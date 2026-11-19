<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { TransformControls } from 'three/addons/controls/TransformControls.js';
  import { planCubeLocalTranslation, planCubeLocalRotation, planCubeLocalScale } from './rustMoveGizmo';
  import { projectedCubeBounds } from './rustCubeProjection';
  import { isActiveTextureRequest } from './rustTextureCache';
  import { cubeSelectionColors, selectionTargetIds } from './rustViewportSelection';
  import { canRefreshPaintSources, sceneRenderStructure, sameSceneInputs, singleCubeRotationUpdate, type SceneInputs } from './rustSceneIdentity';
  import { faceUvCoordinates, bedrockTextureForFace, isCubeFacePresent, previewRenderSide,
  supportedFaceUvRotation, BEDROCK_PREVIEW_ALPHA_TEST } from './rustTextureProjection';
  import type { BoneView, CubeView, HierarchyNode, Vec3 } from './rustEditorTypes';
  import { poseBoneIdsToUpdate, type BoneTransformPose } from './rustAnimationPose';
  import { reviewCameraAxes, type ReviewViewId } from './rustReviewCapture';
  import { appendPaintStrokeInPlace } from './rustPaintStroke';
  import {alphaFromImageData,isVisibleAlphaTexel} from './rustVisibleTexel';
  import { SURFACE_FACE_ORDER,hitFaceLocalTexel,sameSurface,
    canBeginSurfaceSeam,type SurfaceHit,type SurfaceGesture,
    type SurfaceSampleHit } from './rustSurfacePaint';

  export let cubes: CubeView[] = [];
  export let bones: BoneView[] = [];
  export let hierarchy: HierarchyNode[] = [];
  export let texturePreviewSources: (string | null)[] = [];
  export let texturePreviewSides: ('front' | 'double' | null)[] = [];
  export let texturePreviewResolutions: ([number, number] | null)[] = [];
  export let scopedTexturePreview = false;
  export let textureResolution: [number, number] = [16, 16];
  // View-only selection: null means first available Bedrock texture.
  export let previewTextureIndex: number | null = null;
  // Derived Animate-only linear numeric Bone transforms.
  // Never updates Rust-authored geometry or animation data.
  export let previewBoneTransforms: Record<string, BoneTransformPose> | null = null;
  export let selectedId: string | null = null;
  export let onSelect: (id: string | null) => void = () => {};
  // Direct-user paint gesture only. The native command resolves actual
  // texture UUID/UV and validates all face-local points before any mutation.
  export let surfacePaintEnabled = false;
  export let surfacePaintEpoch = 0;
  export let surfacePaintRevision = 0;
  export let surfacePaintTextureUuid: string | null = null;
  export let surfacePaintContextKey = '';
  export let surfaceSampleMode=false;
  export let surfaceSeamEnabled=false;
  export let onSurfaceStroke:(value:SurfaceGesture)=>void=()=>{};
  export let onSurfaceSample:(value:SurfaceSampleHit)=>void=()=>{};
  // One canonical Rust edit per completed 3D transform; preview never owns data.
  type GizmoMode = 'translate' | 'rotate' | 'scale';
  export let onTranslate: (uuid: string, delta: Vec3) => Promise<boolean> = async () => false;
  export let onRotate: (uuid: string, rotation: Vec3) => Promise<boolean> = async () => false;
  export let onScale: (uuid: string, factors: Vec3) => Promise<boolean> = async () => false;
  export let transformMode: GizmoMode | null = 'translate';
  export let canTransform = false;

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ready = false;
  let unavailable = false;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let controls: OrbitControls | null = null;
  let gizmo: TransformControls | null = null;
  let modelRoot: THREE.Group | null = null;
  let pickMeshes: THREE.Mesh[] = [];
  // Selection updates touch only the previously selected and next selected
  // meshes; raycast still uses the original complete list.
  let meshesByCube = new Map<string, THREE.Mesh>();
  let renderedSelection: string | null = null;
  // One derived index per rebuilt scene: Paint touches only material faces
  // using the changed atlas instead of scanning every Cube in the scene.
  type IndexedPaintMaterial = {
    material: THREE.MeshLambertMaterial;
    cubeUuid: string;
    fallbackColor: number;
  };
  let paintMaterialsByTexture = new Map<number, IndexedPaintMaterial[]>();
  const textureCache = new Map<number, { source: string; texture: THREE.Texture }>();
  // Disposable alpha-only preview data; never an editable RGBA bitmap.
  const alphaCache=new Map<number,{source:string;alpha:Uint8Array;
    width:number;height:number}>();
  const failedTextureSources = new Set<string>();
  let projectedScene: SceneInputs | null = null;
  const FACE_ORDER = SURFACE_FACE_ORDER;
  let pivots = new Map<string, THREE.Group>();
  // Existing Bone scene nodes and bind rotations, not a mutable asset model.
  let bonePivots = new Map<string, {
    pivot: THREE.Group; bindRotation: Vec3; bindPosition: Vec3;
  }>();
  // Only Bone channels actually present in the previous sparse preview pose.
  let posedBones = new Set<string>();
  let drag: {
    uuid: string; pivot: THREE.Group; mode: GizmoMode;
    start: THREE.Vector3; rotationStart: THREE.Quaternion;
    anglesStart: Vec3; scaleStart: THREE.Vector3;
  } | null = null;
  let mutationPending = false;
  let skipPick = false;
  let frameRequest = 0;
  let mouseStart: [number, number] | null = null;
  let surfaceGesture:(SurfaceGesture&{
    pointerId:number;overflow:boolean;stopped:boolean;
  })|null=null;

  const COLORS = [0xa6bbc3, 0x8cacc1, 0xb4a2bb, 0xb9a384, 0x90afa0, 0xbc8f8f];

  function scheduleRender() {
    if (!renderer || !scene || !camera || frameRequest) return;
    frameRequest = window.requestAnimationFrame(() => {
      frameRequest = 0;
      renderer?.render(scene!, camera!);
    });
  }

  function disposeNode(node: THREE.Object3D) {
    node.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
  }

  // GPU textures are derived render resources only; never edit a bitmap here.
  function embeddedTexture(index: number): THREE.Texture | null {
    const source = texturePreviewSources[index];
    if (!source || failedTextureSources.has(source)) return null;
    const cached = textureCache.get(index);
    if (cached?.source === source) return cached.texture;
    if (cached) { cached.texture.dispose(); textureCache.delete(index); }
    alphaCache.delete(index);
    // Distinguish this request from an older load of the exact same URI.
    // A stale image callback must not invalidate a newer GPU texture.
    const entry = { source, texture: null as THREE.Texture | null };
    const texture = new THREE.TextureLoader().load(
      source,
      () => {
        // A previous Paint/Undo/Redo image can finish loading after the
        // source or index is replaced. Never render a superseded resource.
        if (isActiveTextureRequest(textureCache, index, entry)) {
          scheduleRender();
        }
      },
      undefined,
      () => {
        if (!isActiveTextureRequest(textureCache, index, entry)) return;
        textureCache.delete(index);
        alphaCache.delete(index);
        failedTextureSources.add(source);
        entry.texture?.dispose();
        projectedScene = null;
        rebuild(cubes, bones, hierarchy);
      },
    );
    entry.texture = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    textureCache.set(index, entry as { source: string; texture: THREE.Texture });
    return texture;
  }

  function reconcileTextures() {
    for (const source of failedTextureSources) {
      if (!texturePreviewSources.includes(source)) failedTextureSources.delete(source);
    }
    for (const [index, cached] of textureCache) {
      if (texturePreviewSources[index] !== cached.source) {
        alphaCache.delete(index);
        cached.texture.dispose();
        textureCache.delete(index);
      }
    }
  }

  // Selection is a view-only operation. Never rebuild the scene or dispose
  // geometry/PNG resources merely because a Cube highlight changed.
  function updateSelection(currentSelection: string | null) {
    const targets = selectionTargetIds(renderedSelection, currentSelection);
    renderedSelection = currentSelection;
    if (!targets.length) return;
    for (const uuid of targets) {
      const mesh = meshesByCube.get(uuid);
      if (!mesh) continue; // Hidden/unavailable Cubes have no GPU projection.
      const fallback: unknown = mesh.userData.fallbackColor;
      if (typeof fallback !== 'number') continue;
      const colors = cubeSelectionColors(uuid, currentSelection, fallback);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshLambertMaterial && !material.map) {
          material.color.setHex(colors.untextured);
        }
      }
      for (const child of mesh.children) {
        if (child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) {
          child.material.color.setHex(colors.outline);
        }
      }
    }
    scheduleRender();
  }

  // Changing only admitted embedded PNG bytes cannot affect saved Cube UV,
  // hierarchy or rig. Rebind derived Three.js materials without discarding
  // geometry, raycast targets, Bone pivots or selection/gizmo state.
  function refreshPaintSources(identity: SceneInputs): boolean {
    if (!canRefreshPaintSources(projectedScene, identity)) return false;
    reconcileTextures();
    const changed = new Set<number>();
    for (let index = 0; index < identity.sources.length; index++) {
      if (projectedScene!.sources[index] !== identity.sources[index]) changed.add(index);
    }
    for (const index of changed) {
      const targets = paintMaterialsByTexture.get(index);
      if (!targets?.length) continue;
      const texture = embeddedTexture(index);
      // The browser decoder may reject a newly admitted PNG later. Its
      // active-request callback already invalidates this scene and rebuilds
      // the safe untextured fallback without changing Rust-owned pixels.
      for (const { material, cubeUuid, fallbackColor } of targets) {
        material.map = texture;
        const colors = cubeSelectionColors(cubeUuid, selectedId, fallbackColor);
        material.color.setHex(texture ? 0xffffff : colors.untextured);
        material.transparent = Boolean(texture);
        material.alphaTest = texture ? BEDROCK_PREVIEW_ALPHA_TEST : 0;
        material.opacity = texture ? 1 : 0.94;
        material.side = previewRenderSide(texture ? texturePreviewSides[index] : null) === 'front'
          ? THREE.FrontSide : THREE.DoubleSide;
        material.needsUpdate = true;
      }
    }
    projectedScene = { structure: identity.structure, sources: [...identity.sources] };
    scheduleRender();
    return true;
  }

  // Keep an unchanged Three.js scene for one admitted Cube rotation. This
  // does not reuse source-derived matrices when UV, hierarchy, texture or
  // any other saved property changes; those take the full rebuild path.
  function refreshCubeRotation(identity: SceneInputs): boolean {
    const update = singleCubeRotationUpdate(projectedScene, identity);
    if (!update) return false;
    const pivot = pivots.get(update.uuid);
    if (!pivot) return false;
    pivot.rotation.set(
      deg(update.rotation[0]), deg(update.rotation[1]),
      deg(update.rotation[2]), 'ZYX',
    );
    projectedScene = { structure: identity.structure, sources: [...identity.sources] };
    scheduleRender();
    return true;
  }

  function deg(value: number) { return THREE.MathUtils.degToRad(value); }
  function vector(v: Vec3) { return new THREE.Vector3(v[0], v[1], v[2]); }

  function syncGizmo(allowed: boolean, mode: GizmoMode | null) {
    if (!gizmo) return;
    if (mode && !drag) {
      gizmo.setMode(mode);
      gizmo.setSpace(mode === 'translate' ? 'world' : 'local');
    }
    const pivot = selectedId ? pivots.get(selectedId) : undefined;
    if (pivot && allowed && mode && !mutationPending && !drag) {
      if (gizmo.object !== pivot) gizmo.attach(pivot);
      gizmo.enabled = true;
    } else {
      if (gizmo.object) gizmo.detach();
      gizmo.enabled = false;
    }
    scheduleRender();
  }

  // During time scrubbing/playback update only Bone transforms; rebuilding
  // every BoxGeometry and GPU material at 60 FPS would be unnecessarily costly.
  function applyPreviewPose(pose: Record<string, BoneTransformPose> | null) {
    // Only currently animated Bones and previously animated Bones need
    // adjustment. The latter must return to their bind transforms when an
    // Animation clip stops or switches to a different Bone track.
    const affected = poseBoneIdsToUpdate(posedBones, pose);
    const nextPosed = new Set<string>();
    for (const uuid of affected) {
      const bound = bonePivots.get(uuid);
      if (!bound) continue; // Removed/unsupported Bones have no scene node.
      const { pivot, bindRotation, bindPosition } = bound;
      const transform = pose?.[uuid];
      if (transform) nextPosed.add(uuid);
      // Single-clip default blend: Position adds to bind position;
      // Rotation offsets bind angles; Scale multiplies bind scale=1.
      // Blockbench v5.2.1 BoneAnimator.displayPosition/displayScale.
      pivot.position.set(
        bindPosition[0] + (transform?.position[0] ?? 0),
        bindPosition[1] + (transform?.position[1] ?? 0),
        bindPosition[2] + (transform?.position[2] ?? 0),
      );
      pivot.rotation.set(
        deg(bindRotation[0] + (transform?.rotation[0] ?? 0)),
        deg(bindRotation[1] + (transform?.rotation[1] ?? 0)),
        deg(bindRotation[2] + (transform?.rotation[2] ?? 0)),
        'ZYX',
      );
      const scale = transform?.scale ?? [1, 1, 1];
      // Pinned Blockbench substitutes a tiny nonzero value for a zero
      // preview scale. Negative scale is deliberately unsupported.
      pivot.scale.set(
        scale[0] || 0.00001, scale[1] || 0.00001, scale[2] || 0.00001,
      );
    }
    posedBones = nextPosed;
    scheduleRender();
  }

  function rebuild(
    currentCubes: CubeView[], currentBones: BoneView[],
    currentHierarchy: HierarchyNode[],
    _sources: (string | null)[] = texturePreviewSources,
    _sides: ('front' | 'double' | null)[] = texturePreviewSides,
    _resolutions: ([number, number] | null)[] = texturePreviewResolutions,
    _scopedTexturePreview: boolean = scopedTexturePreview,
    _resolution: [number, number] = textureResolution,
    _previewTextureIndex: number | null = previewTextureIndex,
  ) {
    // Never destroy a manipulated object before its one Rust transaction ends.
    if (!modelRoot || drag || mutationPending) return;
    // An editor label, Outliner expansion or animation timeline update
    // cannot change this renderer projection. Compare only scene dependencies;
    // never stringify PNG data or treat cache identity as document authority.
    const identity: SceneInputs = {
      structure: sceneRenderStructure(
        currentCubes, currentBones, currentHierarchy,
        _sides, _resolutions, _scopedTexturePreview,
        _resolution, _previewTextureIndex,
      ),
      sources: _sources,
    };
    if (sameSceneInputs(projectedScene, identity)) return;
    if (refreshPaintSources(identity)) return;
    if (refreshCubeRotation(identity)) return;
    gizmo?.detach();
    reconcileTextures();
    for (const child of [...modelRoot.children]) {
      modelRoot.remove(child);
      disposeNode(child);
    }
    pickMeshes = [];
    meshesByCube = new Map();
    renderedSelection = null;
    paintMaterialsByTexture = new Map();
    pivots = new Map();
    bonePivots = new Map();
    posedBones.clear();
    const cubesById = new Map(currentCubes.map((cube) => [cube.uuid, cube] as const));
    const bonesById = new Map(currentBones.map((bone) => [bone.uuid, bone] as const));

    const visit = (nodes: HierarchyNode[], parent: THREE.Group, parentOrigin: Vec3) => {
      for (const node of nodes) {
        if (typeof node === 'string') {
          const cube = cubesById.get(node);
          if (!cube || !cube.visible) continue;
          const pivot = new THREE.Group();
          pivot.position.copy(vector(cube.origin).sub(vector(parentOrigin)));
          pivot.rotation.set(deg(cube.rotation[0]), deg(cube.rotation[1]), deg(cube.rotation[2]), 'ZYX');
          parent.add(pivot);
          pivots.set(cube.uuid, pivot);
          const bounds = projectedCubeBounds(cube.from, cube.to, cube.inflate, cube.stretch);
          // Do not show a false default-sized solid when an imported Cube
          // has unsupported inverted/zero inflated or stretched dimensions.
          if (!bounds) continue;
          const geometry = new THREE.BoxGeometry(...bounds.size);
          const uvAttribute = geometry.getAttribute('uv') as THREE.BufferAttribute;
          const materials: THREE.MeshLambertMaterial[] = [];
          geometry.clearGroups();
          for (let faceIndex = 0; faceIndex < FACE_ORDER.length; faceIndex++) {
            const face = cube.faces[FACE_ORDER[faceIndex]];
            const textureIndex = bedrockTextureForFace(
              face, previewTextureIndex, texturePreviewSources.length,
              scopedTexturePreview, cube.previewTextureIndex,
            );
            // In the pinned attachable ruleset, Cube scope determines the
            // material and that texture's UV grid, not the project atlas.
            const uvResolution = scopedTexturePreview
              ? (textureIndex === null ? null : texturePreviewResolutions[textureIndex] ?? null)
              : textureResolution;
            const rectangle = uvResolution
              ? faceUvCoordinates(face, uvResolution, cube.boxUv) : null;
            const texture = textureIndex !== null && rectangle
              ? embeddedTexture(textureIndex) : null;
            if (isCubeFacePresent(face)) {
              geometry.addGroup(faceIndex * 6, 6, faceIndex);
            }
            if (texture && rectangle) {
              for (let vertex = 0; vertex < 4; vertex++) {
                uvAttribute.setXY(faceIndex * 4 + vertex,
                  rectangle[vertex * 2], rectangle[vertex * 2 + 1]);
              }
            }
            const material = new THREE.MeshLambertMaterial({
              map: texture,
              color: texture ? 0xffffff : COLORS[cube.color % COLORS.length],
              transparent: Boolean(texture),
              // Blockbench 5.2.1 discards sampled alpha < 0.01. In the
              // Rust preview this also prevents invisible texels from
              // writing depth and hiding other modeled faces behind them.
              alphaTest: texture ? BEDROCK_PREVIEW_ALPHA_TEST : 0,
              opacity: texture ? 1 : 0.94,
              // Respect the pinned default double-side texture preview,
              // with explicit per-texture front-side overrides.
              side: previewRenderSide(texture ? texturePreviewSides[textureIndex!] : null) === 'front'
                ? THREE.FrontSide : THREE.DoubleSide,
            });
            // Read-only UV/material identity for source-only texture refreshes.
            material.userData.previewTextureIndex =
              rectangle && textureIndex !== null ? textureIndex : null;
            materials.push(material);
          }
          uvAttribute.needsUpdate = true;
          const mesh = new THREE.Mesh(geometry, materials);
          for (const material of materials) {
            const textureIndex: unknown = material.userData.previewTextureIndex;
            if (typeof textureIndex !== 'number') continue;
            const entries = paintMaterialsByTexture.get(textureIndex) ?? [];
            entries.push({
              material, cubeUuid: cube.uuid,
              fallbackColor: COLORS[cube.color % COLORS.length],
            });
            paintMaterialsByTexture.set(textureIndex, entries);
          }
          // Match pinned Blockbench Cube.preview_controller.updateRenderOrder.
          mesh.renderOrder = cube.renderOrder;
          mesh.position.set(
            bounds.center[0] - cube.origin[0],
            bounds.center[1] - cube.origin[1],
            bounds.center[2] - cube.origin[2],
          );
          mesh.userData.cubeUuid = cube.uuid;
          mesh.userData.fallbackColor = COLORS[cube.color % COLORS.length];
          pivot.add(mesh);
          pickMeshes.push(mesh);
          meshesByCube.set(cube.uuid, mesh);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x46535f }),
          );
          mesh.add(edges);
        } else {
          const bone = bonesById.get(node.uuid);
          if (!bone) continue;
          const pivot = new THREE.Group();
          pivot.position.copy(vector(bone.origin).sub(vector(parentOrigin)));
          // Preserve the Rust bind pose; the admitted preview offset is
          // applied in-place on top of it by applyPreviewPose().
          bonePivots.set(bone.uuid, {
            pivot, bindRotation: [...bone.rotation] as Vec3,
            bindPosition: [pivot.position.x, pivot.position.y,
              pivot.position.z],
          });
          parent.add(pivot);
          visit(node.children, pivot, bone.origin);
        }
      }
    };

    visit(currentHierarchy, modelRoot, [0, 0, 0]);
    projectedScene = { structure: identity.structure, sources: [...identity.sources] };
    applyPreviewPose(previewBoneTransforms);
    updateSelection(selectedId);
    syncGizmo(canTransform, transformMode);
    scheduleRender();
  }

  function resize() {
    if (!host || !renderer || !camera) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    scheduleRender();
  }

  /** User-requested view of the current Rust Three.js preview, never a
   * Bedrock/Blockbench render or independent artistic verdict. No model edit.
   * Synchronous draw/read makes each direction capture the same scene state.
   */
  export function captureReviewPng(
    viewId: ReviewViewId,
    expectedPaintSource?: {index: number; source: string},
  ): string {
    if (!ready || !renderer || !scene || !camera || !modelRoot ||
        !projectedScene || mutationPending || drag) {
      throw new Error('REVIEW_CAPTURE_VIEWPORT_NOT_READY');
    }
    const axes = reviewCameraAxes(viewId);
    if (!axes) throw new Error('REVIEW_CAPTURE_VIEW_UNKNOWN');
    // P0-D/E: a before/after comparison must render the precise temporary
    // or original atlas expected by the UI, never an older cached PNG.
    if (expectedPaintSource) {
      const {index,source}=expectedPaintSource;
      if (!Number.isSafeInteger(index) || index<0 ||
          !source.startsWith('data:image/png;base64,') ||
          projectedScene.sources[index]!==source ||
          !paintMaterialsByTexture.get(index)?.length ||
          textureCache.get(index)?.source!==source) {
        throw new Error('REVIEW_CAPTURE_TEXTURE_SOURCE_MISMATCH');
      }
    }
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    if (bounds.isEmpty()) throw new Error('REVIEW_CAPTURE_NO_RENDERABLE_MODEL');
    // Never silently export placeholder colors while used GPU textures
    // are still loading. Unsupported imported materials remain UNVERIFIED.
    for (const index of paintMaterialsByTexture.keys()) {
      const entry=textureCache.get(index);
      const image=entry?.texture.image as HTMLImageElement | undefined;
      if (!entry || entry.source!==projectedScene.sources[index] ||
          !image || image.complete!==true || image.naturalWidth<1 ||
          image.naturalHeight<1) {
        throw new Error('REVIEW_CAPTURE_TEXTURE_NOT_READY');
      }
    }
    const target = bounds.getCenter(new THREE.Vector3());
    const distance = Math.max(12, bounds.getSize(new THREE.Vector3()).length() * 2);
    const captureCamera = camera.clone();
    captureCamera.position.copy(target).add(new THREE.Vector3(
      ...axes.direction).multiplyScalar(distance));
    captureCamera.up.set(...axes.up);
    captureCamera.lookAt(target);
    captureCamera.updateMatrixWorld(true);
    const hidden: Array<{ node: THREE.Object3D; visible: boolean }> = [];
    scene.traverse((node) => {
      if (node === gizmo || node instanceof THREE.GridHelper ||
          node instanceof THREE.AxesHelper || node instanceof THREE.LineSegments) {
        hidden.push({ node, visible: node.visible });
        node.visible = false;
      }
    });
    const priorSelection = renderedSelection;
    updateSelection(null);
    try {
      renderer.render(scene, captureCamera);
      const png = canvas.toDataURL('image/png');
      // IPC/native PNG decoding imposes a second independent size limit.
      if (!png.startsWith('data:image/png;base64,') ||
          png.length > 3 * 1024 * 1024) {
        throw new Error('REVIEW_CAPTURE_PNG_UNAVAILABLE');
      }
      return png;
    } finally {
      for (const item of hidden) item.node.visible = item.visible;
      updateSelection(priorSelection);
      scheduleRender();
    }
  }

  export function frameModel() {
    if (!modelRoot || !camera || !controls) return;
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    if (bounds.isEmpty()) {
      camera.position.set(25, 19, 25);
      controls.target.set(0, 0, 0);
    } else {
      const center = bounds.getCenter(new THREE.Vector3());
      const length = Math.max(bounds.getSize(new THREE.Vector3()).length(), 8);
      camera.position.copy(center).add(new THREE.Vector3(length, length * 0.7, length));
      controls.target.copy(center);
    }
    controls.update();
    scheduleRender();
  }

  function onGizmoDown() {
    const pivot = selectedId ? pivots.get(selectedId) : undefined;
    const cube = selectedId ? cubes.find((item) => item.uuid === selectedId) : undefined;
    if (!pivot || !cube || !gizmo || gizmo.object !== pivot ||
        !canTransform || !transformMode || mutationPending) return;
    drag = {
      uuid: cube.uuid, pivot, mode: transformMode,
      start: pivot.position.clone(),
      rotationStart: pivot.quaternion.clone(),
      anglesStart: [...cube.rotation] as Vec3,
      scaleStart: pivot.scale.clone(),
    };
    skipPick = true;
    mouseStart = null;
    if (controls) controls.enabled = false;
  }

  function onGizmoUp() {
    if (controls) controls.enabled = true;
    const gesture = drag;
    drag = null;
    if (!gesture) return;
    const edit = gesture.mode === 'translate'
      ? planCubeLocalTranslation(
          gesture.uuid,
          [gesture.start.x, gesture.start.y, gesture.start.z],
          [gesture.pivot.position.x, gesture.pivot.position.y, gesture.pivot.position.z],
        )
      : gesture.mode === 'rotate'
        ? gesture.rotationStart.angleTo(gesture.pivot.quaternion) > 1e-6
          ? planCubeLocalRotation(gesture.uuid, gesture.anglesStart, [
              THREE.MathUtils.radToDeg(gesture.pivot.rotation.x),
              THREE.MathUtils.radToDeg(gesture.pivot.rotation.y),
              THREE.MathUtils.radToDeg(gesture.pivot.rotation.z),
            ])
          : null
        : planCubeLocalScale(
            gesture.uuid,
            [gesture.scaleStart.x, gesture.scaleStart.y, gesture.scaleStart.z],
            [gesture.pivot.scale.x, gesture.pivot.scale.y, gesture.pivot.scale.z],
          );
    if (!edit || gesture.uuid !== selectedId || !canTransform ||
        gesture.mode !== transformMode) {
      projectedScene = null;
      rebuild(cubes, bones, hierarchy);
      return;
    }
    mutationPending = true;
    if (gizmo) gizmo.enabled = false;
    // Rust commits exactly one transform command; failed/unknown outcomes
    // must restore the source pose, while a successful source-bound rotation
    // can use the local pivot-only path instead of replacing every GPU mesh.
    void (async () => {
      let accepted = false;
      try {
        if (edit.op === 'translate_cube') accepted = await onTranslate(edit.uuid, edit.delta);
        else if (edit.op === 'set_cube_rotation') accepted = await onRotate(edit.uuid, edit.rotation);
        else accepted = await onScale(edit.uuid, edit.factors);
      } catch {
        // No speculative retry or model mutation in the viewport.
      } finally {
        mutationPending = false;
        // A rejected, canceled or unconfirmed gesture has moved the transient
        // gizmo even though the authoritative Rust scene may be unchanged.
        // Force reconstruction only for that rollback case.
        if (!accepted) projectedScene = null;
        rebuild(cubes, bones, hierarchy);
      }
    })();
  }

  function alphaPreview(index:number,source:string,
    image:HTMLImageElement):Uint8Array|null{
    const cached=alphaCache.get(index);
    if(cached?.source===source&&cached.width===textureResolution[0]&&
       cached.height===textureResolution[1])return cached.alpha;
    alphaCache.delete(index);
    const [width,height]=textureResolution;
    if(image.naturalWidth!==width||image.naturalHeight!==height)return null;
    try{
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)return null;
      context.drawImage(image,0,0,width,height);
      const alpha=alphaFromImageData(context.getImageData(
        0,0,width,height).data,width,height);
      if(!alpha)return null;
      alphaCache.set(index,{source,alpha,width,height});
      return alpha;
    }catch{
      return null;
    }
  }
  function surfacePick(event:PointerEvent):SurfaceHit|null{
    if(!camera||!canvas||!surfacePaintEnabled||scopedTexturePreview||
       !surfacePaintTextureUuid||!ready)return null;
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return null;
    const ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      (event.clientX-rect.left)/rect.width*2-1,
      -(event.clientY-rect.top)/rect.height*2+1,
    ),camera);
    const hits=ray.intersectObjects(pickMeshes,false);
    const byUuid=new Map(cubes.map(cube=>[cube.uuid,cube]));
    for(const first of hits){
      if(!first.uv||!first.face)continue;
      const face=FACE_ORDER[first.face.materialIndex];
      const cubeUuid=first.object.userData.cubeUuid;
      if(!face||typeof cubeUuid!=='string')return null;
      const cube=byUuid.get(cubeUuid);
      const data=cube?.faces[face];
      if(!cube||!data||data.enabled===false)return null;
      const index=bedrockTextureForFace(data,previewTextureIndex,
        texturePreviewSources.length,scopedTexturePreview,
        cube.previewTextureIndex);
      // Unknown texture or alpha cannot prove that a lower hit is visible.
      if(index===null||!texturePreviewSources[index])return null;
      const texture=textureCache.get(index);
      if(!texture||texture.source!==texturePreviewSources[index]||
         !(texture.texture.image instanceof HTMLImageElement)||
         !texture.texture.image.complete||
         texture.texture.image.naturalWidth!==textureResolution[0]||
         texture.texture.image.naturalHeight!==textureResolution[1])return null;
      const alpha=alphaPreview(index,texture.source,texture.texture.image);
      if(!alpha)return null;
      if(!isVisibleAlphaTexel(alpha,[first.uv.x,first.uv.y],
        textureResolution[0],textureResolution[1],
        BEDROCK_PREVIEW_ALPHA_TEST))continue;
      // The *first visible* hit is not writable unless it is the explicitly
      // selected owned atlas. Do not silently paint a covered rear face.
      if(!(data.texture===surfacePaintTextureUuid ||
           data.texture===index))return null;
      const corners=faceUvCoordinates(data,textureResolution,cube.boxUv);
      const local=corners?hitFaceLocalTexel(
        data,corners,[first.uv.x,first.uv.y]):null;
      const rotation=supportedFaceUvRotation(data);
      if(!local||rotation===null)return null;
      return {cubeUuid,face,textureIndex:index,
        texel:local.texel,size:local.size,
        sourceUv:[data.uv[0],data.uv[1],data.uv[2],data.uv[3]],
        sourceRotation:rotation};
    }
    return null;
  }
  function moveSurfacePointer(event:PointerEvent){
    const current=surfaceGesture;
    if(!current||current.pointerId!==event.pointerId||current.stopped)return;
    if(!surfacePaintEnabled||
       current.contextKey!==surfacePaintContextKey||
       current.epoch!==surfacePaintEpoch||
       current.revision!==surfacePaintRevision||
       !surfacePaintTextureUuid||
       current.textureUuid!==surfacePaintTextureUuid){
      surfaceGesture={...current,stopped:true,overflow:true};
      return;
    }
    const hit=surfacePick(event);
    if(!hit){
      surfaceGesture={...current,stopped:true,overflow:surfaceSeamEnabled};
      return;
    }
    if(current.seam){
      if(!sameSurface(current.seam,hit)){
        surfaceGesture={...current,stopped:true,overflow:true};
        return;
      }
      if(!appendPaintStrokeInPlace(current.seam.points,hit.texel,
        current.seam.size[0],current.seam.size[1])||
        current.points.length+current.seam.points.length>4096){
        surfaceGesture={...current,stopped:true,overflow:true};
      }
      return;
    }
    if(sameSurface(current,hit)){
      if(!appendPaintStrokeInPlace(current.points,hit.texel,
        current.size[0],current.size[1])){
        surfaceGesture={...current,stopped:true,overflow:true};
      }
    }else if(surfaceSeamEnabled&&canBeginSurfaceSeam(current,hit)){
      // Rust verifies shared Bone frame, actual coplanarity, edge contact,
      // UV isolation and original color before any source may change.
      surfaceGesture={...current,seam:{...hit,points:[hit.texel]}};
    }else{
      surfaceGesture={...current,stopped:true,overflow:surfaceSeamEnabled};
    }
  }
  function finishSurfacePointer(event:PointerEvent,cancelled=false){
    const held=surfaceGesture;
    if(!held||held.pointerId!==event.pointerId)return;
    if(!cancelled)moveSurfacePointer(event);
    const completed=surfaceGesture??held;
    surfaceGesture=null;
    if(canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if(!cancelled&&!completed.overflow&&surfacePaintEnabled&&
       completed.epoch===surfacePaintEpoch&&
       completed.revision===surfacePaintRevision&&
       completed.textureUuid===surfacePaintTextureUuid&&
       completed.contextKey===surfacePaintContextKey){
      onSurfaceStroke({cubeUuid:completed.cubeUuid,face:completed.face,
        textureIndex:completed.textureIndex,texel:completed.texel,
        size:completed.size,sourceUv:completed.sourceUv,
        sourceRotation:completed.sourceRotation,epoch:completed.epoch,
        revision:completed.revision,textureUuid:completed.textureUuid,
        contextKey:completed.contextKey,points:completed.points,
        ...(completed.seam?{seam:completed.seam}:{})});
    }
  }
  function pointerMove(event:PointerEvent){
    if(surfaceGesture)moveSurfacePointer(event);
  }
  function pointerLost(event:PointerEvent){
    if(surfaceGesture?.pointerId===event.pointerId)surfaceGesture=null;
  }
  function pointerDown(event: PointerEvent) {
    if(surfacePaintEnabled && event.button===0){
      const hit=surfacePick(event);
      mouseStart=null;
      if(!hit)return;
      if(surfaceSampleMode){
        // Source selection is a read-only native RGBA8 sample, not a
        // WebGL canvas/lighting/texture-image-derived color guess.
        onSurfaceSample({...hit,epoch:surfacePaintEpoch,
          revision:surfacePaintRevision,textureUuid:surfacePaintTextureUuid!,
          contextKey:surfacePaintContextKey});
        event.preventDefault();
        return;
      }
      surfaceGesture={...hit,epoch:surfacePaintEpoch,
        revision:surfacePaintRevision,
        textureUuid:surfacePaintTextureUuid!,
        contextKey:surfacePaintContextKey,points:[hit.texel],
        pointerId:event.pointerId,overflow:false,stopped:false};
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (!gizmo?.dragging) skipPick = false;
    mouseStart = event.button === 0 ? [event.clientX, event.clientY] : null;
  }

  function pointerCancel() {
    surfaceGesture=null;
    mouseStart = null;
    if (drag) {
      gizmo?.reset();
      drag = null;
      if (controls) controls.enabled = true;
      projectedScene = null;
      rebuild(cubes, bones, hierarchy);
    }
  }

  function pointerUp(event: PointerEvent) {
    if(surfaceGesture && surfaceGesture.pointerId===event.pointerId){
      finishSurfacePointer(event);
      event.preventDefault();return;
    }
    if(surfacePaintEnabled && event.button===0)return;
    if (skipPick) {
      skipPick = false;
      mouseStart = null;
      return;
    }
    if (event.button !== 0 || !mouseStart || !camera || !renderer) return;
    const movement = Math.hypot(event.clientX - mouseStart[0], event.clientY - mouseStart[1]);
    mouseStart = null;
    if (movement > 4) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(pickMeshes, false);
    onSelect(hits.length ? String(hits[0].object.userData.cubeUuid) : null);
  }

  $: if (ready) rebuild(cubes, bones, hierarchy,
    texturePreviewSources, texturePreviewSides, texturePreviewResolutions,
    scopedTexturePreview, textureResolution, previewTextureIndex);
  $: if (ready) applyPreviewPose(previewBoneTransforms);
  $: if (ready) {
    updateSelection(selectedId);
    syncGizmo(canTransform, transformMode);
    // In 3D paint, left-drag cannot also orbit. Right/middle navigation stays.
    if(controls)controls.mouseButtons.LEFT=surfacePaintEnabled
      ? (-1 as typeof controls.mouseButtons.LEFT) : THREE.MOUSE.ROTATE;
  }

  onMount(() => {
    let observer: ResizeObserver | null = null;
    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#181b1f');
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
      camera.position.set(25, 19, 25);
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      modelRoot = new THREE.Group();
      scene.add(modelRoot);
      scene.add(new THREE.HemisphereLight(0xcde3fb, 0x475161, 2));
      const sunlight = new THREE.DirectionalLight(0xffffff, 2);
      sunlight.position.set(25, 45, 30);
      scene.add(sunlight);
      scene.add(new THREE.GridHelper(64, 64, 0x334155, 0x252d37));
      scene.add(new THREE.AxesHelper(3));
      gizmo = new TransformControls(camera, canvas);
      gizmo.setMode('translate');
      gizmo.setSpace('world');
      gizmo.setSize(0.85);
      gizmo.enabled = false;
      gizmo.addEventListener('change', scheduleRender);
      gizmo.addEventListener('mouseDown', onGizmoDown);
      gizmo.addEventListener('mouseUp', onGizmoUp);
      // TransformControls r162 is an Object3D. Add it to the same scene.
      scene.add(gizmo);
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = false;
      controls.target.set(0, 0, 0);
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      controls.addEventListener('change', scheduleRender);
      controls.update();
      observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      ready = true;
    } catch {
      unavailable = true;
    }
    return () => {
      ready = false;
      observer?.disconnect();
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      controls?.dispose();
      controls = null;
      gizmo?.detach();
      gizmo?.dispose();
      gizmo?.removeFromParent();
      gizmo = null;
      drag = null;
      surfaceGesture=null;
      mutationPending = false;
      if (modelRoot) {
        disposeNode(modelRoot);
        modelRoot.clear();
      }
      for (const { texture } of textureCache.values()) texture.dispose();
      textureCache.clear();
      alphaCache.clear();
      failedTextureSources.clear();
      renderer?.dispose();
      renderer = null;
      projectedScene = null;
      scene = null;
      camera = null;
      modelRoot = null;
      pickMeshes = [];
      meshesByCube.clear();
      paintMaterialsByTexture.clear();
      renderedSelection = null;
      pivots.clear();
      bonePivots.clear();
      posedBones.clear();
    };
  });
</script>

<div class="view" bind:this={host} aria-label="3D model viewport">
  <canvas bind:this={canvas} tabindex="0"
    onpointerdown={pointerDown} onpointermove={pointerMove}
    onpointerup={pointerUp} onpointercancel={pointerCancel}
    onlostpointercapture={pointerLost}
    aria-label={surfacePaintEnabled
      ? (surfaceSampleMode
        ? 'Sample the original face pixel from Rust with a click. No model change.'
        : 'Draw an exact hard pixel stroke on a source-bound Cube face. Optional adjacent Cube seam bridge is checked by Rust; right drag pans.')
      : 'Geometry preview with embedded PNG textures. Select a Cube and use Move, Rotate or Scale gizmo; drag to orbit, scroll to zoom.'} />
  {#if unavailable}
    <div class="viewer-unavailable" role="status">3D viewport could not initialize. Model files remain safe.</div>
  {/if}
</div>

<style>
  .view { min-width: 0; min-height: 0; width: 100%; height: 100%; position: relative; overflow: hidden; background: #181b1f; }
  canvas { width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; outline-offset: -3px; }
  canvas:focus-visible { outline: 2px solid #3e90ff; }
  .viewer-unavailable { position: absolute; left: 16px; right: 16px; top: 16px; padding: 12px; border: 1px solid #896a42; background: #302923; color: #efcd9e; }
</style>
