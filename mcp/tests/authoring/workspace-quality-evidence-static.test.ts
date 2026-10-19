import { describe, expect, test } from "bun:test";

/**
 * Read-only structural examples, never artistic targets or acceptance scores.
 * Source models are not modified. A PASS cannot establish visual resemblance,
 * native Blockbench editing, UV seam appearance or Minecraft playback.
 */
type Face = { uv?: number[]; texture?: number | null };
type Element = {
  uuid: string;
  type: string;
  from?: number[];
  to?: number[];
  faces?: Record<string, Face>;
};
type Group = { uuid: string; name: string };
type OutlinerNode = string | { uuid: string; children?: OutlinerNode[] };
type Texture = { name: string; width: number; height: number; source?: string };
type Keyframe = { time: number; channel: string };
type Animator = { name: string; type?: string; keyframes?: Keyframe[] };
type Animation = { name: string; length: number; animators?: Record<string, Animator> };
type SavedModel = {
  meta?: { model_format?: string };
  elements?: Element[];
  groups?: Group[];
  outliner?: OutlinerNode[];
  textures?: Texture[];
  animations?: Animation[];
};

const cases = [
  { label: "Lift", path: "../workspace/active/lift/lift.bbmodel" },
  { label: "Crimson Sentinel", path: "../workspace/active/crimson-sentinel-reference/crimson_sentinel.bbmodel" },
  { label: "Guardian Turret", path: "../workspace/active/crimson-guardian-turret/crimson_guardian_turret.bbmodel" },
] as const;

