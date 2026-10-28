/// <reference types="blockbench-types" />

import { getAllToolDefinitions } from "@/lib/factories";
import {
  analyzeAxisAlignedSurfaceEvidence,
  analyzeCurrentPreviewObbContainment,
  GEOMETRY_WORLD_OBB_SAMPLE_LIMIT,
} from "@/lib/geometry/surfaceEvidence";
import { orientedBoxFromCube } from "@/lib/geometry/blockbenchCubeObb";
import { isEffectivelyVisible } from "@/lib/geometry/renderedModelBounds";
import {
  summarizeMeshToCubeFidelity,
  MESH_TO_CUBE_ANALYSIS_LIMIT,
  MESH_TO_CUBE_VERTEX_LIMIT,
  MESH_TO_CUBE_FACE_LIMIT,
  type MeshToCubeInput,
} from "@/lib/geometry/meshToCubeFidelity";
import { analyzeUvPhysicalEvidence, type UvPhysicalFaceInput } from "@/lib/uv/physicalEvidence";
import { analyzeAnimationCraftEvidence, type AnimationCraftTrackInput } from "@/lib/animation/craftEvidence";

type JsonRecord = Record<string, unknown>;
const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const wired = new Set<string>();

function objectRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function nonZeroRotation(values: readonly number[] | undefined): boolean {
  return Boolean(values && values.slice(0, 3).some((value) => Number.isFinite(value) && Math.abs(value) > 1e-5));
}


/** Read bounded authored Mesh data; never sort/mutate native faces or geometry. */
function nativeMeshToCubeFidelity() {
  if (typeof Mesh === "undefined" || !Array.isArray(Mesh.all)) {
    return {
      state:"unavailable" as const,
      reason:"blockbench_mesh_inventory_unavailable" as const,
      native_conversion_executed:false as const,
    };
  }
  const visible=(Mesh.all ?? []).filter((mesh:Mesh)=>mesh.visibility!==false);
  const selected=[...visible].sort((a,b)=>a.uuid.localeCompare(b.uuid))
    .slice(0,MESH_TO_CUBE_ANALYSIS_LIMIT);
  const reads:MeshToCubeInput[]=selected.map(mesh=>{
    const nativeVertices=mesh.vertices ?? {};
    const nativeFaces=mesh.faces ?? {};
    // Count before visiting face keys or invoking native quad sorting.
    const tooLarge=Object.keys(nativeVertices).length>MESH_TO_CUBE_VERTEX_LIMIT ||
      Object.keys(nativeFaces).length>MESH_TO_CUBE_FACE_LIMIT;
    const faces:Record<string,MeshToCubeInput["faces"][string]>={};
    if(!tooLarge){
      for(const [key,face] of Object.entries(nativeFaces)){
        let faceKeys:readonly string[]=[];
        try {
          // MeshFace vertices are not generally pre-sorted. This native
          // function computes a convex winding but has no authored mutation.
          faceKeys=face.getSortedVertices();
        } catch {
          // A broken native face is not convertible; pure owner refuses it.
        }
        faces[key]={
          vertices:faceKeys,
          uv:face.uv,
          texture:face.texture,
          material_name:(face as MeshFace & {material_name?:string}).material_name,
        };
      }
    }
    const parentId=typeof Group!=="undefined" && mesh.parent instanceof Group
      ?mesh.parent.uuid:mesh.parent==="root"?"root":null;
    let armatureAttached:boolean|null=null;
    try {
      armatureAttached=typeof mesh.getArmature==="function"
        ?Boolean(mesh.getArmature()):null;
    } catch {
      armatureAttached=null;
    }
    return {
      uuid:mesh.uuid,name:mesh.name,
      // Send the native count bound through to the pure analyst. Oversized
      // source is explicitly unverified, not silently reduced to a small one.
      vertices:tooLarge ? nativeVertices : nativeVertices,
      faces:tooLarge ? nativeFaces as unknown as MeshToCubeInput["faces"] : faces,
      origin:mesh.origin,rotation:mesh.rotation,parent_id:parentId,
      shading:mesh.shading,armature_attached:armatureAttached,
    };
  });
  return summarizeMeshToCubeFidelity(reads,{
    total_visible_mesh_count:visible.length,
  });
}

