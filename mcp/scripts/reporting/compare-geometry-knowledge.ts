import casebook from "../../../docs/03-authoring/modelling/decision-cases.md" with { type: "text" };
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
} from "../../lib/semantic/knowledge";
import {
  compareAcceptedGoldenSessions,
  type FinalGoldenSessionReport,
} from "./compare-golden-sessions";

const CASEBOOK_PATH = "docs/03-authoring/modelling/decision-cases.md";
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_SHA = /^[0-9a-f]{40}$/;
const MAX_CLAIM_REFS = 8;
const GEOMETRY_TASKS = new Set([
  "golden-existing-model-correction",
  "golden-organic-flower",
  "golden-mechanical-lift",
  "golden-humanoid-fisherman",
  "golden-prop-chair",
  "golden-layered-cutout-display",
]);

/** Benchmark-only sidecar, not persisted Recipe, Runtime or Gateway metadata.
 * The actual captured response bytes and human review are external evidence.
 * This contract cannot authenticate them or a claimed control condition.
 */
export type GeometryKnowledgeExposure = {
  mode: "CONTROL_NO_CURATED_GUIDANCE" | "CANDIDATE_CURATED_GUIDANCE";
  task_id: string;
  source_sha: string;
  input_project_uuid: string;
  /** Distinct runner capture session; Project UUID may persist in the seed. */
  benchmark_session_id: string;
  feature_id: string;
  /** Same observed Reference Package claim handles in both runs. */
  reference_claim_ids: string[];
  /** A content-addressed capture of the actual live structured response. */
  structured_response_ref: string;
  structured_response_sha256: string;
  /** Same fixed instructions and experiment protocol for both conditions. */
  protocol_sha256: string;
  environment: {
    operating_system: string;
    blockbench_version: string;
    target_bedrock_version: string;
  };
  curated_case: null | {
    feature_id: string;
    section_id: string;
    section_sha256: string;
    source_sha256: string;
    heading: string;
    source_path: typeof CASEBOOK_PATH;
    guidance_state: "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF";
  };
};

export type GeometryKnowledgePairInput = {
  baseline: FinalGoldenSessionReport;
  candidate: FinalGoldenSessionReport;
  baseline_exposure: GeometryKnowledgeExposure;
  candidate_exposure: GeometryKnowledgeExposure;
};

const identity = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim() || v !== v.trim() ||
      v.length > 256) {
    throw new Error("R5_GEOMETRY_PAIR_INVALID_" + name);
  }
  return v;
};
const fingerprint = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !SHA256.test(v)) {
    throw new Error("R5_GEOMETRY_PAIR_INVALID_" + name);
  }
  return v;
};
const claims = (input: GeometryKnowledgeExposure): string[] => {
  if (!Array.isArray(input.reference_claim_ids) ||
      input.reference_claim_ids.length < 1 ||
      input.reference_claim_ids.length > MAX_CLAIM_REFS ||
      new Set(input.reference_claim_ids).size !==
        input.reference_claim_ids.length) {
    throw new Error("R5_GEOMETRY_PAIR_REFERENCE_CLAIMS_INVALID");
  }
  return input.reference_claim_ids.map(s => identity(s, "REFERENCE_CLAIM"));
};

function checkExposure(
  report: FinalGoldenSessionReport,
  observation: GeometryKnowledgeExposure,
  mode: GeometryKnowledgeExposure["mode"],
  label: string
): void {
  if (!observation || observation.mode !== mode ||
      !SOURCE_SHA.test(observation.source_sha) ||
      observation.source_sha !== report.source_sha ||
      observation.task_id !== report.task_id ||
      identity(observation.input_project_uuid, "PROJECT_UUID") !==
        report.pipeline_provenance.input_project_uuid ||
      !identity(observation.feature_id, "FEATURE_ID")) {
    throw new Error("R5_GEOMETRY_PAIR_" + label + "_OWNERSHIP_MISMATCH");
  }
  identity(observation.benchmark_session_id, "BENCHMARK_SESSION_ID");
  identity(observation.structured_response_ref, "RESPONSE_REF");
  fingerprint(observation.structured_response_sha256, "RESPONSE_HASH");
  fingerprint(observation.protocol_sha256, "PROTOCOL_HASH");
  for (const key of [
    "operating_system", "blockbench_version", "target_bedrock_version",
  ] as const) identity(observation.environment?.[key], key.toUpperCase());
  claims(observation);
}

