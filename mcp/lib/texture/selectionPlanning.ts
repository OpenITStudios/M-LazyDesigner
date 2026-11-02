export type TextureSelectionCoordinates = Readonly<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;

export function rectangleSelectionPredicate(
  coordinates: TextureSelectionCoordinates
): (x: number, y: number) => boolean {
  const minX = Math.floor(Math.min(coordinates.x1, coordinates.x2));
  const maxX = Math.ceil(Math.max(coordinates.x1, coordinates.x2));
  const minY = Math.floor(Math.min(coordinates.y1, coordinates.y2));
  const maxY = Math.ceil(Math.max(coordinates.y1, coordinates.y2));
  return (x, y) => x >= minX && x < maxX && y >= minY && y < maxY;
}

export function ellipseSelectionPredicate(
  coordinates: TextureSelectionCoordinates
): (x: number, y: number) => boolean {
  const centerX = (coordinates.x1 + coordinates.x2) / 2;
  const centerY = (coordinates.y1 + coordinates.y2) / 2;
  const radiusX = Math.abs(coordinates.x2 - coordinates.x1) / 2;
  const radiusY = Math.abs(coordinates.y2 - coordinates.y1) / 2;
  if (radiusX === 0 || radiusY === 0) {
    throw new Error("Ellipse selection requires non-zero width and height.");
  }

  return (x, y) => {
    const dx = (x + 0.5 - centerX) / radiusX;
    const dy = (y + 0.5 - centerY) / radiusY;
    return dx * dx + dy * dy <= 1;
  };
}

import type { TextureTreatmentFace } from "@/lib/texture/treatmentPlan";
import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
} from "@/lib/uv/facePixelMapping";

export type NativeFaceFootprint = TextureTreatmentFace & {
  enabled: boolean;
  texture_uuid: string | null;
  native_material_name: string;
  rect: readonly [number, number, number, number] | null;
};

const FACE_SCOPE_TARGET_LIMIT = 64;
const FACE_SCOPE_INVENTORY_LIMIT = 16_384;
const FACE_SCOPE_PIXEL_LIMIT = 1_048_576;

function faceId(item: TextureTreatmentFace): string {
  return item.cube_uuid + ":" + item.face;
}

function uvOverlaps(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function sameUvRect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a.every((v, i) => v === b[i]);
}

/**
 * Exact physical-pixel ownership only, compiled from a complete native
 * Cube-face inventory. This is a planner, not material inference or painting.
 */
