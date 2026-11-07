import { describe, expect, test } from "bun:test";
import {
  planTextureVariantFromBase,
  reconcileTextureVariantNativeContinuity,
  type TextureVariantNativeBefore,
  type TextureVariantNativeAfter,
} from "@/lib/texture/variantPlan";
import {
  textureVariantCreationReceiptSchema,
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
    expect(block).toContain("variant_native_continuity: nativeContinuity");
    expect(native).toContain('createDefinition.parameterSchema = wiredCreateTextureParameters');
  });
});
