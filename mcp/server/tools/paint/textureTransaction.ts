/// <reference types="blockbench-types" />

import { createTool, type ToolSpec } from "@/lib/factories";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { bakeNativeCubeAo } from "@/lib/geometry/cubeAoRuntime";
import { imageContent } from "@/lib/protocol/imageContent";
import { resolvePaintTexture } from "@/lib/texture/selection";
import {
  planFaceScopedTextureSelection,
  type NativeFaceFootprint,
} from "@/lib/texture/selectionPlanning";
import type { TextureTreatmentFace } from "@/lib/texture/treatmentPlan";
import {
  mapFaceUvToTexturePixels,
  requireExactFacePixelGrid,
  requireSupportedFaceRotation,
} from "@/lib/uv/facePixelMapping";
import {
  applyPaintTransactionRgba,
  buildPaintTransactionReceipt,
  paintTransactionParameters,
} from "@/lib/texture/paintTransaction";
import {
  PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  requirePaintTransactionV1Target,
} from "@/lib/texture/paintTransactionPolicy";
import { computeTextureRevision } from "@/lib/texture/revision";
import { applyTextureComputePipeline } from "@/lib/texture/computePipeline";
import { parseTextureComputeRequest } from "@/lib/texture/computeRequest";
import {
  cropRgbaRect,
  fullTextureRgba,
  requireUnchangedTextureBitmap,
  rgbaToPngDataUrl,
} from "@/lib/texture/bitmapRuntime";

export const paintTextureTransactionToolDocs: ToolSpec = {
  name: PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  description:
    "Applies bounded pixel operations, texture compute, or Cube AO with revision protection and one Undo.",
  annotations: {
    title: "Paint Texture Transaction",
    destructiveHint: true,
  },
  parameters: paintTransactionParameters,
  status: "stable",
};

type TexturePngFilesystem = {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array, options?: { flag: "wx" }): void;
  lstatSync(path: string): { isFile(): boolean; size: number };
  linkSync(existingPath: string, newPath: string): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
};

type PreparedTexturePngWrite = {
  path: string;
  overwrite: boolean;
  existed: boolean;
  temp_path: string;
  backup_path: string | null;
  committed: boolean;
  backup_moved: boolean;
  byte_length: number;
  /** The exact file content accepted at preflight, if one existed. */
  original_bytes: Uint8Array | null;
  /** Do not delete a temp sidecar that another writer created. */
  temp_created: boolean;
  /** Exact published content; protects concurrent changes during rollback. */
  published_bytes: Uint8Array | null;
};

function requireTexturePngFilesystem(path: string): TexturePngFilesystem {
  // @ts-ignore - Blockbench desktop provides fs through requireNativeModule.
  const fs = requireNativeModule("fs", {
    message: `LazyDesigner requested write access to save texture PNG ${path}`,
  }) as TexturePngFilesystem | undefined;
  if (!fs) throw new Error("File system access was denied for texture PNG output.");
  return fs;
}

function texturePngBytes(dataUrl: string): Buffer {
  const marker = "data:image/png;base64,";
  if (!dataUrl.startsWith(marker)) {
    throw new Error("Texture PNG encoder did not return a base64 PNG data URL.");
  }
  const bytes = Buffer.from(dataUrl.slice(marker.length), "base64");
  if (bytes.byteLength === 0) throw new Error("Texture PNG encoder returned an empty PNG.");
  return bytes;
}

function uniqueTextureSiblingPath(
  fs: TexturePngFilesystem,
  targetPath: string,
  label: "tmp" | "bak"
): string {
  for (let index = 0; index < 128; index += 1) {
    const candidate = `${targetPath}.blockit-${label}-${process.pid}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a bounded texture ${label} path beside ${targetPath}.`);
}

function sameTexturePngBytes(
  actual: Uint8Array,
  expected: Uint8Array | null
): boolean {
  return expected !== null &&
    actual.byteLength === expected.byteLength &&
    actual.every((value, index) => value === expected[index]);
}

