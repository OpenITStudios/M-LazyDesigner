import { describe, expect, test } from "bun:test";
import { validateNativeUvTransactionPlan } from "@/lib/uv/nativeTransaction";

describe("native semantic UV transaction contract", () => {
  test("preserves full native face quarter-turn values in validated transactions", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(() => validateNativeUvTransactionPlan({
        expected_fingerprint: "pinned-source",
        operations: [
          { island_id: "arm", cube_uuid: "cube", face: "north",
            uv: [8, 6, 4, 2], rotation },
        ],
      })).not.toThrow();
    }
    expect(() => validateNativeUvTransactionPlan({
      expected_fingerprint: "pinned-source",
      operations: [
        { island_id: "arm", cube_uuid: "cube", face: "north",
          uv: [0, 0, 4, 4], rotation: 45 as never },
      ],
    })).toThrow("unsupported face rotation");
  });


  test("rejects duplicate face mutation and non-finite coordinates", () => {
    expect(() => validateNativeUvTransactionPlan({
      expected_fingerprint: "state",
      operations: [
        { island_id: "a", cube_uuid: "cube", face: "north", uv: [0,0,4,4], rotation: 0 },
        { island_id: "b", cube_uuid: "cube", face: "north", uv: [4,0,8,4], rotation: 0 },
      ],
    })).toThrow("same Cube face twice");

    expect(() => validateNativeUvTransactionPlan({
      expected_fingerprint: "state",
      operations: [
        { island_id: "a", cube_uuid: "cube", face: "north", uv: [0,0,Number.NaN,4], rotation: 0 },
      ],
    })).toThrow("non-finite");
  });
});
