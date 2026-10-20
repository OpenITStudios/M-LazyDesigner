import type { VerificationTask } from "@/lib/orchestration/verificationPlan";
import type { VerificationRisk } from "@/lib/orchestration/deltaVerification";
import type { ModelView } from "@/lib/reference/visualEvidence";

export type VerificationEvidenceRequest =
  | {
      domain: "GEOMETRY";
      source: "capture_model_views";
      verification_risk: VerificationRisk;
      views: ModelView[];
      views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS";
      size: 256 | 512;
      size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS";
      scope_instance_ids: string[];
    }
  | {
      domain: "UV";
      source: null;
      availability: "UNAVAILABLE";
      reason: "UV_CAPABILITY_UNREGISTERED";
      island_ids: string[];
      full_replan: boolean;
    }
  | {
      domain: "RIG";
      source: "inspect_elements";
      instance_ids: string[];
      full_replan: boolean;
    }
  | {
      domain: "ANIMATION";
      source: "inspect_animation";
      instance_ids: string[];
      full_review: boolean;
    }
  | {
      domain: "TEXTURE";
      source: "get_texture";
      mode: "AFFECTED_SURFACES" | "SEMANTIC_REVIEW";
      inspection: "region" | "full_atlas";
    };

function geometryViews(risk: VerificationRisk): ModelView[] {
  if (risk === "LOW") return ["front"];
  if (risk === "MEDIUM") return ["front", "left"];
  return ["front", "left", "front_left_3q"];
}

export function compileVerificationEvidenceRequests(
  tasks: readonly VerificationTask[],
  risk: VerificationRisk
): VerificationEvidenceRequest[] {
  return tasks.map((task): VerificationEvidenceRequest => {
    switch (task.domain) {
      case "GEOMETRY":
        return {
          domain: "GEOMETRY",
          source: "capture_model_views",
          verification_risk: risk,
          views: geometryViews(risk),
          views_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          size: risk === "HIGH" ? 512 : 256,
          size_role: "FALLBACK_IF_NO_GROUNDED_TARGETS",
          scope_instance_ids: [...task.instance_ids],
        };
      case "UV":
        return {
          domain: "UV",
          source: null,
          availability: "UNAVAILABLE",
          reason: "UV_CAPABILITY_UNREGISTERED",
          island_ids: [...task.island_ids],
          full_replan: task.full_replan,
        };
      case "RIG":
        return {
          domain: "RIG",
          source: "inspect_elements",
          instance_ids: [...task.instance_ids],
          full_replan: task.full_replan,
        };
      case "ANIMATION":
        return {
          domain: "ANIMATION",
          source: "inspect_animation",
          instance_ids: [...task.instance_ids],
          full_review: task.full_review,
        };
      case "TEXTURE":
        return {
          domain: "TEXTURE",
          source: "get_texture",
          mode: task.mode,
          inspection: task.mode === "AFFECTED_SURFACES" ? "region" : "full_atlas",
        };
    }
  });
}
