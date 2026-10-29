import casebook from "../../../docs/03-authoring/texture/decision-cases.md" with { type: "text" };
import { createTextureUvCaseReader, type TextureUvCaseId } from "@/lib/texture/knowledgeCases";
import { createResource, type ResourceSpec } from "@/lib/factories";
import {
  TEXTURE_SURFACE_PATTERN_NAMES,
  TEXTURE_SURFACE_PATTERN_RECIPES,
} from "@/lib/texture/surfacePattern";
import { VANILLA_TEXTURE_KNOWLEDGE } from "@/lib/texture/vanillaKnowledge";
import {
  VANILLA_ENTITY_RENDER_MATERIAL_CODES,
  inspectEntityRenderMaterialCode,
} from "@/lib/texture/renderProfile";

const TOPICS = [
  "surface-patterns",
  "vanilla-principles",
  "render-profiles",
  "treatment-plan",
  "case-uv-p01",
  "case-tex-p01",
  "case-tex-p02",
  "case-tex-p03",
] as const;

type TextureKnowledgeTopic = (typeof TOPICS)[number];

const CASE_TOPICS = {
  "case-uv-p01": "UV-P01",
  "case-tex-p01": "TEX-P01",
  "case-tex-p02": "TEX-P02",
  "case-tex-p03": "TEX-P03",
} as const satisfies Record<string, TextureUvCaseId>;

function isCaseTopic(value: TextureKnowledgeTopic): value is keyof typeof CASE_TOPICS {
  return Object.prototype.hasOwnProperty.call(CASE_TOPICS, value);
}

export const textureAuthoringKnowledgeResourceDocs: ResourceSpec = {
  name: "texture-authoring-knowledge",
  uriTemplate: "texture-authoring://{topic}",
  title: "Texture Authoring Knowledge",
  description:
    "On-demand LazyDesigner texture knowledge: established surface/render principles, treatment planning, and four pinned, source-grounded K3 review cases. Case reads never attest current reference/target compatibility or authorize UV/paint mutations.",
};

function isTopic(value: string | undefined): value is TextureKnowledgeTopic {
  return TOPICS.includes(value as TextureKnowledgeTopic);
}

function topicPayload(topic: TextureKnowledgeTopic) {
  // Embedded canonical Markdown is indexed ONLY for an explicitly selected
  // K3 case resource, never at plugin startup or on ordinary texture reads.
  if (isCaseTopic(topic)) {
    const candidate = createTextureUvCaseReader(casebook).read(CASE_TOPICS[topic]);
    if (candidate.state !== "SOURCE_CANDIDATE") {
      throw new Error("TEXTURE_KNOWLEDGE_CASE_SOURCE_UNAVAILABLE");
    }
    return candidate; // Still REVIEW_REQUIRED for any current user asset.
  }
  if (topic === "surface-patterns") {
    return {
      domain: "surface_pattern",
      purpose:
        "Reference-grounded pixel-language recipes. They never select transparency, glow, PBR, or other runtime behavior.",
      patterns: TEXTURE_SURFACE_PATTERN_NAMES.map((name) =>
        TEXTURE_SURFACE_PATTERN_RECIPES[name]
      ),
    };
  }
  if (topic === "vanilla-principles") {
    return VANILLA_TEXTURE_KNOWLEDGE;
  }
  if (topic === "render-profiles") {
    return {
      domain: "minecraft_entity_render_material",
      purpose:
        "Known Vanilla entity material contracts. Custom codes remain unverified and must not inherit semantics by name.",
      profiles: VANILLA_ENTITY_RENDER_MATERIAL_CODES.map((code) =>
        inspectEntityRenderMaterialCode(code)
      ),
    };
  }
  return {
    domain: "texture_treatment_plan",
    purpose:
      "Compact reasoning contract before broad painting; use approved reference evidence and leave unknowns unresolved.",
    region_fields: [
      "region",
      "evidence: observed | inferred | unknown",
      "surface_pattern",
      "render_profile or minecraft_material_code",
      "optional pbr_intent",
      "identity_colors / notes",
    ],
    passes: [
      "BASE PASS",
      "VALUE / FORM PASS",
      "SURFACE PATTERN PASS",
      "IDENTITY PASS",
      "SECONDARY DETAIL PASS",
      "RENDER / ALPHA VERIFY",
      "MAPPED MODEL VERIFY",
    ],
    invariants: [
      "surface_pattern never selects render_profile",
      "render_profile never selects surface_pattern",
      "PBR is optional and explicit",
      "unknown reference evidence remains review_required",
      "no similarity or quality score",
    ],
  };
}

createResource(textureAuthoringKnowledgeResourceDocs.name, {
  uriTemplate: textureAuthoringKnowledgeResourceDocs.uriTemplate,
  title: textureAuthoringKnowledgeResourceDocs.title,
  description: textureAuthoringKnowledgeResourceDocs.description,
  async listCallback() {
    return {
      resources: TOPICS.map((topic) => ({
        uri: `texture-authoring://${topic}`,
        name: topic,
        description: `Read ${topic} only when that texture-authoring knowledge is needed.`,
        mimeType: "application/json",
      })),
    };
  },
  async readCallback(uri, { topic }) {
    const value = typeof topic === "string" ? topic : undefined;
    if (!isTopic(value)) {
      throw new Error(
        `Unknown texture-authoring topic "${String(value)}". Available: ${TOPICS.join(", ")}.`
      );
    }
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(topicPayload(value), null, 2),
          mimeType: "application/json",
        },
      ],
    };
  },
});