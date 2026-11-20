//! One-source Rust review and opt-in correction of EXISTING numeric Animation
//! clips. This module does not edit a source file, own history, infer visual
//! quality, solve IK, or copy unsupported/Molang values into new keyframes.
use super::{editable_transform_clip, saved_animation_loop, transform_axis,
    valid_animation_transform_value, valid_uuid, AuthoringDocument, EditOperation,
    EditPlan, EditorSession, Result, MAX_PLAN_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const ISSUE_LIMIT:usize=16;
const TRACK_LIMIT:usize=24;
const DRIFT_LIMIT:f64=0.05;
type Vec3=[f64;3];

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum ExistingAnimationCorrection {
    CloseLoopEndpoint {
        bone_uuid:String, channel:String,
        start_keyframe_uuid:String,end_keyframe_uuid:String,
        expected_start_value:Vec3, expected_end_value:Vec3,
        max_axis_delta:f64,
    },
    ReplaceExactKey {
        bone_uuid:String,channel:String,keyframe_uuid:String,
        expected_time:f64, expected_value:Vec3,
        replacement_value:Vec3, max_axis_delta:f64,
    },
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExistingAnimationIntent {
    pub expected_revision:u64,
    pub animation_uuid:String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub correction:Option<ExistingAnimationCorrection>,
}
#[derive(Debug,Clone,Serialize)]
pub struct ExistingAnimationReview {
    pub analysis:Value,
    pub plan:Option<EditPlan>,
    pub preflight:Option<Value>,
    pub correction_evidence:Option<Value>,
}
#[derive(Debug,Clone)]
struct Key {
    uuid:String,
    time:f64,
    value:Vec3,
    interpolation:String,
}
type Tracks=BTreeMap<(String,String),Vec<Key>>;

fn numeric_frame(frame:&Value)->Result<Key>{
    let value=&frame["data_points"][0];
    let axis=|letter:&str|->Result<f64>{
        transform_axis(value.get(letter))
            .ok_or_else(||"EXISTING_ANIMATION_AXIS_UNSUPPORTED".into())
    };
    Ok(Key{
        uuid:frame.get("uuid").and_then(Value::as_str)
            .ok_or_else(||"EXISTING_ANIMATION_KEY_INVALID".to_owned())?.into(),
        time:frame.get("time").and_then(Value::as_f64)
            .ok_or_else(||"EXISTING_ANIMATION_TIME_INVALID".to_owned())?,
        value:[axis("x")?,axis("y")?,axis("z")?],
        interpolation:frame.get("interpolation").and_then(Value::as_str)
            .ok_or_else(||"EXISTING_ANIMATION_INTERPOLATION_UNSUPPORTED".to_owned())?.into(),
    })
}
fn issues_push(issues:&mut Vec<Value>,total:&mut usize,issue:Value){
    *total+=1;
    if issues.len()<ISSUE_LIMIT {issues.push(issue);}
}
fn axis_max(a:Vec3,b:Vec3)->f64{
    (0..3).map(|i|(a[i]-b[i]).abs()).fold(0.0_f64,f64::max)
}
fn vec_eq(a:Vec3,b:Vec3)->bool{a==b}
fn target<'a>(tracks:&'a Tracks,bone:&str,channel:&str)->Result<&'a [Key]>{
    if !matches!(channel,"rotation"|"position"|"scale")||!valid_uuid(bone){
        return Err("EXISTING_ANIMATION_TARGET_INVALID".into());
    }
    tracks.get(&(bone.to_owned(),channel.to_owned()))
        .map(Vec::as_slice).ok_or_else(||"EXISTING_ANIMATION_TRACK_NOT_FOUND".into())
}
fn require_linear(keys:&[Key])->Result<()>{
    if keys.iter().any(|k|k.interpolation!="linear"){
        return Err("EXISTING_ANIMATION_CORRECTION_NONLINEAR".into());
    }
    if keys.len()<2 {return Err("EXISTING_ANIMATION_CORRECTION_SPARSE".into());}
    // Euler winding can't be deduced just from endpoint equality.
    Ok(())
}
fn compile_correction(
    session:&EditorSession,intent:&ExistingAnimationIntent,
    tracks:&Tracks,clip_length:f64,loop_mode:&str,
    correction:&ExistingAnimationCorrection,
)->Result<(EditPlan,Value,Value)>{
    let (bone,channel,key,old,new_value,threshold,correction_kind)=match correction {
        ExistingAnimationCorrection::CloseLoopEndpoint{
            bone_uuid,channel,start_keyframe_uuid,end_keyframe_uuid,
            expected_start_value,expected_end_value,max_axis_delta,
        }=>{
            if loop_mode!="loop"||!max_axis_delta.is_finite()||
               *max_axis_delta<=0.0||*max_axis_delta>DRIFT_LIMIT {
                // The scalar threshold is a strict engineering gate,
                // not approval to change meaningful authored winding.
                return Err("EXISTING_ANIMATION_LOOP_CORRECTION_INVALID".into());
            }
            let keys=target(tracks,bone_uuid,channel)?;
            require_linear(keys)?;
            let first=&keys[0];let last=&keys[keys.len()-1];
            if first.time!=0.0||last.time!=clip_length||
               first.uuid!=*start_keyframe_uuid||last.uuid!=*end_keyframe_uuid||
               !vec_eq(first.value,*expected_start_value)||
               !vec_eq(last.value,*expected_end_value){
                return Err("EXISTING_ANIMATION_SOURCE_MISMATCH".into());
            }
            let diff=axis_max(first.value,last.value);
            if diff<=1e-9||diff>*max_axis_delta||diff>DRIFT_LIMIT {
                return Err("EXISTING_ANIMATION_DRIFT_UNSAFE".into());
            }
            (bone_uuid,channel,last,last.value,first.value,*max_axis_delta,"close_loop_endpoint")
        },
        ExistingAnimationCorrection::ReplaceExactKey{
            bone_uuid,channel,keyframe_uuid,expected_time,
            expected_value,replacement_value,max_axis_delta,
        }=>{
            let keys=target(tracks,bone_uuid,channel)?;
            require_linear(keys)?;
            let key=keys.iter().find(|frame|frame.uuid==*keyframe_uuid)
                .ok_or_else(||"EXISTING_ANIMATION_KEY_NOT_FOUND".to_owned())?;
            if key.time!=*expected_time||!vec_eq(key.value,*expected_value) {
                return Err("EXISTING_ANIMATION_SOURCE_MISMATCH".into());
            }
            if !valid_animation_transform_value(channel,*replacement_value) {
                return Err("EXISTING_ANIMATION_REPLACEMENT_INVALID".into());
            }
            let diff=axis_max(key.value,*replacement_value);
            if diff<=1e-9||diff>*max_axis_delta {
                return Err("EXISTING_ANIMATION_CHANGE_OUT_OF_SCOPE".into());
            }
            (bone_uuid,channel,key,key.value,*replacement_value,*max_axis_delta,
                "replace_exact_key")
        }
    };
    if !threshold.is_finite()||threshold<=0.0||threshold>100_000.0 {
        return Err("EXISTING_ANIMATION_DELTA_INVALID".into());
    }
    if keys_have_ambiguous_winding(tracks,bone,channel){
        return Err("EXISTING_ANIMATION_EULER_WINDING_UNRESOLVED".into());
    }
    let plan=EditPlan{
        expected_revision:intent.expected_revision,
        operations:vec![EditOperation::UpdateBoneTransformKeyframe{
            animation_uuid:intent.animation_uuid.clone(),
            bone_uuid:bone.clone(),channel:channel.clone(),keyframe_uuid:key.uuid.clone(),
            time:key.time,value:new_value,
        }],
        correction_scope:None,
    };
    let preflight=session.preflight(&plan)?;
    let evidence=json!({
        "scope":"source_bound_existing_animation_key_correction",
        "kind":correction_kind,"animation_uuid":intent.animation_uuid,
        "bone_uuid":bone,"channel":channel,"keyframe_uuid":key.uuid,
        "time":key.time,"source_before":old,"replacement":new_value,
        "max_axis_delta":threshold,
        "source_authority":"EXACT_SAVED_NUMERIC_KEY",
        "native_playback_verdict":"NOT_EXECUTED",
        "visual_verdict":"UNVERIFIED","write_authority":"NOT_GRANTED"
    });
    Ok((plan,preflight,evidence))
}
fn keys_have_ambiguous_winding(tracks:&Tracks,bone:&str,channel:&str)->bool{
    channel=="rotation"&&tracks.get(&(bone.to_owned(),channel.to_owned()))
        .is_some_and(|keys|keys.windows(2).any(|w|
            axis_max(w[0].value,w[1].value)>=180.0))
}
pub(super) fn review(
    session:&EditorSession,intent:&ExistingAnimationIntent,
)->Result<ExistingAnimationReview>{
    session.check_revision(intent.expected_revision)?;
    if !valid_uuid(&intent.animation_uuid) ||
       serde_json::to_vec(intent)
          .map_err(|_|"EXISTING_ANIMATION_INTENT_INVALID".to_owned())?.len()>MAX_PLAN_BYTES{
        return Err("EXISTING_ANIMATION_INTENT_INVALID".into());
    }
    let doc: &AuthoringDocument=session.document();
    let matching:Vec<&Value>=doc.animation_assets.iter().filter(|clip|
        clip.get("uuid").and_then(Value::as_str)==Some(intent.animation_uuid.as_str()))
        .collect();
    let clip=match matching.as_slice(){
        []=>return Err("EXISTING_ANIMATION_NOT_FOUND".into()),
        [clip]=>*clip,
        _=>return Err("EXISTING_ANIMATION_AMBIGUOUS".into()),
    };
    if !editable_transform_clip(clip,&doc.bones){
        if intent.correction.is_some(){
            return Err("EXISTING_ANIMATION_CLIP_OPAQUE".into());
        }
        return Ok(ExistingAnimationReview{
            analysis:json!({
                "scope":"source_bound_existing_numeric_animation_review",
                "animation_uuid":intent.animation_uuid,
                "recognized":false,"status":"unsupported",
                "reason":"OPAQUE_OR_UNSUPPORTED_CLIP",
                "tracks_total":null,"keyframe_count":null,
                "issues_total":null,"issues":[],"track_summaries":[],
                "truncated":false,
                "native_playback_verdict":"NOT_EXECUTED",
                "visual_verdict":"UNVERIFIED","write_authority":"NOT_GRANTED"
            }),
            plan:None,preflight:None,correction_evidence:None,
        });
    }
    let length=clip["length"].as_f64()
        .ok_or_else(||"EXISTING_ANIMATION_LENGTH_INVALID".to_owned())?;
    let loop_mode=saved_animation_loop(clip)
        .ok_or_else(||"EXISTING_ANIMATION_LOOP_INVALID".to_owned())?;
    let mut tracks=Tracks::new();
    let mut total_keys=0_usize;
    for (bone_uuid,track) in clip["animators"].as_object()
        .ok_or_else(||"EXISTING_ANIMATION_TRACKS_INVALID".to_owned())?{
        if bone_uuid=="effects" {continue}
        let frames=track["keyframes"].as_array()
            .ok_or_else(||"EXISTING_ANIMATION_TRACK_INVALID".to_owned())?;
        for frame in frames{
            let channel=frame["channel"].as_str()
                .ok_or_else(||"EXISTING_ANIMATION_CHANNEL_INVALID".to_owned())?;
            let key=numeric_frame(frame)?;
            tracks.entry((bone_uuid.clone(),channel.to_owned()))
                .or_default().push(key);
            total_keys+=1;
        }
    }
    let mut summaries=Vec::new();
    let mut issues=Vec::new();
    let mut issue_count=0;
    for ((bone_uuid,channel),keys) in &mut tracks{
        keys.sort_by(|a,b|a.time.total_cmp(&b.time));
        let nonlinear=keys.iter().any(|k|k.interpolation!="linear");
        let maximum_segment_speed=if nonlinear {None}else{
            Some(keys.windows(2).map(|pair|{
                let dt=pair[1].time-pair[0].time;
                (0..3).map(|axis|
                    ((pair[1].value[axis]-pair[0].value[axis])/dt).powi(2)
                ).sum::<f64>().sqrt()
            }).fold(0.0_f64,f64::max))
        };
        if summaries.len()<TRACK_LIMIT{
            summaries.push(json!({
                "bone_uuid":bone_uuid,"channel":channel,
                "key_count":keys.len(),
                "first_time":keys.first().map(|k|k.time),
                "last_time":keys.last().map(|k|k.time),
                "contains_nonlinear_keys":nonlinear,
                "max_authored_linear_segment_speed":maximum_segment_speed,
            }));
        }
        if channel=="rotation" {
            for pair in keys.windows(2){
                let delta=axis_max(pair[0].value,pair[1].value);
                if delta>=180.0 {
                    issues_push(&mut issues,&mut issue_count,json!({
                        "kind":"euler_winding_unresolved",
                        "bone_uuid":bone_uuid,"channel":channel,
                        "from_keyframe_uuid":pair[0].uuid,
                        "to_keyframe_uuid":pair[1].uuid,
                        "from_time":pair[0].time,"to_time":pair[1].time,
                        "max_abs_axis_delta":delta,
                        "automatic_correction":"NOT_SAFE"
                    }));
                }
            }
        }
        if loop_mode=="loop"&&keys.len()>=2{
            let first=&keys[0];let last=&keys[keys.len()-1];
            if first.time!=0.0||last.time!=length{
                issues_push(&mut issues,&mut issue_count,json!({
                    "kind":"loop_boundary_not_explicit",
                    "bone_uuid":bone_uuid,"channel":channel,
                    "first_keyframe_uuid":first.uuid,"last_keyframe_uuid":last.uuid,
                    "first_time":first.time,"last_time":last.time,
                    "automatic_correction":"NOT_SAFE"
                }));
            }else{
                let diff=axis_max(first.value,last.value);
                if diff>1e-9 {
                    issues_push(&mut issues,&mut issue_count,json!({
                        "kind":"loop_endpoint_value_difference",
                        "bone_uuid":bone_uuid,"channel":channel,
                        "start_keyframe_uuid":first.uuid,
                        "end_keyframe_uuid":last.uuid,
                        "start_value":first.value,"end_value":last.value,
                        "max_abs_axis_delta":diff,
                        "bounded_close_candidate":
                            diff<=DRIFT_LIMIT&&!nonlinear&&
                            !keys_have_ambiguous_winding_single(keys,channel),
                        "native_continuity":"UNVERIFIED"
                    }));
                }
            }
        }
    }
    let analysis=json!({
        "scope":"source_bound_existing_numeric_animation_review",
        "animation_uuid":intent.animation_uuid,
        "recognized":true,"status":if issue_count==0 {"no_source_candidates"}
            else {"needs_review"},
        "loop_mode":loop_mode,"length_seconds":length,
        "tracks_total":tracks.len(),"keyframe_count":total_keys,
        "issues_total":issue_count,"issues":issues,
        "track_summaries":summaries,
        "truncated":issue_count>ISSUE_LIMIT||tracks.len()>TRACK_LIMIT,
        "analysis_limit":"NUMERIC_SAVED_KEYS_ONLY",
        "native_playback_verdict":"NOT_EXECUTED",
        "visual_verdict":"UNVERIFIED","write_authority":"NOT_GRANTED",
    });
    let (plan,preflight,correction_evidence)=if let Some(correction)=&intent.correction{
        let (plan,preflight,evidence)=compile_correction(
            session,intent,&tracks,length,loop_mode,correction)?;
        (Some(plan),Some(preflight),Some(evidence))
    }else{(None,None,None)};
    Ok(ExistingAnimationReview{analysis,plan,preflight,correction_evidence})
}
fn keys_have_ambiguous_winding_single(keys:&[Key],channel:&str)->bool{
    channel=="rotation"&&keys.windows(2).any(|w|axis_max(w[0].value,w[1].value)>=180.0)
}
#[cfg(test)]
mod tests{
    use super::*;
    const SOURCE:&[u8]=include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const BONE:&str="00000000-0000-4000-8000-000000000001";
    const CLIP:&str="00000000-0000-4000-8000-000000009001";
    const K0:&str="00000000-0000-4000-8000-000000009002";
    const K1:&str="00000000-0000-4000-8000-000000009003";
    const K2:&str="00000000-0000-4000-8000-000000009004";
    fn fixture()->EditorSession{
        let mut s=EditorSession::open(SOURCE).unwrap();
        s.apply(0,&[
            EditOperation::CreateAnimation{uuid:CLIP.into(),name:"walk".into(),length:1.0},
            EditOperation::AddBoneTransformKeyframe{
                animation_uuid:CLIP.into(),bone_uuid:BONE.into(),keyframe_uuid:K0.into(),
                channel:"rotation".into(),time:0.0,value:[0.0,0.0,0.0],
            },
            EditOperation::AddBoneTransformKeyframe{
                animation_uuid:CLIP.into(),bone_uuid:BONE.into(),keyframe_uuid:K1.into(),
                channel:"rotation".into(),time:0.5,value:[20.0,0.0,0.0],
            },
            EditOperation::AddBoneTransformKeyframe{
                animation_uuid:CLIP.into(),bone_uuid:BONE.into(),keyframe_uuid:K2.into(),
                channel:"rotation".into(),time:1.0,value:[0.02,0.0,0.0],
            },
            EditOperation::SetAnimationLoopMode{animation_uuid:CLIP.into(),mode:"loop".into()}
        ]).unwrap();
        s
    }
    fn intent()->ExistingAnimationIntent{
        ExistingAnimationIntent{expected_revision:1,animation_uuid:CLIP.into(),correction:None}
    }
    fn close()->ExistingAnimationCorrection{
        ExistingAnimationCorrection::CloseLoopEndpoint{
            bone_uuid:BONE.into(),channel:"rotation".into(),
            start_keyframe_uuid:K0.into(),end_keyframe_uuid:K2.into(),
            expected_start_value:[0.0;3],expected_end_value:[0.02,0.0,0.0],
            max_axis_delta:0.025
        }
    }
    #[test]
    fn existing_clip_review_sees_exact_source_keys_and_no_write(){
        let s=fixture();let original=s.export().unwrap();
        let proposal=review(&s,&intent()).unwrap();
        assert!(proposal.plan.is_none());
        assert_eq!(proposal.analysis["recognized"],true);
        assert_eq!(proposal.analysis["issues_total"],1);
        assert_eq!(proposal.analysis["issues"][0]["kind"],"loop_endpoint_value_difference");
        assert_eq!(proposal.analysis["issues"][0]["bounded_close_candidate"],true);
        assert_eq!(proposal.analysis["track_summaries"][0]["key_count"],3);
        assert_eq!(s.export().unwrap(),original);
    }
    #[test]
    fn explicit_small_loop_fix_is_one_existing_edit_operation_and_undoable(){
        let s=fixture();let original=s.export().unwrap();
        let mut request=intent();request.correction=Some(close());
        let p=review(&s,&request).unwrap();
        assert_eq!(p.preflight.as_ref().unwrap()["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(p.correction_evidence.as_ref().unwrap()["source_before"],json!([0.02,0.0,0.0]));
        assert_eq!(p.plan.as_ref().unwrap().operations.len(),1);
        let mut changed=s.clone();
        changed.apply(1,&p.plan.unwrap().operations).unwrap();
        let clips=&changed.document().animation_assets;
        let target=&clips[0]["animators"][BONE]["keyframes"][2];
        assert_eq!(target["data_points"][0]["x"],"0");
        assert_eq!(changed.undo(2).unwrap().revision,3);
        assert_eq!(changed.export().unwrap(),original);
    }
    #[test]
    fn explicit_source_bound_manual_key_does_not_change_untargeted_tracks(){
        let s=fixture();let original=s.export().unwrap();
        let mut request=intent();
        request.correction=Some(ExistingAnimationCorrection::ReplaceExactKey{
            bone_uuid:BONE.into(),channel:"rotation".into(),keyframe_uuid:K1.into(),
            expected_time:0.5,expected_value:[20.0,0.0,0.0],
            replacement_value:[21.0,0.0,0.0],max_axis_delta:2.0,
        });
        let p=review(&s,&request).unwrap();
        assert_eq!(p.correction_evidence.as_ref().unwrap()["kind"],"replace_exact_key");
        assert_eq!(s.export().unwrap(),original);
        let mut after=s.clone();
        after.apply(1,&p.plan.unwrap().operations).unwrap();
        assert_eq!(after.document().animation_assets[0]["animators"][BONE]
            ["keyframes"][0]["data_points"][0]["x"],"0");
        assert_eq!(after.document().animation_assets[0]["animators"][BONE]
            ["keyframes"][1]["data_points"][0]["x"],"21");
        assert_eq!(after.document().animation_assets[0]["animators"][BONE]
            ["keyframes"][2]["data_points"][0]["x"],"0.02");
    }
    #[test]
    fn correction_preserves_other_clip_timeline_and_non_animation_assets(){
        let mut s=fixture();
        s.apply(1,&[
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:CLIP.into(),time:0.35,
                name:"confirmed_impact".into(),color:0,
            },
            EditOperation::CreateAnimation{
                uuid:"00000000-0000-4000-8000-000000009011".into(),
                name:"idle".into(),length:2.0,
            },
        ]).unwrap();
        let original=s.document().clone();
        let mut request=intent();request.expected_revision=2;
        request.correction=Some(close());
        let candidate=review(&s,&request).unwrap();
        let mut changed=s.clone();
        changed.apply(2,&candidate.plan.unwrap().operations).unwrap();
        let doc=changed.document();
        assert_eq!(doc.animation_assets.len(),original.animation_assets.len());
        assert_eq!(doc.animation_assets[1],original.animation_assets[1]);
        assert_eq!(doc.animation_assets[0]["markers"],original.animation_assets[0]["markers"]);
        assert_eq!(doc.animation_assets[0]["animators"][BONE]["keyframes"][1],
            original.animation_assets[0]["animators"][BONE]["keyframes"][1]);
        assert_eq!(doc.bones,original.bones);
        assert_eq!(doc.cubes,original.cubes);
        assert_eq!(doc.texture_assets,original.texture_assets);
    }
    #[test]
    fn opaque_imported_expression_is_reported_but_never_proposed_as_edit(){
        let session=fixture();
        let mut doc=session.document().clone();
        doc.animation_assets[0]["animators"][BONE]["keyframes"][1]
            ["data_points"][0]["x"]=json!("query.head_rotation");
        let saved=EditorSession::from_document(doc).unwrap();
        let p=review(&saved,&intent()).unwrap_err();
        // Imported document no longer has revision 1. Explicit source
        // selection must use the actual session revision, not a stale lease.
        assert_eq!(p,"DOCUMENT_REVISION_STALE");
        let mut r=intent();r.expected_revision=0;
        let p=review(&saved,&r).unwrap();
        assert_eq!(p.analysis["status"],"unsupported");
        assert_eq!(p.analysis["recognized"],false);
        assert!(p.plan.is_none());
        r.correction=Some(close());
        assert_eq!(review(&saved,&r).unwrap_err(),"EXISTING_ANIMATION_CLIP_OPAQUE");
    }
    #[test]
    fn large_euler_spin_refuses_endpoint_snap_despite_small_boundary_drift(){
        let session=fixture();
        let mut spun=session.clone();
        spun.apply(1,&[EditOperation::UpdateBoneTransformKeyframe{
            animation_uuid:CLIP.into(),bone_uuid:BONE.into(),
            keyframe_uuid:K1.into(),channel:"rotation".into(),
            time:0.5,value:[200.0,0.0,0.0],
        }]).unwrap();
        let mut r=intent();r.expected_revision=2;
        let read=review(&spun,&r).unwrap();
        assert!(read.analysis["issues_total"].as_u64().unwrap()>=2);
        assert_eq!(read.analysis["issues"][0]["kind"],"euler_winding_unresolved");
        r.correction=Some(close());
        assert_eq!(review(&spun,&r).unwrap_err(),
            "EXISTING_ANIMATION_EULER_WINDING_UNRESOLVED");
    }
    #[test]
    fn corrected_clip_refuses_stale_source_opaque_or_meaningful_large_delta(){
        let s=fixture();let mut r=intent();r.expected_revision=0;
        assert_eq!(review(&s,&r).unwrap_err(),"DOCUMENT_REVISION_STALE");
        r=intent();r.correction=Some(close());
        if let Some(ExistingAnimationCorrection::CloseLoopEndpoint{
            expected_end_value,..})=&mut r.correction {*expected_end_value=[4.0;3]}
        assert_eq!(review(&s,&r).unwrap_err(),"EXISTING_ANIMATION_SOURCE_MISMATCH");
        r=intent();r.correction=Some(close());
        if let Some(ExistingAnimationCorrection::CloseLoopEndpoint{
            max_axis_delta,..})=&mut r.correction {*max_axis_delta=2.0}
        assert_eq!(review(&s,&r).unwrap_err(),"EXISTING_ANIMATION_LOOP_CORRECTION_INVALID");
        r=intent();r.correction=Some(close());
        let mut changed=s.clone();
        changed.apply(1,&[EditOperation::SetBoneTransformKeyframeInterpolation{
            animation_uuid:CLIP.into(),bone_uuid:BONE.into(),
            keyframe_uuid:K1.into(),channel:"rotation".into(),
            interpolation:"step".into(),
        }]).unwrap();
        r.expected_revision=2;
        assert_eq!(review(&changed,&r).unwrap_err(),
            "EXISTING_ANIMATION_CORRECTION_NONLINEAR");
    }
}
