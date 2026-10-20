import type { ManagedProgress } from './desktopTypes';

/** Release both registered and asynchronously arriving listeners on disposal. */
export function subscribeManagedProgress(
  subscribe: (receive: (progress: ManagedProgress) => void) => Promise<() => void>,
  receive: (progress: ManagedProgress) => void,
): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  void subscribe(progress => {
    if (!disposed) receive(progress);
  }).then(unlisten => {
    if (disposed) unlisten();
    else unsubscribe = unlisten;
  }).catch(() => {
    // Progress is advisory; the maintenance result and full status own truth.
  });
  return () => {
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
  };
}
