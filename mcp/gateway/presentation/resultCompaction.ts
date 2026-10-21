import type { CapabilityVerificationClass } from "../../lib/capabilities/metadata";
import type { JsonRecord } from "../contracts/protocol";

const CUBE_UV_CONTINUATION_FIELDS = new Set([
  "faces",
  "box_uv",
  "uv_offset",
  "mirror_uv",
  "autouv",
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function changedFieldsFromEffect(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.changed_fields)) return [];
  return value.changed_fields.filter(
    (field): field is string => typeof field === "string"
  );
}

function compactBatchCubeContinuationState(
  value: unknown,
  geometryEffect: unknown
): unknown {
  if (!isRecord(value)) return value;
  const changedFields = new Set(changedFieldsFromEffect(geometryEffect));
  const compact: JsonRecord = {};

  if (typeof value.uuid === "string") compact.uuid = value.uuid;
  if (typeof value.name === "string") compact.name = value.name;

  const copy = (field: string) => {
    if (value[field] !== undefined) compact[field] = value[field];
  };

  if (changedFields.has("name")) copy("name");
  if (changedFields.has("from")) copy("from");
  if (changedFields.has("to")) copy("to");
  if (changedFields.has("from") || changedFields.has("to")) {
    copy("size");
    copy("box_uv_region");
  }
  if (changedFields.has("origin")) copy("origin");
  if (changedFields.has("rotation")) copy("rotation");
  if (changedFields.has("inflate")) copy("inflate");
  if (changedFields.has("box_uv")) {
    copy("box_uv");
    copy("box_uv_region");
  }
  if (changedFields.has("uv_offset")) {
    copy("uv_offset");
    copy("box_uv_region");
  }
  if (changedFields.has("mirror_uv")) copy("mirror_uv");
  if (changedFields.has("autouv")) copy("autouv");
  if (changedFields.has("visibility")) copy("visibility");
  if (changedFields.has("faces")) copy("face_uvs");

  return compact;
}

function compactCubeContinuationState(
  value: unknown,
  geometryEffect: unknown
): unknown {
  if (!isRecord(value)) return value;
  const changedFields = changedFieldsFromEffect(geometryEffect);
  if (
    changedFields.some((field) =>
      CUBE_UV_CONTINUATION_FIELDS.has(field)
    )
  ) {
    return value;
  }

  const { face_uvs: _faceUvs, ...compact } = value;
  return compact;
}

function compactManageCubesStructuredContent(value: unknown): unknown {
  if (!isRecord(value)) return value;

  if (Array.isArray(value.effects)) {
    return {
      ...value,
      effects: value.effects.map((rawEffect) => {
        if (!isRecord(rawEffect)) return rawEffect;
        const {
          before: _before,
          after,
          geometry_effect: geometryEffect,
          ...rest
        } = rawEffect;
        return {
          ...rest,
          ...(after !== undefined
            ? {
                after: compactBatchCubeContinuationState(
                  after,
                  geometryEffect
                ),
              }
            : {}),
          ...(geometryEffect !== undefined
            ? { geometry_effect: geometryEffect }
            : {}),
        };
      }),
    };
  }

  if (value.before !== undefined && value.after !== undefined) {
    const {
      before: _before,
      after,
      geometry_effect: geometryEffect,
      ...rest
    } = value;
    return {
      ...rest,
      after: compactCubeContinuationState(after, geometryEffect),
      ...(geometryEffect !== undefined
        ? { geometry_effect: geometryEffect }
        : {}),
    };
  }

  return value;
}

function singleTextContent(content: unknown): string | null {
  if (
    !Array.isArray(content) ||
    content.length !== 1 ||
    !isRecord(content[0]) ||
    content[0].type !== "text" ||
    typeof content[0].text !== "string"
  ) {
    return null;
  }
  return content[0].text;
}

