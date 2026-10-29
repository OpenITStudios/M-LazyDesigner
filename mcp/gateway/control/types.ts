import type { CapabilitySummary, JsonRecord } from "../contracts/protocol";
import type { CapabilityVerificationClass } from "../../lib/capabilities/metadata";
import type { CapabilitySemanticScope } from "../../lib/capabilities/manifest";
import type { BlockitAuthoringPhaseAffinity } from "../../lib/runtime/affinity";
import type { SemanticRevisionDimension } from "../capabilities/semanticRegistry";
import type { GatewayAuthoringDomain } from "../context/authoring";
import type { DevelopmentSourceOwner } from "../development/types";

export type ControlAuthoringDomain = GatewayAuthoringDomain;

export type ControlFreshnessScope = CapabilitySemanticScope;

export type ControlVerificationScope =
  | {
      kind: "CUBE_TARGETS";
      cube_uuids: string[];
      framing: {
        min: [number, number, number];
        max: [number, number, number];
      };
    }
  | {
      kind: "ANIMATION_RANGE";
      animation_uuid: string;
      bone_uuid: string;
      channel: string | null;
      time_range: [number, number];
      review: {
        bone_ids: string[];
        range: { start: number; end: number };
        sample_times: number[];
      };
    }
  | {
      kind: "TEXTURE_REGION";
      texture_uuid: string;
      /** Producer-owned [left, top, right_exclusive, bottom_exclusive],
       * NOT get_texture.region's [x, y, width, height] form. */
      affected_rect: [number, number, number, number];
      revision: string;
      evidence_source: "mutation_response" | "follow_up_read";
    };

export type ControlContextSemanticDependency = SemanticRevisionDimension;

export type ControlContextHandle = {
  id: string;
  path: string;
  sha256: string;
  semantic_dependencies: ControlContextSemanticDependency[];
  semantic_revision: string;
};

export type ControlSourceOwner = DevelopmentSourceOwner;

export type ControlSystemState = "READY" | "DEGRADED" | "OFFLINE";

export type ControlReadiness = {
  modelling_start: "READY" | "NEEDS_ORIENTATION" | "BLOCKED";
  runtime_ready: boolean;
  project_ready: boolean;
  domain_ready: boolean;
  /** Required Skill/Profile handles exist; not proof the client loaded their text. */
  context_ready: boolean;
  workspace_state: "AVAILABLE" | "UNAVAILABLE" | "NOT_REQUIRED";
  reasons: string[];
};

export type ControlSnapshot = {
  protocol: "lazydesigner-control-v1";
  system: ControlSystemState;
  mode: "ASSET_AUTHORING";
  project: {
    affinity_uuid: string | null;
    active_uuid: string | null;
    open_project_count: number | null;
    binding: "BOUND" | "UNBOUND" | "LOST" | "UNKNOWN";
  };
  authoring: {
    phase: BlockitAuthoringPhaseAffinity | null;
    domain: ControlAuthoringDomain | null;
    next_intent: string;
  };
  runtime: {
    online: boolean;
    // HTTP reachability is not proof of a completed MCP handshake.
    // Optional for legacy internal fixtures; live Control snapshots set it.
    mcp_client_ready?: boolean;
    build_identity: string | null;
    runtime_signature: string | null;
    catalog_count: number;
    catalog_stale: boolean;
  };
  context: {
    required: ControlContextHandle[];
    optional: ControlContextHandle[];
  };
  blockers: string[];
};

export type ControlCapabilitySummary = CapabilitySummary & {
  control: {
    authoring_domain: ControlAuthoringDomain;
    current_domain: boolean;
    eligibility: "RECOMMENDED" | "AVAILABLE" | "FOREIGN_PHASE";
    source_owner: ControlSourceOwner;
  };
};

export type ControlDelta = {
  protocol: "lazydesigner-control-v1";
  capability: string;
  authoring_domain: ControlAuthoringDomain;
  source_owner: ControlSourceOwner;
  phase_before: BlockitAuthoringPhaseAffinity | null;
  phase_after: BlockitAuthoringPhaseAffinity | null;
  project_uuid: string | null;
  changed: string[];
  invalidates: {
    authoring_domains: ControlAuthoringDomain[];
    workspace_projection: boolean;
    acceptance_gates: boolean;
  };
  freshness: {
    basis: "NO_CHANGE" | "PRECISE_EFFECT" | "CONSERVATIVE_EFFECT" | "UNKNOWN_OUTCOME";
    stale: ControlFreshnessScope[];
    fresh: ControlFreshnessScope[];
    unknown: ControlFreshnessScope[];
  };
  revision_evidence: Partial<Record<ControlFreshnessScope, string>>;
  next_intent: string;
  verification_class: CapabilityVerificationClass;
  verification_scope: ControlVerificationScope | null;
  downstream_recheck: {
    required: Array<{
      scope: ControlFreshnessScope;
      domain: ControlAuthoringDomain;
      action:
        | "REVERIFY_GEOMETRY"
        | "REVERIFY_UV_LAYOUT"
        | "REVERIFY_MAPPED_TEXTURE"
        | "REVERIFY_MATERIAL_RENDER"
        | "REVERIFY_ANIMATION_MOTION"
        | "REVERIFY_ANIMATION_CONTROLLER"
        | "REVERIFY_ANIMATION_EFFECTS"
        | "REVERIFY_PARTICLE_SYSTEM";
      reason: string;
      target?: {
        cube_ids?: string[];
        island_ids?: string[];
        faces?: Array<{ cube_uuid: string; face: string | null }>;
        texture_uuid?: string;
        affected_rect?: [number, number, number, number];
        revision?: string;
        animation_uuid?: string;
        bone_ids?: string[];
        channel?: string | null;
        channels?: string[];
        time_range?: [number, number];
        controller_uuid?: string;
        state_ids?: string[];
      };
    }>;
    preserved_domains: ControlAuthoringDomain[];
  };
  requires_status_refresh: boolean;
};

export type RuntimeHealthLike = JsonRecord & {
  build_identity?: unknown;
  exposed_tool_count?: unknown;
  product?: unknown;
  project_context?: unknown;
};
