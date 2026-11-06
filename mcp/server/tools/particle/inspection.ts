/// <reference types="blockbench-types" />

import {
  inspectParticleDocument,
  parseParticleDocument,
  serializeParticleDocument,
  type JsonValue,
} from "@/lib/particle/document";
import { requireParticleFilesystem } from "./fileTransaction";

export type GeneratedParticleTextureReadiness =
  | { source: "existing" | "vanilla"; status: "SATISFIED" }
  | { source: "generated"; status: "SATISFIED" | "REQUIRES_TEXTURING"; output_path: string };

export function assertGeneratedTextureReady(
  plan: GeneratedParticleTextureReadiness | null
): void {
  if (!plan || plan.source !== "generated" || plan.status !== "SATISFIED") {
    return;
  }

  const fs = requireParticleFilesystem(
    `BlockIT requested read access to verify generated particle texture ${plan.output_path}`
  );

  if (!fs.existsSync(plan.output_path)) {
    throw new Error(
      `Generated particle texture is marked ready but the PNG does not exist: ${plan.output_path}. Return to Texturing; do not write or bind the particle yet.`
    );
  }

  const stat = fs.statSync(plan.output_path);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(
      `Generated particle texture is marked ready but is not a non-empty PNG file: ${plan.output_path}. Return to Texturing before resuming manage_particle.`
    );
  }
}

export function readParticleSource(
  source: { content?: string; path?: string }
): {
  document: ReturnType<typeof parseParticleDocument>;
  source_path: string | null;
  source_content: string | null;
} {
  if (source.content !== undefined) {
    return {
      document: parseParticleDocument(source.content),
      source_path: null,
      source_content: null,
    };
  }

  const path = source.path!;
  const fs = requireParticleFilesystem(
    `BlockIT requested read access to inspect Bedrock particle ${path}`
  );

  if (!fs.existsSync(path)) {
    throw new Error(`Particle source file does not exist: ${path}`);
  }

  const content = fs.readFileSync(path, "utf8");
  return {
    document: parseParticleDocument(content),
    source_path: path,
    source_content: content,
  };
}

function sliceWithoutSplittingSurrogatePair(
  value: string,
  maxChars: number
): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return maxChars <= 0 ? "" : value;
  }

  let end = maxChars;
  const lastCodeUnit = value.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

export function boundedContent(
  serialized: string,
  maxContentLength: number
): { truncated: boolean; content: string | null } {
  const truncated =
    maxContentLength > 0 && serialized.length > maxContentLength;

  return {
    truncated,
    content:
      maxContentLength === 0
        ? null
        : truncated
          ? sliceWithoutSplittingSurrogatePair(
              serialized,
              maxContentLength
            )
          : serialized,
  };
}

export function compactParticleInspectResult(
  document: ReturnType<typeof parseParticleDocument>,
  mode: "summary" | "components" | "full",
  maxContentLength: number
) {
  const summary = inspectParticleDocument(document);

  if (mode === "summary") return { summary };

  if (mode === "components") {
    const effect = document.particle_effect as Record<string, JsonValue>;
    return {
      summary,
      components:
        effect &&
        typeof effect === "object" &&
        !Array.isArray(effect)
          ? ((effect.components as
              | Record<string, JsonValue>
              | undefined) ?? {})
          : {},
    };
  }

  const serialized = serializeParticleDocument(document);
  return {
    summary,
    ...boundedContent(serialized, maxContentLength),
  };
}

export function assertNativeParticlePreviewAvailable(): void {
  if (
    typeof Animator === "undefined" ||
    typeof Animator.loadParticleEmitter !== "function"
  ) {
    throw new Error(
      "Blockbench native particle preview is unavailable in this runtime."
    );
  }
}

export function loadNativeParticlePreview(
  path: string,
  content: string
): void {
  assertNativeParticlePreviewAvailable();
  const loaded = Animator.loadParticleEmitter(path, content) as unknown as {
    config?: {
      preview_texture?: string;
      updateTexture?: () => void;
    };
  } | undefined;
  if (!loaded?.config) {
    throw new Error("Blockbench rejected the particle document; the native preview was not loaded.");
  }
  // A reloaded effect can retain the previous preview_texture path even after
  // a PNG edit. Re-resolve it through Blockbench's own Wintersky scene loader.
  if ("preview_texture" in loaded.config) delete loaded.config.preview_texture;
  loaded.config.updateTexture?.();
}
