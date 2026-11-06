import {
  inspectParticleDocument,
  type JsonObject,
  type JsonValue,
} from "./document";
import { inspectParticleBindings } from "./binding";

export type ParticlePackDocument = {
  document: JsonObject;
  source_path?: string | null;
};

export type ParticlePackDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  particle_identifier?: string;
  source_path?: string | null;
};

export type ParticleDependencyEdge = {
  from: string;
  to: string;
};

export type ParticlePackAnalysisInput = {
  particles: readonly ParticlePackDocument[];
  client_entities?: readonly ParticlePackDocument[];
  available_textures?: readonly string[];
  available_sound_events?: readonly string[];
};

export type ParticlePackAnalysis = {
  particle_count: number;
  client_entity_count: number;
  identifiers: string[];
  dependency_edges: ParticleDependencyEdge[];
  dependency_cycles: string[][];
  /** Sum of isolated single-emitter numeric estimates, NEVER predicted game FPS. */
  composition_workload: {
    state: "single_instance_numeric" | "partial" | "cycle_review";
    numeric_effect_count: number;
    unevaluated_effect_count: number;
    known_single_instance_particle_sum: number;
    child_dependency_count: number;
    budget_review: boolean;
    runtime_fps_verified: false;
    /** Risk across the selected files; not concurrent scene/gameplay cost. */
    game_cost_review_effect_count: number;
    game_cost_drivers: string[];
  };
  texture_dependencies: string[];
  sound_dependencies: string[];
  diagnostics: ParticlePackDiagnostic[];
  valid: boolean;
};

const DIAGNOSTIC_LIMIT = 128;

type DiagnosticAccumulator = {
  entries: ParticlePackDiagnostic[];
  seen: Set<string>;
  has_error: boolean;
  truncated: boolean;
};

function object(value: JsonValue | undefined): JsonObject | null {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function diagnosticKey(diagnostic: ParticlePackDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.code,
    diagnostic.path ?? "",
    diagnostic.particle_identifier ?? "",
    diagnostic.source_path ?? "",
    diagnostic.message,
  ].join("|");
}

function emit(state: DiagnosticAccumulator, diagnostic: ParticlePackDiagnostic): void {
  if (diagnostic.severity === "error") state.has_error = true;
  const key = diagnosticKey(diagnostic);
  if (state.seen.has(key)) return;
  state.seen.add(key);
  if (state.entries.length < DIAGNOSTIC_LIMIT) {
    state.entries.push(diagnostic);
  } else {
    state.truncated = true;
  }
}

function finalizeDiagnostics(state: DiagnosticAccumulator): ParticlePackDiagnostic[] {
  if (!state.truncated) return state.entries;
  const marker: ParticlePackDiagnostic = {
    severity: "info",
    code: "particle_pack_diagnostics_truncated",
    message: `Particle pack diagnostics were bounded to ${DIAGNOSTIC_LIMIT} entries; validity still reflects errors beyond the returned diagnostic window.`,
  };
  if (state.entries.length >= DIAGNOSTIC_LIMIT) {
    return [...state.entries.slice(0, DIAGNOSTIC_LIMIT - 1), marker];
  }
  return [...state.entries, marker];
}

function stableUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function collectSoundEvents(value: JsonValue, out: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSoundEvents(entry, out));
    return;
  }
  const node = object(value);
  if (!node) return;
  const sound = object(node.sound_effect);
  if (sound && typeof sound.event_name === "string" && sound.event_name) out.add(sound.event_name);
  Object.values(node).forEach((entry) => collectSoundEvents(entry, out));
}

function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  let index = 0;
  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string): void => {
    indexes.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, indexes.get(next)!));
      }
    }

    if (low.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === node) break;
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  };

  for (const node of [...nodes].sort((left, right) => left.localeCompare(right))) {
    if (!indexes.has(node)) visit(node);
  }
  return components;
}