function geometrySurfaceRuntime() {
  if (typeof Cube === "undefined") {
    return { state: "unavailable" as const, reason: "blockbench_geometry_runtime_unavailable" as const };
  }
  const groups = typeof Group === "undefined" ? [] : (Group.all ?? []);
  const transformedGroups = groups.filter((group: Group) => nonZeroRotation(group.rotation));
  const meshCount = typeof Mesh === "undefined" ? 0 : (Mesh.all ?? []).filter((mesh: Mesh) => mesh.visibility !== false).length;
  const visibleCubes = (Cube.all ?? []).filter((cube: Cube) =>
    cube.visibility !== false && isEffectivelyVisible(cube.mesh));
  const base = analyzeAxisAlignedSurfaceEvidence(
    visibleCubes
      .map((cube: Cube) => ({
        uuid: cube.uuid,
        name: cube.name,
        from: [...cube.from],
        to: [...cube.to],
        inflate: cube.inflate ?? 0,
        rotation: [...cube.rotation],
        origin: [...cube.origin],
        parent_id:
          typeof Group !== "undefined" && cube.parent instanceof Group
            ? cube.parent.uuid
            : cube.parent === "root" ? "root" : null,
      })),
    {
      unsupportedTransformCount: transformedGroups.length,
      unsupportedMeshCount: meshCount,
    }
  );
  // Only the current preview transform is measured; never advance an
  // animation time cursor or mutate geometry/Undo for diagnostics.
  const sampled = [...visibleCubes].sort((a: Cube, b: Cube) =>
    Number(nonZeroRotation(b.rotation)) - Number(nonZeroRotation(a.rotation)) ||
    a.uuid.localeCompare(b.uuid)
  ).slice(0, GEOMETRY_WORLD_OBB_SAMPLE_LIMIT);
  const poseInputs = sampled.map((cube: Cube) => {
    let obb: ReturnType<typeof orientedBoxFromCube> | null = null;
    try {
      obb = orientedBoxFromCube(cube);
    } catch {
      // Missing mesh, unsupported world transform or invalid geometry cannot
      // be silently promoted to a clean model diagnosis.
    }
    return {
      uuid: cube.uuid,
      name: cube.name,
      parent_id: typeof Group !== "undefined" && cube.parent instanceof Group
        ? cube.parent.uuid
        : cube.parent === "root" ? "root" : null,
      obb,
    };
  });
  return {
    ...base,
    mesh_to_cube_fidelity: nativeMeshToCubeFidelity(),
    current_preview_world_obb_review: analyzeCurrentPreviewObbContainment(
      poseInputs, {
        omitted_cube_count: visibleCubes.length - sampled.length,
      }
    ),
  };
}

function uvPhysicalRuntime() {
  if (typeof Cube === "undefined") {
    return { state: "unavailable" as const, reason: "blockbench_geometry_runtime_unavailable" as const };
  }
  const faces: UvPhysicalFaceInput[] = [];
  for (const cube of Cube.all ?? []) {
    const inflate = Number(cube.inflate ?? 0);
    const size = [0, 1, 2].map((axis) => Math.abs(Number(cube.to[axis]) - Number(cube.from[axis])) + 2 * inflate);
    for (const faceName of FACE_KEYS) {
      const face = cube.faces?.[faceName];
      if (!face || face.enabled === false) continue;
      const texture = face.getTexture?.();
      faces.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        face: faceName,
        cube_size: size,
        uv: [...face.uv],
        texture_uuid: texture
          ? texture.uuid
          : typeof face.texture === "string"
            ? face.texture
            : null,
      });
    }
  }
  const base = analyzeUvPhysicalEvidence(faces);
  const meshCount = typeof Mesh === "undefined" ? 0 : (Mesh.all ?? []).filter((mesh: Mesh) => mesh.visibility !== false).length;
  return {
    ...base,
    cube_face_scope_complete: meshCount === 0,
    unsupported_mesh_count: meshCount,
    ...(meshCount > 0
      ? { note: `${base.note} Mesh UV topology is outside this cube-face evidence and must be reviewed separately.` }
      : {}),
  };
}

function animationCraftRuntime(structuredContent: JsonRecord) {
  if (typeof AnimationItem === "undefined" || typeof BoneAnimator === "undefined") {
    return { state: "unavailable" as const, reason: "authored_animation_runtime_unavailable" as const };
  }
  const animationInfo = objectRecord(structuredContent.animation);
  const animationUuid = typeof animationInfo?.uuid === "string" ? animationInfo.uuid : null;
  if (!animationUuid) {
    return { state: "unavailable" as const, reason: "authored_animation_identity_unavailable" as const };
  }
  const item = (AnimationItem.all as unknown[]).find((candidate) => objectRecord(candidate)?.uuid === animationUuid) as BBAnimation | AnimationController | undefined;
  if (!item || (typeof AnimationController !== "undefined" && item instanceof AnimationController)) {
    return { state: "unavailable" as const, reason: "authored_animation_not_resolved" as const };
  }
  const animation = item as BBAnimation;
  const tracks: AnimationCraftTrackInput[] = [];
  for (const animator of Object.values(animation.animators)) {
    if (!(animator instanceof BoneAnimator)) continue;
    for (const channel of ["position", "rotation", "scale"] as const) {
      const keys = (animator[channel] as BBKeyframe[] | undefined) ?? [];
      if (!keys.length) continue;
      tracks.push({
        group_uuid: animator.uuid,
        group_name: animator.name,
        channel,
        keyframe_times: keys.map((key) => key.time),
      });
    }
  }
  return analyzeAnimationCraftEvidence({ length: animation.length, tracks });
}

type EvidenceReader = (structuredContent: JsonRecord, args: unknown) => unknown;

function wire(toolName: string, field: string, read: EvidenceReader): void {
  const key = `${toolName}:${field}`;
  if (wired.has(key)) return;
  const definition = getAllToolDefinitions()[toolName];
  if (!definition) return;
  const execute = definition.execute;
  definition.execute = async (args, context) => {
    const result = await execute(args, context);
    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (!structured) return result;
    const evidence = read(structured, args);
    if (evidence === undefined) return result;
    return {
      ...record,
      structuredContent: { ...structured, [field]: evidence },
    } as typeof result;
  };
  wired.add(key);
}

/** Adds read-only deterministic evidence without expanding the public MCP catalog. */
export function wireAuthoringEvidenceRuntime(): void {
  wire("inspect_model_bounds", "surface_integrity", () => geometrySurfaceRuntime());
  wire("list_textures", "physical_uv_evidence", (_structured, args) =>
    objectRecord(args)?.diagnostics === true ? uvPhysicalRuntime() : undefined
  );
  wire("inspect_animation", "motion_craft_evidence", (structured) => animationCraftRuntime(structured));
}