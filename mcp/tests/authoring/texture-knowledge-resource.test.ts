import { describe, expect, test } from "bun:test";
import {
  createTextureUvCaseReader,
  suggestTextureUvTechnicalKnowledge,
  TEXTURE_UV_CASE_IDS,
} from "@/lib/texture/knowledgeCases";
import { getAllResourceDefinitions } from "@/lib/factories";
import { classifyWatchPath, RUNTIME_WATCH_TARGETS } from "@/build/watch-policy";
import "@/server/resources/texture-authoring-knowledge";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("on-demand texture authoring knowledge", () => {
  test("surface recipes and Vanilla principles are resources rather than hot-path tools", async () => {
    const [resource, index, skill] = await Promise.all([
      source("server/resources/texture-authoring-knowledge.ts"),
      source("server/index.ts"),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
    ]);

    expect(index).toContain('import "./resources/texture-authoring-knowledge"');
    expect(resource).toContain('uriTemplate: "texture-authoring://{topic}"');
    for (const topic of [
      "surface-patterns",
      "vanilla-principles",
      "render-profiles",
      "treatment-plan",
    ]) expect(resource).toContain(topic);
    expect(resource).toContain("TEXTURE_SURFACE_PATTERN_RECIPES");
    expect(resource).toContain("VANILLA_TEXTURE_KNOWLEDGE");
    expect(resource).not.toContain("createTool(");
    expect(skill).not.toContain("wood_grain painted_wood brushed_metal bare_metal");
  });

  test("knowledge remains reference grammar instead of copied image assets or network dependency", async () => {
    const vanilla = await source("lib/texture/vanillaKnowledge.ts");
    expect(vanilla).toContain("runtime_network_required: false");
    expect(vanilla).toContain("copied_texture_assets_required: false");
    expect(vanilla).toContain("inferring render_profile from surface_pattern");
  });
});


