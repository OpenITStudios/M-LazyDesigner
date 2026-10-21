import { describe, expect, test } from "bun:test";

describe("Runtime project-affinity dispatch ordering", () => {
  test("Stage request scoping is inside native serialization and no post-queue switch can race a newer call", async () => {
    const [source, phase] = await Promise.all([
      Bun.file("server/net.ts").text(),
      Bun.file("server/runtime/phaseControl.ts").text(),
    ]);
    const queue = source.indexOf("runRuntimeOperationExclusive(generation, async () => {");
    const scoped = source.indexOf("runWithMcpStageRequest(", queue);
    const end = source.indexOf("}, { signal: nativeRequestAbort.signal })", scoped);
    expect(queue).toBeGreaterThan(-1);
    expect(scoped).toBeGreaterThan(queue);
    expect(end).toBeGreaterThan(scoped);
    expect(source).not.toContain("requestMcpPhaseSwitch(envelope.targetAuthoringPhase)");
    expect(phase).toContain("if (!requestStage?.scoped) requestMcpStageSwitch(target_phase)");
    expect(phase).toContain("requestStage = prior");
  });

  test("queued direct tool calls read current Stage and profile after earlier handoffs", async () => {
    const source = await Bun.file("server/net.ts").text();
    const queue = source.indexOf("runRuntimeOperationExclusive(generation, async () => {");
    const stageRead = source.indexOf("requestedAuthoringPhase ?? getActiveMcpAuthoringStage()", queue);
    const profileRead = source.indexOf("const executionProfile = getActiveMcpRegistrationProfile()", queue);
    const execution = source.indexOf("() => dispatch(executionPhase, executionProfile)", queue);
    const done = source.indexOf("}, { signal: nativeRequestAbort.signal })", execution);
    expect(stageRead).toBeGreaterThan(queue);
    expect(profileRead).toBeGreaterThan(stageRead);
    expect(execution).toBeGreaterThan(profileRead);
    expect(done).toBeGreaterThan(execution);
    expect(source).toContain("dispatch(effectiveAuthoringPhase, activeProfile)");
  });

  test("queued tool calls re-check socket liveness before entering native project dispatch", async () => {
    const source = await Bun.file("server/net.ts").text();
    const queue = source.indexOf("runRuntimeOperationExclusive(generation, async () => {");
    const liveness = source.indexOf("request.aborted ||", queue);
    const responseLiveness = source.indexOf("response.destroyed ||", liveness);
    const shutdownLiveness = source.indexOf("shuttingDown", responseLiveness);
    const dispatch = source.indexOf("runWithMcpStageRequest(", shutdownLiveness);
    const abandonedCatch = source.indexOf(
      "error instanceof RuntimeRequestAbandonedError",
      dispatch
    );
    const retiredCatch = source.indexOf(
      "error instanceof RuntimeGenerationRetiredError",
      abandonedCatch
    );
    const projectErrorCatch = source.indexOf(
      "error instanceof RuntimeProjectContextError",
      retiredCatch
    );

    expect(queue).toBeGreaterThan(-1);
    expect(liveness).toBeGreaterThan(queue);
    expect(responseLiveness).toBeGreaterThan(liveness);
    expect(shutdownLiveness).toBeGreaterThan(responseLiveness);
    expect(dispatch).toBeGreaterThan(shutdownLiveness);
    expect(abandonedCatch).toBeGreaterThan(dispatch);
    expect(retiredCatch).toBeGreaterThanOrEqual(abandonedCatch);
    expect(projectErrorCatch).toBeGreaterThan(retiredCatch);
  });
});
