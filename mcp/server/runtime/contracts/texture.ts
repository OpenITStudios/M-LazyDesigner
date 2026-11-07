/// <reference types="blockbench-types" />

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  getAllToolDefinitions,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import { resolveCoreTexture } from "@/lib/core/identity";
import { imageContent } from "@/lib/protocol/imageContent";
import {
  buildTextureEvidenceSnapshot,
  buildTextureCraftEvidence,
  focusedGetTextureParameters,
} from "@/lib/texture/evidence";
import {
  buildTextureEvidenceDeliveryMetadata,
  requireStableTextureEvidenceIdentity,
  type TextureEvidenceSourceIdentity,
} from "@/lib/texture/evidenceDelivery";
import {
  createTextureVariantParameters,
  planTextureVariantFromBase,
  reconcileTextureVariantNativeContinuity,
  chooseTextureVariantNativeFailureRecovery,
  textureVariantNativeInventoryIntact,
  type TextureVariantNativeTextureIdentity,
  type TextureVariantSource,
} from "@/lib/texture/variantPlan";
import { textureIdSchema } from "@/lib/schemas/ids";
import {
  fullTextureRgba,
  requireUnchangedTextureBitmap,
  rgbaToPngDataUrl,
} from "@/lib/texture/bitmapRuntime";
import { createTextureParameters } from "../../tools/texture/createSchema";
import { collectUvAtlasUsages } from "../../tools/texture/atlas";

export const wiredCreateTextureParameters = z.union([
  createTextureParameters,
  createTextureVariantParameters,
]);

type RuntimeToolDefinition = {
  inputSchema: Record<string, z.ZodType>;
  parameterSchema: z.ZodType;
  execute: (
    args: Record<string, unknown>,
    context?: unknown
  ) => Promise<unknown>;
};

let textureRuntimeContractsWired = false;

function requireRuntimeToolDefinition(name: string): RuntimeToolDefinition {
  const definitions = getAllToolDefinitions() as unknown as Record<
    string,
    RuntimeToolDefinition
  >;
  const definition = definitions[name];
  if (!definition) {
    throw new Error(
      `Cannot wire ${name}: its canonical runtime definition is unavailable.`
    );
  }
  return definition;
}

function textureGroupByReference(reference: string): TextureGroup {
  const groups = TextureGroup.all ?? [];
  const uuidMatch = groups.find((group) => group.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = groups.filter((group) => group.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `TextureGroup name "${reference}" is ambiguous. Pass the TextureGroup UUID.`
    );
  }
  throw new Error(
    `TextureGroup "${reference}" was not found. Use add_texture_group first and pass its UUID or unique exact name.`
  );
}

function textureProductionRoleForVariant(texture: Texture): TextureVariantSource["role"] {
  const channel = texture.pbr_channel ?? "color";
  if (channel !== "color") return "pbr_support";
  if (!texture.group) return "base_color_candidate";
  const group = TextureGroup.all.find((candidate) => candidate.uuid === texture.group);
  return group?.is_material === false ? "explicit_variant" : "base_color_candidate";
}

function variantSource(texture: Texture): TextureVariantSource {
  return {
    uuid: texture.uuid,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    role: textureProductionRoleForVariant(texture),
  };
}


function nativeVariantTextureIdentity(texture: Texture): TextureVariantNativeTextureIdentity {
  return {
    uuid: texture.uuid,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    display_height: texture.display_height ?? texture.height,
    uv_width: texture.getUVWidth(),
    uv_height: texture.getUVHeight(),
    group_uuid: texture.group || null,
    pbr_channel: texture.pbr_channel ?? "color",
  };
}

/** Transaction-local native appearance evidence, not a public receipt. */
function nativeVariantAppearanceIdentity(texture: Texture) {
  return JSON.stringify([
    texture.render_mode ?? null, texture.render_sides ?? null,
    texture.wrap_mode ?? null, texture.visible ?? null,
    texture.use_as_default ?? null, texture.frame_time ?? null,
    texture.frame_order_type ?? null, texture.frame_order ?? null,
    texture.frame_interpolate ?? null,
  ]);
}

