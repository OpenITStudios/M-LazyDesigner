// Derived Three.js read-only projection identity. Only renderer input fields
// belong in structure; images are compared by exact source string identity.
// This does not cache/validate authored Rust document or image permissions.
export interface SceneInputs {
  structure: string;
  sources: readonly (string | null)[];
}

export function sameSceneInputs(previous: SceneInputs | null, next: SceneInputs): boolean {
  return previous !== null && previous.structure === next.structure &&
    previous.sources.length === next.sources.length &&
    previous.sources.every((source, index) => source === next.sources[index]);
}

/**
 * Fast path is safe only for an unchanged Cube/Bone/UV/material structure.
 * Changed sources must stay non-null (painted PNG replacement, not a new
 * asset/unsupported source). Other transitions keep the full scene rebuild.
 */
export function canRefreshPaintSources(previous: SceneInputs | null, next: SceneInputs): boolean {
  if (!previous || previous.structure !== next.structure ||
      previous.sources.length !== next.sources.length) return false;
  let replaced = false;
  for (let i = 0; i < next.sources.length; i++) {
    if (previous.sources[i] === next.sources[i]) continue;
    if (!previous.sources[i] || !next.sources[i]) return false;
    replaced = true;
  }
  return replaced;
}
