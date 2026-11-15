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
  inflate: number;
  stretch: Vec3;
  visible: boolean;
  // Read-only Three.js render priority from Rust-validated Blockbench metadata.
  renderOrder: -1 | 0 | 1;
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
  visible: boolean;
};

export type HierarchyNode = string | {
  uuid: string;
  isOpen?: boolean;
  children: HierarchyNode[];
};

export type RotationKeyframeView = {
  uuid: string;
  boneUuid: string;
  time: number;
  rotation: Vec3;
};

export type AnimationView = {
  uuid: string;
  name: string;
  length: number;
  rotationKeyframes: RotationKeyframeView[];
  // True only when Tauri recognizes every animation/track field for static pose.
  previewSupported: boolean;
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
  textureUuids: (string | null)[];
  texturePreviewSources: (string | null)[];
  texturePreviewSides: ('front' | 'double' | null)[];
  paintEditableTextures: boolean[];
  paintAdoptableTextures: boolean[];
  paintExportableTextures: boolean[];
  textureResolution: [number, number];
  atlasResolutionEditable: boolean;
  paintTextureAddable: boolean;
  animationCount: number;
  animations: AnimationView[];
  previewScope: 'UNVERIFIED_EMBEDDED_PNG_SUBSET';
};

export type EditOperation =
  | { op: 'translate_cube'; uuid: string; delta: Vec3 }
  | { op: 'set_cube_bounds'; uuid: string; from: Vec3; to: Vec3 }
  | { op: 'set_cube_rotation'; uuid: string; rotation: Vec3 }
  | { op: 'scale_cube'; uuid: string; factors: Vec3 }
  | { op: 'set_bone_rotation'; uuid: string; rotation: Vec3 }
  | { op: 'update_bone_rotation_keyframe'; animation_uuid: string; bone_uuid: string; keyframe_uuid: string; time: number; rotation: Vec3 }
  | { op: 'remove_bone_rotation_keyframe'; animation_uuid: string; bone_uuid: string; keyframe_uuid: string }
  | { op: 'set_node_visibility'; uuid: string; visible: boolean }
  | { op: 'remove_cube'; uuid: string }
  | { op: 'duplicate_cube'; source_uuid: string; new_uuid: string }
  | { op: 'reparent_node'; uuid: string; parent_uuid: string | null }
  | { op: 'remove_empty_bone'; uuid: string }
  | { op: 'set_face_uv'; uuid: string; face: string; uv: Vec4 }
  | { op: 'set_box_uv_offset'; uuid: string; offset: [number, number] }
  | { op: 'create_paint_texture'; uuid: string; name: string }
  | { op: 'enable_imported_paint_texture'; texture_index: number }
  | { op: 'import_paint_texture'; uuid: string; name: string; source: string }
  | { op: 'set_empty_atlas_resolution'; width: number; height: number }
  | { op: 'assign_cube_texture'; cube_uuid: string; texture_uuid: string }
  | { op: 'paint_texture_pixel'; texture_index: number; x: number; y: number; rgba: [number, number, number, number] }
  | { op: 'paint_texture_stroke'; texture_index: number; points: [number, number][]; rgba: [number, number, number, number] }
  | { op: 'paint_texture_brush'; texture_index: number; points: [number, number][]; radius: number; rgba: [number, number, number, number]; erase: boolean }
  | { op: 'paint_texture_rectangle'; texture_index: number; from: [number, number]; to: [number, number]; rgba: [number, number, number, number]; erase: boolean };
