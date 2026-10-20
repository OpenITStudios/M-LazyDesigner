import type { SystemStatus } from './desktopTypes';

export type DevFixture = 'ready' | 'fresh-install' | 'approval-required' | 'plugin-missing' | 'plugin-modified' | 'runtime-offline' | 'client-wait' | 'unsupported' | 'repair-blocked';

export function applyDevFixture(base: SystemStatus, fixture: DevFixture): SystemStatus {
  const next = structuredClone(base);
  const runtimeOnline = ['ready', 'client-wait', 'repair-blocked'].includes(fixture);
  const gatewayActive = ['ready', 'repair-blocked'].includes(fixture);

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
    state: fixture === 'ready' ? 'healthy'
      : fixture === 'client-wait' ? 'client-disconnected'
      : fixture === 'repair-blocked' ? 'healthy'
      : fixture === 'runtime-offline' || fixture === 'approval-required' || fixture === 'plugin-missing' ? 'runtime-offline'
      : 'idle',
    action: null,
  };

  next.readiness = {
    ready: fixture === 'ready',
    state: fixture === 'ready' ? 'ready'
      : fixture === 'fresh-install' ? 'setup-required'
      : fixture === 'client-wait' || fixture === 'runtime-offline' || fixture === 'approval-required' || fixture === 'plugin-missing' ? 'needs-connection'
      : 'needs-attention',
    summary: fixture === 'ready' ? 'LazyDesigner is ready.' : 'Fixture state.',
  };

  next.product_state = fixture === 'ready' ? 'ready'
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
    continue_model_id: fixture === 'fresh-install' ? null : 'model-fixture',
    recent_model_ids: fixture === 'fresh-install' ? [] : ['model-fixture-2'],
    preferences_issue: null,
    active: fixture === 'fresh-install' ? null : {
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

export function devFixtureFromLocation(development: boolean, search: string): DevFixture | null {
  if (!development) return null;
  const value = new URLSearchParams(search).get('fixture');
  const allowed: DevFixture[] = ['ready','fresh-install','approval-required','plugin-missing','plugin-modified','runtime-offline','client-wait','unsupported','repair-blocked'];
  return allowed.includes(value as DevFixture) ? value as DevFixture : null;
}

