import { describe,expect,test } from "bun:test";
import { planTemporalImageEvidence } from "@/lib/animation/temporalEvidenceSampling";
const track=(times:number[],angles:number[])=>({
  group_uuid:"arm",group_name:"Arm",channel:"rotation" as const,
  keyframes:times.map((time,i)=>({time,value:[angles[i],0,0],data_point_count:1})),
});
describe("bounded candidate times for image evidence",()=>{
  test("finds rapid change without uniform screenshot cadence",()=>{
    const p=planTemporalImageEvidence({
      duration_seconds:1,max_frames:3,
      tracks:[track([0,0.3,0.4,1],[0,0,90,90])],
    });
    expect(p.state).toBe("CANDIDATE_ONLY");
    expect(p.suggested_times_seconds).toEqual([0,0.35,1]);
    expect(p.visual_pass_authorized).toBe(false);
  });
  test("enforces frame budget and chronological output",()=>{
    const p=planTemporalImageEvidence({
      duration_seconds:2,max_frames:5,
      tracks:[track([0,0.1,0.2,0.3,0.4,1.5,2],[0,20,45,90,0,40,0])],
    });
    expect(p.suggested_times_seconds.length).toBeLessThanOrEqual(5);
    expect(p.suggested_times_seconds.at(0)).toBe(0);
    expect(p.suggested_times_seconds.at(-1)).toBe(2);
    expect(p.suggested_times_seconds).toEqual(
      [...p.suggested_times_seconds].sort((a,b)=>a-b));
  });
  test("does not infer motion through unsupported numeric inputs",()=>{
    const p=planTemporalImageEvidence({
      duration_seconds:1,tracks:[{group_uuid:"g",group_name:"g",
      channel:"rotation",keyframes:[
        {time:0,value:["math.sin(t)",0,0],data_point_count:1},
        {time:0.5,value:[0,20,0],data_point_count:2},
        {time:0.5,value:[0,30,0],data_point_count:1},
        {time:1,value:[0,40,0],data_point_count:1},
      ]}],
    });
    expect(p.state).toBe("CANDIDATE_ONLY");
    if(p.state==="CANDIDATE_ONLY"){
      expect(p.unresolved_segments).toBeGreaterThan(0);
      expect(p.numeric_segments).toBe(1);
      expect(p.interpolated_pose_evaluated).toBe(false);
    }
  });
  test("a full 360-degree authored rotation is not misclassified as a static pose",()=>{
    const p=planTemporalImageEvidence({
      duration_seconds:1,max_frames:3,
      tracks:[track([0,1],[0,360])],
    });
    expect(p.state).toBe("CANDIDATE_ONLY");
    expect(p.suggested_times_seconds).toEqual([0,0.5,1]);
  });
  test("unsupported-only and submicrosecond clips fail closed",()=>{
    expect(planTemporalImageEvidence({
      duration_seconds:1,
      tracks:[{group_uuid:"expr",group_name:"Expression",channel:"rotation",
        keyframes:[{time:0,value:["math.sin(t)",0,0],data_point_count:1},
          {time:1,value:["math.cos(t)",0,0],data_point_count:1}]}],
    }).state).toBe("UNAVAILABLE");
    expect(planTemporalImageEvidence({
      duration_seconds:1e-8,tracks:[track([0,1e-8],[0,45])],
    }).state).toBe("UNAVAILABLE");
  });
  test("refuses excessive keyframes without rendering",()=>{
    const p=planTemporalImageEvidence({
      duration_seconds:1,
      tracks:[track(Array.from({length:4100},(_,i)=>i/4100),
        Array.from({length:4100},(_,i)=>i))],
    });
    expect(p.state).toBe("UNAVAILABLE");
  });
  test("only on explicitly requested native diagnostics",async()=>{
    const s=await Bun.file("server/runtime/extensions/animation/nativeIntelligence.ts").text();
    expect(s).toContain("temporal_image_capture_hints: planTemporalImageEvidence");
    expect(s).toContain("if (args.diagnostics !== true) return result");
  });
});
