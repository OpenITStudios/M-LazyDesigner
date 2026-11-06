import { createResource, type ResourceSpec } from "@/lib/factories";
import { MOLANG_ANIMATION_MATH_SYMBOLS } from "@/lib/animation/molangSemantics";
import {
  BEDROCK_PARTICLE_COMPONENT_REFERENCE,
  BEDROCK_PARTICLE_CURVE_REFERENCE,
  BEDROCK_PARTICLE_EVENT_REFERENCE,
  BEDROCK_PARTICLE_PRESET_REFERENCE,
} from "@/lib/particle/document";
import { BEDROCK_PARTICLE_SPECIAL_MOLANG_VARIABLES } from "@/lib/particle/semantics";
import { BEDROCK_PARTICLE_RESOURCE_LAYOUT } from "@/lib/particle/resourceLayout";

export const PARTICLE_REFERENCE_IDS = [
  "components",
  "materials",
  "curves",
  "events",
  "presets",
  "molang",
  "workflow",
] as const;

export type ParticleReferenceId = (typeof PARTICLE_REFERENCE_IDS)[number];

export const particleReferenceResourceDocs: ResourceSpec[] = [
  {
    name: "particle-reference",
    uriTemplate: "particle-reference://{id}",
    title: "Bedrock Particle Reference",
    description:
      "Lazy reference for Bedrock particle component families, render materials, compact starting presets, particle Molang/math, and authoring workflow. Read only the section needed for the current particle decision.",
  },
];

const PARTICLE_MATERIAL_REFERENCE = {
  principle:
    "basic_render_parameters.material selects the Bedrock particle material contract; preserve custom material strings losslessly and use known Vanilla particle materials when their render semantics fit the effect.",
  materials: {
    particles_base:
      "Base Vanilla particle material. Use when an authored particle or inherited Vanilla contract explicitly calls for the base particle material rather than alpha/blend/additive specializations.",
    particles_opaque:
      "Opaque particle rendering; best for fully opaque sprites that do not need alpha blending.",
    particles_alpha:
      "Alpha-tested/alpha-oriented particle rendering commonly used for cutout-style particle sprites.",
    particles_blend:
      "Standard translucent blending for soft smoke, mist, transparent energy and similar effects.",
    particles_add:
      "Additive particle blending for glow-like sparks, energy, magic and light-emitting visual effects.",
  },
  rules: [
    "Do not infer a material only from the texture filename.",
    "Unknown/custom material strings are preserved and remain unverified rather than rewritten.",
    "Visual approval still belongs to native Blockbench/Minecraft preview because JSON validity does not prove blend appearance.",
  ],
};

const PARTICLE_MOLANG_REFERENCE = {
  principle:
    "Particle numeric/vector fields may use Molang. BlockIT preserves authored expressions, lints known structural/math risks, and delegates actual evaluation to Minecraft/Blockbench rather than implementing a second Molang runtime.",
  variables: {
    "variable.emitter_age": "Age since the current emitter loop started.",
    "variable.emitter_lifetime": "Duration of the current emitter loop.",
    "variable.emitter_random_1": "Stable 0..1 random for the current emitter loop.",
    "variable.emitter_random_2": "Stable 0..1 random for the current emitter loop.",
    "variable.emitter_random_3": "Stable 0..1 random for the current emitter loop.",
    "variable.emitter_random_4": "Stable 0..1 random for the current emitter loop.",
    "variable.entity_scale": "Entity scale when the effect is attached to an entity.",
    "variable.particle_age": "Current particle age.",
    "variable.particle_lifetime": "Particle lifetime.",
    "variable.particle_random_1": "Stable 0..1 random for this particle lifetime.",
    "variable.particle_random_2": "Stable 0..1 random for this particle lifetime.",
    "variable.particle_random_3": "Stable 0..1 random for this particle lifetime.",
    "variable.particle_random_4": "Stable 0..1 random for this particle lifetime.",
  },
  special_variables: BEDROCK_PARTICLE_SPECIAL_MOLANG_VARIABLES,
  official_math_symbols: MOLANG_ANIMATION_MATH_SYMBOLS,
  execution_notes: {
    parametric_motion:
      "minecraft:particle_motion_parametric relative_position/direction/rotation are mathematical motion inputs evaluated per particle frame.",
    billboard:
      "Billboard size and UV Molang are evaluated during rendering; keep per-render expressions bounded.",
    curves:
      "Particle curves are evaluated each rendering frame and place their result into the curve's variable.* name.",
    randomness:
      "Prefer particle/emitter random variables when stable lifetime/loop randomness is desired; math.random-style calls in per-render expressions can vary frame-to-frame.",
  },
  lint_scope: [
    "known math.* symbol recognition without gameplay evaluation",
    "delimiter/quote structure",
    "obvious literal zero divisors",
    "Molang scalar/vector slot shape",
    "per-render complexity/randomness warnings",
    "parametric-motion cost warnings",
  ],
};

