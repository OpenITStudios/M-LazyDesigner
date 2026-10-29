export type BedrockGeometryOverwriteAnalysis = {
  identifiers: string[];
  target_occurrences: number;
  has_unknown_identifier: boolean;
  safe_single_model_replace: boolean;
  requires_native_merge: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function bedrockGeometryIdentifiers(document: unknown): string[] {
  const root = asRecord(document);
  const geometries = root?.["minecraft:geometry"];
  if (!Array.isArray(geometries)) return [];

  const identifiers: string[] = [];
  for (const geometry of geometries) {
    const description = asRecord(asRecord(geometry)?.description);
    const identifier = description?.identifier;
    if (typeof identifier === "string" && identifier.length > 0) {
      identifiers.push(identifier);
    }
  }
  return identifiers;
}

export function bedrockAnimationIdentifiers(document: unknown): string[] {
  const root = asRecord(document);
  const animations = asRecord(root?.animations);
  return animations ? Object.keys(animations) : [];
}

/**
 * Verify identity coverage of the native Bedrock AnimationCodec result.
 * This is a content-only preflight, NOT proof of keyframe fidelity, playback,
 * Minecraft validity, a saved file, or user/visual approval.
 *
 * Consume the exact native clip snapshot passed to compileFile; never infer
 * a missing clip from a successful codec call or from content byte length.
 */
export function assertBedrockAnimationExportMatchesSource(
  authoredClips: readonly unknown[],
  compiled: unknown
) {
  if (authoredClips.length === 0) {
    throw new Error("BEDROCK_ANIMATION_EXPORT_NO_CLIPS: no authored clips were supplied.");
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const clip of authoredClips) {
    const name = asRecord(clip)?.name;
    if (typeof name !== "string" || !name.trim() ||
        name !== name.trim() || seen.has(name)) {
      throw new Error("BEDROCK_ANIMATION_EXPORT_SOURCE_IDENTITY_INVALID: clip names must be unique, nonempty and exact.");
    }
    names.push(name);
    seen.add(name);
  }
  let document: unknown = compiled;
  if (typeof document === "string") {
    try {
      document = JSON.parse(document);
    } catch {
      throw new Error("BEDROCK_ANIMATION_EXPORT_CONTENT_INVALID: native compiler did not return valid JSON.");
    }
  }
  const animations = asRecord(asRecord(document)?.animations);
  if (!animations) {
    throw new Error("BEDROCK_ANIMATION_EXPORT_CONTENT_INVALID: native output has no animations object.");
  }
  const outputNames = bedrockAnimationIdentifiers(document);
  const missing = missingRequestedDeliverables(names, outputNames);
  const unexpected = missingRequestedDeliverables(outputNames, names);
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `BEDROCK_ANIMATION_EXPORT_IDENTITY_MISMATCH: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}.`
    );
  }
  if (outputNames.some((name) => !asRecord(animations[name]))) {
    throw new Error("BEDROCK_ANIMATION_EXPORT_CONTENT_INVALID: an exported clip has no object payload.");
  }

  return {
    state: "SOURCE_CLIP_IDENTITIES_MATCHED" as const,
    source_clip_count: names.length,
    compiled_clip_count: outputNames.length,
    clip_name_examples: outputNames.slice(0, 8),
    clip_name_examples_truncated: outputNames.length > 8,
    visual_verdict: "not_evaluated" as const,
    native_playback_attested: false as const,
    saved_file_attested: false as const,
  };
}

/**
 * Verify compiled Bedrock geometry identity before a content response or
 * native file write. Valid source identifiers are structural evidence only;
 * they do not establish UV, Texture, rig, visual or runtime correctness.
 *
 * Reuse the existing geometry identifier vocabulary and keep this check
 * inside the export owner. No additional validation tool is registered.
 */
