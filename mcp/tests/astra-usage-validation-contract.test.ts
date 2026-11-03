import { describe, expect, test } from "bun:test";
import {
  summarizeAstraUsage,
  validateAstraUsageDocument,
} from "@/scripts/evaluate/validate-astra-usage";

describe("Astra usage validation contract", () => {
  test("checked-in template starts telemetry-unverified and cannot claim savings", async () => {
    const template = await Bun.file(
      "tests/fixtures/astra-usage-validation-template.json"
    ).json();

    expect(template.schema).toBe("lazydesigner-astra-usage-v1");
    expect(template.proof_scope).toBe("LOCAL_CODE_OR_LIVE_BLOCKBENCH");
    expect(template.source_sha).toBeNull();
    expect(template.model).toBeNull();
    expect(template.telemetry_source).toBeNull();

    const summary = summarizeAstraUsage(template);
    expect(summary.aggregate.measured_pairs).toBe(0);
    expect(summary.aggregate.token_claim_available).toBe(false);
    expect(summary.comparisons[0].comparison_state).toBe("UNAVAILABLE");
  });

  test("token comparison requires source-provided total tokens and PASS quality on both variants", () => {
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        {
          task_id: "A_known_transform",
          variant: "baseline",
          quality_verdict: "PASS",
          task_success: true,
          user_corrections: 1,
          usage: {
            total_tokens: 1000,
            input_tokens: 800,
            cached_input_tokens: 100,
            output_tokens: 200,
            reasoning_tokens: null,
          },
          calls: { total: 4, search: 0, describe: 0, inspect: 2, mutate: 1, verify: 1, recovery: 0 },
        },
        {
          task_id: "A_known_transform",
          variant: "zero_waste",
          quality_verdict: "PASS",
          task_success: true,
          user_corrections: 1,
          usage: {
            total_tokens: 700,
            input_tokens: 550,
            cached_input_tokens: 100,
            output_tokens: 150,
            reasoning_tokens: null,
          },
          calls: { total: 2, search: 0, describe: 0, inspect: 0, mutate: 1, verify: 1, recovery: 0 },
        },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0]).toMatchObject({
      comparison_state: "MEASURED",
      token_claim_available: true,
      total_tokens: {
        baseline: 1000,
        zero_waste: 700,
        delta: 300,
        reduction_percent: 30,
      },
    });
  });

  test("components never synthesize a missing total token count", () => {
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        {
          task_id: "A_known_transform",
          variant: "baseline",
          quality_verdict: "PASS",
          task_success: true,
          user_corrections: 0,
          usage: { total_tokens: null, input_tokens: 800, cached_input_tokens: 100, output_tokens: 200, reasoning_tokens: 50 },
          calls: { total: 2, search: 0, describe: 0, inspect: 0, mutate: 1, verify: 1, recovery: 0 },
        },
        {
          task_id: "A_known_transform",
          variant: "zero_waste",
          quality_verdict: "PASS",
          task_success: true,
          user_corrections: 0,
          usage: { total_tokens: null, input_tokens: 500, cached_input_tokens: 100, output_tokens: 150, reasoning_tokens: 25 },
          calls: { total: 2, search: 0, describe: 0, inspect: 0, mutate: 1, verify: 1, recovery: 0 },
        },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0].token_claim_available).toBe(false);
    expect(summary.aggregate.baseline_total_tokens).toBeNull();
  });

  test("negative or malformed usage is rejected", () => {
    expect(() =>
      validateAstraUsageDocument({
        schema: "lazydesigner-astra-usage-v1",
        proof_scope: "LIVE_BLOCKBENCH",
        source_sha: null,
        model: null,
        telemetry_source: null,
        runs: [
          {
            task_id: "A",
            variant: "baseline",
            quality_verdict: "UNVERIFIED",
            task_success: null,
            user_corrections: null,
            usage: { total_tokens: -1, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null },
            calls: { total: null, search: null, describe: null, inspect: null, mutate: null, verify: null, recovery: null },
          },
        ],
      } as any)
    ).toThrow(/non-negative/);
  });

  test("multi-event task counts source-provided compaction totals", () => {
    const common = {
      task_id: "F_reference_driven_asset",
      quality_verdict: "PASS",
      task_success: true,
      user_corrections: 0,
      usage: { total_tokens: null, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null },
      calls: { total: 4, search: 0, describe: 0, inspect: 1, mutate: 2, verify: 1, recovery: 0 },
    };
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        {
          ...common,
          variant: "baseline",
          model_events: [
            { kind: "response", total_tokens: 800, input_tokens: 600, cached_input_tokens: 100, output_tokens: 200, reasoning_tokens: null },
            { kind: "compaction", total_tokens: 200, input_tokens: 150, cached_input_tokens: 0, output_tokens: 50, reasoning_tokens: null },
          ],
        },
        {
          ...common,
          variant: "zero_waste",
          model_events: [
            { kind: "response", total_tokens: 650, input_tokens: 500, cached_input_tokens: 150, output_tokens: 150, reasoning_tokens: null },
            { kind: "compaction", total_tokens: 100, input_tokens: 80, cached_input_tokens: 0, output_tokens: 20, reasoning_tokens: null },
          ],
        },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0]).toMatchObject({
      comparison_state: "MEASURED",
      total_tokens: {
        baseline: 1000,
        zero_waste: 750,
        delta: 250,
        reduction_percent: 25,
      },
      telemetry: {
        baseline: { event_count: 2, compaction_events: 1 },
        zero_waste: { event_count: 2, compaction_events: 1 },
      },
    });
  });

  test("accepted-result telemetry gates claims when explicitly available", () => {
    const baseRun = {
      task_id: "A_known_transform",
      task_class: "DIRECT",
      quality_verdict: "PASS",
      task_success: true,
      user_corrections: 0,
      usage: {
        total_tokens: 100,
        input_tokens: 80,
        cached_input_tokens: 20,
        output_tokens: 20,
        reasoning_tokens: null,
      },
      calls: {
        total: 1,
        search: 0,
        describe: 0,
        inspect: 0,
        mutate: 1,
        verify: 0,
        recovery: 0,
      },
    };
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        { ...baseRun, variant: "baseline", accepted_result: true },
        {
          ...baseRun,
          variant: "zero_waste",
          accepted_result: false,
          usage: { ...baseRun.usage, total_tokens: 70 },
        },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0].token_claim_available).toBe(false);
  });

  test("duplicate model event IDs are rejected before token aggregation", () => {
    const event = {
      event_id: "resp-1",
      source: "client",
      kind: "response",
      total_tokens: 100,
      input_tokens: 80,
      cached_input_tokens: 20,
      output_tokens: 20,
      reasoning_tokens: null,
    };
    expect(() =>
      validateAstraUsageDocument({
        schema: "lazydesigner-astra-usage-v1",
        proof_scope: "LIVE_BLOCKBENCH",
        source_sha: "abc",
        model: "Codex Astra",
        telemetry_source: "captured-client-telemetry",
        runs: [
          {
            task_id: "A",
            task_class: "DIRECT",
            variant: "baseline",
            quality_verdict: "PASS",
            task_success: true,
            accepted_result: true,
            user_corrections: 0,
            usage: {
              total_tokens: 200,
              input_tokens: null,
              cached_input_tokens: null,
              output_tokens: null,
              reasoning_tokens: null,
            },
            model_events: [event, { ...event }],
            calls: {
              total: 1,
              search: 0,
              describe: 0,
              inspect: 0,
              mutate: 1,
              verify: 0,
              recovery: 0,
            },
          },
        ],
      } as any)
    ).toThrow(/duplicate event_id/);
  });

  test("missing event total prevents a token-saving claim", () => {
    const common = {
      task_id: "A_known_transform",
      quality_verdict: "PASS",
      task_success: true,
      user_corrections: 0,
      usage: { total_tokens: null, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null },
      calls: { total: 1, search: 0, describe: 0, inspect: 0, mutate: 1, verify: 0, recovery: 0 },
    };
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        { ...common, variant: "baseline", model_events: [{ kind: "response", total_tokens: null, input_tokens: 900, cached_input_tokens: 100, output_tokens: 100, reasoning_tokens: 50 }] },
        { ...common, variant: "zero_waste", model_events: [{ kind: "response", total_tokens: 700, input_tokens: 500, cached_input_tokens: 100, output_tokens: 150, reasoning_tokens: 50 }] },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0].token_claim_available).toBe(false);
  });

  test("reports cache efficiency and cost-to-accepted-result dimensions without inventing a score", () => {
    const common = {
      task_id: "D_texture_material_correction",
      quality_verdict: "PASS",
      task_success: true,
      user_corrections: 0,
      calls: { total: 3, search: 0, describe: 0, inspect: 0, mutate: 2, verify: 1, recovery: 0 },
    };
    const doc = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: "abc",
      model: "Codex Astra",
      telemetry_source: "captured-client-telemetry",
      runs: [
        {
          ...common,
          variant: "baseline",
          usage: { total_tokens: 1000, input_tokens: 800, cached_input_tokens: 200, output_tokens: 200, reasoning_tokens: null },
          performance: {
            wall_time_ms: 4200,
            accepted_result_ms: 4200,
            model_latency_ms: 1800,
            tool_latency_ms: 2000,
            image_inputs: 3,
            tool_result_bytes: 12000,
          },
        },
        {
          ...common,
          variant: "zero_waste",
          usage: { total_tokens: 760, input_tokens: 600, cached_input_tokens: 300, output_tokens: 160, reasoning_tokens: null },
          performance: {
            wall_time_ms: 3000,
            accepted_result_ms: 3000,
            model_latency_ms: 1300,
            tool_latency_ms: 1400,
            image_inputs: 2,
            tool_result_bytes: 7000,
          },
        },
      ],
    } as any;

    const summary = summarizeAstraUsage(doc);
    expect(summary.comparisons[0]).toMatchObject({
      comparison_state: "MEASURED",
      performance: {
        baseline: {
          accepted_result_ms: 4200,
          image_inputs: 3,
          tool_result_bytes: 12000,
          cache_efficiency_percent: 25,
        },
        zero_waste: {
          accepted_result_ms: 3000,
          image_inputs: 2,
          tool_result_bytes: 7000,
          cache_efficiency_percent: 50,
        },
      },
    });
    expect(summary).not.toHaveProperty("aggregate_score");
  });

  test("rejects malformed performance telemetry instead of silently coercing it", () => {
    expect(() =>
      validateAstraUsageDocument({
        schema: "lazydesigner-astra-usage-v1",
        proof_scope: "LIVE_BLOCKBENCH",
        source_sha: null,
        model: null,
        telemetry_source: null,
        runs: [
          {
            task_id: "A",
            variant: "baseline",
            quality_verdict: "UNVERIFIED",
            task_success: null,
            user_corrections: null,
            usage: { total_tokens: null, input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null },
            calls: { total: null, search: null, describe: null, inspect: null, mutate: null, verify: null, recovery: null },
            performance: {
              wall_time_ms: -1,
              accepted_result_ms: null,
              model_latency_ms: null,
              tool_latency_ms: null,
              image_inputs: null,
              tool_result_bytes: null,
            },
          },
        ],
      } as any)
    ).toThrow(/performance\.wall_time_ms.*non-negative/);
  });

  test("optional per-run Gateway trace digest must be an exact lowercase SHA-256", () => {
    const input = {
      schema: "lazydesigner-astra-usage-v1",
      proof_scope: "LIVE_BLOCKBENCH",
      source_sha: null,
      model: null,
      telemetry_source: null,
      runs: [{
        task_id: "A_known_transform",
        variant: "baseline",
        quality_verdict: "UNVERIFIED",
        task_success: null,
        user_corrections: null,
        gateway_trace_sha256: "not-the-actual-file-hash",
        usage: {
          total_tokens: null, input_tokens: null, cached_input_tokens: null,
          output_tokens: null, reasoning_tokens: null,
        },
        calls: {
          total: null, search: null, describe: null,
          inspect: null, mutate: null, verify: null, recovery: null,
        },
      }],
    } as any;
    expect(() => validateAstraUsageDocument(input)).toThrow("gateway_trace_sha256");
    input.runs[0].gateway_trace_sha256 = "a".repeat(64);
    expect(() => validateAstraUsageDocument(input)).not.toThrow();
  });

  test("live Golden manifest covers A-F and keeps quality before efficiency", async () => {
    const manifest = await Bun.file(
      "tests/fixtures/astra-live-golden-tasks.json"
    ).json();

    expect(manifest.schema).toBe("lazydesigner-live-golden-tasks-v1");
    expect(manifest.proof_scope).toBe("LIVE_BLOCKBENCH");
    expect(manifest.quality_precedes_efficiency).toBe(true);
    expect(manifest.aggregate_score).toBe(false);
    expect(manifest.tasks.map((task: any) => task.id)).toEqual([
      "A_known_transform",
      "B_unknown_target_edit",
      "C_component_create",
      "D_texture_material_correction",
      "E_animation_correction",
      "F_reference_driven_asset",
    ]);
  });
});