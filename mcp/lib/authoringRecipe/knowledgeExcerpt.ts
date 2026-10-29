import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  type KnowledgeSection,
} from "@/lib/semantic/knowledge";
import type { RecipeKnowledgeSnapshot } from "@/lib/authoringRecipe/knowledge";

const MAX_SOURCE_BYTES = 32_768;
const MAX_EXCERPT_CHARS = 1_600;

export type RecipeKnowledgeExcerpt = {
  guidance_text: string;
  guidance_truncated: boolean;
  guidance_source_state: "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF";
};

/** Source/section-hash verification before exposing only selected evidence. */
export function createRecipeKnowledgeExcerptReader(
  snapshot: RecipeKnowledgeSnapshot
): (section: KnowledgeSection) => RecipeKnowledgeExcerpt | null {
  const cache = new Map<string, Map<string, {
    section: KnowledgeSection;
    text: string;
  }>>();

  return (section) => {
    const content = snapshot.source_contents?.[section.source];
    if (content === undefined) return null; // Legacy metadata-only retrieval.
    if (typeof content !== "string" ||
        new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES) {
      throw new Error("RECIPE_KNOWLEDGE_SOURCE_CONTENT_INVALID");
    }
    let indexed = cache.get(section.source);
    if (!indexed) {
      const source = snapshot.sources?.find(
        item => item.source === section.source
      );
      if (!source ||
          describeKnowledgeSource(section.source, content).content_sha256 !==
            source.content_sha256) {
        throw new Error("RECIPE_KNOWLEDGE_SOURCE_CONTENT_STALE");
      }
      const lines = content.split(/\r?\n/);
      indexed = new Map(indexMarkdownKnowledge(section.source, content).map(item => [
        item.id, {
          section: item,
          text: lines.slice(item.start_line, item.end_line).join("\n").trimEnd(),
        },
      ]));
      cache.set(section.source, indexed);
    }
    const current = indexed.get(section.id);
    if (!current || current.section.sha256 !== section.sha256 ||
        current.section.start_line !== section.start_line ||
        current.section.end_line !== section.end_line ||
        current.text.length === 0) {
      throw new Error("RECIPE_KNOWLEDGE_SECTION_CONTENT_STALE");
    }
    return {
      guidance_text: current.text.slice(0, MAX_EXCERPT_CHARS),
      guidance_truncated: current.text.length > MAX_EXCERPT_CHARS,
      guidance_source_state: "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF",
    };
  };
}
