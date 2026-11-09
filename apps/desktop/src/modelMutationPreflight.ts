/** Model file mutation preflight for UI messaging only.
 * Rust must independently revalidate all input and filesystem state before
 * performing any rename or recycle operation. No filesystem mutation here.
 */
export type ModelMutationEligibility = {
  allowed: boolean;
  reason: 'missing' | 'open' | 'dirty' | 'unverified' | null;
};

export function modelMutationEligibility(model: {
  exists: boolean; open: boolean; active: boolean; dirty: boolean;
}, observationVerified: boolean): ModelMutationEligibility {
  if (!observationVerified) return { allowed: false, reason: 'unverified' };
  if (!model.exists) return { allowed: false, reason: 'missing' };
  if (model.dirty) return { allowed: false, reason: 'dirty' };
  if (model.open || model.active) return { allowed: false, reason: 'open' };
  return { allowed: true, reason: null };
}

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_WINDOWS_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

/** Accept a filename stem, never a path. The .bbmodel suffix is owned by Rust. */
export function validateModelRenameStem(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 120) return null;
  if (raw !== raw.trim() || raw.endsWith('.') || INVALID_WINDOWS_CHARS.test(raw)) return null;
  if (raw === '.' || raw === '..' || RESERVED_WINDOWS_NAME.test(raw)) return null;
  if (/\.bbmodel$/i.test(raw)) return null;
  return raw;
}
