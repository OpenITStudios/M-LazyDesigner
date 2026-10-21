import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

/** Records evidence only into the existing managed Gateway PID lease. */
export type ManagedGatewayCatalogEvidence = {
  catalog_ready: boolean;
  runtime_build_identity: string | null;
};

export function publishManagedGatewayLeaseEvidence(
  evidence: ManagedGatewayCatalogEvidence,
  leasePath: string | undefined = process.env.LAZYDESIGNER_GATEWAY_LEASE_PATH,
  now: number = Date.now()
): boolean {
  if (!leasePath || basename(leasePath) !== `${process.pid}.json`
      || !Number.isSafeInteger(now) || now <= 0) return false;
  try {
    const bytes = readFileSync(leasePath);
    if (bytes.length === 0 || bytes.length > 2048) return false;
    const lease: unknown = JSON.parse(bytes.toString("utf8"));
    if (!lease || typeof lease !== "object" || Array.isArray(lease)) return false;
    const current = lease as Record<string, unknown>;
    if (current.producer_pid !== process.pid
        || typeof current.source_sha !== "string"
        || !/^[a-f0-9]{40}$/.test(current.source_sha)) return false;
    const ready = evidence.catalog_ready === true
      && typeof evidence.runtime_build_identity === "string"
      && /^sha256:[a-f0-9]{64}$/.test(evidence.runtime_build_identity);
    writeFileSync(leasePath, JSON.stringify({
      source_sha: current.source_sha,
      producer_pid: process.pid,
      observed_at_unix_ms: now,
      catalog_ready: ready,
      runtime_build_identity: ready ? evidence.runtime_build_identity : null,
    }), "utf8");
    return true;
  } catch {
    // Advisory evidence cannot change the result of a real MCP request.
    return false;
  }
}
