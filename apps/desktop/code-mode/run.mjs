#!/usr/bin/env node
/**
 * Operator-owned entrypoint for a standalone Rust Code Mode run.
 *
 * Default read-only. Writes require an actual interactive TTY confirmation
 * for EACH exact SDK mutation; this cannot replace host/OS permissions.
 * Use from a verified local-PC agent only after its held phase is released.
 * This file is source-authored, NOT_EXECUTED.
 */
import { readFile, lstat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { createCodeModeHost } from './host.mjs';

function parseArgs(argv) {
  const accepted = new Set([
    '--rust', '--deno', '--input', '--output-dir', '--code', '--png', '--approve-interactive',
  ]);
  const out = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!accepted.has(key) || Object.hasOwn(out, key)) {
      throw new Error('CODE_MODE_CLI_OPTION_INVALID');
    }
    if (key === '--approve-interactive') {
      out[key] = true;
    } else {
      const next = argv[++i];
      if (typeof next !== 'string' || !next || next.startsWith('--')) {
        throw new Error('CODE_MODE_CLI_OPTION_VALUE_REQUIRED');
      }
      out[key] = next;
    }
  }
  for (const key of ['--rust', '--deno', '--code']) {
    if (typeof out[key] !== 'string') {
      throw new Error('CODE_MODE_CLI_OPTION_REQUIRED_' + key.slice(2));
    }
  }
  if ((out['--input'] === undefined) ===
      (out['--output-dir'] === undefined)) {
    throw new Error('CODE_MODE_CLI_REQUIRE_EXACTLY_ONE_SOURCE_OR_OUTPUT_DIR');
  }
  return out;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args['--code'];
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.size > 32 * 1024) {
    throw new Error('CODE_MODE_SCRIPT_FILE_INVALID');
  }
  const code = await readFile(source, 'utf8');
  const interactive = args['--approve-interactive'] === true;
  if (interactive && !process.stdin.isTTY) {
    throw new Error('CODE_MODE_APPROVAL_REQUIRES_INTERACTIVE_TTY');
  }
  const rl = interactive ? createInterface({
    input: process.stdin, output: process.stderr,
  }) : null;
  try {
    const authorizeMutation = interactive ? async (request) => {
      const challenge = randomBytes(4).toString('hex');
      process.stderr.write('\nLazyDesigner Code Mode write request:\n');
      process.stderr.write(JSON.stringify({
        operation: request.operation, input: request.input ?? null,
        output: request.output, png: request.png ?? null,
        source_sha256: request.expectedSha256 ?? null,
        plan_sha256: request.planSha256 ?? null,
        operation_kinds: request.operationKinds ?? null,
        operation_count: request.operationCount ?? null,
      }, null, 2) + '\n');
      process.stderr.write('Review the intended effects and file path first.\n');
      const answer = await rl.question(
        'Type APPROVE ' + challenge + ' for this write, otherwise deny: ',
      );
      return answer.trim() === 'APPROVE ' + challenge;
    } : undefined;
    const host = await createCodeModeHost({
      rustBinary: args['--rust'], denoBinary: args['--deno'],
      ...(args['--input'] ? { input: args['--input'] }
        : { outputDirectory: args['--output-dir'] }),
      authorizeMutation,
      ...(args['--png'] ? { preselectedPngPath: args['--png'] } : {}),
    });
    const response = await host.execute({ code });
    process.stdout.write(JSON.stringify(response) + '\n');
  } finally {
    rl?.close();
  }
}
main().catch((error) => {
  const code = String(error?.message ?? error).slice(0, 200);
  process.stderr.write(JSON.stringify({
    status: 'ERROR', code,
  }) + '\n');
  process.exitCode = 2;
});