function assertUnchangedPngDestination(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite
): void {
  if (!state.existed) return; // Exclusive publication protects a new path.
  if (!fs.existsSync(state.path)) {
    throw new Error(
      `Texture PNG ${state.path} disappeared since output preflight. Refusing overwrite.`
    );
  }
  const stat = fs.lstatSync(state.path);
  if (
    !stat.isFile() ||
    !sameTexturePngBytes(fs.readFileSync(state.path), state.original_bytes)
  ) {
    throw new Error(
      `Texture PNG ${state.path} changed since output preflight. Refusing overwrite; refresh the destination before retrying.`
    );
  }
}

export function prepareTexturePngWrite(
  path: string,
  overwrite: boolean,
  byteLength: number,
  filesystem?: TexturePngFilesystem
): { fs: TexturePngFilesystem; state: PreparedTexturePngWrite } {
  const fs = filesystem ?? requireTexturePngFilesystem(path);
  const existed = fs.existsSync(path);
  if (existed && !overwrite) {
    throw new Error(`Refusing to replace existing texture PNG ${path} without overwrite=true.`);
  }
  let originalBytes: Uint8Array | null = null;
  if (existed) {
    const stat = fs.lstatSync(path);
    if (!stat.isFile()) {
      throw new Error(`Refusing texture PNG output to a non-regular existing file: ${path}.`);
    }
    originalBytes = fs.readFileSync(path);
    if (originalBytes.byteLength !== stat.size) {
      throw new Error(`Texture PNG ${path} changed while reading the original file.`);
    }
  }
  return {
    fs,
    state: {
      path,
      overwrite,
      existed,
      temp_path: uniqueTextureSiblingPath(fs, path, "tmp"),
      backup_path: existed ? uniqueTextureSiblingPath(fs, path, "bak") : null,
      committed: false,
      backup_moved: false,
      byte_length: byteLength,
      original_bytes: originalBytes,
      temp_created: false,
      published_bytes: null,
    },
  };
}

export function commitTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite,
  bytes: Uint8Array
): void {
  // Reserve the temporary filename exclusively, even if another process
  // creates it after the bounded candidate selection.
  fs.writeFileSync(state.temp_path, bytes, { flag: "wx" });
  state.temp_created = true;
  const tempStat = fs.lstatSync(state.temp_path);
  if (
    !tempStat.isFile() ||
    tempStat.size !== state.byte_length ||
    !sameTexturePngBytes(fs.readFileSync(state.temp_path), bytes)
  ) {
    throw new Error(
      `Temporary texture PNG verification failed for ${state.path}.`
    );
  }

  assertUnchangedPngDestination(fs, state);
  if (state.existed && state.backup_path) {
    if (fs.existsSync(state.backup_path)) {
      throw new Error(
        `Texture PNG backup path ${state.backup_path} became occupied. Refusing overwrite.`
      );
    }
    fs.renameSync(state.path, state.backup_path);
    state.backup_moved = true;
    // Detect an external edit between the content check and backup move.
    // On failure rollback restores the moved file, never the stale snapshot.
    if (!sameTexturePngBytes(
      fs.readFileSync(state.backup_path), state.original_bytes
    )) {
      throw new Error(
        `Texture PNG ${state.path} changed during backup. Refusing overwrite.`
      );
    }
  }

  // Atomically create only when absent, for both new and replacement paths.
  // A concurrent creator after backup move must not be overwritten.
  // Temp and target are siblings, so hard-linking is same-filesystem.
  fs.linkSync(state.temp_path, state.path);
  state.committed = true;
  state.published_bytes = bytes;
  const finalStat = fs.lstatSync(state.path);
  if (
    !finalStat.isFile() ||
    finalStat.size !== state.byte_length ||
    !sameTexturePngBytes(fs.readFileSync(state.path), bytes)
  ) {
    throw new Error(
      `Committed texture PNG verification failed for ${state.path}.`
    );
  }
  fs.unlinkSync(state.temp_path);
  state.temp_created = false;
}

