import { createHash } from "node:crypto";
import {
  compareAcceptedGoldenSessions,
  validateAcceptedGoldenSessionReport,
  type FinalGoldenSessionReport,
} from "../reporting/compare-golden-sessions";

/** Read-only Harness²-inspired probe, not an agent runner or automatic promoter. */
export type HarnessProbeDomain = "GEOMETRY" | "TEXTURING" | "ANIMATION" | "CONTROL";
export type HarnessProbeInput = {
  schema: 1;
  proposal_id: string;
  domain: HarnessProbeDomain;
  baseline_harness_sha256: string;
  candidate_harness_sha256: string;
  baseline: FinalGoldenSessionReport;
  candidate: FinalGoldenSessionReport;
};
export type HarnessProbeResult = {
  schema: 1;
  report: "harness-candidate-probe";
  proposal_id: string;
  task_id: string;
  domain: HarnessProbeDomain;
  status: "REJECTED_QUALITY" | "INCONCLUSIVE" | "REVIEW_REQUIRED";
  reasons: string[];
  comparison: ReturnType<typeof compareAcceptedGoldenSessions> | null;
  evidence: "SUPPLIED_GOLDEN_REPORTS_NOT_INDEPENDENTLY_CORRELATED";
  interpretation: string;
};
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const DOMAINS: readonly HarnessProbeDomain[] = [
  "GEOMETRY", "TEXTURING", "ANIMATION", "CONTROL",
];

/** An explicit selected file's SHA does not prove which context an AI consumed. */
export type HarnessContextByteCheck = {
  status: "SELECTED_BYTES_MATCH_DECLARATIONS_NOT_AGENT_CONSUMPTION";
  baseline_bytes: number;
  candidate_bytes: number;
};

const MAX_CONTEXT_BYTES = 256 * 1024;

/**
 * Pure, bounded file-byte integrity check for an opt-in A/B experiment.
 * The CLI reads explicit paths; this function neither discovers files nor
 * authenticates whether Codex actually loaded the checked instructions.
 */
export function verifyHarnessContextBytes(
  input: HarnessProbeInput,
  baseline: Uint8Array,
  candidate: Uint8Array
): HarnessContextByteCheck {
  if (!(baseline instanceof Uint8Array) || !(candidate instanceof Uint8Array) ||
      baseline.byteLength === 0 || candidate.byteLength === 0 ||
      baseline.byteLength > MAX_CONTEXT_BYTES ||
      candidate.byteLength > MAX_CONTEXT_BYTES) {
    throw new Error("Harness context byte inputs must be 1..262144 bytes each.");
  }
  const baselineSha = createHash("sha256").update(baseline).digest("hex");
  const candidateSha = createHash("sha256").update(candidate).digest("hex");
  if (baselineSha !== input.baseline_harness_sha256 ||
      candidateSha !== input.candidate_harness_sha256) {
    throw new Error("HARNESS_CONTEXT_BYTE_IDENTITY_MISMATCH: declared SHA-256 does not match selected file bytes.");
  }
  if (baselineSha === candidateSha) {
    throw new Error("HARNESS_CONTEXT_IDENTICAL_BYTES: no variant was supplied.");
  }
  return {
    status: "SELECTED_BYTES_MATCH_DECLARATIONS_NOT_AGENT_CONSUMPTION",
    baseline_bytes: baseline.byteLength,
    candidate_bytes: candidate.byteLength,
  };
}

function result(
  input: HarnessProbeInput,
  status: HarnessProbeResult["status"],
  reasons: string[],
  comparison: HarnessProbeResult["comparison"] = null
): HarnessProbeResult {
  return {
    schema: 1,
    report: "harness-candidate-probe",
    proposal_id: input.proposal_id,
    task_id: input.baseline.task_id,
    domain: input.domain,
    status,
    reasons,
    comparison,
    evidence: "SUPPLIED_GOLDEN_REPORTS_NOT_INDEPENDENTLY_CORRELATED",
    interpretation: "No automatic adoption, aggregate score or causal quality claim. Match independent native/visual evidence before accepting a variant.",
  };
}

