// Inspector parsing only; Rust retains authoritative mutation checks.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Reject empty, incomplete and nonfinite decimal input before Tauri IPC. */
export function parseFiniteEditorNumber(text: string): number | null {
  const input = text.trim();
  if (!DECIMAL.test(input)) return null;
  const number = Number(input);
  return Number.isFinite(number) ? number : null;
}