export function rollbackTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite
): void {
  // A newer destination is not owned by this transaction, even on rollback.
  // Preserve the original backup rather than deleting somebody else's file.
  if (state.committed && fs.existsSync(state.path)) {
    if (!sameTexturePngBytes(
      fs.readFileSync(state.path), state.published_bytes
    )) {
      throw new Error(
        `Texture PNG destination changed after publication; preserving the original backup at ${state.backup_path ?? "none"}.`
      );
    }
    fs.unlinkSync(state.path);
  }
  if (state.backup_moved) {
    if (!state.backup_path || !fs.existsSync(state.backup_path)) {
      throw new Error(
        `Original texture PNG backup is missing for ${state.path}; refusing uncertain rollback.`
      );
    }
    if (fs.existsSync(state.path)) {
      throw new Error(
        `Texture PNG destination was recreated concurrently. Refusing to overwrite it; original retained at ${state.backup_path}.`
      );
    }
    fs.renameSync(state.backup_path, state.path);
    state.backup_moved = false;
  }
  // Only clean up a file this transaction successfully created with wx.
  if (state.temp_created && fs.existsSync(state.temp_path)) {
    fs.unlinkSync(state.temp_path);
    state.temp_created = false;
  }
}

function finalizeTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite
): void {
  if (!state.backup_path || !fs.existsSync(state.backup_path)) return;
  try {
    fs.unlinkSync(state.backup_path);
  } catch {
    // The authored PNG and Undo unit are already committed. A stale backup is
    // safer than turning successful authoring into a second rollback attempt.
  }
}


const FACE_RECOLOR_KEYS = ["north","south","east","west","up","down"] as const;