export function assertCompiledBedrockGeometryIdentity(compiled: unknown) {
  let document: unknown = compiled;
  if (typeof document === "string") {
    try {
      document = JSON.parse(document);
    } catch {
      throw new Error("BEDROCK_GEOMETRY_EXPORT_CONTENT_INVALID: native compile did not return valid JSON.");
    }
  }
  const geometries = asRecord(document)?.["minecraft:geometry"];
  if (!Array.isArray(geometries) || geometries.length === 0) {
    throw new Error("BEDROCK_GEOMETRY_EXPORT_EMPTY: native output contains no minecraft:geometry entries.");
  }
  const identifiers: string[] = [];
  const seen = new Set<string>();
  for (const geometry of geometries) {
    const name = asRecord(asRecord(geometry)?.description)?.identifier;
    if (typeof name !== "string" || !name.trim() || name !== name.trim() ||
        name === "geometry.unknown" || name.endsWith(".unknown")) {
      throw new Error("BEDROCK_GEOMETRY_EXPORT_IDENTITY_INVALID: every geometry needs a non-unknown exact identifier.");
    }
    if (seen.has(name)) {
      throw new Error("BEDROCK_GEOMETRY_EXPORT_IDENTITY_DUPLICATE: duplicate geometry identifiers cannot be an accepted export.");
    }
    seen.add(name);
    identifiers.push(name);
  }
  return {
    state: "COMPILED_GEOMETRY_IDENTITIES_VALIDATED" as const,
    geometry_count: identifiers.length,
    identifier_examples: identifiers.slice(0, 8),
    identifier_examples_truncated: identifiers.length > 8,
    visual_verdict: "not_evaluated" as const,
    saved_file_attested: false as const,
    uv_texture_attested: false as const,
  };
}

export function analyzeBedrockGeometryOverwrite(
  document: unknown,
  expectedIdentifier: string
): BedrockGeometryOverwriteAnalysis {
  if (!expectedIdentifier.trim()) {
    throw new Error("Bedrock geometry overwrite analysis requires an expected identifier.");
  }

  const identifiers = bedrockGeometryIdentifiers(document);
  const targetOccurrences = identifiers.filter(
    (identifier) => identifier === expectedIdentifier
  ).length;
  const hasUnknownIdentifier = identifiers.some(
    (identifier) => identifier === "geometry.unknown" || identifier.endsWith(".unknown")
  );

  return {
    identifiers,
    target_occurrences: targetOccurrences,
    has_unknown_identifier: hasUnknownIdentifier,
    safe_single_model_replace:
      identifiers.length === 1 &&
      targetOccurrences === 1 &&
      !hasUnknownIdentifier,
    requires_native_merge: identifiers.length > 1,
  };
}

export function planBedrockGeometryWrite(input: {
  destination_exists: boolean;
  overwrite_requested: boolean;
  existing_document?: unknown;
  expected_identifier: string;
}) {
  if (!input.expected_identifier.trim()) {
    throw new Error("Bedrock geometry write plan requires an expected identifier.");
  }

  if (!input.destination_exists) {
    return {
      action: "CREATE_NEW" as const,
      expected_identifier: input.expected_identifier,
    };
  }

  if (!input.overwrite_requested) {
    return {
      action: "OVERWRITE_CONSENT_REQUIRED" as const,
      expected_identifier: input.expected_identifier,
    };
  }

  if (input.existing_document === undefined) {
    throw new Error(
      "Existing Bedrock geometry content is required before planning an owned overwrite."
    );
  }

  const analysis = analyzeBedrockGeometryOverwrite(
    input.existing_document,
    input.expected_identifier
  );
  if (analysis.safe_single_model_replace) {
    return {
      action: "REPLACE_SINGLE" as const,
      expected_identifier: input.expected_identifier,
      analysis,
    };
  }
  if (analysis.requires_native_merge) {
    return {
      action: "NATIVE_MERGE_REQUIRED" as const,
      expected_identifier: input.expected_identifier,
      analysis,
    };
  }

  return {
    action: "IDENTIFIER_REPAIR_REQUIRED" as const,
    expected_identifier: input.expected_identifier,
    analysis,
  };
}

export function requireExpectedGeometryIdentifier(
  document: unknown,
  expectedIdentifier: string
): void {
  const analysis = analyzeBedrockGeometryOverwrite(document, expectedIdentifier);
  if (analysis.target_occurrences !== 1) {
    throw new Error(
      `Expected exactly one Bedrock geometry identifier "${expectedIdentifier}", found ${analysis.target_occurrences}. Available identifiers: ${analysis.identifiers.join(", ") || "none"}.`
    );
  }
  if (analysis.has_unknown_identifier) {
    throw new Error(
      "Bedrock geometry output still contains an unknown identifier; repair native project metadata before claiming finalization integrity."
    );
  }
}

export function missingRequestedDeliverables(
  requested: readonly string[],
  actual: readonly string[]
): string[] {
  const actualSet = new Set(actual);
  return [...new Set(requested)].filter((name) => !actualSet.has(name));
}
