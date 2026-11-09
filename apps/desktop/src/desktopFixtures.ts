import type { SystemStatus, AnalyticsOverview } from './desktopTypes';

/** Fixed browser-only comparison clock; never represents the real machine clock. */
export const FIXTURE_NOW_MS = 1_730_000_000_000;

export type DevFixture = 'ready' | 'ready-no-active' | 'ready-continue' | 'ready-aged' | 'many-projects' | 'status-unverified' | 'status-unavailable' | 'fresh-install' | 'approval-required' | 'plugin-missing' | 'plugin-modified' | 'runtime-offline' | 'client-wait' | 'unsupported' | 'repair-blocked';

export function applyDevFixture(base: SystemStatus, fixture: DevFixture): SystemStatus {
  const next = structuredClone(base);
  const ready = ['ready', 'ready-no-active', 'ready-continue', 'ready-aged', 'many-projects', 'status-unverified'].includes(fixture);
  const runtimeOnline = ready || ['client-wait', 'repair-blocked'].includes(fixture);
  const gatewayActive = ready || fixture === 'repair-blocked';

  next.manager_available = fixture !== 'fresh-install';
  next.bootstrap_available = true;
  next.plugin_integrity = fixture === 'plugin-missing' ? 'missing' : fixture === 'plugin-modified' ? 'modified' : 'ready';
  next.blockbench.running = fixture !== 'fresh-install';
  next.blockbench.version = next.blockbench.version ?? '5.2.0';
  next.blockbench.compatibility = {
    status: fixture === 'unsupported' ? 'unsupported' : 'validated',
    minimum_version: next.blockbench.compatibility?.minimum_version ?? '5.2.0',
    review_boundary_version: next.blockbench.compatibility?.review_boundary_version ?? '5.3.0',
    source_type_baseline: next.blockbench.compatibility?.source_type_baseline ?? 'desktop',
    live_validated: fixture !== 'unsupported',
  };

  next.managed = fixture === 'fresh-install' ? null : {
    schema: 1,
    installed: next.managed?.installed ?? { source_sha: '0000000000000000000000000000000000000000' },
    pending: false,
    gateway_active: gatewayActive,
    runtime_online: runtimeOnline,
    runtime_url: next.managed?.runtime_url ?? 'https://127.0.0.1:3000/bb-mcp',
    tls_ready: true,
    tls_error: null,
    rollback: { available: false, previous_source_sha: null, transaction: null },
  };

  next.runtime_listener_live = runtimeOnline;
  next.runtime_endpoint_match = runtimeOnline ? true : null;
  next.runtime_ready = runtimeOnline;

  next.gateway = {
    ownership: 'client-owned',
    state: ready ? 'healthy'
      : fixture === 'client-wait' ? 'client-disconnected'
      : fixture === 'repair-blocked' ? 'healthy'
      : fixture === 'runtime-offline' || fixture === 'approval-required' || fixture === 'plugin-missing' ? 'runtime-offline'
      : 'idle',
    action: null,
  };

  next.readiness = {
    ready,
    state: ready ? 'ready'
      : fixture === 'fresh-install' ? 'setup-required'
      : fixture === 'client-wait' || fixture === 'runtime-offline' || fixture === 'approval-required' || fixture === 'plugin-missing' ? 'needs-connection'
      : 'needs-attention',
    summary: ready ? 'LazyDesigner is ready.' : 'Fixture state.',
  };

  next.product_state = ready ? 'ready'
    : fixture === 'fresh-install' ? 'welcome'
    : fixture === 'unsupported' ? 'unsupported'
    : fixture === 'plugin-modified' ? 'attention'
    : fixture === 'client-wait' ? 'client-wait'
    : fixture === 'repair-blocked' ? 'attention'
    : fixture === 'runtime-offline' || fixture === 'approval-required' || fixture === 'plugin-missing' ? 'plugin-setup'
    : 'attention';

  next.project_navigation = {
    revision: 'fixture:1',
    session_live: fixture !== 'fresh-install' && fixture !== 'runtime-offline',
    continue_model_id: fixture === 'fresh-install' || fixture === 'ready-no-active' ? null : 'model-fixture',
    recent_model_ids: fixture === 'fresh-install' ? [] : ['model-fixture-2'],
    preferences_issue: null,
    active: fixture === 'fresh-install' || fixture === 'ready-no-active' || fixture === 'ready-continue' ? null : {
      project_id: 'project-fixture',
      project_name: 'Furniture',
      model_id: 'model-fixture',
      model_name: 'Modern Chair',
      saved: true,
      dirty: false,
    },
    projects: fixture === 'fresh-install' ? [] : [{
      id: 'project-fixture',
      name: 'Furniture',
      active: true,
      pinned: true,
      registered: true,
      available: true,
      model_count: 2,
      models: [
        { id: 'model-fixture', name: 'Modern Chair', active: true, open: true, dirty: false, exists: true },
        { id: 'model-fixture-2', name: 'Sofa', active: false, open: true, dirty: true, exists: true },
      ],
      folders: [
        { id: 'folder-fixture-models', label: 'Models', kind: 'models' },
        { id: 'folder-fixture-references', label: 'References', kind: 'references' },
      ],
    }],
  };

  if (fixture === 'ready-no-active' || fixture === 'ready-continue') {
    const project = next.project_navigation.projects[0];
    if (project) {
      project.active = false;
      project.models = project.models.map(model => ({
        ...model, active: false, open: false, dirty: false,
      }));
    }
  }

  if (fixture === 'many-projects') {
    // Synthetic UI-only inventory: the Needle asset is beyond the first six
    // project rows, and is discoverable without expanding all projects.
    next.project_navigation.active = null;
    next.project_navigation.continue_model_id = null;
    next.project_navigation.recent_model_ids = [];
    next.project_navigation.projects = Array.from({ length: 8 }, (_, index) => ({
      id: `fixture-project-${index + 1}`,
      name: index === 7 ? 'Archive Models' : `Project ${index + 1}`,
      active: false,
      pinned: false,
      registered: true,
      available: true,
      model_count: 1,
      models: [{
        id: `fixture-model-${index + 1}`,
        name: index === 7 ? 'Needle asset' : `Prop ${index + 1}`,
        active: false,
        open: false,
        dirty: false,
        exists: true,
      }],
      folders: [],
    }));
  }

  if (fixture === 'ready-aged') {
    // Healthy at the last FULL observation; that observation is now old.
    next.observed_at_unix_ms = FIXTURE_NOW_MS - 90_000;
  }

  next.maintenance = {
    ...next.maintenance,
    update: fixture !== 'fresh-install',
    repair: fixture !== 'repair-blocked' && fixture !== 'fresh-install',
    recover: fixture !== 'repair-blocked' && fixture !== 'fresh-install',
    setup_tls: false,
    blocked_reason: fixture === 'repair-blocked' ? 'Runtime or Gateway is active.' : null,
  };
  return next;
}

