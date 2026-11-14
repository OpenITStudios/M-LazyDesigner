// Read-only view contract from the Rust authoring session.
// This module does not own authored model data or edit history.
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export type CubeFace = {
  uv: number[];
  // Format-5.0 Blockbench stores Cube face texture UUID strings; older
  // imported numeric references remain represented without normalization.
  texture?: number | string | null | false;
  [key: string]: unknown;
};

export type CubeView = {
  uuid: string;
  name: string;
  from: Vec3;
  to: Vec3;
  origin: Vec3;
  rotation: Vec3;
  visible: boolean;
  boxUv: boolean;
  uvOffset: [number, number];
  autoUv: number;
  color: number;
  faces: Record<string, CubeFace>;
};

export type BoneView = {
  uuid: string;
  name: string;
  origin: Vec3;
  rotation: Vec3;
};

export type HierarchyNode = string | {
  uuid: string;
  isOpen?: boolean;
  children: HierarchyNode[];
};

export type EditorSnapshot = {
  epoch: number;
  revision: number;
  name: string;
  sourceName: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  cubes: CubeView[];
  bones: BoneView[];
  hierarchy: HierarchyNode[];
  textureNames: string[];
  texturePreviewSources: (string | null)[];
  texturePreviewSides: ('front' | 'double' | null)[];
  paintEditableTextures: boolean[];
  textureResolution: [number, number];
  animationCount: number;
  previewScope: 'UNVERIFIED_EMBEDDED_PNG_SUBSET';
};

export type EditOperation =
  | { op: 'translate_cube'; uuid: string; delta: Vec3 }
  | { op: 'set_cube_bounds'; uuid: string; from: Vec3; to: Vec3 }
  | { op: 'set_cube_rotation'; uuid: string; rotation: Vec3 }
  | { op: 'set_face_uv'; uuid: string; face: string; uv: Vec4 }
  | { op: 'set_box_uv_offset'; uuid: string; offset: [number, number] }
  | { op: 'create_paint_texture'; uuid: string; name: string }
  | { op: 'paint_texture_pixel'; texture_index: number; x: number; y: number; rgba: [number, number, number, number] }
  | { op: 'paint_texture_stroke'; texture_index: number; points: [number, number][]; rgba: [number, number, number, number] }
  | { op: 'paint_texture_brush'; texture_index: number; points: [number, number][]; radius: number; rgba: [number, number, number, number]; erase: boolean }
  | { op: 'paint_texture_rectangle'; texture_index: number; from: [number, number]; to: [number, number]; rgba: [number, number, number, number]; erase: boolean };
