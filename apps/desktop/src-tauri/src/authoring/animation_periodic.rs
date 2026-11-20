//! A1: read-only source-bound phase/amplitude-to-Bone-keyframe compiler.
//! Periodic motion becomes editable linear rotation keys in one standard
//! Rust EditPlan. No GPU animation source, persistent recipe, IK, automatic
//! Apply, visual approval, or new authoring/Undo authority.
use super::{sha256, valid_uuid, valid_node_name, valid_animation_transform_value,
    EditOperation, EditPlan, EditorSession, Result, MAX_OPERATIONS, MAX_PLAN_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, f64::consts::TAU};

const TICKS: usize = 65536;
const TIME_EPS: f64 = 1.0e-10;
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodicRotationTrack {
    pub bone_uuid: String,
    pub base_rotation: [f64;3],
    pub amplitude: [f64;3],
    pub phase_degrees: f64,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodicRotationIntent {
    pub expected_revision:u64,
    pub animation_uuid:String,
    pub name:String,
    pub length_seconds:f64,
    /// Conservative scalar-Euler linear-chord bound, not 3D pose error.
    pub max_error_degrees:f64,
    pub tracks:Vec<PeriodicRotationTrack>,
}
#[derive(Debug,Clone,Serialize)]
pub struct PeriodicRotationProposal {
    pub plan:EditPlan,
    pub preflight:Value,
    pub motion_evidence:Value,
}
fn key_uuid(clip:&str,bone:&str,tick:usize)->String {
    let h=sha256(format!(
        "lazydesigner:animation-periodic-rotation-v1\0{clip}\0{bone}\0{tick}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",&h[..8],&h[8..12],
        &h[13..16],&h[17..20],&h[20..32])
}
fn pose(track:&PeriodicRotationTrack,tick:usize)->[f64;3] {
    let v=(track.phase_degrees.to_radians()+
        TAU*(tick as f64/TICKS as f64)).sin();
    std::array::from_fn(|a|track.base_rotation[a]+track.amplitude[a]*v)
}
fn scalar_error_bound(amp:[f64;3],segments:usize)->f64 {
    let largest=amp.iter().map(|v|v.abs()).fold(0.0_f64,f64::max);
    // Supremum |f''| = largest*(2π)^2; linear chord error <= M*h²/8.
    largest*TAU*TAU/(8.0*(segments as f64).powi(2))
}
fn precise_time(t:f64)->bool {
    t.is_finite()&&(0.0..=3600.0).contains(&t)&&
    format!("{t:.9}").parse::<f64>()
        .is_ok_and(|r|(r-t).abs()<=TIME_EPS)
}
pub(super) fn compile(s:&EditorSession,r:&PeriodicRotationIntent)
    ->Result<PeriodicRotationProposal>
{
    s.check_revision(r.expected_revision)?;
    if serde_json::to_vec(r).map_err(|_|"PERIODIC_ROTATION_INTENT_INVALID".to_string())?
        .len()>MAX_PLAN_BYTES {
        return Err("PERIODIC_ROTATION_INTENT_TOO_LARGE".into());
    }
    if !valid_uuid(&r.animation_uuid)||!valid_node_name(&r.name)||
       r.name!=r.name.trim()||r.length_seconds<=0.0||
       !precise_time(r.length_seconds)||
       !r.max_error_degrees.is_finite()||r.max_error_degrees<=0.0||
       r.tracks.is_empty() {
        return Err("PERIODIC_ROTATION_INTENT_INVALID".into());
    }
    let doc=s.document();
    let mut seen=HashSet::new();
    for t in &r.tracks {
        if !valid_uuid(&t.bone_uuid)||!seen.insert(t.bone_uuid.as_str())||
           !doc.bones.iter().any(|b|b.uuid==t.bone_uuid)||
           !valid_animation_transform_value("rotation",t.base_rotation)||
           !t.amplitude.iter().all(|a|a.is_finite()&&a.abs()<=100_000.0)||
           t.amplitude.iter().all(|a|*a==0.0)||
           !t.phase_degrees.is_finite()||t.phase_degrees.abs()>100_000.0 {
            return Err("PERIODIC_ROTATION_TRACK_INVALID".into());
        }
    }
    let mut ops=vec![EditOperation::CreateAnimation {
        uuid:r.animation_uuid.clone(),name:r.name.clone(),length:r.length_seconds
    }];
    let mut traces=Vec::with_capacity(r.tracks.len());
    let mut key_total=0usize;
    for t in &r.tracks {
        let mut segments=4usize;
        let mut bound=scalar_error_bound(t.amplitude,segments);
        while bound>r.max_error_degrees {
            segments=segments.checked_mul(2)
                .ok_or_else(||"PERIODIC_ROTATION_OPERATION_BUDGET".to_string())?;
            if segments>TICKS||ops.len().checked_add(segments+2)
                .is_none_or(|total|total>MAX_OPERATIONS) {
                return Err("PERIODIC_ROTATION_OPERATION_BUDGET".into());
            }
            bound=scalar_error_bound(t.amplitude,segments);
        }
        // An additional final loop-mode operation is always reserved.
        if ops.len().checked_add(segments+2)
            .is_none_or(|total|total>MAX_OPERATIONS) {
            return Err("PERIODIC_ROTATION_OPERATION_BUDGET".into());
        }
        let first=pose(t,0);
        if !valid_animation_transform_value("rotation",first){
            return Err("PERIODIC_ROTATION_VALUE_UNREPRESENTABLE".into());
        }
        for i in 0..=segments {
            let tick=i*(TICKS/segments);
            let time=r.length_seconds*(tick as f64/TICKS as f64);
            if !precise_time(time) {
                return Err("PERIODIC_ROTATION_TIME_UNREPRESENTABLE".into());
            }
            // Exact last=first eliminates sine floating-point seam drift.
            let value=if i==segments {first} else {pose(t,tick)};
            if !valid_animation_transform_value("rotation",value){
                return Err("PERIODIC_ROTATION_VALUE_UNREPRESENTABLE".into());
            }
            ops.push(EditOperation::AddBoneTransformKeyframe{
                animation_uuid:r.animation_uuid.clone(),
                bone_uuid:t.bone_uuid.clone(),
                keyframe_uuid:key_uuid(&r.animation_uuid,&t.bone_uuid,tick),
                channel:"rotation".into(),time,value
            });
        }
        key_total+=segments+1;
        traces.push(json!({
            "bone_uuid":t.bone_uuid,"segments":segments,
            "keyframe_count":segments+1,
            "conservative_scalar_error_bound_degrees":bound,
            "seam_endpoint_values_identical":true
        }));
    }
    ops.push(EditOperation::SetAnimationLoopMode{
        animation_uuid:r.animation_uuid.clone(),mode:"loop".into()
    });
    let plan=EditPlan{expected_revision:r.expected_revision,
        operations:ops,correction_scope:None};
    let preflight=s.preflight(&plan)?;
    let motion_evidence=json!({
        "scope":"source_bound_periodic_bone_rotation_candidate",
        "animation_uuid":r.animation_uuid,
        "sampling_strategy":"conservative_scalar_linear_sine_chord",
        "max_error_degrees":r.max_error_degrees,
        "loop_mode":"loop",
        "track_count":r.tracks.len(),
        "keyframe_count":key_total,"tracks":traces,
        "source_identity":"EXACT_SAVED_BONE_UUIDS",
        "pose_contact_verdict":"UNVERIFIED",
        "continuous_euler_motion_verdict":"SCALAR_LINEAR_BOUND_ONLY",
        "native_playback_verdict":"NOT_EXECUTED",
        "visual_verdict":"UNVERIFIED","write_authority":"NOT_GRANTED",
    });
    Ok(PeriodicRotationProposal{plan,preflight,motion_evidence})
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE:&[u8]=include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const BONE:&str="00000000-0000-4000-8000-000000000001";
    const CLIP:&str="00000000-0000-4000-8000-000000007801";
    fn request()->PeriodicRotationIntent{
        PeriodicRotationIntent{
            expected_revision:0,animation_uuid:CLIP.into(),
            name:"antenna_idle".into(),length_seconds:1.0,
            max_error_degrees:1.0,tracks:vec![PeriodicRotationTrack{
                bone_uuid:BONE.into(),base_rotation:[0.0,10.0,0.0],
                amplitude:[0.0,12.0,0.0],phase_degrees:90.0,
            }]
        }
    }
    #[test]
    fn read_only_wave_is_deterministic_one_undoable_editable_clip(){
        let s=EditorSession::open(SOURCE).unwrap();
        let before=s.export().unwrap();
        let p=compile(&s,&request()).unwrap();
        let again=compile(&s,&request()).unwrap();
        assert_eq!(serde_json::to_value(&p.plan).unwrap(),
                   serde_json::to_value(&again.plan).unwrap());
        assert_eq!(p.motion_evidence["tracks"][0]["segments"],8);
        assert_eq!(p.plan.operations.len(),11);
        assert_eq!(p.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(s.export().unwrap(),before);
        let begin=&p.plan.operations[1];
        let end=&p.plan.operations[9];
        let (EditOperation::AddBoneTransformKeyframe{value:a,..},
            EditOperation::AddBoneTransformKeyframe{value:b,..})=(begin,end)
        else {panic!("keyframes missing")};
        assert_eq!(a,b);
        let mut authored=s.clone();
        authored.apply(0,&p.plan.operations).unwrap();
        assert_eq!(authored.document().animation_assets.last().unwrap()["loop"],"loop");
        assert_eq!(authored.document().cubes,s.document().cubes);
        assert_eq!(authored.undo(1).unwrap().revision,2);
        assert_eq!(authored.export().unwrap(),before);
    }
    #[test]
    fn adapts_key_budget_and_refuses_unknown_or_invalid_source(){
        let s=EditorSession::open(SOURCE).unwrap();
        let mut r=request();r.max_error_degrees=10.0;
        let coarse=compile(&s,&r).unwrap();
        assert_eq!(coarse.motion_evidence["tracks"][0]["segments"],4);
        r.max_error_degrees=1e-16;
        assert_eq!(compile(&s,&r).unwrap_err(),
            "PERIODIC_ROTATION_OPERATION_BUDGET");
        r=request();r.tracks[0].bone_uuid="missing".into();
        assert_eq!(compile(&s,&r).unwrap_err(),"PERIODIC_ROTATION_TRACK_INVALID");
        r=request();r.tracks[0].amplitude=[0.0;3];
        assert_eq!(compile(&s,&r).unwrap_err(),"PERIODIC_ROTATION_TRACK_INVALID");
        r=request();r.expected_revision=1;
        assert_eq!(compile(&s,&r).unwrap_err(),"DOCUMENT_REVISION_STALE");
    }
}