/** Browser-only baseline. Never treated as an authoritative machine observation. */
export function createDevFixtureStatus(fixture: DevFixture): SystemStatus {
  if (fixture === 'status-unavailable') {
    throw new Error('No SystemStatus exists in the unavailable-status fixture; render it through App.');
  }
  const baseline: SystemStatus = {
    schema: 1,
    product_state: 'welcome',
    plugin_integrity: 'unknown',
    observed_at_unix_ms: FIXTURE_NOW_MS,
    readiness: { state: 'setup-required', summary: 'Development fixture only.', ready: false },
    blockbench: { running: false, version: null, compatibility: null, diagnostic: null },
    gateway: { ownership: 'client-owned', state: 'idle', action: null },
    maintenance: {
      update: false, rollback: false, repair: false, recover: false,
      setup_tls: false, blocked_reason: null,
    },
    manager_available: false,
    bootstrap_available: true,
    runtime_listener_live: false,
    runtime_endpoint_match: null,
    runtime_ready: false,
    managed: null,
    project_navigation: {
      revision: null, session_live: false, continue_model_id: null,
      recent_model_ids: [], preferences_issue: null, active: null, projects: [],
    },
    diagnostic: null,
  };
  return applyDevFixture(baseline, fixture);
}

/** Synthetic data for inspecting the read-only Analytics layout, not real usage evidence. */
export function createDevAnalyticsFixture(): AnalyticsOverview {
  return {
    schema: 1,
    report: 'desktop-analytics-overview',
    source: 'GATEWAY_L0_BOUNDED_SNAPSHOTS',
    state: 'PARTIAL',
    observed_sessions: 3,
    observed_calls: 18,
    failures: 2,
    unbound_calls: 1,
    open_or_unclean_sessions: 1,
    invalid_snapshots: 0,
    older_snapshots_omitted: 0,
    capture_failures: 0,
    persist_failures: 0,
    overflow_project_observations: 0,
    projects: [{
      project_key: '0000000000000000000000000000000000000000000000000000000000000001',
      observed_sessions: 2,
      observed_calls: 14,
      failures: 1,
      duration_sum_ms: 2150,
      domains: {
        geometry: { calls: 11, failures: 1, duration_sum_ms: 1500 },
        texture: { calls: 3, failures: 0, duration_sum_ms: 650 },
      },
      capabilities: [
        { name: 'manage_cubes', calls: 9 },
        { name: 'inspect_model', calls: 5 },
      ],
      error_codes: [{ name: 'FIXTURE_ERROR', calls: 1 }],
      by_tool: {},
      build_calls: {
        'fixture-build': { calls: 14, failures: 1, duration_sum_ms: 2150 },
      },
      build_unattributed_calls: 0,
      build_measured_sessions: 2,
      build_overflow: false,
    }],
    limits: {
      retrospective_scope: 'Synthetic fixture; not a project history.',
      project_identity: 'Synthetic non-user identity.',
      duration: 'Illustrative cumulative call duration only.',
      source_sha: null,
      provider_tokens: null,
      accepted_quality: 'UNVERIFIED',
      build_coverage: 'Synthetic fixture only.',
    },
  };
}

export function devFixtureFromLocation(development: boolean, search: string): DevFixture | null {
  if (!development) return null;
  const value = new URLSearchParams(search).get('fixture');
  const allowed: DevFixture[] = ['ready','ready-no-active','ready-continue','ready-aged','many-projects','status-unverified','status-unavailable','fresh-install','approval-required','plugin-missing','plugin-modified','runtime-offline','client-wait','unsupported','repair-blocked'];
  return allowed.includes(value as DevFixture) ? value as DevFixture : null;
}