/** Read-only native owner snapshot, recomputed after asynchronous planning. */
function captureNativeFaceRecolorScope(
  texture: Texture, width: number, height: number,
  targets: readonly TextureTreatmentFace[]
) {
  if (typeof Format === "undefined" || Format.id !== "bedrock" ||
      typeof Cube === "undefined" || !Array.isArray(Cube.all) ||
      typeof Texture === "undefined" || !Array.isArray(Texture.all) ||
      typeof Project === "undefined" || !Array.isArray(Project?.textures)) {
    throw new Error("FACE_SCOPE_NATIVE_UNAVAILABLE: requires complete Bedrock Entity Cube/texture state.");
  }
  const channel = (texture as Texture & { pbr_channel?: string }).pbr_channel;
  if (channel && channel !== "color" && channel !== "albedo") {
    throw new Error("FACE_SCOPE_COLOR_ONLY: packed PBR support channels must not be hue-recolored.");
  }
  if (texture.layers_enabled === true || (texture.frameCount ?? 1) !== 1 ||
      texture.height !== texture.display_height ||
      texture.width !== width || texture.height !== height) {
    throw new Error("FACE_SCOPE_UNSUPPORTED_ATLAS: require one flattened physical bitmap frame.");
  }
  const registry=new Set<Texture>(Texture.all);
  const projectTextures=new Set<Texture>(Project.textures);
  if (registry.size !== Texture.all.length ||
      projectTextures.size !== Project.textures.length ||
      registry.size !== projectTextures.size ||
      [...registry].some((t)=>!projectTextures.has(t)) || !registry.has(texture)) {
    throw new Error("FACE_SCOPE_TEXTURE_INVENTORY_INCOMPLETE: nonunique or foreign textures.");
  }
  if (typeof Outliner === "undefined" || !Array.isArray(Outliner.elements) ||
      Cube.all.some((cube)=>!Outliner.elements.includes(cube)) ||
      Outliner.elements.filter((el)=>el instanceof Cube).length !== Cube.all.length ||
      Outliner.elements.some((el)=>!(el instanceof Cube) && typeof el === "object" &&
        el !== null && "faces" in el)) {
    throw new Error("FACE_SCOPE_OUTLINER_INCOMPLETE: cannot attest all texture-capable geometry.");
  }
  const scale={
    width, displayHeight:height,
    uvWidth:texture.getUVWidth(), uvHeight:texture.getUVHeight(),
  };
  const footprints: NativeFaceFootprint[]=[];
  const snapshot: unknown[]=[];
  const ids=new Set<string>();
  for(const cube of [...Cube.all].sort((a,b)=>a.uuid.localeCompare(b.uuid))) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() || ids.has(cube.uuid)) {
      throw new Error("FACE_SCOPE_CUBE_IDENTITY_AMBIGUOUS: unique UUIDs required.");
    }
    ids.add(cube.uuid);
    const boxUv=cube.box_uv===true || (cube.box_uv!==false && Project?.box_uv===true);
    snapshot.push([cube.uuid,cube.from,cube.to,cube.origin,cube.rotation,
      cube.inflate,cube.box_uv,cube.mirror_uv,cube.visibility]);
    for(const key of FACE_RECOLOR_KEYS) {
      const face=cube.faces?.[key];
      if(!face) throw new Error("FACE_SCOPE_FACE_INVENTORY_INCOMPLETE: "+cube.uuid+":"+key);
      const enabled=face.enabled!==false;
      const material=(face as CubeFace & { material_name?: string }).material_name??"";
      if(typeof material!=="string")throw new Error("FACE_SCOPE_MATERIAL_UNRESOLVED");
      if(enabled && typeof face.getTexture!=="function") {
        throw new Error("FACE_SCOPE_TEXTURE_RESOLVER_UNAVAILABLE");
      }
      const bound=enabled?face.getTexture():null;
      if(bound && (!registry.has(bound)||!projectTextures.has(bound))) {
        throw new Error("FACE_SCOPE_FOREIGN_TEXTURE: "+cube.uuid+":"+key);
      }
      if(bound && bound.uuid===texture.uuid && bound!==texture) {
        throw new Error("FACE_SCOPE_TEXTURE_IDENTITY_AMBIGUOUS");
      }
      let rect: [number,number,number,number]|null=null;
      if(enabled && bound===texture) {
        if(boxUv)throw new Error("FACE_SCOPE_BOX_UV_UNVERIFIED: per-face grid ownership required.");
        const label=cube.uuid+":"+key+" selective recolor";
        const mapping=mapFaceUvToTexturePixels(face.uv,scale,label);
        requireExactFacePixelGrid(mapping,label);
        requireSupportedFaceRotation(face.rotation,label);
        rect=mapping.rect;
      }
      footprints.push({cube_uuid:cube.uuid,face:key,enabled,
        texture_uuid:bound?.uuid??null,native_material_name:material,rect});
      snapshot.push([cube.uuid,key,enabled,bound?.uuid??null,
        face.texture,material,face.uv,face.rotation]);
    }
  }
  const plan=planFaceScopedTextureSelection({
    texture_uuid:texture.uuid,bitmap_width:width,bitmap_height:height,
    faces:footprints,face_targets:targets,
  });
  return {...plan,native_snapshot:JSON.stringify([
    texture.uuid,width,height,scale.uvWidth,scale.uvHeight,snapshot,
  ])};
}