const PARTICLE_WORKFLOW_REFERENCE = {
  resource_layout: BEDROCK_PARTICLE_RESOURCE_LAYOUT,
  fast_path: [
    "intent",
    "choose closest preset only as a starting point",
    "targeted component/curve/event edits",
    "resolve particle texture provenance: existing, vanilla, or generated",
    "for generated texture: create_texture -> paint -> final paint_texture_transaction PNG output -> resume manage_particle with state=ready",
    "verify generated PNG exists before particle write/preview",
    "use Molang/curves when motion or appearance is mathematically driven",
    "inspect summary diagnostics",
    "native Blockbench preview when a stable particle path exists",
    "smallest causal correction",
    "save verified .particle.json",
    "bind through manage_animation_effects with explicit time/effect and locator when attachment is required",
  ],
  design_quality_decisions: {
    principle: "Choose the smallest physical/visual explanation that preserves the approved reference at the intended in-game viewing distance.",
    order: [
      "Identify the primary read: silhouette/shape, intensity/contrast, direction and moment of impact. Keep a secondary role only when visually distinct.",
      "Specify source region, motion impulse vs acceleration, world/local ownership and lifetime envelopes before choosing spawn count.",
      "Choose texture/alpha/UV/flipbook or color progression based on appearance readability; use stable per-particle age/random values rather than emitter-age switching when persistent identity matters.",
      "Tune event timing and optional child roles by the causal animation/impact clock; prefer an emitter event for a single shared beat, not per-particle full child emitters.",
      "Optimize repeated bursts, lifetime, large blended overlap, collision and per-render math before weakening the focal flash or approved silhouette.",
      "Review inspect_particle summary.game_cost and actual source diagnostics; treat unknown Molang, concurrency and game FPS as UNVERIFIED.",
    ],
    failure_contrasts: [
      "An unreadable explosion with many particles often needs a clearer flash/texture and event ordering, not higher emission.",
      "Large translucent billboards can cost more fill-rate than numerous small opaque sprites; screen-space cost cannot be certified by JSON.",
      "Two physically distinct roles may justify two emitter files; two identical motions with only colors changed usually do not justify extra child effects.",
      "A small instant count repeated every 0.1 seconds is not equivalent to a single one-shot burst.",
    ],
    proof: "Source quality and native preview invocation do not prove reference fidelity or Minecraft FPS. Protect artist-approved motion and do not auto-reduce authored production JSON.",
  },
  composed_effects: {
    mode: "SMALL_EXISTING_EVENT_GRAPH_NO_AUTOMATIC_MULTI_PREVIEW",
    purpose: "Only separate materially distinct physical roles; one emitter with curves first.",
    author: [
      "Author each child with manage_particle and preview=false before wiring the root.",
      "Assign unique IDs and use named particle_effect.events for child emitters.",
      "For one-shot VFX use minecraft:emitter_lifetime_events.creation_event or timeline seconds; ensure root lifetime reaches all scheduled beats.",
      "Keep emitter vs emitter_bound ownership explicit; avoid per-particle triggers that multiply full child emitters.",
      "Inspect each JSON and, when all files are available, the existing pack graph composition_workload.",
    ],
    efficiency: [
      "Start with one root and at most two distinct child roles as a reversible heuristic, never a universal Bedrock limit.",
      "Recheck alpha/overdraw, collision, rate*lifetime cap and nested event cycles before increasing density.",
      "One native Studio preview owner remains; expensive or nested auto-preview is paused, not silently simplified.",
      "The pack subtotal excludes repeated event activations and is NOT a measured peak count or FPS.",
    ],
  },
  ownership: {
    particle_asset: "inspect_particle / manage_particle",
    texture_canvas: "create_texture",
    texture_authoring: "existing Texturing paint capabilities",
    texture_final_png: "paint_texture_transaction optional output",
    animation_timing_and_locator: "manage_animation_effects",
    controller_state_binding: "manage_animation_controller",
    locator_authoring: "manage_locator",
  },
  recovery: [
    "Generated texture state=missing is a dependency handoff, not a particle mutation; do not write or preview the particle yet.",
    "Generated texture state=ready is accepted only when the canonical PNG output exists and is non-empty.",
    "A final PNG write failure rolls back the paint transaction; remain in Texturing and do not resume particle authoring.",
    "Particle validation errors block particle file writes and preview.",
    "Particle asset creation does not mutate animation effects; bind only after the particle artifact is ready.",
    "Animation particle binding requires explicit effect/time and uses explicit locator identity when attachment is required; ambiguous or missing targets must fail rather than guess.",
    "Do not automatically retry an outcome-unknown mutation after interruption.",
  ],
  quality: [
    "Particle JSON validity is not visual approval.",
    "Particle math lint is not runtime evaluation; native preview owns motion/appearance truth before approval.",
    "Prefer bounded particle counts and profile collision, high event fan-out, parametric motion, and complex per-render Molang on target hardware.",
    "Use patch for deep changes when sibling fields are not fully known.",
    "Do not regenerate a complex imported particle from a shallow preset when a targeted edit is sufficient.",
    "Do not add create_particle_texture or a second particle-specific painting/save system; reuse the canonical Texturing pipeline.",
  ],
};