/** Existing atlas usage collector owns native Cube face/UV references. */
function currentVariantMappedUvIdentity() {
  const faces = collectUvAtlasUsages()
    .slice()
    .sort((a, b) =>
      a.cube_uuid.localeCompare(b.cube_uuid) || a.face.localeCompare(b.face)
    );
  return {
    mapped_face_count: faces.length,
    mapped_face_sha256: "sha256:" + createHash("sha256")
      .update(JSON.stringify(faces)).digest("hex"),
    project_logical_uv: [
      Project?.texture_width ?? 0,
      Project?.texture_height ?? 0,
    ] as [number, number],
  };
}

/** Existing internal executor, exported only for disposable fake-native regression. */
export async function createTextureVariant(request: z.infer<typeof createTextureVariantParameters>) {
  const source = resolveCoreTexture(
    request.source_texture_id,
    "Use list_textures to identify the single established base-color atlas."
  );
  const targetGroup = textureGroupByReference(request.group);
  const sources = Texture.all.map(variantSource);
  const plan = planTextureVariantFromBase({
    source: variantSource(source),
    base_color_candidates: sources.filter(
      (candidate) => candidate.role === "base_color_candidate"
    ),
    target_group: {
      uuid: targetGroup.uuid,
      name: targetGroup.name,
      is_material: targetGroup.is_material,
    },
    requested_name: request.name,
    existing_texture_names: Texture.all.map((texture) => texture.name),
  });

  if (Undo.current_save) {
    throw new Error("TEXTURE_VARIANT_UNDO_ALREADY_ACTIVE");
  }
  if (!Project?.uuid) {
    throw new Error("TEXTURE_VARIANT_NATIVE_PROJECT_UNAVAILABLE");
  }
  // Project UUID alone is insufficient across reload/open transitions: the
  // native Project object must also remain the transaction's original owner.
  const projectOwner = Project;
  // Read actual native data before edit. This is not a caller-supplied
  // appearance hash; it is bound to this Project and Texture instance.
  const sourceBitmap = fullTextureRgba(source);
  const sourceBefore = nativeVariantTextureIdentity(source);
  const sourceAppearanceBefore = nativeVariantAppearanceIdentity(source);
  if (sourceBitmap.width !== plan.bitmap.width ||
      sourceBitmap.height !== plan.bitmap.height) {
    throw new Error("TEXTURE_VARIANT_NATIVE_SOURCE_BITMAP_MISMATCH");
  }
  const precommit = {
    project_uuid: Project.uuid,
    source: sourceBefore,
    mapping: currentVariantMappedUvIdentity(),
    source_rgba_revision: "sha256:" + sourceBitmap.width + "x" +
      sourceBitmap.height + ":" + createHash("sha256")
        .update(sourceBitmap.pixels).digest("hex"),
  };
  const textureInventoryBefore = [...Texture.all];
  if (!Texture.all.includes(source) ||
      !textureVariantNativeInventoryIntact(textureInventoryBefore, Texture.all)) {
    throw new Error("TEXTURE_VARIANT_NATIVE_BASE_INVENTORY_AMBIGUOUS");
  }
  // TextureGroup is independently mutable. Listener changes to its membership
  // or metadata during async decode must not be undone as though owned here.
  const groupInventoryBefore = TextureGroup.all.map(group => ({
    owner: group, uuid: group.uuid, name: group.name,
    is_material: group.is_material,
  }));
  const textureGroupsUnchanged = () =>
    TextureGroup.all.length === groupInventoryBefore.length &&
    TextureGroup.all.every((group, index) => {
      const original = groupInventoryBefore[index];
      return group === original?.owner &&
        group.uuid === original.uuid &&
        group.name === original.name &&
        group.is_material === original.is_material;
    });

  // A history snapshot lets failure recovery reject asynchronous edits by a
  // different owner, even if they happened on the same Project instance.
  const undoSystemOwner = Undo;
  const historyBefore = [...Undo.history];
  const undoIndexBefore = Undo.index;
  const undoHistoryUnchanged = () =>
    Undo.index === undoIndexBefore &&
    Undo.history.length === historyBefore.length &&
    Undo.history.every((entry, i) => entry === historyBefore[i]);
  let undoOwner: typeof Undo.current_save;
  const initAspects = { textures: [], collections: [] };
  try {
    Undo.initEdit(initAspects);
    undoOwner = Undo.current_save;
    // UndoSystem.save retains the exact init aspects with empty texture and
    // collection snapshots. init_edit listeners run before initEdit returns,
    // so foreign edits must be refused before constructing a candidate.
    const save = undoOwner as unknown as {
      aspects?: unknown; textures?: Record<string, unknown>;
      collections?: Record<string, unknown>;
    } | undefined;
    if (!save || save.aspects !== initAspects ||
        initAspects.textures.length !== 0 ||
        initAspects.collections.length !== 0 ||
        !save.textures || Object.keys(save.textures).length !== 0 ||
        !save.collections || Object.keys(save.collections).length !== 0 ||
        Undo !== undoSystemOwner ||
        Project !== projectOwner ||
        Project?.uuid !== precommit.project_uuid ||
        !undoHistoryUnchanged() ||
        !textureVariantNativeInventoryIntact(textureInventoryBefore, Texture.all) ||
        !textureGroupsUnchanged() ||
        JSON.stringify(nativeVariantTextureIdentity(source)) !==
          JSON.stringify(precommit.source) ||
        nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
        JSON.stringify(currentVariantMappedUvIdentity()) !==
          JSON.stringify(precommit.mapping)) {
      throw new Error("TEXTURE_VARIANT_UNDO_INIT_STATE_UNVERIFIED");
    }
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(source),
      "TEXTURE_VARIANT_UNDO_INIT_SOURCE_CHANGED"
    );
  } catch (error) {
    // initEdit/create_undo_save/init_edit may have opened a foreign or
    // incomplete transaction; no candidate has been created yet.
    throw new Error(
      "TEXTURE_VARIANT_UNDO_INIT_OUTCOME_UNKNOWN: inspect editor before retrying.",
      { cause: error }
    );
  }
  let commitAttempted = false;
  let nativeContinuity!: ReturnType<typeof reconcileTextureVariantNativeContinuity>;
  let variant: Texture | undefined;
  let variantAppearanceAfterAdd = "";
  try {
    variant = new Texture({
      name: plan.requested_name,
      width: source.width,
      height: source.height,
      keep_size: true,
      group: targetGroup.uuid,
      pbr_channel: "color",
      render_mode: source.render_mode,
      render_sides: source.render_sides,
      wrap_mode: source.wrap_mode,
      frame_time: source.frame_time,
      frame_order_type: source.frame_order_type,
      frame_order: source.frame_order,
      frame_interpolate: source.frame_interpolate,
      internal: true,
    }).fromDataURL(source.getDataURL());

    variant.group = targetGroup.uuid;
    variant.pbr_channel = "color";
    variant.uv_width = source.uv_width;
    variant.uv_height = source.uv_height;
    const addResult: unknown = variant.add(false, false);
    // Native Texture.add registers the object before dispatching add_texture.
    // Refuse listener changes before yielding to the image decoder.
    if (addResult !== variant ||
        Undo !== undoSystemOwner ||
        Undo.current_save !== undoOwner ||
        Project !== projectOwner ||
        Project?.uuid !== precommit.project_uuid ||
        !undoHistoryUnchanged() ||
        !textureGroupsUnchanged() ||
        !textureVariantNativeInventoryIntact(
          textureInventoryBefore, Texture.all, variant
        ) ||
        !Texture.all.includes(variant) ||
        variant.uuid === source.uuid ||
        variant.name !== plan.requested_name ||
        variant.group !== plan.target_group_uuid ||
        variant.pbr_channel !== "color" ||
        JSON.stringify(nativeVariantTextureIdentity(source)) !==
          JSON.stringify(precommit.source) ||
        nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
        JSON.stringify(currentVariantMappedUvIdentity()) !==
          JSON.stringify(precommit.mapping)) {
      throw new Error("TEXTURE_VARIANT_ADD_TEXTURE_STATE_DRIFT");
    }
    // Texture.add() may legitimately adjust the new Texture's material mode.
    // Bind the native result after add_texture, then guard later listener drift.
    variantAppearanceAfterAdd = nativeVariantAppearanceIdentity(variant);
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(source),
      "TEXTURE_VARIANT_ADD_TEXTURE_SOURCE_CHANGED"
    );
    await variant.img.decode();
    // Keep the precommit check synchronous: no more yield is allowed while
    // the mutation is open. Reject a changed source, project or UV map rather
    // than presenting a stale variant_creation success receipt.
    if (Undo !== undoSystemOwner || Undo.current_save !== undoOwner) {
      throw new Error("TEXTURE_VARIANT_UNDO_OWNERSHIP_LOST");
    }
    if (Project !== projectOwner ||
        Project?.uuid !== precommit.project_uuid) {
      throw new Error("TEXTURE_VARIANT_PROJECT_OWNERSHIP_LOST");
    }
    if (!undoHistoryUnchanged()) {
      // A concurrent edit may have committed while the async decoder yielded.
      // The original Undo transaction is no longer safe to finish or cancel.
      throw new Error("TEXTURE_VARIANT_UNDO_HISTORY_CHANGED_DURING_DECODE");
    }
    if (!textureGroupsUnchanged()) {
      throw new Error("TEXTURE_VARIANT_NATIVE_TEXTURE_GROUP_INVENTORY_DRIFT");
    }
    if (nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
        nativeVariantAppearanceIdentity(variant) !== variantAppearanceAfterAdd) {
      throw new Error("TEXTURE_VARIANT_NATIVE_APPEARANCE_DRIFT");
    }
    const sourceNow = fullTextureRgba(source);
    requireUnchangedTextureBitmap(
      sourceBitmap, sourceNow,
      "TEXTURE_VARIANT_NATIVE_SOURCE_RGBA_CHANGED"
    );
    const variantNow = fullTextureRgba(variant);
    requireUnchangedTextureBitmap(
      sourceBitmap, variantNow,
      "TEXTURE_VARIANT_NATIVE_VARIANT_RGBA_MISMATCH"
    );
    const ownedGroup = TextureGroup.all.filter(
      group => group.uuid === targetGroup.uuid
    );
    if (!Texture.all.includes(variant) ||
        !textureVariantNativeInventoryIntact(
          textureInventoryBefore, Texture.all, variant
        )) {
      throw new Error("TEXTURE_VARIANT_NATIVE_TEXTURE_INVENTORY_DRIFT");
    }
    nativeContinuity = reconcileTextureVariantNativeContinuity(
      plan, precommit, {
        project_uuid: Project?.uuid ?? "",
        source: nativeVariantTextureIdentity(source),
        variant: nativeVariantTextureIdentity(variant),
        mapping: currentVariantMappedUvIdentity(),
        target_group_uuid: targetGroup.uuid,
        target_group_is_valid: ownedGroup.length === 1 &&
          ownedGroup[0] === targetGroup &&
          targetGroup.name === plan.target_group_name &&
          targetGroup.is_material === false,
        source_remains_base_color:
          textureProductionRoleForVariant(source) === "base_color_candidate",
        source_registered_once: Texture.all.includes(source) &&
          Texture.all.filter(item => item.uuid === source.uuid).length === 1,
        variant_registered_once: Texture.all.includes(variant) &&
          Texture.all.filter(item => item.uuid === variant.uuid).length === 1,
        variant_name_count: Texture.all.filter(
          item => item.name === variant.name
        ).length,
        source_rgba_unchanged: true,
        variant_rgba_matches_source: true,
      }
    );

    // Blockbench dispatches finish_edit BEFORE the Undo post-save and
    // finished_edit AFTER committing the history entry. Both may invoke
    // extension listeners that mutate Texture or TextureGroup state.
    const variantBeforeFinish = nativeVariantTextureIdentity(variant);
    const variantIdBeforeFinish = variant.id;
    // After attempting finishEdit, outcome is uncertain even if its listener
    // fails before the history entry is recorded. Never auto-rollback.
    commitAttempted = true;
    const committedEntry = Undo.finishEdit("Agent created texture variant", {
      textures: [variant],
      collections: [],
    });
    const commitSnapshot = committedEntry as unknown as {
      before?: { textures?: Record<string, unknown> };
      post?: { textures?: Record<string, { uuid?: unknown; name?: unknown }> };
    } | undefined;
    const beforeTextures = commitSnapshot?.before?.textures;
    const postTextures = commitSnapshot?.post?.textures;
    const recordedVariant = postTextures?.[variantBeforeFinish.uuid];
    // The real UndoSystem.save snapshots a map keyed by the Texture UUID.
    // A matching history object alone does not guarantee undo/redo captured
    // the intended new Texture instead of a listener-modified aspect list.
    if (!committedEntry || Undo.index < 1 ||
        Undo.history[Undo.index - 1] !== committedEntry ||
        commitSnapshot?.before !== undoOwner ||
        !beforeTextures || Object.keys(beforeTextures).length !== 0 ||
        !postTextures || Object.keys(postTextures).length !== 1 ||
        !Object.hasOwn(postTextures, variantBeforeFinish.uuid) ||
        recordedVariant?.uuid !== variantBeforeFinish.uuid ||
        recordedVariant?.name !== variantBeforeFinish.name) {
      throw new Error("TEXTURE_VARIANT_UNDO_COMMIT_ENTRY_UNVERIFIED");
    }
    const groupAfterFinish = TextureGroup.all.filter(
      group => group.uuid === targetGroup.uuid
    );
    // Never publish a receipt for a renamed/regrouped variant or mutated
    // material group, even if source/variant pixel bytes still match.
    if (Project !== projectOwner ||
        Project?.uuid !== precommit.project_uuid ||
        Undo !== undoSystemOwner ||
        Undo.current_save ||
        !Texture.all.includes(variant) ||
        !textureVariantNativeInventoryIntact(
          textureInventoryBefore, Texture.all, variant
        ) ||
        !textureGroupsUnchanged() ||
        Texture.all.filter(item => item.uuid === variant.uuid).length !== 1 ||
        !Texture.all.includes(source) ||
        Texture.all.filter(item => item.uuid === source.uuid).length !== 1 ||
        groupAfterFinish.length !== 1 ||
        groupAfterFinish[0] !== targetGroup ||
        targetGroup.name !== plan.target_group_name ||
        targetGroup.is_material !== false ||
        textureProductionRoleForVariant(source) !== "base_color_candidate" ||
        nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
        nativeVariantAppearanceIdentity(variant) !== variantAppearanceAfterAdd ||
        variant.id !== variantIdBeforeFinish ||
        JSON.stringify(nativeVariantTextureIdentity(variant)) !==
          JSON.stringify(variantBeforeFinish) ||
        Texture.all.filter(item => item.name === variantBeforeFinish.name).length !== 1 ||
        JSON.stringify(nativeVariantTextureIdentity(source)) !==
          JSON.stringify(precommit.source) ||
        JSON.stringify(currentVariantMappedUvIdentity()) !==
          JSON.stringify(precommit.mapping)) {
      throw new Error("TEXTURE_VARIANT_POSTCOMMIT_STATE_UNVERIFIED");
    }
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(source),
      "TEXTURE_VARIANT_POSTCOMMIT_SOURCE_BITMAP_CHANGED"
    );
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(variant),
      "TEXTURE_VARIANT_POSTCOMMIT_VARIANT_BITMAP_CHANGED"
    );
  } catch (error) {
    const projectUnchanged = Project === projectOwner &&
      Project?.uuid === precommit.project_uuid;
    const undoOwned = Undo === undoSystemOwner &&
      Undo.current_save === undoOwner;
    let sourceUnchanged = false;
    let uvUnchanged = false;
    // Reads are best-effort only; failure to observe means NO rollback.
    if (!commitAttempted && projectUnchanged && undoOwned) {
      try {
        sourceUnchanged =
          Texture.all.includes(source) &&
          Texture.all.filter(item => item.uuid === source.uuid).length === 1 &&
          JSON.stringify(nativeVariantTextureIdentity(source)) ===
            JSON.stringify(precommit.source) &&
          nativeVariantAppearanceIdentity(source) === sourceAppearanceBefore;
        if (sourceUnchanged) {
          requireUnchangedTextureBitmap(
            sourceBitmap, fullTextureRgba(source),
            "TEXTURE_VARIANT_ROLLBACK_SOURCE_CHANGED"
          );
        }
        uvUnchanged = JSON.stringify(currentVariantMappedUvIdentity()) ===
          JSON.stringify(precommit.mapping);
      } catch {
        sourceUnchanged = false;
        uvUnchanged = false;
      }
    }
    let inventoryIntact = false;
    let groupsIntact = false;
    if (projectUnchanged) {
      try {
        // A constructor/fromDataURL/add failure can register a partial
        // object before variant is assigned. Unowned drift forbids rollback.
        inventoryIntact = textureVariantNativeInventoryIntact(
          textureInventoryBefore, Texture.all, variant
        );
        groupsIntact = textureGroupsUnchanged();
      } catch {
        inventoryIntact = false;
        groupsIntact = false;
      }
    }
    const decision = chooseTextureVariantNativeFailureRecovery({
      commit_attempted: commitAttempted,
      project_unchanged: projectUnchanged,
      undo_owned: undoOwned,
      history_unchanged: undoHistoryUnchanged(),
      source_unchanged: sourceUnchanged,
      uv_unchanged: uvUnchanged,
      texture_inventory_unchanged_except_candidate: inventoryIntact,
      texture_group_inventory_unchanged: groupsIntact,
    });
    if (decision !== "ROLLBACK_OWNED_PRECOMMIT") {
      throw new Error(
        "TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN: native ownership, " +
        "source/UV integrity, or commit outcome cannot be established. " +
        "Inspect project, textures and Undo before any retry.",
        { cause: error }
      );
    }
    try {
      if (variant && Texture.all.includes(variant)) {
        variant.remove(true);
      }
      // remove() can itself invoke Blockbench listeners; re-check the
      // owner before touching Undo or another Project's transaction.
      if (Project !== projectOwner ||
          Project?.uuid !== precommit.project_uuid ||
          Undo !== undoSystemOwner ||
          Undo.current_save !== undoOwner ||
          !textureGroupsUnchanged()) {
        throw new Error("TEXTURE_VARIANT_ROLLBACK_OWNERSHIP_LOST");
      }
      Undo.cancelEdit();
      if (Undo !== undoSystemOwner ||
          Undo.current_save ||
          !undoHistoryUnchanged() ||
          Project !== projectOwner ||
          Project?.uuid !== precommit.project_uuid ||
          (variant && Texture.all.includes(variant)) ||
          !textureVariantNativeInventoryIntact(
            textureInventoryBefore, Texture.all
          ) ||
          !textureGroupsUnchanged() ||
          !Texture.all.includes(source) ||
          Texture.all.filter(item => item.uuid === source.uuid).length !== 1 ||
          JSON.stringify(nativeVariantTextureIdentity(source)) !==
            JSON.stringify(precommit.source) ||
          nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
          JSON.stringify(currentVariantMappedUvIdentity()) !==
            JSON.stringify(precommit.mapping)) {
        throw new Error("TEXTURE_VARIANT_ROLLBACK_POSTCONDITION_FAILED");
      }
      requireUnchangedTextureBitmap(
        sourceBitmap, fullTextureRgba(source),
        "TEXTURE_VARIANT_ROLLBACK_SOURCE_PIXELS_NOT_RESTORED"
      );
      Canvas.updateAll();
    } catch (rollbackError) {
      throw new Error(
        "TEXTURE_VARIANT_ROLLBACK_UNVERIFIED: inspect the current " +
        "project, texture inventory and Undo history before retrying.",
        { cause: new AggregateError([error, rollbackError],
          "Variant creation and rollback errors") }
      );
    }
    throw error;
  }

  // The native transaction has finished. Keep a bounded exact snapshot
  // around final redraw: Canvas.updateAll can dispatch further listeners.
  // A redraw that returns normally must not turn altered native state into
  // a stale successful creation receipt. Never retry an already committed edit.
  const sourceBeforeRedraw = nativeVariantTextureIdentity(source);
  const variantBeforeRedraw = nativeVariantTextureIdentity(variant);
  const variantIdBeforeRedraw = variant.id;
  const historyBeforeRedraw = [...Undo.history];
  const undoIndexBeforeRedraw = Undo.index;
  try {
    Canvas.updateAll();
    if (Undo !== undoSystemOwner ||
        Undo.current_save ||
        Undo.index !== undoIndexBeforeRedraw ||
        Undo.history.length !== historyBeforeRedraw.length ||
        Undo.history.some((entry, index) => entry !== historyBeforeRedraw[index]) ||
        Project !== projectOwner ||
        Project?.uuid !== precommit.project_uuid ||
        !textureVariantNativeInventoryIntact(
          textureInventoryBefore, Texture.all, variant
        ) ||
        !textureGroupsUnchanged() ||
        variant.id !== variantIdBeforeRedraw ||
        JSON.stringify(nativeVariantTextureIdentity(variant)) !==
          JSON.stringify(variantBeforeRedraw) ||
        JSON.stringify(nativeVariantTextureIdentity(source)) !==
          JSON.stringify(sourceBeforeRedraw) ||
        nativeVariantAppearanceIdentity(source) !== sourceAppearanceBefore ||
        nativeVariantAppearanceIdentity(variant) !== variantAppearanceAfterAdd ||
        JSON.stringify(currentVariantMappedUvIdentity()) !==
          JSON.stringify(precommit.mapping)) {
      throw new Error("TEXTURE_VARIANT_POSTREDRAW_STATE_DRIFT");
    }
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(source),
      "TEXTURE_VARIANT_POSTREDRAW_SOURCE_RGBA_CHANGED"
    );
    requireUnchangedTextureBitmap(
      sourceBitmap, fullTextureRgba(variant),
      "TEXTURE_VARIANT_POSTREDRAW_VARIANT_RGBA_CHANGED"
    );
  } catch (error) {
    throw new Error(
      "TEXTURE_VARIANT_POSTCOMMIT_DISPLAY_UNVERIFIED: the variant may " +
      "already be committed; inspect native editor state before retrying.",
      { cause: error }
    );
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `Created explicit texture variant "${variant.name}" (${variant.uuid}) from base "${source.name}".`,
      },
    ],
    structuredContent: {
      texture: {
        uuid: variant.uuid,
        id: variant.id,
        name: variant.name,
        width: variant.width,
        height: variant.height,
        group: variant.group,
        pbr_channel: variant.pbr_channel,
      },
      variant_creation: plan,
      variant_native_continuity: nativeContinuity,
    },
  };
}

