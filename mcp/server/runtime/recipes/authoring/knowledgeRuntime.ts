import geometryCasebook from "../../../../../docs/03-authoring/modelling/decision-cases.md" with { type: "text" };
import { getManifest } from "@/lib/prompts/loader";
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  type KnowledgeIndexSnapshot,
} from "@/lib/semantic/knowledge";
import type { RecipeKnowledgeSnapshot } from "@/lib/authoringRecipe/knowledge";

const WORKFLOW_PATH = "prompts/bedrock_entity_workflow.md";
const GEOMETRY_CASE_PATH = "docs/03-authoring/modelling/decision-cases.md";
const MAX_WORKFLOW_BYTES = 64_000;
const MAX_CASE_BYTES = 24_000;
const EXPECTED_CASES = [
  "G-P01", "G-P02", "G-P03", "G-P04",
  "G-P05", "G-P06", "G-P07", "G-P08",
] as const;

/** The existing canonical generator continues to own the prompt manifest. */
export function buildRecipeKnowledgeIndexFromWorkflow(
  markdown: string | null | undefined
): KnowledgeIndexSnapshot | null {
  if (!markdown?.trim() ||
      new TextEncoder().encode(markdown).byteLength > MAX_WORKFLOW_BYTES) {
    return null;
  }
  return {
    sections: indexMarkdownKnowledge(WORKFLOW_PATH, markdown),
    sources: [describeKnowledgeSource(WORKFLOW_PATH, markdown)],
  };
}

/** Eight sections from a canonical Markdown source, not a second registry. */
export function buildRecipeGeometryCaseIndex(
  markdown: string | null | undefined
): RecipeKnowledgeSnapshot | null {
  if (!markdown?.trim() ||
      new TextEncoder().encode(markdown).byteLength > MAX_CASE_BYTES) {
    return null;
  }
  const cases = indexMarkdownKnowledge(GEOMETRY_CASE_PATH, markdown)
    .filter(section => /^G-P0[1-8] /.test(section.heading));
  if (cases.length !== EXPECTED_CASES.length ||
      !EXPECTED_CASES.every((id, index) =>
        cases[index]?.heading.startsWith(id + " "))) {
    return null; // Missing/modified pilot is not silently accepted as complete.
  }
  return {
    sections: cases,
    sources: [describeKnowledgeSource(GEOMETRY_CASE_PATH, markdown)],
    source_contents: { [GEOMETRY_CASE_PATH]: markdown },
  };
}

/**
 * Only called during Recipe planning or explicit opt-in Recipe inspection.
 * Bun embeds original Markdown at build-time; no runtime fs/network reads,
 * duplicated case registry, hand-edited manifest, or extra Gateway tool.
 */
export function readBundledRecipeKnowledgeIndex(): RecipeKnowledgeSnapshot | null {
  const workflow = buildRecipeKnowledgeIndexFromWorkflow(
    getManifest().prompts["bedrock_entity_workflow"]
  );
  const geometry = buildRecipeGeometryCaseIndex(geometryCasebook);
  if (!workflow || !geometry) return null;
  return {
    sections: [...workflow.sections, ...geometry.sections],
    sources: [...workflow.sources!, ...geometry.sources!],
    source_contents: geometry.source_contents,
  };
}