function textCarriesExternalLocator(text: string): boolean {
  return (
    /\b[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
    /\b[A-Za-z]:[\\/][^\s]+/.test(text) ||
    /(?:^|\s)\/(?:[^\s/]+\/)+[^\s]+/.test(text)
  );
}

function textCarriesDecisionSignal(text: string): boolean {
  return /\b(warn(?:ing)?|error|failed?|blocked|unavailable|missing|stale|conflict|unsafe|unsupported|deprecated|unverified|incomplete|partial|pending|uncertain)\b|\bnot\s+(?:verified|saved|applied|executed|supported|available)\b/i.test(
    text
  );
}

function readOnlyTextIsRedundant(
  structuredContent: unknown,
  content: unknown
): boolean {
  const text = singleTextContent(content)?.trim();
  // Structured data existing is not evidence that arbitrary prose is
  // redundant. Retain unique conclusions and guidance that are not present
  // in machine fields, even when they contain no warning keywords.
  return (
    text === "Read complete." &&
    isRecord(structuredContent) &&
    Object.keys(structuredContent).length > 0
  );
}

function matchesElementInspectionSummary(
  structuredContent: JsonRecord,
  text: string
): boolean {
  if (
    typeof structuredContent.uuid !== "string" ||
    typeof structuredContent.name !== "string" ||
    typeof structuredContent.type !== "string"
  ) return false;
  const identity =
    `Inspected ${structuredContent.type} "${structuredContent.name}" (${structuredContent.uuid})`;
  return text === `${identity}.` ||
    text === `${identity} with UV mapping detail.`;
}

function hasAuthoritativeReceiptState(
  structuredContent: unknown
): boolean {
  if (!isRecord(structuredContent)) return false;
  if (structuredContent.after !== undefined) return true;
  if (structuredContent.state !== undefined) return true;
  if (structuredContent.project !== undefined) return true;
  if (structuredContent.phase !== undefined) return true;
  if (
    Array.isArray(structuredContent.effects) &&
    structuredContent.effects.length > 0 &&
    structuredContent.effects.every(
      (effect) =>
        isRecord(effect) && effect.after !== undefined
    )
  ) {
    return true;
  }
  if (
    structuredContent.execution === "applied" &&
    (
      Array.isArray(structuredContent.changed_fields) ||
      typeof structuredContent.modified === "number" ||
      typeof structuredContent.affected_count === "number"
    )
  ) {
    return true;
  }
  return false;
}

function receiptOnlyTextIsRedundant(
  structuredContent: unknown,
  content: unknown
): boolean {
  const text = singleTextContent(content);
  return (
    text !== null &&
    !textCarriesExternalLocator(text) &&
    !textCarriesDecisionSignal(text) &&
    hasAuthoritativeReceiptState(structuredContent)
  );
}

export function shouldAttachGatewayControlDelta(
  succeeded: boolean,
  readOnly: boolean
): boolean {
  if (!succeeded) return true;
  return !readOnly;
}

export function compactGatewayCapabilityContent(
  capability: string,
  structuredContent: unknown,
  content: unknown,
  verificationClass?: CapabilityVerificationClass,
  readOnly = false
): unknown {
  // Shortcut summaries must not erase warnings, external locators, images
  // or mixed content. Only one plain, non-decision text item is compactable.
  const text = singleTextContent(content);
  if (
    text === null ||
    textCarriesDecisionSignal(text) ||
    textCarriesExternalLocator(text)
  ) return content;

  if (
    readOnly &&
    readOnlyTextIsRedundant(structuredContent, content)
  ) {
    return [{ type: "text", text: "Read complete." }];
  }

  if (
    capability === "inspect_elements" &&
    isRecord(structuredContent) &&
    matchesElementInspectionSummary(structuredContent, text)
  ) {
    return [{ type: "text", text: "Inspection ready." }];
  }

  if (
    capability === "manage_cubes" &&
    isRecord(structuredContent) &&
    structuredContent.execution === "applied" &&
    typeof structuredContent.modified === "number"
  ) {
    return [{
      type: "text",
      text: "Cube mutation applied; use structured receipt.",
    }];
  }

  if (
    verificationClass === "receipt_only" &&
    receiptOnlyTextIsRedundant(structuredContent, content)
  ) {
    return [{ type: "text", text: "Receipt complete." }];
  }

  return content;
}

function compactReceiptOnlyStructuredContent(value: unknown): unknown {
  if (!isRecord(value)) return value;

  if (Array.isArray(value.effects)) {
    let changed = false;
    const effects = value.effects.map((effect) => {
      if (
        !isRecord(effect) ||
        effect.before === undefined ||
        effect.after === undefined
      ) {
        return effect;
      }
      const { before: _before, ...rest } = effect;
      changed = true;
      return rest;
    });
    return changed ? { ...value, effects } : value;
  }

  if (value.before !== undefined && value.after !== undefined) {
    const { before: _before, ...rest } = value;
    return rest;
  }

  return value;
}

export function compactGatewayCapabilityStructuredContent(
  capability: string,
  value: unknown,
  verificationClass?: CapabilityVerificationClass
): unknown {
  if (capability === "manage_cubes") {
    return compactManageCubesStructuredContent(value);
  }
  if (verificationClass === "receipt_only") {
    return compactReceiptOnlyStructuredContent(value);
  }
  return value;
}