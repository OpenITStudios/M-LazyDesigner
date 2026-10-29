import { getManifest } from "@/lib/prompts/loader";
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  type KnowledgeIndexSnapshot,
} from "@/lib/semantic/knowledge";

const SOURCE_PATH = "prompts/bedrock_entity_workflow.md";
const MAX_BUNDLED_BYTES = 64_000;

/** Canonical bundled prompt only, not user overrides, network URLs or unverified files. */
export function buildRecipeKnowledgeIndexFromWorkflow(
  markdown: string | null | undefined
): KnowledgeIndexSnapshot | null {
  if (!markdown?.trim() ||
      new TextEncoder().encode(markdown).byteLength > MAX_BUNDLED_BYTES) {
    return null;
  }
  return {
    sections: indexMarkdownKnowledge(SOURCE_PATH, markdown),
    sources: [describeKnowledgeSource(SOURCE_PATH, markdown)],
  };
}

/** On-demand for Recipe planning or explicit opt-in inspection only. */
export function readBundledRecipeKnowledgeIndex(): KnowledgeIndexSnapshot | null {
  return buildRecipeKnowledgeIndexFromWorkflow(
    getManifest().prompts["bedrock_entity_workflow"]
  );
}
