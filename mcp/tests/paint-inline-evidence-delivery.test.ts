import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { assessInlinePaintImageEvidence } from "@/lib/texture/inlinePaintImageEvidence";
import { maybeDeferPaintCohortImage } from "@/gateway/presentation/paintEvidenceDelivery";
import { buildControlDelta, reduceControlExecutionState } from "@/gateway/control";

// Valid 1x1 RGBA PNG generated independently; text metadata never includes
// the actual color. Transport verification does NOT decode visual meaning.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOoMr/+HwAFPwKIuAByCAAAAABJRU5ErkJggg==",
  "base64"
);
const revision = "sha256:1x1:" + "a".repeat(64);
const visualEvidence = () => ({
  execution: "applied",
  texture: {uuid:"texture-a",name:"atlas"},
  revision:{before:"sha256:1x1:"+"b".repeat(64),after:revision},
  operation_count:1,pixel_writes:1,
  affected_rect:[0,0,1,1],
  affected_size:[1,1],
  visual_evidence:{
    kind:"affected_region_png",
    affected_rect:[0,0,1,1],
    revision,width:1,height:1,
    image_sha256:createHash("sha256").update(PNG).digest("hex"),
    png_bytes:PNG.byteLength,
  },
});
const content = () => [
  {type:"text",text:
    'Applied 1 texture operation(s) as one Undo transaction on "atlas". The attached PNG is the exact affected atlas region after mutation.'},
  {type:"image",mimeType:"image/png",data:PNG.toString("base64")},
];
function delta(result:unknown, c:unknown) {
  return buildControlDelta({
    capability:"paint_texture_transaction",
    phaseBefore:"texturing",phaseAfter:"texturing",
    projectUuid:"project-a",succeeded:true,
    result,content:c,
  });
}

describe("paint image transport and cohort image economy",()=>{
  test("matches actual encoded bytes, frame and pinned current revision",()=>{
    const check=assessInlinePaintImageEvidence(visualEvidence(),content());
    expect(check.state).toBe("MATCHED");
    expect(delta(visualEvidence(),content()).verification_scope).toMatchObject({
      kind:"TEXTURE_REGION",evidence_source:"mutation_response",
    });
    expect(reduceControlExecutionState(
      null,delta(visualEvidence(),content())
    ).continuation.next_action.kind).toBe("REVIEW_RETURNED_EVIDENCE");
  });
  test("metadata alone cannot create model-consumed evidence",()=>{
    const d=delta(visualEvidence(),undefined);
    expect(d.verification_scope).toMatchObject({
      evidence_source:"follow_up_read",
    });
    expect(reduceControlExecutionState(
      null,d
    ).continuation.next_action).toMatchObject({
      kind:"VERIFY_VISUAL",recommended_capability:"get_texture",
    });
  });
  test("mismatched hash, dimensions, PNG count, and MIME fail closed",()=>{
    const bad=[
      [ {...visualEvidence(),visual_evidence:{
        ...visualEvidence().visual_evidence,image_sha256:"f".repeat(64),
      }}, content()],
      [ {...visualEvidence(),visual_evidence:{
        ...visualEvidence().visual_evidence,width:2,
      }}, content()],
      [ visualEvidence(),[...content(),content()[1]] ],
      [ visualEvidence(),[content()[0],{...content()[1]!,mimeType:"image/jpeg"}] ],
      [ visualEvidence(),[content()[0],{...content()[1]!,data:"aGVsbG8="}] ],
      [ visualEvidence(),[] ],
    ] as const;
    for(const [receipt,pixels] of bad){
      expect(assessInlinePaintImageEvidence(receipt,pixels).state).toBe("UNVERIFIED");
      expect(delta(receipt,pixels).verification_scope).toMatchObject({
        evidence_source:"follow_up_read",
      });
    }
  });
  test("default, COMPLETE and failed mutations preserve original PNG",()=>{
    const base={capability:"paint_texture_transaction",succeeded:true,
      projectUuid:"project-a",structuredContent:visualEvidence(),content:content()};
    expect(maybeDeferPaintCohortImage(base)).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,
      taskContextId:"cohort",cohortBoundary:"COMPLETE"})).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,
      taskContextId:"cohort",cohortBoundary:"CONTINUE",succeeded:false})).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,
      taskContextId:"",cohortBoundary:"CONTINUE"})).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,
      capability:"capture_model_views",taskContextId:"cohort",
      cohortBoundary:"CONTINUE"})).toBe(base.content);
  });
  test("unverified native project identity cannot suppress a verified PNG",()=>{
    const base={capability:"paint_texture_transaction",succeeded:true,
      taskContextId:"cohort",cohortBoundary:"CONTINUE" as const,
      structuredContent:visualEvidence(),content:content()};
    expect(maybeDeferPaintCohortImage({...base,projectUuid:null})).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,projectUuid:""})).toBe(base.content);
    expect(maybeDeferPaintCohortImage({...base,projectUuid:"project-a"}))
      .not.toBe(base.content);
  });
  test("only explicitly deferred intermediate image is omitted; visual debt remains",()=>{
    const raw=content();
    const deferred=maybeDeferPaintCohortImage({
      capability:"paint_texture_transaction",succeeded:true,
      taskContextId:"cohort",cohortBoundary:"CONTINUE",projectUuid:"project-a",
      structuredContent:visualEvidence(),content:raw,
    }) as Array<{type:string;text?:string}>;
    expect(deferred).toHaveLength(1);
    expect(deferred[0].type).toBe("text");
    expect(deferred[0].text).toContain("visual review remains required");
    expect(raw).toHaveLength(2);
    expect(delta(visualEvidence(),deferred).verification_scope).toMatchObject({
      evidence_source:"follow_up_read",
    });

    const first=reduceControlExecutionState(null,delta(visualEvidence(),deferred),
      {taskContextId:"cohort",cohortBoundary:"CONTINUE"});
    expect(first.continuation.next_action.kind).toBe("CONTINUE");
    const second=reduceControlExecutionState(first.state,delta(visualEvidence(),content()),
      {taskContextId:"cohort",cohortBoundary:"COMPLETE"});
    expect(second.continuation.next_action).toMatchObject({
      kind:"REVIEW_RETURNED_EVIDENCE",
      verification_scope:{evidence_source:"mutation_response"},
    });
  });
  test("unverified or malformed producer payload never gets silently dropped",()=>{
    const fake={...visualEvidence(),visual_evidence:{
      ...visualEvidence().visual_evidence,image_sha256:"0".repeat(64),
    }};
    const raw=content();
    expect(maybeDeferPaintCohortImage({
      capability:"paint_texture_transaction",succeeded:true,
      taskContextId:"cohort",cohortBoundary:"CONTINUE",projectUuid:"project-a",
      structuredContent:fake,content:raw,
    })).toBe(raw);
  });
});