function inspectSavedProject(model: SavedModel): string[] {
  const problems: string[] = [];
  const elements = model.elements ?? [];
  const groups = model.groups ?? [];
  const textures = model.textures ?? [];
  const allIds = [...elements.map(e => e.uuid), ...groups.map(g => g.uuid)];
  const ids = new Set(allIds);
  const groupIds = new Set(groups.map(g => g.uuid));

  if (model.meta?.model_format !== "bedrock") problems.push("unsupported model format");
  if (!elements.length) problems.push("no elements");
  if (ids.size !== allIds.length) problems.push("duplicate UUID");

  const occurrences = new Map<string, number>();
  function visit(nodes: OutlinerNode[]): void {
    for (const node of nodes) {
      const id = typeof node === "string" ? node : node.uuid;
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
      if (!ids.has(id)) problems.push("orphan outliner ID");
      if (typeof node !== "string") visit(node.children ?? []);
    }
  }
  visit(model.outliner ?? []);
  for (const id of ids) {
    if (occurrences.get(id) !== 1) problems.push("unlinked or duplicate outliner ID");
  }

  for (const element of elements) {
    if (element.type !== "cube") continue;
    if ([element.from, element.to].some(coords =>
      !Array.isArray(coords) || coords.length !== 3 ||
      coords.some(value => !Number.isFinite(value))
    )) problems.push("invalid cube coordinates");
    for (const face of Object.values(element.faces ?? {})) {
      if (face.uv !== undefined &&
        (face.uv.length !== 4 || !face.uv.every(Number.isFinite))) {
        problems.push("invalid face UV");
      }
      if (face.texture !== null && face.texture !== undefined &&
        (!Number.isInteger(face.texture) || face.texture < 0 || face.texture >= textures.length)) {
        problems.push("invalid texture index");
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const texture of textures) {
    const source = texture.source ?? "";
    if (!source.startsWith("data:image/png;base64,")) {
      problems.push("missing embedded PNG");
      continue;
    }
    const png = Buffer.from(source.slice("data:image/png;base64,".length), "base64");
    if (png.length < 24 || !png.subarray(0, 8).equals(signature) ||
      png.toString("ascii", 12, 16) !== "IHDR") {
      problems.push("invalid embedded PNG header");
      continue;
    }
    if (png.readUInt32BE(16) !== texture.width ||
      png.readUInt32BE(20) !== texture.height) {
      problems.push("embedded PNG dimensions disagree with texture");
    }
  }

  for (const animation of model.animations ?? []) {
    if (!Number.isFinite(animation.length) || animation.length <= 0) {
      problems.push("invalid animation duration");
    }
    for (const [id, animator] of Object.entries(animation.animators ?? {})) {
      if ((animator.type ?? "bone") === "bone" && !groupIds.has(id)) {
        problems.push("orphan animation bone");
      }
      for (const key of animator.keyframes ?? []) {
        if (!Number.isFinite(key.time) || key.time < 0 ||
          key.time > animation.length + 1e-6) {
          problems.push("keyframe outside animation duration");
        }
      }
    }
  }
  return [...new Set(problems)].sort();
}

describe("read-only saved-asset structural evidence (not visual approval)", () => {
  for (const sample of cases) {
    test(sample.label + " has coherent saved model, atlas and animation references", async () => {
      const project = await Bun.file(sample.path).json() as SavedModel;
      expect(inspectSavedProject(project)).toEqual([]);
      // Report counts as inventory only, never as artistic quality metrics.
      console.info("[STATIC_ONLY]", sample.label,
        "elements:", project.elements?.length ?? 0,
        "textures:", project.textures?.length ?? 0,
        "animations:", project.animations?.length ?? 0);
    });
  }

  test("detects corrupt data without modifying the source asset", async () => {
    const project = await Bun.file(cases[0].path).json() as SavedModel;
    const damaged = structuredClone(project);
    damaged.outliner?.push("orphan");
    if (damaged.textures?.[0]) damaged.textures[0].source = "data:image/png;base64,AA==";
    const animation = damaged.animations?.[0];
    if (animation) {
      animation.animators = {
        ...(animation.animators ?? {}),
        orphan: { type: "bone", name: "not_in_hierarchy", keyframes: [
          { channel: "position", time: animation.length + 1 },
        ] },
      };
    }
    const problems = inspectSavedProject(damaged);
    for (const required of [
      "orphan outliner ID",
      "invalid embedded PNG header",
      "orphan animation bone",
      "keyframe outside animation duration",
    ]) expect(problems).toContain(required);
    expect(inspectSavedProject(project)).toEqual([]);
  });
  test("Guardian Turret reference and preview evidence cannot be mistaken for visual approval", async () => {
    const base = "../workspace/active/crimson-guardian-turret/";
    const [reference, evidence, summary] = await Promise.all([
      Bun.file(base + "reference/REFERENCE.json").json() as Promise<{
        images: Array<{ id: string; file: string; status: string }>;
        parts: Array<{ id: string; evidence: string }>;
      }>,
      Bun.file(base + "review/texture-detail-verification.json").json() as Promise<{
        current_verdict: string;
        seams: { cross_cube_continuity: string; scan: { scanned_faces: number; budget_skipped_faces: number } };
      }>,
      Bun.file(base + "README.md").text(),
    ]);
    const approved = reference.images.find(image => image.id === "redesign_target");
    expect(approved?.status).toBe("APPROVED");
    expect(approved?.file).toBe("redesign-target.png");
    for (const path of [
      "reference/redesign-target.png",
      "review/detail-textured-front.png",
      "review/detail-textured-front-left.png",
      "review/detail-textured-back.png",
    ]) {
      const file = Bun.file(base + path);
      expect(await file.exists(), path).toBe(true);
      expect(file.size, path).toBeGreaterThan(0);
    }
    expect(reference.parts.find(part => part.id === "rear_gold_yoke")?.evidence).toBe("PROVISIONAL");
    expect(evidence.current_verdict).toContain("READY_FOR_USER_REVIEW");
    expect(evidence.current_verdict).toContain("not user approval");
    if (evidence.seams.cross_cube_continuity === "not_evaluated") {
      expect(summary).toContain("Cross-Cube seam diagnostic: NOT_EVALUATED");
      expect(summary).toContain("64 of 498 faces");
      expect(evidence.seams.scan.scanned_faces).toBe(64);
    }
    expect(summary).toContain("no new visual approval");
    expect(summary).toContain("reference-to-model resemblance");
    expect(summary).toContain("user visual approval");
  });

});
