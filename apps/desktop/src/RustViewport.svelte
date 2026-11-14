<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import type { BoneView, CubeView, HierarchyNode, Vec3 } from './rustEditorTypes';

  export let cubes: CubeView[] = [];
  export let bones: BoneView[] = [];
  export let hierarchy: HierarchyNode[] = [];
  export let selectedId: string | null = null;
  export let onSelect: (id: string | null) => void = () => {};

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ready = false;
  let unavailable = false;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let controls: OrbitControls | null = null;
  let modelRoot: THREE.Group | null = null;
  let pickMeshes: THREE.Mesh[] = [];
  let frameRequest = 0;
  let mouseStart: [number, number] | null = null;

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

  function deg(value: number) { return THREE.MathUtils.degToRad(value); }
  function vector(v: Vec3) { return new THREE.Vector3(v[0], v[1], v[2]); }

  function rebuild(
    currentCubes: CubeView[], currentBones: BoneView[],
    currentHierarchy: HierarchyNode[], currentSelection: string | null,
  ) {
    if (!modelRoot) return;
    for (const child of [...modelRoot.children]) {
      modelRoot.remove(child);
      disposeNode(child);
    }
    pickMeshes = [];
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
          const dimensions = [
            cube.to[0] - cube.from[0],
            cube.to[1] - cube.from[1],
            cube.to[2] - cube.from[2],
          ];
          // Zero-thickness cubes have no visible solid volume in this source slice.
          if (dimensions.some((side) => side <= 0)) continue;
          const geometry = new THREE.BoxGeometry(dimensions[0], dimensions[1], dimensions[2]);
          const active = currentSelection === cube.uuid;
          const material = new THREE.MeshLambertMaterial({
            color: active ? 0x80b8ef : COLORS[cube.color % COLORS.length],
            transparent: true,
            opacity: 0.94,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(
            (cube.from[0] + cube.to[0]) / 2 - cube.origin[0],
            (cube.from[1] + cube.to[1]) / 2 - cube.origin[1],
            (cube.from[2] + cube.to[2]) / 2 - cube.origin[2],
          );
          mesh.userData.cubeUuid = cube.uuid;
          pivot.add(mesh);
          pickMeshes.push(mesh);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: active ? 0xf8fafc : 0x46535f }),
          );
          mesh.add(edges);
        } else {
          const bone = bonesById.get(node.uuid);
          if (!bone) continue;
          const pivot = new THREE.Group();
          pivot.position.copy(vector(bone.origin).sub(vector(parentOrigin)));
          pivot.rotation.set(deg(bone.rotation[0]), deg(bone.rotation[1]), deg(bone.rotation[2]), 'ZYX');
          parent.add(pivot);
          visit(node.children, pivot, bone.origin);
        }
      }
    };

    visit(currentHierarchy, modelRoot, [0, 0, 0]);
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

  function pointerDown(event: PointerEvent) {
    mouseStart = event.button === 0 ? [event.clientX, event.clientY] : null;
  }

  function pointerUp(event: PointerEvent) {
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

  $: if (ready) rebuild(cubes, bones, hierarchy, selectedId);

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
      if (modelRoot) {
        disposeNode(modelRoot);
        modelRoot.clear();
      }
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
      modelRoot = null;
      pickMeshes = [];
    };
  });
</script>

<div class="view" bind:this={host} aria-label="3D model viewport">
  <canvas bind:this={canvas} tabindex="0" onpointerdown={pointerDown} onpointerup={pointerUp} onpointercancel={() => mouseStart = null}
    aria-label="Interactive untextured geometry preview. Drag to orbit, scroll to zoom, click to select Cube." />
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
