import {
  buildAffectedExecutionPlan,
  parseAffectedExecutionArguments,
} from "./plan-affected-execution";

function commandArgv(command: string): string[] {
  if (command.startsWith("bun run ")) {
    const script = command.slice("bun run ".length).trim();
    if (!script || /\s/.test(script)) {
      throw new Error(`Unsupported affected run command: ${command}`);
    }
    return [process.execPath, "run", script];
  }

  if (command.startsWith("bun test ")) {
    const files = command
      .slice("bun test ".length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (files.length === 0) {
      throw new Error(`Affected test command has no files: ${command}`);
    }
    return [process.execPath, "test", ...files];
  }

  throw new Error(`Unsupported affected verification command: ${command}`);
}

export async function runAffectedCommand(command: string): Promise<void> {
  const child = Bun.spawn(commandArgv(command), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Affected verification command failed with exit code ${exitCode}: ${command}`
    );
  }
}

/**
 * Source tests alone cannot qualify a routing implementation change if its
 * canonical semantic revision was not tracked. Detect this before invoking
 * Bun so no check result is mistaken for full source acceptance.
 */
export function assertSemanticSourceAlignedForAffectedRun(
  plan: ReturnType<typeof buildAffectedExecutionPlan>
): void {
  const alignment = plan.semantic_source_alignment;
  // Manifest revisions alone do not fingerprint executable ranking/graph.
  // Even an observed manifest change cannot authorize matching source proof.
  if (!alignment) return;
  throw new Error(
    `SEMANTIC_REVISION_UNVERIFIED: ${alignment.status}. ` +
    "Manifest-only changes cannot prove executable routing/graph coverage. " +
    "Synchronize the canonical implementation revision and generated API " +
    "with a prior semantic snapshot before rerunning. No checks were executed."
  );
}

async function main() {
  const { changedPaths, previousSemanticRegistry } =
    await parseAffectedExecutionArguments(process.argv.slice(2));
  const plan = buildAffectedExecutionPlan(changedPaths, previousSemanticRegistry);

  console.log(
    JSON.stringify(
      {
        changed_paths: plan.execution.changed_paths,
        checks: plan.execution.checks,
        targeted_tests: plan.execution.targeted_tests,
        fallback_full_verify: plan.execution.fallback_full_verify,
        ...(plan.semantic_source_alignment
          ? { semantic_source_alignment: plan.semantic_source_alignment }
          : {}),
      },
      null,
      2
    )
  );

  // The plan-only command remains available to inspect unresolved changes.
  assertSemanticSourceAlignedForAffectedRun(plan);

  for (const command of plan.execution.commands) {
    console.log(`[affected] ${command}`);
    await runAffectedCommand(command);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
