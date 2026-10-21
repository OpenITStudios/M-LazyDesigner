import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

// Documentation policy guards, not measurements of calls, speed or accepted asset quality.
const policyOwners = [
  {
    owner: "modelling",
    paths: [
      ".agents/skills/lazydesigner-modelling/SKILL.md",
      ".agents/skills/lazydesigner-modelling/references/verification.md",
      ".agents/skills/lazydesigner-modelling/references/correction.md"
    ],
    phrases: [
      "minimum necessary evidence",
      "local correction / convergence",
      "do not inspect each newly created cube",
      "same causal direction failing twice without new evidence → blocked"
    ],
    uniqueContinuation: true
  },
  {
    owner: "texturing",
    paths: [
      ".agents/skills/lazydesigner-texturing/SKILL.md",
      ".agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md"
    ],
    phrases: [
      "direct routing",
      "no evidence-per-micro-mutation loop",
      "search_capabilities(limit=4)",
      "same texture-owned causal direction twice without new evidence → blocked"
    ],
    uniqueContinuation: false
  },
  {
    owner: "animation",
    paths: [
      ".agents/skills/lazydesigner-animation/SKILL.md",
      ".agents/skills/lazydesigner-animation/references/fidelity-correction-evidence.md"
    ],
    phrases: [
      "direct routing",
      "do not call inspect_animation after every successful deterministic mutation",
      "known → gateway; unknown/stale → search_capabilities"
    ],
    uniqueContinuation: false
  },
  {
    owner: "evaluation",
    paths: [
      "mcp/docs/TOOL_CALL_EFFICIENCY.md"
    ],
    phrases: [
      "there is no universal fixed tool-call count",
      "cost to accepted result",
      "not progress rituals",
      "known target uuid/state -> mutate directly",
      "diagnostics=true only when decision-changing review is needed",
      "inspect_animation is for unknown/stale clip state, not mandatory before every edit",
      "fewer calls are an improvement only when acceptance quality is equivalent or better",
      "same diagnosed cause twice",
      "blocked unless new decision-changing evidence exists"
    ],
    uniqueContinuation: false
  },
  {
    owner: "workflow prompt",
    paths: [
      "mcp/prompts/bedrock_entity_workflow.md"
    ],
    phrases: [],
    uniqueContinuation: true
  },
];

function normalized(value: string): string {
  return value.replace(/`/g, "").replace(/\s+/g, " ").toLowerCase();
}

describe("authoring efficiency documentation policy", () => {
  test.each(policyOwners)("$owner retains its routing, evidence and convergence rules", async ({ owner, paths, phrases, uniqueContinuation }) => {
    const source = (await Promise.all(paths.map(path =>
      readFile(new URL("../../" + path, import.meta.url), "utf8")
    ))).join("\n");
    const policy = normalized(source);
    for (const phrase of phrases) expect(policy, owner).toContain(phrase);
    if (uniqueContinuation) {
      const heading = "Correction continuation is runtime-owned and incremental";
      expect(source.split(heading).length - 1, owner).toBe(1);
    }
  });
});
