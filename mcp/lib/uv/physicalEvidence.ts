export const UV_PHYSICAL_EXAMPLE_LIMIT = 8;

export type UvPhysicalFaceInput = {
  cube_uuid: string;
  cube_name: string;
  face: "north" | "south" | "east" | "west" | "up" | "down";
  cube_size: readonly number[];
  uv: readonly number[];
  texture_uuid?: string | null;
};

/** Canonical Cube face physical span in model units, before UV rotation. */
export function facePhysicalSize(face: UvPhysicalFaceInput["face"], size: readonly number[]): [number, number] | null {
  if (size.length < 3 || size.slice(0, 3).some((value) => !Number.isFinite(value) || value < 0)) return null;
  const [x, y, z] = size.map(Number);
  if (face === "north" || face === "south") return [x, y];
  if (face === "east" || face === "west") return [z, y];
  return [x, z];
}

function uvRect(uv: readonly number[]): { x: number; y: number; width: number; height: number } | null {
  if (uv.length !== 4 || uv.some((value) => !Number.isFinite(value))) return null;
  return {
    x: Math.min(uv[0], uv[2]),
    y: Math.min(uv[1], uv[3]),
    width: Math.abs(uv[2] - uv[0]),
    height: Math.abs(uv[3] - uv[1]),
  };
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Read-only physical-to-UV evidence. It never decides visual PASS. */
export function analyzeUvPhysicalEvidence(
  faces: readonly UvPhysicalFaceInput[],
  options: { exampleLimit?: number; epsilon?: number } = {}
) {
  const exampleLimit = options.exampleLimit ?? UV_PHYSICAL_EXAMPLE_LIMIT;
  const epsilon = options.epsilon ?? 1e-9;
  const invalid: Array<Record<string, unknown>> = [];
  const nonUniform: Array<Record<string, unknown>> = [];
  const sharedMismatch: Array<Record<string, unknown>> = [];
  const groups = new Map<string, Array<{ input: UvPhysicalFaceInput; physical: [number, number]; rect: { x: number; y: number; width: number; height: number } }>>();
  let maxDensityRatio = 1;
  let maxAspectError = 0;

  for (const input of faces) {
    const physical = facePhysicalSize(input.face, input.cube_size);
    const rect = uvRect(input.uv);
    if (!physical || !rect || physical[0] <= epsilon || physical[1] <= epsilon || rect.width <= epsilon || rect.height <= epsilon) {
      invalid.push({ cube_uuid: input.cube_uuid, cube_name: input.cube_name, face: input.face, physical, uv: input.uv });
      continue;
    }
    const du = rect.width / physical[0];
    const dv = rect.height / physical[1];
    const densityRatio = Math.max(du, dv) / Math.min(du, dv);
    const physicalAspect = physical[0] / physical[1];
    const uvAspect = rect.width / rect.height;
    const aspectError = Math.abs(uvAspect / physicalAspect - 1);
    maxDensityRatio = Math.max(maxDensityRatio, densityRatio);
    maxAspectError = Math.max(maxAspectError, aspectError);
    if (Math.abs(du - dv) > epsilon) {
      nonUniform.push({
        cube_uuid: input.cube_uuid,
        cube_name: input.cube_name,
        face: input.face,
        physical,
        uv_size: [rect.width, rect.height],
        texel_density: [round(du), round(dv)],
        density_ratio: round(densityRatio),
        aspect_error: round(aspectError),
      });
    }
    const key = [input.texture_uuid ?? "unbound", rect.x, rect.y, rect.width, rect.height].join(":");
    const entries = groups.get(key) ?? [];
    entries.push({ input, physical, rect });
    groups.set(key, entries);
  }

  for (const [region, entries] of groups) {
    if (entries.length < 2) continue;
    const base = entries[0];
    for (const current of entries.slice(1)) {
      if (Math.abs(base.physical[0] - current.physical[0]) > epsilon || Math.abs(base.physical[1] - current.physical[1]) > epsilon) {
        sharedMismatch.push({
          region,
          a: { cube_uuid: base.input.cube_uuid, cube_name: base.input.cube_name, face: base.input.face, physical: base.physical },
          b: { cube_uuid: current.input.cube_uuid, cube_name: current.input.cube_name, face: current.input.face, physical: current.physical },
        });
        break;
      }
    }
  }

  return {
    state: invalid.length > 0 ? ("partial" as const) : ("available" as const),
    visual_verdict: "not_evaluated" as const,
    face_count: faces.length,
    evaluated_face_count: faces.length - invalid.length,
    invalid_face_count: invalid.length,
    non_uniform_density_face_count: nonUniform.length,
    exact_shared_region_count: [...groups.values()].filter((entries) => entries.length > 1).length,
    shared_region_physical_mismatch_count: sharedMismatch.length,
    max_density_ratio: round(maxDensityRatio),
    max_aspect_error: round(maxAspectError),
    invalid_examples: invalid.slice(0, exampleLimit),
    non_uniform_examples: nonUniform.slice(0, exampleLimit),
    shared_region_mismatch_examples: sharedMismatch.slice(0, exampleLimit),
    examples_truncated: invalid.length > exampleLimit || nonUniform.length > exampleLimit || sharedMismatch.length > exampleLimit,
    note: "Physical face aspect and texel-density evidence only. Exact UV sharing can be intentional; semantic artwork/material identity and mapped-model visual fidelity still require authoring review.",
  };
}
