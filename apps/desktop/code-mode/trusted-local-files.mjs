/** Operator-owned input and fresh output path validation.
 * Rust remains the only file publisher; these checks grant no write authority.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute} from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/i;

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) ||
      value.includes('\0')) {
    throw new TypeError(label + ' must be an absolute path');
  }
  return value;
}
async function regularFile(path, label) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error(label + '_NOT_REGULAR_FILE');
  }
  return realpath(path);
}
function outputName(name, suffix) {
  if (typeof name !== 'string' || !name || name.length > 128 ||
      name !== basename(name) || name.trim() !== name ||
      /[/\\:<>"|?*\x00-\x1f]/.test(name) ||
      name.startsWith('.') || name.includes('..') ||
      !name.toLowerCase().endsWith(suffix) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('CODE_MODE_OUTPUT_NAME_INVALID');
  }
  return name;
}
async function checkFreshSibling(path, folder) {
  if (await realpath(dirname(path)) !== folder) {
    throw new Error('CODE_MODE_OUTPUT_OUTSIDE_PROJECT');
  }
  try {
    await lstat(path);
    throw new Error('CODE_MODE_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}


export {SHA256,requireAbsolute,regularFile,outputName,checkFreshSibling};
