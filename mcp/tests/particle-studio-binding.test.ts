import { describe, expect, test } from "bun:test";
import { resolveUniqueParticlePreviewFile } from "../server/tools/animation/effects";
import { loadNativeParticlePreview } from "../server/tools/particle/inspection";

describe("Particle Studio native preview identity", () => {
  const loaded = [
    { path: "/pack/particles/blue.particle.json", identifier: "mivubi:blue" },
    { path: "/pack/particles/green.particle.json", identifier: "mivubi:green" },
  ];

  test("binds uniquely loaded exact identifiers and Bedrock short names", () => {
    expect(resolveUniqueParticlePreviewFile("mivubi:blue", loaded)).toBe(loaded[0].path);
    expect(resolveUniqueParticlePreviewFile("green", loaded)).toBe(loaded[1].path);
    expect(resolveUniqueParticlePreviewFile("missing", loaded)).toBeNull();
  });

  test("never guesses a file when two namespaces share a short name", () => {
    expect(resolveUniqueParticlePreviewFile("blue", [
      ...loaded, { path: "/pack/particles/second.particle.json", identifier: "other:blue" },
    ])).toBeNull();
    expect(resolveUniqueParticlePreviewFile("mivubi:blue", [
      ...loaded, { path: "/pack/particles/second.particle.json", identifier: "other:blue" },
    ])).toBe(loaded[0].path);
  });

  test("preview binding recheck is separate from exported semantic fields", async () => {
    const source = await Bun.file("server/tools/animation/effects.ts").text();
    expect(source).toContain('found.point.snapshot.file === next.file');
    expect(source).toContain('next.file = loadedParticlePreviewFile(next.effect) ?? ""');
    const studio = await Bun.file("ui/particleStudio.ts").text();
    expect(studio).toContain('operation: "update"');
    expect(studio).toContain('Particle is already attached at the selected playhead.');
  });

  test("native loader clears cached texture and requests refresh", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "Animator");
    let refreshes = 0;
    const config: { preview_texture?: string; updateTexture: () => void } = {
      preview_texture: "/pack/textures/particle/old.png",
      updateTexture: () => { refreshes += 1; },
    };
    const effectPath = "/pack/particles/blue.particle.json";
    Object.defineProperty(globalThis, "Animator", {
      configurable: true,
      value: {
        particle_effects: { [effectPath]: { config } },
        loadParticleEmitter: () => {
          // Simulates Blockbench's reset().setFromJSON() and its single updateTexture call.
          expect(config.preview_texture).toBeUndefined();
          config.updateTexture();
          return { config };
        },
      },
    });
    try {
      loadNativeParticlePreview(effectPath, "{}");
      expect(config.preview_texture).toBeUndefined();
      expect(refreshes).toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis, "Animator", original);
      else Reflect.deleteProperty(globalThis, "Animator");
    }
  });

  test("newly loaded particle does not require duplicate texture refresh", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "Animator");
    let refreshes = 0;
    const config = { updateTexture: () => { refreshes += 1; } };
    Object.defineProperty(globalThis, "Animator", {
      configurable: true,
      value: {
        particle_effects: {},
        loadParticleEmitter: () => { config.updateTexture(); return { config }; },
      },
    });
    try {
      loadNativeParticlePreview("/pack/particles/new.particle.json", "{}");
      expect(refreshes).toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis, "Animator", original);
      else Reflect.deleteProperty(globalThis, "Animator");
    }
  });

  test("rejects a loader returning no config rather than claiming a preview", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "Animator");
    Object.defineProperty(globalThis, "Animator", {
      configurable: true, value: { loadParticleEmitter: () => undefined },
    });
    try {
      expect(() => loadNativeParticlePreview("/pack/particles/missing.particle.json", "{}"))
        .toThrow(/rejected the particle document/);
    } finally {
      if (original) Object.defineProperty(globalThis, "Animator", original);
      else Reflect.deleteProperty(globalThis, "Animator");
    }
  });
});