function textureEvidenceSourceIdentity(
  texture: Texture
): TextureEvidenceSourceIdentity {
  return {
    uuid: texture.uuid,
    id: texture.id,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    display_height: texture.display_height,
    uv_width: texture.getUVWidth(),
    uv_height: texture.getUVHeight(),
  };
}

async function getFocusedTextureEvidence(request: z.infer<typeof focusedGetTextureParameters>) {
  const available = Project?.textures ?? Texture.all;
  if (!request.texture && available.length > 1) {
    throw new Error(
      "Multiple textures are loaded. Pass texture explicitly so get_texture returns evidence for the intended atlas."
    );
  }
  const texture = request.texture
    ? resolveCoreTexture(
        request.texture,
        "Use list_textures to confirm the intended texture UUID or unique exact name."
      )
    : Texture.getDefault();
  if (!texture) {
    throw new Error("No texture is available. Use create_texture first.");
  }

  const bitmap = fullTextureRgba(texture);
  const sourceIdentity = textureEvidenceSourceIdentity(texture);
  const snapshot = await buildTextureEvidenceSnapshot(
    bitmap.pixels,
    bitmap.width,
    bitmap.height,
    {
      region: request.region,
      expected_revision: request.expected_revision,
    }
  );
  // Revision hashing above is asynchronous. Ensure the bitmap and frame/UV
  // metadata still belong to that exact decoded source before the PNG/result
  // can be presented as current evidence. Both checks are synchronous.
  requireStableTextureEvidenceIdentity(
    sourceIdentity,
    textureEvidenceSourceIdentity(texture)
  );
  requireUnchangedTextureBitmap(
    bitmap,
    fullTextureRgba(texture),
    "get_texture decoded bitmap changed during evidence readback. Refresh the full-bitmap revision and retry."
  );
  const metadata = buildTextureEvidenceDeliveryMetadata({
    inspection: snapshot.inspection,
    revision: snapshot.revision,
    bitmap: snapshot.bitmap,
    region: snapshot.region,
    display_height: sourceIdentity.display_height,
    source_byte_length: snapshot.byte_length,
    uv_width: sourceIdentity.uv_width,
    uv_height: sourceIdentity.uv_height,
  });
  const craft = buildTextureCraftEvidence(snapshot);
  const png = rgbaToPngDataUrl(
    snapshot.rgba,
    snapshot.region.width,
    snapshot.region.height
  );
  const image = imageContent(png, "image/png");

  return {
    ...image,
    structuredContent: {
      ...metadata,
      ...craft,
      texture: sourceIdentity,
    },
  };
}

