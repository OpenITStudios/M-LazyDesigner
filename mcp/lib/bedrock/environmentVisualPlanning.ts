import { createHash } from "node:crypto";

/** E1: pure Resource Pack visual-source review, not a fog renderer or pack writer. */
export const FOG_DISTANCE_MEDIA = [
  "air", "water", "weather", "lava", "lava_resistance", "powder_snow",
] as const;
export type FogDistanceMedium = typeof FOG_DISTANCE_MEDIA[number];
export type FogDistanceDeclaration = {
  fog_color: string;
  fog_start: number;
  fog_end: number;
  render_distance_type: "fixed" | "render";
};
export type EnvironmentResource = { identifier: string; file_path: string };
export type EnvironmentVisualInput = {
  target_bedrock_version: string;
  fog: EnvironmentResource & {
    distance: Partial<Record<FogDistanceMedium, FogDistanceDeclaration>>;
  };
  client_biome: EnvironmentResource & {
    fog_identifier: string;
    sky_color?: string;
    water?: { surface_color: string; surface_opacity?: number };
  };
  existing_fogs: readonly EnvironmentResource[];
  existing_client_biomes: readonly EnvironmentResource[];
  command_fog_override_possible: boolean;
  source_refs: readonly string[];
};
type FogDistance = FogDistanceDeclaration;
type DistanceSet = Partial<Record<FogDistanceMedium, FogDistance>>;
type BiomeVisualComponents = {
  "minecraft:fog_appearance": { fog_identifier: string };
  "minecraft:sky_color"?: { sky_color: string };
  "minecraft:water_appearance"?: {
    surface_color: string;
    surface_opacity?: number;
  };
};
export type EnvironmentVisualIssue =
  | "CLIENT_BIOME_FORMAT_TOO_OLD"
  | "FOG_REFERENCE_MISMATCH"
  | "FOG_IDENTIFIER_ALREADY_OWNED"
  | "FOG_FILE_ALREADY_OWNED"
  | "BIOME_IDENTIFIER_ALREADY_OWNED"
  | "BIOME_FILE_ALREADY_OWNED";
export type EnvironmentVisualWarning =
  | "UNSPECIFIED_FOG_MEDIA_INHERIT_STACK"
  | "PLAYER_COMMAND_OVERRIDE_NOT_NATIVE_VERIFIED"
  | "BIOME_FOG_BLEND_NOT_NATIVE_VERIFIED"
  | "VIBRANT_VISUALS_AND_VOLUMETRIC_NOT_MODELED"
  | "RENDER_DISTANCE_SETTING_DEPENDENCY"
  | "ABRUPT_FOG_TRANSITION_REVIEW"
  | "SKY_WATER_COLOR_REVIEW"
  | "UNNAMESPACED_BIOME_ID_REVIEW"
  | "VANILLA_NAMESPACE_OVERRIDE_REVIEW"
  | "BIOME_RUNTIME_ID_NOT_VERIFIED"
  | "RESOURCE_FILES_NOT_VERIFIED";
export type EnvironmentVisualReview = {
  state: "BLOCKED_BY_DECLARED_SOURCE" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  source_fingerprint: string;
  fog_json_hint: string;
  client_biome_json_hint: string;
  candidate_fog: {
    format_version: string;
    "minecraft:fog_settings": {
      description: { identifier: string };
      distance: DistanceSet;
    };
  };
  candidate_client_biome: {
    format_version: string;
    "minecraft:client_biome": {
      description: { identifier: string };
      components: BiomeVisualComponents;
    };
  };
  declared_media: FogDistanceMedium[];
  issues: EnvironmentVisualIssue[];
  warnings: EnvironmentVisualWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  resource_pack_written: false;
  behavior_pack_written: false;
};

const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const ID = /^[a-z0-9_][a-z0-9_.-]{0,63}:[a-z0-9_][a-z0-9_./-]{0,127}$/;
const BIOME_ID = /^[a-z0-9_][a-z0-9_.-]{0,127}$/;
const FOG_FILE = /^fogs\/[a-z0-9_][a-z0-9_-]{0,63}\.json$/;
const CLIENT_BIOME_FILE =
  /^biomes_client\/[a-z0-9_][a-z0-9_-]{0,63}\.biome_client\.json$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DISTANCE_FIELDS = ["fog_color","fog_start","fog_end","render_distance_type"];
const FOG_FLOOR = [1,21,40] as const;

