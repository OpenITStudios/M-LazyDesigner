import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { computeTextureRevision } from "@/lib/texture/revision";
import {
  compactGatewayCapabilityStructuredContent,
  composeGatewayStructuredContent,
} from "@/gateway/presentation/resultCompaction";
import { authoritativeReceipt } from "@/gateway/control/delta/receipts";
import {
  planTextureVariantFromBase,
  reconcileTextureVariantNativeContinuity,
  chooseTextureVariantNativeFailureRecovery,
  textureVariantNativeInventoryIntact,
  type TextureVariantNativeBefore,
  type TextureVariantNativeAfter,
} from "@/lib/texture/variantPlan";
import {
  textureVariantCreationReceiptSchema,
  isTextureCreationReceipt,
} from "@/lib/receipts/textureCreation";

const sha = "sha256:" + "a".repeat(64);
function fixture() {
  const base = {uuid:"base",name:"base.png",width:64,height:64,
    role:"base_color_candidate" as const};
  const plan = planTextureVariantFromBase({
    source:base,base_color_candidates:[base],
    target_group:{uuid:"group",name:"Variants",is_material:false},
    requested_name:"variant.png",existing_texture_names:["base.png"],
  });
  const source = {
    uuid:"base",name:"base.png",width:64,height:64,display_height:64,
    uv_width:64,uv_height:64,group_uuid:null,pbr_channel:"color",
  };
  const before:TextureVariantNativeBefore = {
    project_uuid:"project-a",source,
    source_rgba_revision:"sha256:64x64:"+"b".repeat(64),
    mapping:{
      mapped_face_count:12,mapped_face_sha256:sha,project_logical_uv:[64,64],
    },
  };
  const after:TextureVariantNativeAfter = {
    project_uuid:"project-a",source:{...source},
    variant:{...source,uuid:"variant",name:"variant.png",group_uuid:"group"},
    mapping:{...before.mapping},
    target_group_uuid:"group",target_group_is_valid:true,
    source_remains_base_color:true,source_registered_once:true,
    variant_registered_once:true,variant_name_count:1,
    source_rgba_unchanged:true,variant_rgba_matches_source:true,
  };
  return {plan,before,after};
}

