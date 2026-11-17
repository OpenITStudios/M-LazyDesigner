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
import {readOperatorVisualManifest, createTrustedProgramReviewer} from './trusted-visual-reviewer.mjs';

function parseArgs(argv) {
  const accepted = new Set([
    '--rust', '--deno', '--input', '--output-dir', '--code', '--png',
    '--visual-manifest', '--reviewer-exe', '--approve-interactive',
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
  if (out['--reviewer-exe']!==undefined &&
      out['--visual-manifest']===undefined) {
    throw new Error('CODE_MODE_REVIEWER_REQUIRES_VISUAL_MANIFEST');
  }
  if (out['--visual-manifest']!==undefined &&
      out['--input']===undefined) {
    throw new Error('CODE_MODE_VISUAL_REVIEW_REQUIRES_EXISTING_MODEL');
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
        material_work_packet_sha256: request.materialWorkPacketSha256 ?? null,
        material_work_packet:request.materialWorkPacket?{
          cohort:request.materialWorkPacket.partId,
          issue:request.materialWorkPacket.issueId,
          shading_intent:request.materialWorkPacket.shadingIntent,
          style_intent:request.materialWorkPacket.styleIntent,
          light_direction:request.materialWorkPacket.lightDirection,
          planned_cube_faces:request.materialWorkPacket.facePlans.map(face=>({
            cube_uuid:face.cubeUuid,face:face.face,
            atlas_region:face.atlasRegion,
          })),
        }:null,
        operation_kinds: request.operationKinds ?? null,
        operation_count: request.operationCount ?? null,
      }, null, 2) + '\n');
      process.stderr.write('Review the intended effects and file path first.\n');
      const answer = await rl.question(
        'Type APPROVE ' + challenge + ' for this write, otherwise deny: ',
      );
      return answer.trim() === 'APPROVE ' + challenge;
    } : undefined;
    // Operator owns both the selected views and the explicitly installed
    // reviewer executable. The model-written Deno guest never chooses either.
    // No configured executable means source-only inspection, not visual PASS.
    const preselectedVisualPair=args['--visual-manifest']===undefined ?
      undefined:await readOperatorVisualManifest(args['--visual-manifest']);
    const reviewVisualPair=args['--reviewer-exe']===undefined ?
      undefined:await createTrustedProgramReviewer(args['--reviewer-exe']);
    const host = await createCodeModeHost({
      rustBinary: args['--rust'], denoBinary: args['--deno'],
      ...(preselectedVisualPair?{preselectedVisualPair}:{}),
      ...(reviewVisualPair?{reviewVisualPair}:{}),
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