function exact(value: unknown, field: string, limit = 192): string {
  if (typeof value !== "string" || !value ||
      value.length > limit || value.trim() !== value) {
    throw new Error("ENVIRONMENT_IDENTITY_INVALID: "+field);
  }
  return value;
}
function identifier(value: unknown, field: string, allowLegacy = false): string {
  const v = exact(value, field);
  const rest = v.includes(":") ? v.split(":")[1]! : v;
  if (!(ID.test(v) || (allowLegacy && BIOME_ID.test(v))) ||
      rest.includes("//") ||
      rest.split("/").some(s => s === "." || s === "..")) {
    throw new Error("ENVIRONMENT_RESOURCE_ID_INVALID: "+field);
  }
  return v;
}
function filename(value: unknown, kind: "fog"|"biome"): string {
  const v = exact(value, kind+".file_path");
  if (!(kind === "fog" ? FOG_FILE : CLIENT_BIOME_FILE).test(v)) {
    throw new Error("ENVIRONMENT_FILE_PATH_INVALID: "+kind);
  }
  return v;
}
function rgb(value: unknown, field: string): string {
  const v = exact(value, field, 7);
  if (!HEX.test(v)) throw new Error("ENVIRONMENT_COLOR_INVALID: "+field);
  return v.toUpperCase();
}
function quantity(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < 0 || value > max) {
    throw new Error("ENVIRONMENT_NUMBER_INVALID: "+field);
  }
  return Object.is(value, -0) ? 0 : value;
}
function version(value: unknown): [number,number,number] {
  if (typeof value !== "string" || !VERSION.test(value)) {
    throw new Error("ENVIRONMENT_VERSION_INVALID");
  }
  const parts = value.split(".").map(Number);
  return [parts[0]!,parts[1]!,parts[2]!];
}
function meets(version: readonly number[], floor: readonly number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i]! > floor[i]!) return true;
    if (version[i]! < floor[i]!) return false;
  }
  return true;
}
function registry(
  rows: readonly EnvironmentResource[], kind: "fog"|"biome"
): { ids: Set<string>; files: Set<string>; normalized: Array<[string,string]> } {
  if (!Array.isArray(rows) || rows.length > 512) {
    throw new Error("ENVIRONMENT_REGISTRY_INVALID");
  }
  const ids = new Set<string>();
  const files = new Set<string>();
  const normalized: Array<[string,string]> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("ENVIRONMENT_REGISTRY_INVALID");
    }
    const id = identifier(row.identifier,kind+".identifier",kind==="biome");
    const p = filename(row.file_path,kind);
    if (ids.has(id) || files.has(p)) {
      throw new Error("ENVIRONMENT_REGISTRY_AMBIGUOUS");
    }
    ids.add(id); files.add(p); normalized.push([id,p]);
  }
  normalized.sort((a,b) => a[0].localeCompare(b[0]));
  return { ids, files, normalized };
}
function fogDistance(value: unknown): {
  values: DistanceSet;
  media: FogDistanceMedium[];
  scaled: boolean;
  abrupt: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENVIRONMENT_DISTANCE_INVALID");
  }
  const record = value as Record<string,unknown>;
  const keys = Object.keys(record);
  if (!keys.length) throw new Error("ENVIRONMENT_DISTANCE_EMPTY");
  if (keys.some(k => !FOG_DISTANCE_MEDIA.some(scope => scope === k))) {
    throw new Error("ENVIRONMENT_DISTANCE_MEDIA_UNKNOWN");
  }
  const values: DistanceSet = {};
  const media: FogDistanceMedium[] = [];
  let scaled=false,abrupt=false;
  for (const scope of FOG_DISTANCE_MEDIA) {
    if (!Object.prototype.hasOwnProperty.call(record,scope)) continue;
    const item = record[scope];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("ENVIRONMENT_DISTANCE_ITEM_INVALID");
    }
    const s = item as Record<string,unknown>;
    if (Object.keys(s).some(k => !DISTANCE_FIELDS.includes(k))) {
      throw new Error("ENVIRONMENT_DISTANCE_FIELD_UNKNOWN");
    }
    const start=quantity(s.fog_start,scope+".fog_start",1000000);
    const end=quantity(s.fog_end,scope+".fog_end",1000000);
    if (start>end) throw new Error("ENVIRONMENT_FOG_START_AFTER_END");
    if (s.render_distance_type!=="fixed" && s.render_distance_type!=="render") {
      throw new Error("ENVIRONMENT_DISTANCE_MODE_INVALID");
    }
    values[scope]={
      fog_color:rgb(s.fog_color,scope+".fog_color"),
      fog_start:start,fog_end:end,
      render_distance_type:s.render_distance_type,
    };
    media.push(scope);
    scaled ||= s.render_distance_type==="render";
    abrupt ||= start===end;
  }
  return {values,media,scaled,abrupt};
}