export function planFaceScopedTextureSelection(input: {
  texture_uuid: string;
  bitmap_width: number;
  bitmap_height: number;
  faces: readonly NativeFaceFootprint[];
  face_targets: readonly TextureTreatmentFace[];
}) {
  const width = input.bitmap_width;
  const height = input.bitmap_height;
  if (!input.texture_uuid?.trim() || !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("FACE_SCOPE_INVALID_ATLAS: explicit texture and physical dimensions required.");
  }
  if (!Array.isArray(input.faces) || input.faces.length > FACE_SCOPE_INVENTORY_LIMIT ||
      !Array.isArray(input.face_targets) || input.face_targets.length < 1 ||
      input.face_targets.length > FACE_SCOPE_TARGET_LIMIT) {
    throw new Error("FACE_SCOPE_BUDGET: bounded face inventory and 1..64 explicit targets required.");
  }
  const owners = new Map<string, NativeFaceFootprint>();
  for (const face of input.faces) {
    if (typeof face.cube_uuid !== "string" || !face.cube_uuid.trim() ||
        !["north", "south", "east", "west", "up", "down"].includes(face.face) ||
        typeof face.native_material_name !== "string") {
      throw new Error("FACE_SCOPE_INVALID_INVENTORY: Cube-face identity or native material is invalid.");
    }
    const id = faceId(face);
    if (owners.has(id)) throw new Error("FACE_SCOPE_DUPLICATE_FACE: " + id);
    if (face.enabled && face.texture_uuid === input.texture_uuid) {
      const r = face.rect;
      if (!r || r.length !== 4 || !r.every(Number.isSafeInteger) ||
          r[0] < 0 || r[1] < 0 || r[2] <= r[0] || r[3] <= r[1] ||
          r[2] > width || r[3] > height) {
        throw new Error("FACE_SCOPE_INVALID_PIXEL_GRID: " + id);
      }
    }
    owners.set(id, face);
  }
  const picked = new Set<string>();
  const selected: NativeFaceFootprint[] = [];
  let material: string | null = null;
  for (const requested of input.face_targets) {
    if (!requested || typeof requested.cube_uuid !== "string" ||
        !requested.cube_uuid.trim() || !requested.face) {
      throw new Error("FACE_SCOPE_INVALID_TARGET: exact Cube-face identity required.");
    }
    const key = faceId(requested);
    if (picked.has(key)) throw new Error("FACE_SCOPE_DUPLICATE_TARGET: " + key);
    picked.add(key);
    const face = owners.get(key);
    if (!face || !face.enabled || face.texture_uuid !== input.texture_uuid || !face.rect) {
      throw new Error("FACE_SCOPE_TARGET_UNRESOLVED: " + key);
    }
    if (material !== null && material !== face.native_material_name) {
      throw new Error("FACE_SCOPE_MATERIAL_MISMATCH: target faces have different native material identities.");
    }
    material = face.native_material_name;
    selected.push(face);
  }
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const a = selected[i].rect!, b = selected[j].rect!;
    if (uvOverlaps(a, b) && !sameUvRect(a, b)) {
      throw new Error("FACE_SCOPE_PARTIAL_UV_OVERLAP: selected faces do not have exclusive texels.");
    }
  }
  for (const face of input.faces) {
    if (!face.enabled || face.texture_uuid !== input.texture_uuid || picked.has(faceId(face))) {
      continue;
    }
    if (selected.some((item) => uvOverlaps(item.rect!, face.rect!))) {
      throw new Error("FACE_SCOPE_UNSELECTED_UV_OWNER: " + faceId(face) +
        " shares target pixels; select the owner or resolve UV reuse.");
    }
  }
  const left = Math.min(...selected.map((f) => f.rect![0]));
  const top = Math.min(...selected.map((f) => f.rect![1]));
  const right = Math.max(...selected.map((f) => f.rect![2]));
  const bottom = Math.max(...selected.map((f) => f.rect![3]));
  const rectWidth = right - left;
  const rectHeight = bottom - top;
  const area = rectWidth * rectHeight;
  if (!Number.isSafeInteger(area) || area > FACE_SCOPE_PIXEL_LIMIT) {
    throw new Error("FACE_SCOPE_ROI_BUDGET: face islands span too many atlas pixels.");
  }
  const mask = new Uint8Array(area);
  for (const face of selected) {
    const [x0,y0,x1,y1] = face.rect!;
    for (let y=y0; y<y1; y++) {
      mask.fill(1,(y-top)*rectWidth+x0-left,(y-top)*rectWidth+x1-left);
    }
  }
  let covered = 0;
  for (const bit of mask) covered += bit;
  return {
    target_rect: { x:left,y:top,width:rectWidth,height:rectHeight },
    target_mask: mask,
    face_count: selected.length,
    covered_pixels: covered,
    native_material_name: material!,
    material_identity: material === "" ? ("unnamed_default" as const) : ("native_named" as const),
    note: "Exact UV-face ownership; unnamed native materials do not attest semantic material identity.",
  };
}


// Face-local identity masks reuse the same native face/UV authority as scoped
// recoloring. No separate paint executor, persisted mask, or inferred artwork.
export type ProtectedFaceLocalRegion = TextureTreatmentFace & {
  rect: Readonly<{ x: number; y: number; width: number; height: number }>;
};

export type NativeFaceUvFootprint = NativeFaceFootprint & {
  uv: readonly number[] | null;
  rotation: number | null;
};

/**
 * Remove explicit protected face-local texels from a previously validated
 * native face selection. This protects an emblem even when its exact RGB is
 * identical to the editable material. It does NOT recognize the emblem.
 */
