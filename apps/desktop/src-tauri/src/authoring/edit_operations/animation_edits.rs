//! Typed animation EditOperation handling.
//! Rust EditorSession in authoring/mod.rs remains the only transaction/Undo owner.
//! Branch bodies are preserved from the original complete dispatcher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn apply(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
        EditOperation::DuplicateAnimationClip { source_uuid, new_uuid, new_name } => {
            animation_clip::duplicate_animation_clip(doc, source_uuid, new_uuid, new_name)?;
            Ok(new_uuid.clone())
        }
        EditOperation::AddAnimationTimelineMarker { animation_uuid, time, name, color } => {
            timeline_markers::add_marker(doc,animation_uuid,*time,name,*color)
        }
        EditOperation::UpdateAnimationTimelineMarker {
            animation_uuid, target_time, time, name, color,
        } => timeline_markers::update_marker(
            doc,animation_uuid,*target_time,*time,name,*color),
        EditOperation::RemoveAnimationTimelineMarker { animation_uuid, time } => {
            timeline_markers::remove_marker(doc,animation_uuid,*time)
        }
        EditOperation::AddAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::add_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::UpdateAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::update_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::RemoveAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel,
        } => effects::remove_event(doc,animation_uuid,keyframe_uuid,channel),
        EditOperation::CreateAnimation { uuid, name, length } => {
            if !valid_uuid(uuid) || name.trim().is_empty() || name.chars().count() > 128 ||
               name.chars().any(char::is_control) ||
               !length.is_finite() || !(0.0..=3600.0).contains(length) ||
               doc.animation_assets.len() >= MAX_ELEMENTS ||
               doc.animation_assets.iter().any(|a|
                   a.get("uuid").and_then(Value::as_str) == Some(uuid) ||
                   a.get("name").and_then(Value::as_str) == Some(name.trim())) ||
               doc.cubes.iter().any(|c| c.uuid == *uuid) ||
               doc.bones.iter().any(|b| b.uuid == *uuid) ||
               doc.texture_assets.iter().any(|t| t.get("uuid").and_then(Value::as_str) == Some(uuid)) {
                return Err(fail("ANIMATION_CREATION_INVALID"));
            }
            doc.animation_assets.push(json!({
                "uuid": uuid, "name": name.trim(),
                "loop": "once", "length": length, "animators": {}
            }));
            Ok(uuid.clone())
        }
        EditOperation::SetAnimationLoopMode { animation_uuid, mode } => {
            // Only admitted numeric linear/step/Catmull-Rom Bone clips without opaque fields can
            // change their playback policy. Source-backed Blockbench v5.2.1
            // stores exactly once, loop, hold in the .bbmodel clip.
            if !matches!(mode.as_str(), "once" | "loop" | "hold") {
                return Err(fail("ANIMATION_LOOP_MODE_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            let clip = &doc.animation_assets[index];
            if !editable_transform_clip(clip, &doc.bones) {
                return Err(fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"));
            }
            let duration = clip.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"))?;
            if duration == 0.0 && mode != "once" {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            if saved_animation_loop(clip) == Some(mode.as_str()) {
                return Ok(animation_uuid.clone());
            }
            doc.animation_assets[index]["loop"] = json!(mode);
            Ok(animation_uuid.clone())
        }
        EditOperation::SetAnimationLength { animation_uuid, length } => {
            if !length.is_finite() || !(0.0..=3600.0).contains(length) {
                return Err(fail("ANIMATION_LENGTH_INVALID"));
            }
            let mut matching = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid));
            let (index, animation) = matching.next()
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            if matching.next().is_some() {
                // An imported model can contain duplicate Animation UUIDs.
                // Never choose the first target silently.
                return Err(fail("ANIMATION_ID_AMBIGUOUS"));
            }
            // All admitted numeric linear/step/Catmull-Rom transform channels are kept
            // byte-for-byte. No keyframe may be discarded by shortening.
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"));
            }
            if *length == 0.0 && saved_animation_loop(animation) != Some("once") {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            let animators = animation.get("animators").and_then(Value::as_object)
                .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
            for track in animators.values() {
                let frames = track.get("keyframes").and_then(Value::as_array)
                    .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
                if frames.iter().any(|frame| frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|time| time > *length)) {
                    return Err(fail("ANIMATION_LENGTH_BEFORE_KEYFRAME"));
                }
            }
            if !timeline_markers::valid_saved_markers(animation,*length) {
                return Err(fail("ANIMATION_LENGTH_BEFORE_MARKER"));
            }
            doc.animation_assets[index]["length"] = json!(length);
            Ok(animation_uuid.clone())
        }
        EditOperation::ScaleAnimationTimeline { animation_uuid, factor } => {
            // Admitted numeric linear/step/Catmull-Rom/Bezier clips are retimed in a
            // single transaction. No keyframe payload, UUID, Bone identity,
            // channel or interpolation is rewritten or guessed.
            if !factor.is_finite() || !(0.1..=10.0).contains(factor) {
                return Err(fail("ANIMATION_TIMELINE_FACTOR_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str())).map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TIMELINE_UNSUPPORTED"));
            }
            let original_length = doc.animation_assets[index]["length"].as_f64()
                .ok_or_else(|| fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"))?;
            let new_length = original_length * factor;
            if original_length <= 0.0 ||
               !new_length.is_finite() || !(0.0..=3600.0).contains(&new_length) {
                return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
            }
            if *factor == 1.0 { return Ok(animation_uuid.clone()); }
            let tracks = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
            for track in tracks.values_mut() {
                let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                    .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                for frame in frames {
                    let time = frame.get("time").and_then(Value::as_f64)
                        .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                    let scaled = time * factor;
                    if !scaled.is_finite() || scaled > new_length {
                        return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
                    }
                    if frame.get("interpolation").and_then(Value::as_str) == Some("bezier") &&
                       !bezier::retime_handles(frame, *factor) {
                        return Err(fail("ANIMATION_BEZIER_RETIME_UNSUPPORTED"));
                    }
                    frame["time"] = json!(scaled);
                }
            }
            timeline_markers::scale_markers(
                &mut doc.animation_assets[index],*factor,new_length)?;
            doc.animation_assets[index]["length"] = json!(new_length);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                // E.g. scale would collapse distinct same-channel keyframe
                // times below the strict admission threshold. The parent
                // EditorSession discards this entire draft on refusal.
                return Err(fail("ANIMATION_TIMELINE_AFTER_SCALE_UNSUPPORTED"));
            }
            Ok(animation_uuid.clone())
        }
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_uuid(keyframe_uuid) || !time.is_finite() || *time < 0.0 ||
               !valid_vec3(*rotation) ||
               doc.animation_assets.iter().any(|a| value_references_uuid(a, keyframe_uuid)) ||
               doc.cubes.iter().any(|c| c.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|b| b.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animators = animation.get_mut("animators").and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animators.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name": bone_name, "type": "bone", "keyframes": []
            }));
            if track.get("type").is_some_and(|kind| kind.as_str() != Some("bone")) {
                return Err(fail("ANIMATION_TRACK_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 4096 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64).is_some_and(|t| (t - time).abs() <= 1e-6)
            ) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            // Blockbench KeyframeDataPoint's x/y/z fields are Molang strings.
            frames.push(json!({
                "uuid": keyframe_uuid, "channel": "rotation", "time": time,
                "interpolation": "linear",
                "data_points": [{
                    "x": rotation[0].to_string(),
                    "y": rotation[1].to_string(),
                    "z": rotation[2].to_string()
                }]
            }));
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_vec3(*rotation) || !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != index &&
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[index]["time"] = json!(time);
            frames[index]["data_points"][0] = json!({
                "x": rotation[0].to_string(), "y": rotation[1].to_string(),
                "z": rotation[2].to_string()
            });
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid,
        } => {
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            frames.remove(index);
            // The session owns a draft; a refusal here rolls back the removal.
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_uuid(keyframe_uuid) || !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 ||
               doc.animation_assets.iter().any(|asset|
                   value_references_uuid(asset, keyframe_uuid)) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            let animation = &doc.animation_assets[index];
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = animation.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animator = doc.animation_assets[index]["animators"].as_object_mut()
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animator.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name":bone_name,"type":"bone","keyframes":[]
            }));
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 2048 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames.push(json!({
                "uuid":keyframe_uuid, "channel":channel, "time":time,
                "interpolation":"linear",
                "data_points":[{
                    "x":value[0].to_string(), "y":value[1].to_string(),
                    "z":value[2].to_string()
                }]
            }));
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = doc.animation_assets[index].get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != target &&
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[target]["time"] = json!(time);
            frames[target]["data_points"][0] = json!({
                "x":value[0].to_string(), "y":value[1].to_string(),
                "z":value[2].to_string()
            });
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid, bone_uuid, keyframe_uuid, channel, interpolation,
        } => {
            // Blockbench 5.2.1 stores each key's outgoing interpolation.
            // Bezier requires separate explicit handle authoring; a
            // change is therefore targeted at one exact key UUID/channel.
            if !supported_transform_channel(channel) ||
               !matches!(interpolation.as_str(), "linear" | "step" | "catmullrom") {
                return Err(fail("ANIMATION_INTERPOLATION_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, animation)| animation.get("uuid")
                    .and_then(Value::as_str) == Some(animation_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matches: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid")
                    .and_then(Value::as_str) == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames[target].get("interpolation").and_then(Value::as_str)
                == Some(interpolation.as_str()) {
                return Ok(keyframe_uuid.clone());
            }
            frames[target]["interpolation"] = json!(interpolation);
            // Blockbench's saved representation omits Bezier-specific
            // fields when a key is switched to another interpolation.
            bezier::clear_handles(&mut frames[target]);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid, bone_uuid, keyframe_uuid, channel, handles,
        } => {
            if !supported_transform_channel(channel) || !handles.valid() {
                return Err(fail("ANIMATION_BEZIER_HANDLES_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_CLIP_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matching: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid").and_then(Value::as_str)
                    == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matching.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [i] => *i,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str)
                != Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            bezier::write_handles(&mut frames[target], handles);
            // Existing EditorSession draft is never committed if any
            // operation fails. Recheck recognized saved keys now.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel,
        } => {
            if !supported_transform_channel(channel) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            frames.remove(target);
            // Joining two adjacent segments may alter their Bezier time
            // handles. Fail atomically if the remaining track is ambiguous.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        _ => Err(fail("EDIT_OPERATION_DOMAIN_MISMATCH")),
    }
}