function cycleComponents(
  identifiers: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): string[][] {
  return stronglyConnectedComponents(identifiers, adjacency)
    .filter((component) => component.length > 1 || adjacency.get(component[0])?.has(component[0]) === true)
    .sort((left, right) => left.join("|").localeCompare(right.join("|")));
}

export function analyzeBedrockParticlePack(input: ParticlePackAnalysisInput): ParticlePackAnalysis {
  const diagnosticState: DiagnosticAccumulator = {
    entries: [],
    seen: new Set<string>(),
    has_error: false,
    truncated: false,
  };
  const byIdentifier = new Map<string, ParticlePackDocument[]>();
  const summaries = new Map<string, ReturnType<typeof inspectParticleDocument>>();
  const textureDependencies = new Set<string>();
  const soundDependencies = new Set<string>();

  for (const particle of input.particles) {
    const summary = inspectParticleDocument(particle.document);
    const identifier = summary.identifier;
    for (const diagnostic of summary.diagnostics) {
      emit(diagnosticState, {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: identifier
          ? `Particle "${identifier}": ${diagnostic.message}`
          : diagnostic.message,
        path: diagnostic.path,
        particle_identifier: identifier ?? undefined,
        source_path: particle.source_path ?? null,
      });
    }
    if (!identifier) {
      emit(diagnosticState, {
        severity: "error",
        code: "particle_pack_missing_identifier",
        message: "Pack particle document has no valid identifier.",
        source_path: particle.source_path ?? null,
      });
      continue;
    }
    const entries = byIdentifier.get(identifier) ?? [];
    entries.push(particle);
    byIdentifier.set(identifier, entries);
    if (!summaries.has(identifier)) summaries.set(identifier, summary);
    if (summary.texture) textureDependencies.add(summary.texture);

    const effect = object(particle.document.particle_effect);
    const events = effect ? object(effect.events) : null;
    if (events) for (const event of Object.values(events)) collectSoundEvents(event, soundDependencies);
  }

  for (const [identifier, entries] of byIdentifier) {
    if (entries.length <= 1) continue;
    emit(diagnosticState, {
      severity: "error",
      code: "duplicate_particle_identifier",
      message: `Particle identifier "${identifier}" appears in ${entries.length} pack documents.`,
      particle_identifier: identifier,
      source_path: entries[0].source_path ?? null,
    });
  }

  const identifiers = stableUnique(byIdentifier.keys());
  const known = new Set(identifiers);
  const adjacency = new Map<string, Set<string>>();
  const edges: ParticleDependencyEdge[] = [];

  for (const identifier of identifiers) {
    const summary = summaries.get(identifier)!;
    const targets = new Set<string>();
    for (const target of summary.nested_particle_effects) {
      targets.add(target);
      edges.push({ from: identifier, to: target });
      if (!known.has(target)) {
        emit(diagnosticState, {
          severity: "warning",
          code: "unresolved_nested_particle",
          message: `Particle "${identifier}" references nested particle "${target}" that is not present in the analyzed pack set.`,
          particle_identifier: identifier,
          source_path: byIdentifier.get(identifier)?.[0]?.source_path ?? null,
        });
      }
    }
    adjacency.set(identifier, new Set([...targets].filter((target) => known.has(target))));
  }

  edges.sort((left, right) => `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`));
  const cycles = cycleComponents(identifiers, adjacency);
  for (const cycle of cycles) {
    emit(diagnosticState, {
      severity: "warning",
      code: "particle_dependency_cycle",
      message: `Particle dependency cycle detected across: ${cycle.join(" -> ")}. Verify event/lifetime conditions bound repeated spawning.`,
      particle_identifier: cycle[0],
      source_path: byIdentifier.get(cycle[0])?.[0]?.source_path ?? null,
    });
  }

  if (input.available_textures) {
    const available = new Set(input.available_textures);
    for (const texture of textureDependencies) {
      if (!available.has(texture)) {
        emit(diagnosticState, {
          severity: "warning",
          code: "unresolved_particle_texture",
          message: `Particle texture dependency "${texture}" is not present in the supplied texture set.`,
        });
      }
    }
  }

  if (input.available_sound_events) {
    const available = new Set(input.available_sound_events);
    for (const sound of soundDependencies) {
      if (!available.has(sound)) {
        emit(diagnosticState, {
          severity: "warning",
          code: "unresolved_particle_sound_event",
          message: `Particle sound event "${sound}" is not present in the supplied sound-event set.`,
        });
      }
    }
  }

  for (const entry of input.client_entities ?? []) {
    let bindings: ReturnType<typeof inspectParticleBindings>;
    try {
      bindings = inspectParticleBindings(entry.document);
    } catch (error) {
      emit(diagnosticState, {
        severity: "error",
        code: "invalid_particle_client_entity",
        message: error instanceof Error ? error.message : "Client entity particle binding could not be inspected.",
        source_path: entry.source_path ?? null,
      });
      continue;
    }
    for (const diagnostic of bindings.diagnostics) {
      emit(diagnosticState, {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: bindings.entity_identifier
          ? `Client entity "${bindings.entity_identifier}": ${diagnostic.message}`
          : diagnostic.message,
        path: diagnostic.path,
        source_path: entry.source_path ?? null,
      });
    }
    for (const binding of bindings.bindings) {
      if (known.has(binding.effect)) continue;
      emit(diagnosticState, {
        severity: "error",
        code: "unresolved_client_entity_particle",
        message: `Client entity particle shortname "${binding.shortname}" targets "${binding.effect}", which is absent from the analyzed particle pack set.`,
        particle_identifier: binding.effect,
        source_path: entry.source_path ?? null,
      });
    }
  }

  // Only existing summaries: no additional reads, GPU work or nested
  // renderer simulation. Trigger multiplicity cannot be reconstructed here.
  const estimates = [...summaries.values()].map(s =>
    s.preview_workload.estimated_active_particles);
  const subtotal = estimates.reduce<number>((sum, count) =>
    count === null ? sum : Math.min(Number.MAX_SAFE_INTEGER, sum + count), 0);
  const unknown = estimates.filter(value => value === null).length;
  const missingChild = edges.some(edge => !known.has(edge.to));
  const compositionWorkload: ParticlePackAnalysis["composition_workload"] = {
    state: cycles.length ? "cycle_review"
      : unknown || missingChild ? "partial" : "single_instance_numeric",
    numeric_effect_count: estimates.length - unknown,
    unevaluated_effect_count: unknown,
    known_single_instance_particle_sum: subtotal,
    child_dependency_count: edges.length,
    budget_review: cycles.length > 0 || missingChild || edges.length > 3 ||
      subtotal > 256 ||
      [...summaries.values()].some(s => s.preview_workload.state !== "within_budget"),
    runtime_fps_verified: false,
    game_cost_review_effect_count: [...summaries.values()].filter(
      summary => summary.game_cost.cost_drivers.length > 0
    ).length,
    // Bounded, deduplicated and deterministic. Reuse the already-computed
    // document summaries rather than evaluating new event graph simulations.
    game_cost_drivers: stableUnique(
      [...summaries.values()].flatMap(summary => summary.game_cost.cost_drivers)
    ).slice(0, 11),
  };
  const diagnostics = finalizeDiagnostics(diagnosticState);
  return {
    particle_count: input.particles.length,
    client_entity_count: input.client_entities?.length ?? 0,
    identifiers,
    dependency_edges: edges,
    dependency_cycles: cycles,
    composition_workload: compositionWorkload,
    texture_dependencies: stableUnique(textureDependencies),
    sound_dependencies: stableUnique(soundDependencies),
    diagnostics,
    valid: !diagnosticState.has_error,
  };
}