/**
 * Apply the EXISTING accepted-result Golden comparison and add stricter R5
 * matching + repository-source-bound case identity. Never assign a numeric
 * quality score, infer a causal win or authenticate self-supplied captures.
 *
 * The only intended treatment is whether a selected canonical G1 case was
 * visible/used in an otherwise fixed-authoring task. R1-R4 may affect the
 * advice, but their implementation is never benchmarked as a second engine.
 */
export function compareGeometryKnowledgeGoldenPair(
  input: GeometryKnowledgePairInput
) {
  const { baseline, candidate, baseline_exposure, candidate_exposure } = input;
  const general = compareAcceptedGoldenSessions({ baseline, candidate });

  if (!GEOMETRY_TASKS.has(baseline.task_id)) {
    throw new Error("R5_GEOMETRY_PAIR_TASK_NOT_GEOMETRY_RELEVANT");
  }
  if (baseline.source_sha !== candidate.source_sha ||
      baseline.pipeline_provenance.runtime_build_identity !==
        candidate.pipeline_provenance.runtime_build_identity ||
      baseline.pipeline_provenance.control_task_context_id !==
        candidate.pipeline_provenance.control_task_context_id) {
    throw new Error("R5_GEOMETRY_PAIR_SOURCE_BUILD_OR_CONTROL_CHANGED");
  }
  // Distinct runner sessions are required, not distinct project UUIDs:
  // identical .bbmodel seeds may preserve the SAME authored Project UUID.
  // Each session must independently revalidate its immutable starting bytes.
  // Matching seed hashes alone cannot authenticate a filesystem reset.
  if (baseline_exposure.benchmark_session_id ===
      candidate_exposure.benchmark_session_id) {
    throw new Error("R5_GEOMETRY_PAIR_INDEPENDENT_SESSION_REQUIRED");
  }
  const modelA = baseline.usage?.model?.trim();
  const modelB = candidate.usage?.model?.trim();
  if (!modelA || !modelB || modelA !== modelB) {
    throw new Error("R5_GEOMETRY_PAIR_SAME_KNOWN_MODEL_REQUIRED");
  }
  const telemetryA = baseline.usage?.telemetry_source?.trim();
  const telemetryB = candidate.usage?.telemetry_source?.trim();
  if (!telemetryA || telemetryA !== telemetryB) {
    throw new Error("R5_GEOMETRY_PAIR_SAME_KNOWN_TELEMETRY_SOURCE_REQUIRED");
  }
  checkExposure(baseline, baseline_exposure,
    "CONTROL_NO_CURATED_GUIDANCE", "CONTROL");
  checkExposure(candidate, candidate_exposure,
    "CANDIDATE_CURATED_GUIDANCE", "CANDIDATE");
  if (baseline_exposure.structured_response_ref ===
        candidate_exposure.structured_response_ref ||
      baseline_exposure.structured_response_sha256 ===
        candidate_exposure.structured_response_sha256) {
    throw new Error("R5_GEOMETRY_PAIR_DISTINCT_RESPONSE_CAPTURES_REQUIRED");
  }
  if (baseline_exposure.feature_id !== candidate_exposure.feature_id ||
      baseline_exposure.protocol_sha256 !== candidate_exposure.protocol_sha256 ||
      JSON.stringify([...claims(baseline_exposure)].sort()) !==
        JSON.stringify([...claims(candidate_exposure)].sort())) {
    throw new Error("R5_GEOMETRY_PAIR_FEATURE_PROTOCOL_OR_CLAIMS_CHANGED");
  }
  for (const key of [
    "operating_system", "blockbench_version", "target_bedrock_version",
  ] as const) {
    if (baseline_exposure.environment[key] !== candidate_exposure.environment[key]) {
      throw new Error("R5_GEOMETRY_PAIR_ENVIRONMENT_CHANGED");
    }
  }
  if (baseline_exposure.curated_case !== null ||
      !candidate_exposure.curated_case ||
      typeof candidate_exposure.curated_case !== "object" ||
      Array.isArray(candidate_exposure.curated_case)) {
    throw new Error("R5_GEOMETRY_PAIR_INTERVENTION_NOT_ISOLATED");
  }
  const candidateCase = candidate_exposure.curated_case;
  if (candidateCase.feature_id !== candidate_exposure.feature_id ||
      candidateCase.source_path !== CASEBOOK_PATH ||
      candidateCase.guidance_state !==
        "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF" ||
      !SHA256.test(candidateCase.section_sha256) ||
      !SHA256.test(candidateCase.source_sha256)) {
    throw new Error("R5_GEOMETRY_PAIR_CASE_PROVENANCE_INVALID");
  }
  // Verify content hashes from the EXACT checked-in G1 source, not from
  // caller-supplied markdown, filenames or an arbitrary external paper.
  const current = indexMarkdownKnowledge(CASEBOOK_PATH, casebook);
  const evidence = describeKnowledgeSource(CASEBOOK_PATH, casebook);
  const section = current.find(item =>
    item.id === candidateCase.section_id &&
    /^G-P0[1-8] /.test(item.heading)
  );
  if (!section ||
      section.heading !== candidateCase.heading ||
      section.sha256 !== candidateCase.section_sha256 ||
      evidence.content_sha256 !== candidateCase.source_sha256) {
    throw new Error("R5_GEOMETRY_PAIR_CASE_SOURCE_STALE_OR_UNKNOWN");
  }

  return {
    ...general,
    report: "geometry-knowledge-golden-pair",
    experiment_status: "MATCHED_ACCEPTED_REPORTS_FOR_HUMAN_REVIEW" as const,
    intervention: {
      feature_id: baseline_exposure.feature_id,
      source_path: CASEBOOK_PATH,
      heading: section.heading,
      section_id: section.id,
      section_sha256: section.sha256,
      source_sha256: evidence.content_sha256,
      protocol_sha256: baseline_exposure.protocol_sha256,
      baseline_session_id: baseline_exposure.benchmark_session_id,
      candidate_session_id: candidate_exposure.benchmark_session_id,
      baseline_capture_ref: baseline_exposure.structured_response_ref,
      candidate_capture_ref: candidate_exposure.structured_response_ref,
      baseline_capture_sha256: baseline_exposure.structured_response_sha256,
      candidate_capture_sha256: candidate_exposure.structured_response_sha256,
    },
    environment: { ...baseline_exposure.environment },
    attribution: "NOT_CAUSALLY_ATTESTED" as const,
    capture_authentication: "EXTERNAL_REVIEW_REQUIRED" as const,
    verdict_scope: "BOTH_ACCEPTED_WITH_RECORDED_INTERVENTION_NOT_MEASURED_GEOMETRY_GAIN" as const,
    rule:
      "Same source/build/Control/reference/seed/model and recorded intervention are necessary, not sufficient for causation. Independently verify seed reset for each session, actual live response bytes, baseline non-exposure, current reference views and human acceptance. Deltas are descriptive; no winner, aggregate quality score or model allowance saving is inferred.",
  };
}

async function main(): Promise<void> {
  const [baselinePath, candidatePath, exposurePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath || !exposurePath) {
    throw new Error(
      "Usage: bun run compare:geometry-knowledge -- <baseline-final.json> <candidate-final.json> <exposure-pair.json>"
    );
  }
  const files = await Promise.all(
    [baselinePath, candidatePath, exposurePath].map(async path => {
      const file = Bun.file(path);
      if (!(await file.exists())) throw new Error("Missing R5 benchmark file: " + path);
      if (file.size > 262_144) {
        throw new Error("R5_GEOMETRY_PAIR_INPUT_FILE_TOO_LARGE");
      }
      return file.json();
    })
  );
  const [baseline, candidate, observations] = files;
  const pair = observations as {
    baseline_exposure: GeometryKnowledgeExposure;
    candidate_exposure: GeometryKnowledgeExposure;
  };
  console.log(JSON.stringify(compareGeometryKnowledgeGoldenPair({
    baseline: baseline as FinalGoldenSessionReport,
    candidate: candidate as FinalGoldenSessionReport,
    baseline_exposure: pair.baseline_exposure,
    candidate_exposure: pair.candidate_exposure,
  }), null, 2));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