export function wireTextureRuntimeContracts(): void {
  if (textureRuntimeContractsWired) return;

  const createDefinition = requireRuntimeToolDefinition("create_texture");
  const originalCreate = createDefinition.execute.bind(createDefinition);
  createDefinition.parameterSchema = wiredCreateTextureParameters;
  createDefinition.inputSchema = {
    ...createDefinition.inputSchema,
    type: z
      .enum(["blank", "template", "variant"])
      .default("blank")
      .describe("Texture creation mode. variant duplicates the established base atlas into an explicit non-material group."),
    source_texture_id: textureIdSchema
      .optional()
      .describe("Required only when type=variant: established base-color texture UUID/ID/unique exact name."),
  };
  createDefinition.execute = async (args, context) => {
    if (args.type === "variant") {
      return createTextureVariant(
        createTextureVariantParameters.parse(args)
      );
    }
    return originalCreate(args, context);
  };

  const getDefinition = requireRuntimeToolDefinition("get_texture");
  getDefinition.parameterSchema = focusedGetTextureParameters;
  getDefinition.inputSchema = focusedGetTextureParameters.shape;
  getDefinition.execute = async (args) =>
    getFocusedTextureEvidence(focusedGetTextureParameters.parse(args));

  textureRuntimeContractsWired = true;
  invalidateToolRegistrationRuntimeCaches();
}