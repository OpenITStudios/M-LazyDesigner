import { describe, expect, test } from 'bun:test';
import {
  modelMutationEligibility, validateModelRenameStem,
} from '../../../apps/desktop/src/modelMutationPreflight';

describe('model mutation preflight (not filesystem authorization)', () => {
  const closed = { exists: true, open: false, active: false, dirty: false };
  test('requires a verified observation and closed, clean, existing model', () => {
    expect(modelMutationEligibility(closed, true)).toEqual({ allowed: true, reason: null });
    expect(modelMutationEligibility(closed, false).reason).toBe('unverified');
    expect(modelMutationEligibility({ ...closed, exists: false }, true).reason).toBe('missing');
    expect(modelMutationEligibility({ ...closed, dirty: true }, true).reason).toBe('dirty');
    expect(modelMutationEligibility({ ...closed, open: true }, true).reason).toBe('open');
    expect(modelMutationEligibility({ ...closed, active: true }, true).reason).toBe('open');
  });
  test('accepts simple model stems only', () => {
    expect(validateModelRenameStem('Modern Chair')).toBe('Modern Chair');
    expect(validateModelRenameStem('Sofa_v2')).toBe('Sofa_v2');
    for (const value of ['', ' ', ' CON', 'Sofa.', 'Sofa ', '.', '..', 'CON',
      'nul', 'LPT1', 'Sofa.bbmodel', 'Sofa/Other', 'a\\b', 'a:b', 'a?b',
      'a*b', 'a|b', 'a<b', 'a>b', 'a"b', 'a\n', 'x'.repeat(121)]) {
      expect(validateModelRenameStem(value)).toBeNull();
    }
  });
});