export function getParticleReferencePayload(id: ParticleReferenceId) {
  switch (id) {
    case "components":
      return BEDROCK_PARTICLE_COMPONENT_REFERENCE;
    case "materials":
      return PARTICLE_MATERIAL_REFERENCE;
    case "curves":
      return BEDROCK_PARTICLE_CURVE_REFERENCE;
    case "events":
      return BEDROCK_PARTICLE_EVENT_REFERENCE;
    case "presets":
      return BEDROCK_PARTICLE_PRESET_REFERENCE;
    case "molang":
      return PARTICLE_MOLANG_REFERENCE;
    case "workflow":
      return PARTICLE_WORKFLOW_REFERENCE;
  }
}

export function registerParticleResources(): void {
  createResource("particle-reference", {
    ...particleReferenceResourceDocs[0],
    async listCallback() {
      return {
        resources: PARTICLE_REFERENCE_IDS.map((id) => ({
          uri: `particle-reference://${id}`,
          name: id,
          description: `Bedrock particle ${id} reference`,
          mimeType: "application/json",
        })),
      };
    },
    async readCallback(uri, { id }) {
      if (id && !PARTICLE_REFERENCE_IDS.includes(id as ParticleReferenceId)) {
        throw new Error(`Unknown particle reference section "${id}".`);
      }
      if (!id) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ sections: PARTICLE_REFERENCE_IDS }),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(getParticleReferencePayload(id as ParticleReferenceId)),
          },
        ],
      };
    },
  });
}