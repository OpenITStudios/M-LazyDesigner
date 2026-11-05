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
  const path = process.argv[2];
  if (!path) throw new Error("Usage: bun run eval:harness-candidate -- <probe.json>");
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error("Probe not found: " + path);
  console.log(JSON.stringify(evaluateHarnessProbe(
    (await file.json()) as HarnessProbeInput
  ), null, 2));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
