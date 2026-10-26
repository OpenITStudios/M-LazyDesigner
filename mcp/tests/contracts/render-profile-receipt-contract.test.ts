import { describe, expect, test } from "bun:test";
import {
  isRenderProfileMutationReceipt,
  isRenderProfileNoWriteReceipt,
  renderProfileWriteReceiptSchema,
} from "@/lib/receipts/renderProfile";

const write = {
  key: "render_controller" as const,
  path: "/rp/render_controllers/example.render_controllers.json",
  byte_length: 128,
  replaced_existing: true,
  transaction: "single_atomic" as const,
};

describe("shared render-profile receipt contract", () => {
  test("accepts verified assign, set-slot and bind receipts", () => {
    expect(
      isRenderProfileMutationReceipt({
        execution: "applied",
        action: "render_profile",
        operation: "assign",
        write,
        render_controller: "controller.render.example",
        bone_pattern: "body*",
        slot: "default",
      })
    ).toBe(true);

    expect(
      isRenderProfileMutationReceipt({
        execution: "applied",
        action: "render_profile",
        operation: "set_slot",
        slot: "default",
        render_profile: "opaque",
        minecraft_material_code: "entity",
        write: {
          ...write,
          key: "client_entity",
        },
        summary: {
          slots: [],
          diagnostics: [],
        },
      })
    ).toBe(true);

    expect(
      isRenderProfileMutationReceipt({
        execution: "applied",
        action: "render_profile",
        operation: "bind",
        binding: {
          slot: "default",
          minecraft_material_code: "entity",
        },
        write_transaction: {
          state: "paired_atomic",
          write_count: 2,
        },
        client_entity_write: {
          ...write,
          key: "client_entity",
          transaction: "paired_atomic",
        },
        render_controller_write: {
          ...write,
          transaction: "paired_atomic",
        },
        summary: {
          slots: [],
          assignments: [],
          diagnostics: [],
        },
      })
    ).toBe(true);
  });

  test("source-owned zero-write receipt cannot hide an actual resource write", () => {
    const compiledBind = {
      execution: "applied",
      action: "render_profile",
      operation: "bind",
      binding: { slot: "default", minecraft_material_code: "entity" },
      write_transaction: { state: "compile_only", write_count: 0 },
      client_entity_write: null,
      render_controller_write: null,
    };
    expect(isRenderProfileNoWriteReceipt(compiledBind)).toBe(true);
    expect(isRenderProfileNoWriteReceipt({
      ...compiledBind,
      write_transaction: { state: "paired_atomic", write_count: 2 },
    })).toBe(false);
    expect(isRenderProfileNoWriteReceipt({
      ...compiledBind,
      client_entity_write: write,
    })).toBe(false);
    expect(isRenderProfileNoWriteReceipt({
      execution: "applied", action: "render_profile", operation: "set_slot",
      slot: "default", write: null,
    })).toBe(true);
    expect(isRenderProfileNoWriteReceipt({
      execution: "applied", action: "render_profile", operation: "assign",
      slot: "default", render_controller: "controller.render.example",
      bone_pattern: "body*", write: null,
    })).toBe(true);
    expect(isRenderProfileNoWriteReceipt({
      execution: "applied", action: "render_profile", operation: "unassign",
      slot: null, render_controller: "controller.render.example",
      bone_pattern: "body*", write: null,
    })).toBe(true);
    expect(isRenderProfileNoWriteReceipt({
      execution: "applied", action: "render_profile", operation: "assign",
      slot: "default", write: null,
    })).toBe(false);
    expect(isRenderProfileNoWriteReceipt({ execution: "read" })).toBe(false);
  });

  test("rejects incomplete writes and mismatched bind transactions", () => {
    expect(
      renderProfileWriteReceiptSchema.safeParse({
        path: "/tmp/file.json",
        byte_length: 128,
      }).success
    ).toBe(false);

    expect(
      isRenderProfileMutationReceipt({
        execution: "applied",
        action: "render_profile",
        operation: "bind",
        binding: {
          slot: "default",
          minecraft_material_code: "entity",
        },
        write_transaction: {
          state: "paired_atomic",
          write_count: 2,
        },
        client_entity_write: {
          ...write,
          key: "client_entity",
          transaction: "paired_atomic",
        },
        render_controller_write: null,
        summary: {
          slots: [],
          assignments: [],
          diagnostics: [],
        },
      })
    ).toBe(false);
  });

  test("Runtime write funnel and Control share the Render Profile receipt owner", async () => {
    const producer = await Bun.file("server/tools/texture/renderProfile.ts").text();
    const control = await Bun.file("gateway/control/delta/receipts.ts").text();

    expect(producer).toContain(
      'from "@/lib/receipts/renderProfile"'
    );
    expect(producer).toContain("renderProfileWriteReceiptSchema.parse({");
    expect(control).toContain(
      'from "../../../lib/receipts/renderProfile"'
    );
    expect(control).toContain("receiptMatches(value, isRenderProfileMutationReceipt)");
  });
});