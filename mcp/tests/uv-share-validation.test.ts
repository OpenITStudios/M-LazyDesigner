import { describe, expect, test } from "bun:test";
import { planSemanticUv } from "@/lib/uv/semanticPlanner";

describe("semantic UV share validation",()=>{
  test("rejects shared islands whose resolved pixel extents differ",()=>{
    expect(()=>planSemanticUv([
      {id:"left",world_size:[2,4],cohort:"base"},
      {id:"right",world_size:[3,4],cohort:"base",share_with:"left"},
    ],{
      atlas_width:32,atlas_height:32,default_texel_density:1
    })).toThrow("identical pixel extents");
  });

  test("a UNIQUE source cannot be aliased, while reusable sources can", () => {
    expect(() => planSemanticUv([
      { id: "emblem", world_size: [2, 2], cohort: "identity", reuse_policy: "UNIQUE" },
      { id: "arm", world_size: [2, 2], cohort: "identity", share_with: "emblem" },
    ], {
      atlas_width: 16, atlas_height: 16, default_texel_density: 1,
    })).toThrow("identity-unique source");
    const shared = planSemanticUv([
      { id: "pattern", world_size: [2, 2], cohort: "cloth" },
      { id: "arm", world_size: [2, 2], cohort: "cloth", share_with: "pattern" },
    ], { atlas_width: 16, atlas_height: 16, default_texel_density: 1 });
    expect(shared.placements.find((item) => item.id === "arm")?.shared_with).toBe("pattern");
  });

  test("rejects duplicate previous placement identities",()=>{
    expect(()=>planSemanticUv([
      {id:"a",world_size:[2,2],cohort:"base"},
    ],{
      atlas_width:16,atlas_height:16,default_texel_density:1,
      affected_ids:[],
      previous_placements:[
        {id:"a",x:0,y:0,width:2,height:2,rotated:false},
        {id:"a",x:4,y:0,width:2,height:2,rotated:false},
      ],
    })).toThrow("unique non-empty IDs");
  });
});