export function evaluateHarnessProbe(input: HarnessProbeInput): HarnessProbeResult {
  if (!input || input.schema !== 1 ||
      !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(input.proposal_id) ||
      !DOMAINS.includes(input.domain) ||
      !SHA256.test(input.baseline_harness_sha256) ||
      !SHA256.test(input.candidate_harness_sha256) ||
      input.baseline_harness_sha256 === input.candidate_harness_sha256) {
    throw new Error("Harness probe requires distinct declared context SHA-256 values and valid proposal metadata.");
  }

  // Source/receipt validation is owned by the existing Golden report contract.
  validateAcceptedGoldenSessionReport(input.baseline);
  const candidate = input.candidate;
  if (!candidate || candidate.schema !== 1 ||
      candidate.report !== "golden-session-final" ||
      !GIT_SHA.test(candidate.source_sha) ||
      !["PASS", "FAIL", "UNVERIFIED"].includes(candidate.quality_verdict) ||
      !["ACCEPTED", "INCOMPLETE"].includes(candidate.state)) {
    throw new Error("Candidate must be a well-formed golden-session-final report.");
  }
  const baseline = input.baseline;
  const before = baseline.pipeline_provenance;
  const after = candidate.pipeline_provenance;
  const reasons: string[] = [];
  if (baseline.task_id !== candidate.task_id) reasons.push("TASK_MISMATCH");
  if (baseline.source_sha !== candidate.source_sha) reasons.push("SOURCE_SHA_MISMATCH");
  if (!after || after.reference_package_fingerprint !== before.reference_package_fingerprint) {
    reasons.push("REFERENCE_MISMATCH");
  }
  if (!SHA256.test(after?.input_asset_sha256 ?? "") ||
      after?.input_asset_sha256 !== before.input_asset_sha256) {
    reasons.push("START_ASSET_MISMATCH");
  }
  if (!after?.runtime_build_identity?.trim() ||
      after.runtime_build_identity !== before.runtime_build_identity) {
    reasons.push("RUNTIME_MISMATCH");
  }
  const baselineModel = baseline.usage?.model?.trim() || null;
  const candidateModel = candidate.usage?.model?.trim() || null;
  if (!baselineModel || !candidateModel) reasons.push("MODEL_IDENTITY_UNKNOWN");
  else if (baselineModel !== candidateModel) reasons.push("MODEL_MISMATCH");
  // Codex and model-provider usage counters are not interchangeable merely
  // because a model label matches. Reject incomplete or mixed provenance
  // before allowing a per-metric efficiency interpretation.
  const baselineTelemetry = baseline.usage?.telemetry_source?.trim() || null;
  const candidateTelemetry = candidate.usage?.telemetry_source?.trim() || null;
  if (!baselineTelemetry || !candidateTelemetry) {
    reasons.push("TELEMETRY_SOURCE_UNKNOWN");
  } else if (baselineTelemetry !== candidateTelemetry) {
    reasons.push("TELEMETRY_SOURCE_MISMATCH");
  }
  if (candidate.proof_scope !== "LIVE_BLOCKBENCH") {
    reasons.push("NATIVE_PROOF_MISSING");
  }
  if (reasons.length) return result(input, "INCONCLUSIVE", reasons);

  // Quality is a veto, never an efficiency-weighted score.
  if (candidate.quality_verdict === "FAIL") {
    if (candidate.state === "ACCEPTED" || candidate.accepted_result === true) {
      throw new Error("FAIL candidate cannot claim ACCEPTED.");
    }
    return result(input, "REJECTED_QUALITY", ["CANDIDATE_QUALITY_FAIL"]);
  }
  if (candidate.quality_verdict !== "PASS" ||
      candidate.state !== "ACCEPTED" ||
      candidate.accepted_result !== true) {
    return result(input, "INCONCLUSIVE", ["CANDIDATE_NOT_ACCEPTED"]);
  }

  // Use the canonical metrics and persistence comparator; no competing report.
  const comparison = compareAcceptedGoldenSessions({ baseline, candidate });
  return result(input, "REVIEW_REQUIRED", ["MATCHED_ACCEPTED_REPORTS"], comparison);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 && args.length !== 3) {
    throw new Error("Usage: bun run eval:harness-candidate -- <probe.json> [<baseline-context-file> <candidate-context-file>]");
  }
  const file = Bun.file(args[0]!);
  if (!(await file.exists())) throw new Error("Probe not found: " + args[0]);
  const probe = (await file.json()) as HarnessProbeInput;
  const evaluated = evaluateHarnessProbe(probe);
  let contextByteCheck: HarnessContextByteCheck | null = null;

  // File-byte verification is explicitly opt-in and is never called on the
  // Gateway hot path. No raw context, private path or model transcript is logged.
  if (args.length === 3) {
    const baselineFile = Bun.file(args[1]!);
    const candidateFile = Bun.file(args[2]!);
    if (!(await baselineFile.exists()) || !(await candidateFile.exists())) {
      throw new Error("Both selected harness context files must exist.");
    }
    if (baselineFile.size === 0 || candidateFile.size === 0 ||
        baselineFile.size > MAX_CONTEXT_BYTES ||
        candidateFile.size > MAX_CONTEXT_BYTES) {
      throw new Error("Harness context file sizes must be 1..262144 bytes each.");
    }
    const [baselineBytes, candidateBytes] = await Promise.all([
      baselineFile.arrayBuffer(),
      candidateFile.arrayBuffer(),
    ]);
    contextByteCheck = verifyHarnessContextBytes(
      probe, new Uint8Array(baselineBytes), new Uint8Array(candidateBytes)
    );
  }

  console.log(JSON.stringify({
    ...evaluated,
    context_file_check: contextByteCheck ?? { status: "NOT_CHECKED" },
  }, null, 2));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
