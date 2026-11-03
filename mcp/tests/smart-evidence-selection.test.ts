import { describe, expect, test } from "bun:test";
import { planFocusedTextureEvidenceRequest } from "@/gateway/control/evidenceSelection";
import { buildControlDelta, reduceControlExecutionState } from "@/gateway/control";
import type { ControlVerificationScope } from "@/gateway/control/types";
const revision="sha256:128x128:"+"a".repeat(64);
const focus:ControlVerificationScope={
  kind:"TEXTURE_REGION",texture_uuid:"atlas-a",
  affected_rect:[8,16,24,48],revision,evidence_source:"follow_up_read",
};
describe("smart Texture evidence selection",()=>{
  test("converts the native right-exclusive rectangle to exact get_texture arguments",()=>{
    expect(planFocusedTextureEvidenceRequest(focus)).toEqual({
      capability:"get_texture",
      args:{texture:"atlas-a",region:{x:8,y:16,width:16,height:32},
        expected_revision:revision},
      source:"CURRENT_TEXTURE_VERIFICATION_SCOPE",
      automatic_call:false,
      authorizes_visual_pass:false,
    });
  });
  test("invalid, already-returned and non-texture evidence never becomes a suggested read",()=>{
    expect(planFocusedTextureEvidenceRequest({...focus,evidence_source:"mutation_response"})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,revision:"unverified"})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,affected_rect:[24,0,8,10]})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,affected_rect:[120,0,129,8]})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,affected_rect:[0,120,8,129]})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,revision:"sha256:0x128:"+"b".repeat(64)})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({...focus,revision:"sha256:999999999999999999999x128:"+"b".repeat(64)})).toBeNull();
    expect(planFocusedTextureEvidenceRequest({
      ...focus,affected_rect:[112,112,128,128],
    })?.args.region).toEqual({x:112,y:112,width:16,height:16});
    expect(planFocusedTextureEvidenceRequest(null)).toBeNull();
  });
  test("native mutation Control continuation carries the exact focused request but does not execute",()=>{
    const delta=buildControlDelta({
      capability:"paint_texture_transaction",projectUuid:"project-a",
      phaseBefore:"texturing",phaseAfter:"texturing",succeeded:true,
      result:{execution:"applied",texture:{uuid:"atlas-a",name:"atlas"},
        revision:{before:"sha256:128x128:"+"b".repeat(64),after:revision},
        affected_rect:[8,16,24,48],affected_size:[16,32],
        operation_count:1,pixel_writes:512,visual_evidence:null},
    });
    const action=reduceControlExecutionState(null,delta).continuation.next_action;
    expect(action).toMatchObject({
      kind:"VERIFY_VISUAL",recommended_capability:"get_texture",
      evidence_request:{
        args:{texture:"atlas-a",region:{x:8,y:16,width:16,height:32},
          expected_revision:revision},
        automatic_call:false,authorizes_visual_pass:false,
      },
    });
  });
});