describe("V1 variant pre-Undo native source continuity", () => {
  test("exact source, variant, dimensions, group, UV and decoded RGBA produce a bounded receipt",()=>{
    const {plan,before,after}=fixture();
    const result=reconcileTextureVariantNativeContinuity(plan,before,after);
    expect(result).toMatchObject({
      state:"RUNTIME_PRECOMMIT_VARIANT_CONTINUITY_OBSERVED",
      project_uuid:"project-a",source_texture_uuid:"base",
      variant_texture_uuid:"variant",target_group_uuid:"group",
      uv_mapped_faces_sha256:sha,uv_mapped_face_count:12,
      project_logical_uv:[64,64],
      source_and_variant_rgba_equal_at_creation:true,
      uv_mapping_unchanged_during_creation:true,
      visual_verified:false,minecraft_verified:false,
    });
    const creation={
      texture:{uuid:"variant",name:"variant.png",width:64,height:64,
        group:"group",pbr_channel:"color"},
      variant_creation:plan,
      variant_native_continuity:result,
    };
    expect(textureVariantCreationReceiptSchema.safeParse(creation).success).toBe(true);
    expect(reconcileTextureVariantNativeContinuity(plan,before,after)).toEqual(result);
  });

  test("project, source UUID/name, dimensions or UV mutations invalidate receipt",()=>{
    for(const patch of [
      {project_uuid:"other-project"},
      {source:{...fixture().after.source,uuid:"wrong"}},
      {source:{...fixture().after.source,uv_height:32}},
      {source:{...fixture().after.source,name:"renamed"}},
      {mapping:{...fixture().after.mapping,mapped_face_sha256:"sha256:"+"f".repeat(64)}},
      {mapping:{...fixture().after.mapping,mapped_face_count:0}},
      {mapping:{...fixture().after.mapping,project_logical_uv:[128,128] as [number,number]}},
    ]) {
      const {plan,before,after}=fixture();
      expect(()=>reconcileTextureVariantNativeContinuity(
        plan,before,{...after,...patch},
      )).toThrow("TEXTURE_VARIANT_NATIVE_SOURCE_CHANGED");
    }
  });

  test("source revision and observation have strict digest, dimensions and identity",()=>{
    const {plan,before,after}=fixture();
    expect(()=>reconcileTextureVariantNativeContinuity(plan,
      {...before,source_rgba_revision:sha},after))
      .toThrow("TEXTURE_VARIANT_NATIVE_SOURCE_REVISION_INVALID");
    expect(()=>reconcileTextureVariantNativeContinuity(plan,
      {...before,source_rgba_revision:"sha256:32x128:"+"c".repeat(64)},after))
      .toThrow("TEXTURE_VARIANT_NATIVE_SOURCE_REVISION_INVALID");
    expect(()=>reconcileTextureVariantNativeContinuity(plan,
      {...before,mapping:{...before.mapping,mapped_face_sha256:"invented"}},after))
      .toThrow("TEXTURE_VARIANT_NATIVE_OBSERVATION_INVALID");
    expect(()=>reconcileTextureVariantNativeContinuity(plan,
      {...before,source:{...before.source,uv_width:0}},after))
      .toThrow("TEXTURE_VARIANT_NATIVE_OBSERVATION_INVALID");
  });

  test("source changed role, disappeared or RGBA modified cannot pass",()=>{
    for(const patch of [
      {source_remains_base_color:false},
      {source_registered_once:false},
      {source_rgba_unchanged:false},
    ]) {
      const {plan,before,after}=fixture();
      expect(()=>reconcileTextureVariantNativeContinuity(plan,before,{
        ...after,...patch,
      })).toThrow("TEXTURE_VARIANT_NATIVE_SOURCE_CHANGED");
    }
  });

  test("variant identity, registration, grouping and pixels fail closed",()=>{
    for(const patch of [
      {variant:{...fixture().after.variant,uuid:"base"}},
      {variant:{...fixture().after.variant,group_uuid:"wrong"}},
      {variant:{...fixture().after.variant,height:32}},
      {variant:{...fixture().after.variant,uv_width:32}},
      {variant:{...fixture().after.variant,pbr_channel:"normal"}},
      {target_group_uuid:"wrong"},
      {target_group_is_valid:false},
      {variant_registered_once:false},
      {variant_name_count:2},
      {variant_rgba_matches_source:false},
    ]) {
      const {plan,before,after}=fixture();
      expect(()=>reconcileTextureVariantNativeContinuity(plan,before,{
        ...after,...patch,
      })).toThrow("TEXTURE_VARIANT_NATIVE_CREATED_STATE_MISMATCH");
    }
  });

  test("existing receipt only accepts source/group-matching additional native evidence",()=>{
    const {plan,before,after}=fixture();
    const evidence=reconcileTextureVariantNativeContinuity(plan,before,after);
    const output={
      texture:{uuid:"variant",name:"variant.png",width:64,height:64,
        group:"group",pbr_channel:"color" as const},
      variant_creation:plan,variant_native_continuity:evidence,
    };
    expect(textureVariantCreationReceiptSchema.safeParse({
      ...output,variant_native_continuity:{...evidence,variant_texture_uuid:"wrong"},
    }).success).toBe(false);
    expect(textureVariantCreationReceiptSchema.safeParse({
      ...output,variant_native_continuity:{...evidence,visual_verified:true},
    }).success).toBe(false);
    expect(textureVariantCreationReceiptSchema.safeParse({
      ...output,variant_native_continuity:{...evidence,project_logical_uv:[0,64]},
    }).success).toBe(false);
    const legacy={...output};
    delete (legacy as {variant_native_continuity?:unknown}).variant_native_continuity;
    expect(textureVariantCreationReceiptSchema.safeParse(legacy).success).toBe(true);
  });

  test("full RGBA source revision uses the same SHA-256 identity as get_texture", async () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    pixels.set([10, 20, 30, 255, 40, 50, 60, 0]);
    pixels[pixels.length - 1] = 127;
    const expected = await computeTextureRevision(pixels, 64, 64);
    const runtimeRevision = "sha256:64x64:" +
      createHash("sha256").update(pixels).digest("hex");
    expect(runtimeRevision).toBe(expected);
    const { plan, before, after } = fixture();
    expect(reconcileTextureVariantNativeContinuity(plan, {
      ...before, source_rgba_revision: runtimeRevision,
    }, after).source_rgba_revision).toBe(expected);
  });

  test("MCP/Gateway structured transport preserves bounded native continuity", () => {
    const { plan, before, after } = fixture();
    const evidence = reconcileTextureVariantNativeContinuity(plan, before, after);
    const payload = {
      texture: {
        uuid: "variant", name: "variant.png", width: 64, height: 64,
        group: "group", pbr_channel: "color" as const,
      },
      variant_creation: plan,
      variant_native_continuity: evidence,
    };
    const compacted = compactGatewayCapabilityStructuredContent(
      "create_texture", payload, "receipt_only", true
    );
    expect(compacted).toEqual(payload);
    const controlDelta = { kind: "texture", changed: true };
    const composed = composeGatewayStructuredContent(compacted, controlDelta);
    expect(composed.variant_native_continuity).toEqual(evidence);
    expect(composed.variant_creation).toEqual(plan);
    expect(isTextureCreationReceipt(composed, "variant")).toBe(true);
    const selected = authoritativeReceipt({
      content: [{ type: "text", text: "Variant created" }],
      structuredContent: composed,
    });
    expect(selected?.variant_native_continuity).toEqual(evidence);
    expect(textureVariantCreationReceiptSchema.safeParse(selected).success).toBe(true);
    expect(compactGatewayCapabilityStructuredContent(
      "create_texture", payload, "receipt_only", false
    )).toEqual(payload);
  });

  test("failure recovery permits only fully owned precommit rollback", () => {
    const safe = {
      commit_attempted: false,
      project_unchanged: true, undo_owned: true,
      history_unchanged: true, source_unchanged: true,
      uv_unchanged: true, texture_inventory_unchanged_except_candidate: true,
    };
    expect(chooseTextureVariantNativeFailureRecovery(safe))
      .toBe("ROLLBACK_OWNED_PRECOMMIT");
    for (const fault of [
      { commit_attempted: true },
      { project_unchanged: false },
      { undo_owned: false },
      { history_unchanged: false },
      { source_unchanged: false },
      { uv_unchanged: false },
      { texture_inventory_unchanged_except_candidate: false },
    ]) {
      expect(chooseTextureVariantNativeFailureRecovery({
        ...safe, ...fault,
      })).toBe("INSPECT_OUTCOME_UNKNOWN");
    }
    expect(() => chooseTextureVariantNativeFailureRecovery({
      ...safe, undo_owned: undefined as unknown as boolean,
    })).toThrow("TEXTURE_VARIANT_RECOVERY_OBSERVATION_INVALID");
  });

  test("native commit attempt never triggers automatic rollback and unknown recovery stays explicit", async () => {
    const src = await Bun.file("server/runtime/contracts/texture.ts").text();
    const start = src.indexOf("async function createTextureVariant");
    const end = src.indexOf("function textureEvidenceSourceIdentity", start);
    const body = src.slice(start, end);
    expect(body).toContain("commitAttempted = true;");
    expect(body.indexOf("commitAttempted = true;"))
      .toBeLessThan(body.indexOf('Undo.finishEdit("Agent created texture variant"'));
    expect(body).toContain('if (decision !== "ROLLBACK_OWNED_PRECOMMIT")');
    expect(body.indexOf('if (decision !== "ROLLBACK_OWNED_PRECOMMIT")'))
      .toBeLessThan(body.indexOf("variant.remove(true)"));
    expect(body).toContain("TEXTURE_VARIANT_ROLLBACK_UNVERIFIED");
    expect(body).toContain("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
    expect(body).toContain("TEXTURE_VARIANT_UNDO_INIT_OUTCOME_UNKNOWN");
    expect(body).toContain("TEXTURE_VARIANT_POSTCOMMIT_DISPLAY_UNVERIFIED");
    expect(body).toContain("Undo.cancelEdit()");
    expect(body).toContain("TEXTURE_VARIANT_ROLLBACK_POSTCONDITION_FAILED");
    expect(body).toContain("undoHistoryUnchanged()");
    expect(body).toContain("TEXTURE_VARIANT_UNDO_HISTORY_CHANGED_DURING_DECODE");
    expect(body).toContain("TEXTURE_VARIANT_UNDO_COMMIT_ENTRY_UNVERIFIED");
    expect(body).toContain("commitSnapshot?.before !== undoOwner");
    expect(body).toContain("Object.hasOwn(postTextures, variantBeforeFinish.uuid)");
    expect(body).toContain("groupAfterFinish.length !== 1");
    expect(body).toContain("JSON.stringify(nativeVariantTextureIdentity(variant))");
    expect(body).toContain("variant.id !== variantIdBeforeFinish");
    expect(body.indexOf("TEXTURE_VARIANT_UNDO_HISTORY_CHANGED_DURING_DECODE"))
      .toBeLessThan(body.indexOf("commitAttempted = true;"));
  });


  test("native Texture inventory requires original object identities plus at most one owned candidate",()=>{
    const base={uuid:"base"},other={uuid:"other"},candidate={uuid:"candidate"};
    const original=[base,other];
    expect(textureVariantNativeInventoryIntact(original,[other,base])).toBe(true);
    expect(textureVariantNativeInventoryIntact(original,[base,other,candidate],candidate)).toBe(true);
    expect(textureVariantNativeInventoryIntact(original,[base,other],candidate)).toBe(true);
    expect(textureVariantNativeInventoryIntact(original,[base],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,other,{uuid:"foreign"}],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,{uuid:"other"}],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,other,candidate,{uuid:"candidate"}],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,other,candidate,candidate],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact([base,base],[base],candidate)).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,other],{uuid:"base"})).toBe(false);
    expect(textureVariantNativeInventoryIntact(original,[base,other,{uuid:"partial"}])).toBe(false);
  });

  test("runtime checks complete Texture inventory around decode and after cleanup",async()=>{
    const source=await Bun.file("server/runtime/contracts/texture.ts").text();
    const start=source.indexOf("async function createTextureVariant");
    const end=source.indexOf("function textureEvidenceSourceIdentity",start);
    const body=source.slice(start,end);
    expect(body).toContain("const textureInventoryBefore = [...Texture.all]");
    expect(body).toContain("TEXTURE_VARIANT_NATIVE_BASE_INVENTORY_AMBIGUOUS");
    expect(body).toContain("TEXTURE_VARIANT_NATIVE_TEXTURE_INVENTORY_DRIFT");
    expect(body.indexOf("TEXTURE_VARIANT_NATIVE_TEXTURE_INVENTORY_DRIFT"))
      .toBeLessThan(body.indexOf('Undo.finishEdit("Agent created texture variant"'));
    expect(body).toContain("texture_inventory_unchanged_except_candidate: inventoryIntact");
    expect(body).toContain("textureVariantNativeInventoryIntact(");
  });

  test("existing variant executor performs exact precommit source/UV checks before finishEdit",async()=>{
    const native=await Bun.file("server/runtime/contracts/texture.ts").text();
    const variantStart=native.indexOf("async function createTextureVariant");
    const variantEnd=native.indexOf("function textureEvidenceSourceIdentity",variantStart);
    const block=native.slice(variantStart,variantEnd);
    expect(block).toContain("fullTextureRgba(source)");
    expect(native).toContain("const faces = collectUvAtlasUsages()");
    expect(block).toContain("currentVariantMappedUvIdentity()");
    expect(block).toContain("requireUnchangedTextureBitmap(");
    expect(block).toContain("reconcileTextureVariantNativeContinuity(");
    expect(block.indexOf("reconcileTextureVariantNativeContinuity("))
      .toBeLessThan(block.indexOf('Undo.finishEdit("Agent created texture variant"'));
    expect(block).toContain("TEXTURE_VARIANT_WRITE_OUTCOME_UNKNOWN");
    expect(block).toContain("const projectOwner = Project");
    expect(block).toContain("Project !== projectOwner");
    expect(block).toContain("TEXTURE_VARIANT_PROJECT_OWNERSHIP_LOST");
    expect(block).toContain("variant_native_continuity: nativeContinuity");
    expect(block).toContain("targetGroup.name === plan.target_group_name");
    expect(block).toContain("Texture.all.filter(item => item.uuid === variant.uuid).length === 1");
    expect(native).toContain('createDefinition.parameterSchema = wiredCreateTextureParameters');
  });
});