export function planProtectedFaceLocalRegions(input: {
  texture_uuid: string;
  bitmap_width: number;
  bitmap_height: number;
  logical_uv_width: number;
  logical_uv_height: number;
  native_faces: readonly NativeFaceUvFootprint[];
  face_targets: readonly TextureTreatmentFace[];
  selection: Readonly<{
    target_rect: { x: number; y: number; width: number; height: number };
    target_mask: Uint8Array;
  }>;
  protected_regions: readonly ProtectedFaceLocalRegion[];
}): { target_mask: Uint8Array; protected_pixels: number; editable_pixels: number } {
  const regions = input.protected_regions;
  const selection = input.selection;
  const target = selection.target_rect;
  if (!Array.isArray(regions) || regions.length < 1 || regions.length > 32 ||
      !Array.isArray(input.native_faces) ||
      !Array.isArray(input.face_targets) ||
      input.face_targets.length < 1 || input.face_targets.length > FACE_SCOPE_TARGET_LIMIT ||
      !Number.isSafeInteger(target.x) || target.x < 0 ||
      !Number.isSafeInteger(target.y) || target.y < 0 ||
      !Number.isSafeInteger(target.width) || target.width <= 0 ||
      !Number.isSafeInteger(target.height) || target.height <= 0 ||
      !(selection.target_mask instanceof Uint8Array) ||
      selection.target_mask.length !== target.width * target.height) {
    throw new Error("FACE_PROTECTION_SCOPE_INVALID");
  }
  const selected = new Set(input.face_targets.map(faceId));
  if (selected.size !== input.face_targets.length) {
    throw new Error("FACE_PROTECTION_TARGET_AMBIGUOUS");
  }
  const natives = new Map<string, NativeFaceUvFootprint>();
  for (const face of input.native_faces) {
    const id = faceId(face);
    if (natives.has(id)) throw new Error("FACE_PROTECTION_NATIVE_IDENTITY_AMBIGUOUS");
    natives.set(id, face);
  }
  const mask = new Uint8Array(selection.target_mask);
  let protectedPixels = 0;
  let declaredPixels = 0;
  const metrics = {
    width: input.bitmap_width,
    displayHeight: input.bitmap_height,
    uvWidth: input.logical_uv_width,
    uvHeight: input.logical_uv_height,
  };
  for (const region of regions) {
    const id = faceId(region);
    const face = natives.get(id);
    if (!selected.has(id) || !face?.enabled ||
        face.texture_uuid !== input.texture_uuid ||
        !face.uv || face.rotation === null || !face.rect) {
      throw new Error("FACE_PROTECTION_TARGET_UNRESOLVED: " + id);
    }
    // One pixel can represent several selected faces with stacked UVs.
    // A face-specific identity mark cannot then be protected independently.
    for (const otherId of selected) {
      if (otherId === id) continue;
      const other = natives.get(otherId);
      if (!other?.rect || uvOverlaps(face.rect, other.rect)) {
        throw new Error("FACE_PROTECTION_SHARED_UV_REVIEW_REQUIRED: " + id);
      }
    }
    const mapping = mapFaceUvToTexturePixels(face.uv, metrics, id);
    const [faceWidth, faceHeight] = faceLocalPixelSize(mapping, face.rotation, id);
    if (!sameUvRect(mapping.rect, face.rect)) {
      throw new Error("FACE_PROTECTION_NATIVE_UV_RECT_MISMATCH: " + id);
    }
    const rect = region.rect;
    if (!rect || !Number.isSafeInteger(rect.x) || rect.x < 0 ||
        !Number.isSafeInteger(rect.y) || rect.y < 0 ||
        !Number.isSafeInteger(rect.width) || rect.width <= 0 ||
        !Number.isSafeInteger(rect.height) || rect.height <= 0 ||
        rect.x + rect.width > faceWidth ||
        rect.y + rect.height > faceHeight) {
      throw new Error("FACE_PROTECTION_LOCAL_BOUNDS: " + id);
    }
    declaredPixels += rect.width * rect.height;
    if (!Number.isSafeInteger(declaredPixels) || declaredPixels > 8192) {
      throw new Error("FACE_PROTECTION_PIXEL_BUDGET");
    }
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const atlas = mapFaceLocalPixelToAtlasPixel(mapping, face.rotation, x, y, id);
        const localX = atlas.x - target.x;
        const localY = atlas.y - target.y;
        if (localX < 0 || localY < 0 ||
            localX >= target.width || localY >= target.height) {
          throw new Error("FACE_PROTECTION_OUTSIDE_SELECTED_FACES: " + id);
        }
        const index = localY * target.width + localX;
        if (selection.target_mask[index] !== 1) {
          throw new Error("FACE_PROTECTION_OUTSIDE_SELECTED_FACES: " + id);
        }
        if (mask[index] !== 1) {
          throw new Error("FACE_PROTECTION_OVERLAPPING_REGIONS: " + id);
        }
        mask[index] = 0;
        protectedPixels++;
      }
    }
  }
  let editablePixels = 0;
  for (const bit of mask) {
    if (bit !== 0 && bit !== 1) throw new Error("FACE_PROTECTION_SCOPE_INVALID");
    editablePixels += bit;
  }
  if (editablePixels === 0) {
    throw new Error("FACE_PROTECTION_EXHAUSTS_TARGET");
  }
  return {
    target_mask: mask,
    protected_pixels: protectedPixels,
    editable_pixels: editablePixels,
  };
}
