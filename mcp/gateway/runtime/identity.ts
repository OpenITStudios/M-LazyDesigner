export { DEFAULT_RUNTIME_URL, normalizeRuntimeUrl } from "../../lib/runtime/connection";

import { PRODUCT_ID } from "../../lib/product/productIdentity";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

/** A manager-launched Gateway must never attach to a healthy but foreign
 * plugin. Unmanaged developer fixtures do not possess an installed build
 * identity and retain the existing isolated test behavior. */
export function verifyRuntimeBuildIdentity(
  health: unknown,
  expectedBuildIdentity: string | null
): string | null {
  if (expectedBuildIdentity === null) return null;
  const root = isRecord(health) ? health : {};
  const product = isRecord(root.product) ? root.product : {};
  if (product.id !== PRODUCT_ID) {
    return "Runtime product identity does not match this LazyDesigner installation.";
  }
  if (root.build_identity !== expectedBuildIdentity) {
    return "Runtime build identity does not match the installed LazyDesigner package.";
  }
  return null;
}

export function createRuntimeSignature(health: unknown): string {
  const root = isRecord(health) ? health : {};
  const product = isRecord(root.product) ? root.product : {};

  return JSON.stringify({
    build_identity: stringValue(root.build_identity),
    instance_id: stringValue(root.instance_id),
    startup_time: stringValue(root.startup_time),
    product_id: stringValue(product.id),
    product_version: stringValue(product.version),
    profile: stringValue(product.profile),
    authoring_phase: stringValue(product.authoring_phase),
    exposed_tool_count: numberValue(root.exposed_tool_count),
  });
}

/**
 * Only an in-band, backend-validated Stage receipt may authorize this
 * classification. A fresh MCP transport/catalog is still mandatory, but
 * its new connection is not a new Runtime generation when its /health
 * process identity is unchanged. Opaque/incomplete signatures fail closed.
 */
export function sameRuntimeGenerationAfterPlannedHandoff(
  previousSignature: string | null,
  nextSignature: string
): boolean {
  if (!previousSignature) return false;
  let previous: unknown;
  let next: unknown;
  try {
    previous = JSON.parse(previousSignature);
    next = JSON.parse(nextSignature);
  } catch {
    return false;
  }
  if (!isRecord(previous) || !isRecord(next)) return false;
  const hasInstance =
    (typeof previous.instance_id === "string" && previous.instance_id.trim().length > 0) ||
    (typeof previous.startup_time === "string" && previous.startup_time.trim().length > 0);
  if (!hasInstance) return false;
  const validPhase = (value: unknown) =>
    value === "geometry" || value === "texturing" || value === "animation";
  if (!validPhase(previous.authoring_phase) || !validPhase(next.authoring_phase)) return false;
  for (const count of [previous.exposed_tool_count, next.exposed_tool_count]) {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return false;
  }
  const stableFields = (value: JsonRecord) =>
    Object.entries(value)
      .filter(([key]) => key !== "authoring_phase" && key !== "exposed_tool_count")
      .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(stableFields(previous)) === JSON.stringify(stableFields(next));
}
