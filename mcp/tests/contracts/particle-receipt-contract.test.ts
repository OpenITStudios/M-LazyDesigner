import { describe, expect, test } from "bun:test";
import {
  isVerifiedParticleWriteReceipt,
  particleMutationReceipt,
} from "@/lib/receipts/particleMutation";

const summary = {
  identifier: "blockit:spark",
  component_count: 2,
  diagnostics: [],
};

describe("shared particle mutation receipt contract", () => {
  test("accepts a verified particle write as receipt-only evidence", () => {
    const receipt = particleMutationReceipt({
      valid: true,
      artifact_ready: true,
      source_path: null,
      wrote_to_path: "/pack/particles/spark.json",
      preview_path: null,
      preview_error: null,
      byte_length: 128,
      operation_count: 1,
      summary,
      writes: [
        {
          kind: "particle",
          path: "/pack/particles/spark.json",
          byte_length: 128,
          replaced_existing: false,
        },
      ],
    });

    expect(isVerifiedParticleWriteReceipt(receipt)).toBe(true);
  });

  test("texture handoff and preview-only results do not claim verified write completion", () => {
    const handoff = particleMutationReceipt({
      valid: true,
      artifact_ready: false,
      source_path: null,
      wrote_to_path: null,
      preview_path: null,
      preview_error: null,
      byte_length: 128,
      operation_count: 1,
      summary,
      writes: [],
      texture_dependency: {
        status: "REQUIRES_TEXTURING",
      },
    });
    expect(isVerifiedParticleWriteReceipt(handoff)).toBe(false);

    const previewOnly = particleMutationReceipt({
      valid: true,
      artifact_ready: true,
      source_path: "/pack/particles/spark.json",
      wrote_to_path: null,
      preview_path: "/pack/particles/spark.json",
      preview_error: null,
      byte_length: 128,
      operation_count: 1,
      summary,
      writes: [],
    });
    expect(isVerifiedParticleWriteReceipt(previewOnly)).toBe(false);
  });

  test("rejects write receipts that do not prove the exact written path", () => {
    expect(
      isVerifiedParticleWriteReceipt({
        valid: true,
        artifact_ready: true,
        source_path: null,
        wrote_to_path: "/pack/particles/spark.json",
        preview_path: null,
        preview_error: null,
        byte_length: 128,
        operation_count: 1,
        summary,
        writes: [
          {
            kind: "particle",
            path: "/pack/particles/other.json",
            byte_length: 128,
            replaced_existing: false,
          },
        ],
      })
    ).toBe(false);
  });

  test("Runtime and Control share the particle receipt owner", async () => {
    const producer = await Bun.file("server/tools/particle/manage.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain(
      'from "@/lib/receipts/particleMutation"'
    );
    expect(producer).toContain("structuredContent: particleMutationReceipt({");
    expect(control).toContain(
      'from "../../../lib/receipts/particleMutation"'
    );
    expect(control).toContain("receiptMatches(value, isVerifiedParticleWriteReceipt)");
  });
});