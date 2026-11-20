/** SDK-only input primitives, shared by the CLI facade and read-only selector guards.
 * No filesystem, Rust runner, sandbox or mutation authority lives here. */
export const PLAN_LIMIT = 64 * 1024;
export function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || value.includes('\0')) {
    throw new TypeError(name + ' must be a nonempty string without option prefixes or NUL');
  }
  return value;
}
export function wholeNumber(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return String(value);
}
