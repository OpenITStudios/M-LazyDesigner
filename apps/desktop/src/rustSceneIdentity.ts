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