/** Candidate JSON in memory only; no source edits or pack assembly. */
export function planBedrockEnvironmentVisual(
  input: EnvironmentVisualInput
): EnvironmentVisualReview {
  if (!input || typeof input!=="object" || !input.fog ||
      !input.client_biome || typeof input.fog!=="object" ||
      typeof input.client_biome!=="object") {
    throw new Error("ENVIRONMENT_INPUT_INVALID");
  }
  const v=version(input.target_bedrock_version);
  const fogId=identifier(input.fog.identifier,"fog.identifier");
  const biomeId=identifier(input.client_biome.identifier,"biome.identifier",true);
  const linkedFog=identifier(input.client_biome.fog_identifier,"biome.fog_identifier");
  const fogPath=filename(input.fog.file_path,"fog");
  const biomePath=filename(input.client_biome.file_path,"biome");
  const distance=fogDistance(input.fog.distance);
  if (typeof input.command_fog_override_possible!=="boolean") {
    throw new Error("ENVIRONMENT_COMMAND_STATE_INVALID");
  }
  if (!Array.isArray(input.source_refs) || !input.source_refs.length ||
      input.source_refs.length>8 ||
      input.source_refs.some(s=>typeof s!=="string"||!s||
        s.length>160||s!==s.trim()) ||
      new Set(input.source_refs).size!==input.source_refs.length) {
    throw new Error("ENVIRONMENT_SOURCE_REFS_INVALID");
  }
  const fogCatalog=registry(input.existing_fogs,"fog");
  const biomeCatalog=registry(input.existing_client_biomes,"biome");
  const components:BiomeVisualComponents={
    "minecraft:fog_appearance":{fog_identifier:linkedFog},
  };
  if (input.client_biome.sky_color!==undefined) {
    components["minecraft:sky_color"]={
      sky_color:rgb(input.client_biome.sky_color,"sky_color"),
    };
  }
  if (input.client_biome.water!==undefined) {
    const water=input.client_biome.water;
    if (!water || typeof water!=="object" || Array.isArray(water) ||
        Object.keys(water).some(k=>k!=="surface_color"&&k!=="surface_opacity")) {
      throw new Error("ENVIRONMENT_WATER_INVALID");
    }
    components["minecraft:water_appearance"]={
      surface_color:rgb(water.surface_color,"water.surface_color"),
      ...(water.surface_opacity===undefined?{}:{
        surface_opacity:quantity(water.surface_opacity,"water.surface_opacity",1),
      }),
    };
  }
  const issues:EnvironmentVisualIssue[]=[];
  if (!meets(v,FOG_FLOOR)) issues.push("CLIENT_BIOME_FORMAT_TOO_OLD");
  if (fogId!==linkedFog) issues.push("FOG_REFERENCE_MISMATCH");
  if (fogCatalog.ids.has(fogId)) issues.push("FOG_IDENTIFIER_ALREADY_OWNED");
  if (fogCatalog.files.has(fogPath)) issues.push("FOG_FILE_ALREADY_OWNED");
  if (biomeCatalog.ids.has(biomeId)) issues.push("BIOME_IDENTIFIER_ALREADY_OWNED");
  if (biomeCatalog.files.has(biomePath)) issues.push("BIOME_FILE_ALREADY_OWNED");

  const warnings:EnvironmentVisualWarning[]=[
    "BIOME_FOG_BLEND_NOT_NATIVE_VERIFIED",
    "VIBRANT_VISUALS_AND_VOLUMETRIC_NOT_MODELED",
    "BIOME_RUNTIME_ID_NOT_VERIFIED",
    "RESOURCE_FILES_NOT_VERIFIED",
  ];
  if (input.command_fog_override_possible) {
    warnings.push("PLAYER_COMMAND_OVERRIDE_NOT_NATIVE_VERIFIED");
  }
  if (distance.media.length<FOG_DISTANCE_MEDIA.length) {
    warnings.push("UNSPECIFIED_FOG_MEDIA_INHERIT_STACK");
  }
  if (distance.scaled) warnings.push("RENDER_DISTANCE_SETTING_DEPENDENCY");
  if (distance.abrupt) warnings.push("ABRUPT_FOG_TRANSITION_REVIEW");
  if (biomeId.startsWith("minecraft:") || fogId.startsWith("minecraft:")) {
    warnings.push("VANILLA_NAMESPACE_OVERRIDE_REVIEW");
  }
  if (!biomeId.includes(":")) warnings.push("UNNAMESPACED_BIOME_ID_REVIEW");
  if (components["minecraft:sky_color"] ||
      components["minecraft:water_appearance"]) {
    warnings.push("SKY_WATER_COLOR_REVIEW");
  }

  const candidate_fog:EnvironmentVisualReview["candidate_fog"]={
    format_version:input.target_bedrock_version,
    "minecraft:fog_settings":{
      description:{identifier:fogId},
      distance:distance.values,
    },
  };
  const candidate_client_biome:EnvironmentVisualReview["candidate_client_biome"]={
    format_version:input.target_bedrock_version,
    "minecraft:client_biome":{
      description:{identifier:biomeId},
      components,
    },
  };
  const identity={
    contract:"environment-e1-source-v1",
    candidate_fog,candidate_client_biome,
    fogPath,biomePath,
    existing_fogs:fogCatalog.normalized,
    existing_client_biomes:biomeCatalog.normalized,
    command_fog_override_possible:input.command_fog_override_possible,
    source_refs:[...input.source_refs].sort(),
  };
  return {
    state:issues.length?"BLOCKED_BY_DECLARED_SOURCE":
      "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    source_fingerprint:"sha256:"+createHash("sha256")
      .update(JSON.stringify(identity)).digest("hex"),
    fog_json_hint:fogPath,client_biome_json_hint:biomePath,
    candidate_fog,candidate_client_biome,
    declared_media:distance.media,issues,warnings,
    native_verified:false,visual_verified:false,minecraft_verified:false,
    resource_pack_written:false,behavior_pack_written:false,
  };
}