export function registerPaintTextureTransactionTool(): void {
  createTool(
    paintTextureTransactionToolDocs.name,
    {
      ...paintTextureTransactionToolDocs,
      parameters: paintTransactionParameters,
      async execute({ texture_id, expected_revision, operations, compute, ambient_occlusion, output }) {
        const texture = resolvePaintTexture(texture_id);
        requirePaintTransactionV1Target({
          texture_uuid: texture.uuid,
          texture_name: texture.name,
          layers_enabled: texture.layers_enabled,
        });

        const before = fullTextureRgba(texture);
        const beforeRevision = await computeTextureRevision(
          before.pixels,
          before.width,
          before.height
        );
        if (beforeRevision !== expected_revision) {
          throw new Error(
            `Texture "${texture.name}" changed since the caller observed it. Expected revision ${expected_revision}, actual ${beforeRevision}. Refresh texture state before retrying the mutation.`
          );
        }

        const computeRequest = compute
          ? parseTextureComputeRequest(compute)
          : null;
        const faceScope = computeRequest?.face_targets
          ? captureNativeFaceRecolorScope(
              texture, before.width, before.height, computeRequest.face_targets
            )
          : null;
        const computeResult = computeRequest
          ? applyTextureComputePipeline(
              before.pixels,
              before.width,
              before.height,
              computeRequest.steps,
              faceScope?.target_rect ?? computeRequest.target_rect ?? undefined,
              faceScope?.target_mask
            )
          : null;
        const applied = computeResult
          ? {
              pixels: computeResult.pixels,
              operation_count: computeResult.receipt.operation_count,
              pixel_writes: computeResult.receipt.changed_pixels,
              affected_rect: computeResult.receipt.changed_rect!,
            }
          : ambient_occlusion
            ? bakeNativeCubeAo(
                texture,
                before.pixels,
                before.width,
                before.height,
                ambient_occlusion
              )
            : applyPaintTransactionRgba(
                before.pixels,
                before.width,
                before.height,
                operations!
              );
        const plannedAfterRevision = await computeTextureRevision(
          applied.pixels,
          before.width,
          before.height
        );
        const plannedReceipt = buildPaintTransactionReceipt({
          texture_uuid: texture.uuid,
          texture_name: texture.name,
          before_revision: beforeRevision,
          after_revision: plannedAfterRevision,
          operation_count: applied.operation_count,
          pixel_writes: applied.pixel_writes,
          affected_rect: applied.affected_rect,
        });
        const dirtyRegion = cropRgbaRect(
          applied.pixels,
          before.width,
          before.height,
          plannedReceipt.affected_rect
        );
        const outputBytes = output
          ? texturePngBytes(rgbaToPngDataUrl(applied.pixels, before.width, before.height))
          : null;
        const preparedOutput = output && outputBytes
          ? prepareTexturePngWrite(output.path, output.overwrite === true, outputBytes.byteLength)
          : null;

        // Planning includes asynchronous revision hashing. Native edits may
        // occur between the caller's initial revision check and this point.
        // Recheck the entire RGBA source synchronously before opening Undo or
        // overwriting the dirty region with a stale planned candidate.
        requireUnchangedTextureBitmap(before, fullTextureRgba(texture));
        const requireCurrentFaceScope = () => {
          if (!faceScope || !computeRequest?.face_targets) return;
          const current = captureNativeFaceRecolorScope(
            texture, before.width, before.height, computeRequest.face_targets
          );
          if (current.native_snapshot !== faceScope.native_snapshot) {
            throw new Error("FACE_SCOPE_STALE_NATIVE_STATE: UV/material/geometry changed during planning.");
          }
        };
        requireCurrentFaceScope();

        const undoAspects: UndoAspects = {
          bitmap: true,
          textures: [texture],
        };
        Undo.initEdit(undoAspects);
        try {
          texture.edit(
            (
              canvas: HTMLCanvasElement,
              env: BlockbenchRuntimeTextureEditEnvironment
            ) => {
              const activeOffset =
                Array.isArray(env.offset) && env.offset.length === 2
                  ? env.offset
                  : [0, 0];
              const localX = dirtyRegion.left - activeOffset[0];
              const localY = dirtyRegion.top - activeOffset[1];
              const canvasWidth =
                canvas && Number.isFinite(canvas.width)
                  ? canvas.width
                  : before.width;
              const canvasHeight =
                canvas && Number.isFinite(canvas.height)
                  ? canvas.height
                  : before.height;
              if (
                localX < 0 ||
                localY < 0 ||
                localX + dirtyRegion.width > canvasWidth ||
                localY + dirtyRegion.height > canvasHeight
              ) {
                throw new Error(
                  "Paint transaction dirty region falls outside the active texture canvas."
                );
              }
              const imageData = env.ctx.createImageData(
                dirtyRegion.width,
                dirtyRegion.height
              );
              imageData.data.set(dirtyRegion.pixels);
              env.ctx.putImageData(imageData, localX, localY);
            },
            { no_undo: true }
          );

          const actualAfter = fullTextureRgba(texture);
          const actualAfterRevision = await computeTextureRevision(
            actualAfter.pixels,
            actualAfter.width,
            actualAfter.height
          );
          if (actualAfterRevision !== plannedAfterRevision) {
            throw new Error(
              `Paint transaction postcondition mismatch: planned revision ${plannedAfterRevision}, actual ${actualAfterRevision}.`
            );
          }

          // The postcondition digest above is asynchronous. Recheck the
          // verified full bitmap immediately before filesystem publication
          // and Undo.finishEdit; a newer native frame edit must not inherit
          // this transaction's old receipt or output PNG.
          requireUnchangedTextureBitmap(
            actualAfter,
            fullTextureRgba(texture),
            "Paint transaction bitmap changed after postcondition verification. Refusing stale PNG publication and Undo completion."
          );
          requireCurrentFaceScope();
          if (preparedOutput && outputBytes) {
            commitTexturePngWrite(preparedOutput.fs, preparedOutput.state, outputBytes);
          }
          Undo.finishEdit("Paint texture transaction");
          recordCurrentCapabilitySemanticHistoryEffect("paint_texture_transaction");
          if (preparedOutput) {
            finalizeTexturePngWrite(preparedOutput.fs, preparedOutput.state);
          }
        } catch (error) {
          if (preparedOutput) {
            try {
              rollbackTexturePngWrite(preparedOutput.fs, preparedOutput.state);
            } catch (rollbackError) {
              const reason = error instanceof Error ? error.message : String(error);
              const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
              Undo.cancelEdit(true);
              Canvas.updateAll();
              throw new Error(`${reason} Texture PNG rollback also reported: ${rollbackReason}`);
            }
          }
          Undo.cancelEdit(true);
          Canvas.updateAll();
          throw error;
        }

        Canvas.updateAll();
        let affectedRegionImage: ReturnType<typeof imageContent>["content"][number] | null = null;
        try {
          // The full postcondition read above already proved that the authored
          // bitmap matches applied.pixels. Reuse the verified candidate rather
          // than reading the entire atlas a third time just to crop evidence.
          affectedRegionImage = imageContent(
            rgbaToPngDataUrl(
              dirtyRegion.pixels,
              dirtyRegion.width,
              dirtyRegion.height
            )
          ).content[0];
        } catch {
          // Visual evidence is optional optimization. DOM/image encoding may be
          // unavailable in headless Runtime verification; authored mutation and
          // revision proof remain valid and Control will request follow-up read.
        }
        const outputReceipt = preparedOutput
          ? {
              path: preparedOutput.state.path,
              byte_length: preparedOutput.state.byte_length,
              replaced_existing: preparedOutput.state.existed,
              verified: true as const,
            }
          : null;
        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${plannedReceipt.operation_count} texture operation(s) as one Undo transaction on "${texture.name}"${outputReceipt ? `; verified PNG saved to ${outputReceipt.path}` : ""}.${affectedRegionImage ? " The attached PNG is the exact affected atlas region after mutation." : ""}`,
            },
            ...(affectedRegionImage ? [affectedRegionImage] : []),
          ],
          structuredContent: {
            ...plannedReceipt,
            compute: computeResult
              ? {
                  operation_count:
                    computeResult.receipt.operation_count,
                  operations: computeResult.receipt.operations,
                  changed_pixels:
                    computeResult.receipt.changed_pixels,
                  execution: computeResult.receipt.execution,
                  ...(faceScope ? { face_scope: {
                    scope: "explicit_cube_faces" as const,
                    face_count: faceScope.face_count,
                    covered_pixels: faceScope.covered_pixels,
                    native_material_name: faceScope.native_material_name,
                    material_identity: faceScope.material_identity,
                    note: faceScope.note,
                  }} : {}),
                }
              : null,
            visual_evidence: affectedRegionImage
              ? {
                  kind: "affected_region_png",
                  affected_rect: plannedReceipt.affected_rect,
                  revision: plannedReceipt.revision.after,
                  width: plannedReceipt.affected_size[0],
                  height: plannedReceipt.affected_size[1],
                }
              : null,
            output: outputReceipt,
          },
        };
      },
    },
    paintTextureTransactionToolDocs.status
  );
}