describe("K4 on-demand Texture/UV knowledge consumer — no mutation", () => {
  const casePath = "../docs/03-authoring/texture/decision-cases.md";
  const readCasebook = () => Bun.file(casePath).text();

  test("four source-pinned cases stay separately selectable through the ONE semantic index", async () => {
    const reader = createTextureUvCaseReader(await readCasebook());
    for (const id of TEXTURE_UV_CASE_IDS) {
      const selected = reader.read(id);
      expect(selected.state).toBe("SOURCE_CANDIDATE");
      if (selected.state !== "SOURCE_CANDIDATE") continue;
      expect(selected.case_id).toBe(id);
      expect(selected.section_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(selected.source_sha256).toBe(reader.source_sha256);
      expect(selected.section_id).toContain("decision-cases");
      expect(selected.required_evidence.length).toBeGreaterThan(20);
      expect(selected.reference_scope).toBe("CURRENT_USER_REFERENCE_NOT_ATTESTED");
      expect(selected.target_compatibility).toBe("UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH");
      expect(selected.decision_readiness).toBe("REVIEW_REQUIRED");
      expect(selected.mutation_authorized).toBe(false);
      expect(selected.visual_verdict).toBe("not_evaluated");
    }
  });

  test("strict case-title selection excludes generic, unrelated and ambiguous queries", async () => {
    const reader = createTextureUvCaseReader(await readCasebook());
    for (const [query, id] of [
      ["mirrored texel reuse asymmetric identity", "UV-P01"],
      ["reference material palette pixel clusters", "TEX-P01"],
      ["cross cube seam observed continuity", "TEX-P02"],
      ["emissive eyes material pbr render", "TEX-P03"],
    ] as const) {
      const selection = reader.select(query);
      expect(selection.state).toBe("SOURCE_CANDIDATE");
      if (selection.state === "SOURCE_CANDIDATE") {
        expect(selection.case_id).toBe(id);
        expect(selection.mutation_authorized).toBe(false);
      }
    }
    expect(reader.select("material")).toMatchObject({
      state: "REVIEW_REQUIRED", reason: "AMBIGUOUS_CASE",
    });
    expect(reader.select("animation pivot")).toMatchObject({
      state: "REVIEW_REQUIRED", reason: "NO_CASE_MATCH",
    });
    expect(reader.read("UV-P99")).toMatchObject({
      state: "REVIEW_REQUIRED", reason: "CASE_UNKNOWN",
    });
    expect(reader.select("")).toMatchObject({
      state: "REVIEW_REQUIRED", reason: "QUERY_INVALID",
    });
  });

  test("stale source and stale section pins refuse; another case does not inherit a changed section", async () => {
    const original = await readCasebook();
    const reader = createTextureUvCaseReader(original);
    const before = reader.read("UV-P01");
    const other = reader.read("TEX-P01");
    if (before.state !== "SOURCE_CANDIDATE" || other.state !== "SOURCE_CANDIDATE") {
      throw new Error("K3 decision case source unavailable");
    }
    const changed = original.replace(
      "mirrored mark alignment",
      "mirrored mark alignment with changed source"
    );
    expect(changed).not.toBe(original);
    const updated = createTextureUvCaseReader(changed);
    expect(updated.read("UV-P01", {
      expected_source_sha256: before.source_sha256,
    })).toMatchObject({ state: "REVIEW_REQUIRED", reason: "SOURCE_STALE" });
    expect(updated.read("UV-P01", {
      expected_section_sha256: before.section_sha256,
    })).toMatchObject({ state: "REVIEW_REQUIRED", reason: "SECTION_STALE" });
    expect(updated.read("TEX-P01", {
      expected_section_sha256: other.section_sha256,
    }).state).toBe("SOURCE_CANDIDATE");
    expect(reader.read("UV-P01", {
      expected_source_sha256: "not-a-sha",
    })).toMatchObject({ state: "REVIEW_REQUIRED", reason: "SOURCE_REVISION_INVALID" });
  });

  test("malformed or oversized Markdown fails closed instead of serving invented knowledge", async () => {
    const original = await readCasebook();
    expect(() => createTextureUvCaseReader("")).toThrow("SOURCE_INVALID");
    expect(() => createTextureUvCaseReader("x".repeat(40_000))).toThrow("SOURCE_INVALID");
    expect(() => createTextureUvCaseReader(
      original.replace("## TEX-P03 Emissive Eyes Material PBR Render",
        "## OMITTED Emissive Eyes Material PBR Render")
    )).toThrow("CASE_INVENTORY_INCOMPLETE");
    expect(() => createTextureUvCaseReader(
      original.replace("- **Required evidence:**", "- **No evidence:**")
    )).toThrow("CASE_CONTENT_INVALID");
  });

  test("the existing Resource serves only the selected case and preserves old fast paths", async () => {
    const resource = getAllResourceDefinitions()["texture-authoring-knowledge"];
    expect(resource).toBeDefined();
    const list = await resource.listCallback!();
    const uris = list.resources.map(entry => entry.uri);
    for (const oldTopic of [
      "surface-patterns", "vanilla-principles", "render-profiles", "treatment-plan",
    ]) expect(uris).toContain("texture-authoring://" + oldTopic);
    for (const [topic, id] of [
      ["case-uv-p01", "UV-P01"],
      ["case-tex-p01", "TEX-P01"],
      ["case-tex-p02", "TEX-P02"],
      ["case-tex-p03", "TEX-P03"],
    ] as const) {
      const uri = new URL("texture-authoring://" + topic);
      const result = await resource.readCallback(uri, { topic });
      const payload = JSON.parse((result.contents[0] as { text: string }).text);
      expect(payload.case_id).toBe(id);
      expect(payload.state).toBe("SOURCE_CANDIDATE");
      expect(payload.decision_readiness).toBe("REVIEW_REQUIRED");
      expect(payload.mutation_authorized).toBe(false);
      expect(payload.guidance_text).toContain("**Decision:**");
      expect(payload.guidance_text).not.toContain("## Source Identity And Rights");
      expect(payload.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const vanilla = await resource.readCallback(
      new URL("texture-authoring://vanilla-principles"),
      { topic: "vanilla-principles" }
    );
    expect(JSON.parse((vanilla.contents[0] as {text:string}).text).domain)
      .toBe("vanilla_texture_knowledge");
    await expect(resource.readCallback(
      new URL("texture-authoring://case-untrusted"), {topic:"case-untrusted"}
    )).rejects.toThrow("Unknown texture-authoring topic");
  });

  test("embedded casebook edits require a Runtime rebuild, not prompt regeneration", () => {
    const file = "../docs/03-authoring/texture/decision-cases.md";
    expect(RUNTIME_WATCH_TARGETS).toContainEqual({
      path: file, recursive: false,
    });
    expect(classifyWatchPath(file)).toBe("rebuild");
    expect(classifyWatchPath("../docs/03-authoring/texture/knowledge-coverage.md"))
      .toBe("ignore");
  });
});


// K5/K6: the normal list_textures diagnostic may surface only bounded,
// reference-unverified decision hints. Existing ordinary reads remain fast.
describe("K5/K6 diagnostic knowledge hints", () => {
  test("empty technical evidence keeps the no-knowledge fast path", () => {
    let reads = 0;
    const none = suggestTextureUvTechnicalKnowledge({}, () => {
      reads += 1;
      throw new Error("The knowledge reader must not be invoked");
    });
    expect(none).toEqual([]);
    expect(reads).toBe(0);
    const invalid = suggestTextureUvTechnicalKnowledge({
      exact_reuse_region_count: Number.NaN,
      partial_overlap_pair_count: -2,
      solid_color_face_count: 7,
      scanned_face_count: 0,
    }, () => {
      reads += 1;
      throw new Error("No confirmed native scope");
    });
    expect(invalid).toEqual([]);
    expect(reads).toBe(0);
  });

  test("actual shared UV evidence picks UV-P01, but never approves reuse", async () => {
    const reader = createTextureUvCaseReader(await Bun.file(
      "../docs/03-authoring/texture/decision-cases.md"
    ).text());
    const items = suggestTextureUvTechnicalKnowledge({
      exact_reuse_region_count: 2,
      partial_overlap_pair_count: 1,
    }, id => reader.read(id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: "REVIEW_REQUIRED", source_state: "SOURCE_CANDIDATE",
      case_id: "UV-P01", trigger: "UV_PIXEL_OWNERSHIP_REVIEW",
      observed: { exact_reuse_region_count: 2, partial_overlap_pair_count: 1 },
      reference_scope: "CURRENT_USER_REFERENCE_NOT_ATTESTED",
      mutation_authorized: false, visual_verdict: "not_evaluated",
    });
    expect(items[0]!.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0]!.required_evidence).toContain("Cube UUID");
  });

  test("flat face evidence picks TEX-P01 only after sampled face coverage", async () => {
    const reader = createTextureUvCaseReader(await Bun.file(
      "../docs/03-authoring/texture/decision-cases.md"
    ).text());
    const two = suggestTextureUvTechnicalKnowledge({
      exact_reuse_region_count: 1,
      solid_color_face_count: 3,
      scanned_face_count: 8,
    }, id => reader.read(id));
    expect(two.map(x => x.case_id)).toEqual(["UV-P01", "TEX-P01"]);
    expect(two[1]).toMatchObject({
      state: "REVIEW_REQUIRED",
      trigger: "FLAT_TEXTURE_REFERENCE_REVIEW",
      observed: { solid_color_face_count: 3, scanned_face_count: 8 },
      mutation_authorized: false,
    });
    expect(two.some(x => x.case_id === "TEX-P02" || x.case_id === "TEX-P03"))
      .toBe(false);
  });

  test("a stale or unverified case cannot become a diagnostic hint", () => {
    const noSource = suggestTextureUvTechnicalKnowledge({
      exact_reuse_region_count: 1,
      solid_color_face_count: 2,
      scanned_face_count: 4,
    }, () => ({
      state: "REVIEW_REQUIRED" as const,
      reason: "SOURCE_STALE" as const,
      mutation_authorized: false as const,
      visual_verdict: "not_evaluated" as const,
    }));
    expect(noSource).toEqual([]);
    const invalid = suggestTextureUvTechnicalKnowledge({
      exact_reuse_region_count: Number.POSITIVE_INFINITY,
      partial_overlap_pair_count: -1,
      solid_color_face_count: 5,
      scanned_face_count: Number.NaN,
    }, () => { throw new Error("An unusable diagnostic must not load knowledge"); });
    expect(invalid).toEqual([]);
  });

  test("the established Runtime diagnostic caller is opt-in, bounded, and read-only", async () => {
    const runtime = await Bun.file(
      "server/runtime/extensions/texture/authoring.ts"
    ).text();
    const scope = runtime.slice(
      runtime.indexOf("function wireTextureReads(): void {"),
      runtime.indexOf("const listMaterials = runtimeDefinition(", runtime.indexOf("function wireTextureReads(): void {"))
    );
    expect(scope).toContain('if (args.diagnostics !== true) return result;');
    expect(scope).toContain("structured.uv_audit");
    expect(scope).toContain("structured.optimization_opportunities");
    expect(scope).toContain('scope === "uv" || scope === "full"');
    expect(scope).toContain('scope === "coverage" || scope === "full"');
    expect(scope).toContain("suggestTextureUvTechnicalKnowledge(");
    expect(scope).toContain("knowledge_guidance");
    expect(scope).toContain("TEXTURE_UV_KNOWLEDGE_SOURCE_UNAVAILABLE");
    expect(scope).not.toContain("Undo.initEdit(");
    expect(scope).not.toContain("paint_texture_transaction");
  });
});
