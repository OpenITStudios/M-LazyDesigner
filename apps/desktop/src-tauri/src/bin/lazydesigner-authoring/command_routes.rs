//! Exact headless Rust CLI command routing.
//! Original source SHA, write approval boundary and no-overwrite publisher are
//! unchanged; this is the only CLI entrypoint, not a second authoring engine.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn execute() -> Result<Value> {
    let (command, options) = arguments()?;
    match command.as_str() {
        "new" => {
            option_set(&options, &["--output", "--name", "--model-identifier"])?;
            let path = PathBuf::from(option(&options, "--output")?);
            let doc = AuthoringDocument::new_bedrock(
                option(&options, "--name")?, option(&options, "--model-identifier")?
            )?;
            let data = doc.export_bbmodel()?;
            publish_new(&path, &data, MAX_MODEL_BYTES)?;
            Ok(json!({"status":"OK","sha256":sha256(&data),"summary":doc.summary(0)}))
        }
        "inspect" => {
            option_set(&options, &["--input", "--uuid", "--list", "--offset", "--limit", "--texture-index", "--animation-uuid", "--bone-uuid", "--frame-offset", "--frame-limit", "--track-channel", "--surface-uuid", "--face-alpha-uuid", "--alpha-uuid", "--audit", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            bbmodel(&input)?;
            let bytes = read_bounded(&input, MAX_MODEL_BYTES)?;
            let session = EditorSession::open(&bytes)?;
            let digest = sha256(&bytes);
            if let Some(expected) = options.get("--expected-sha256") {
                ensure_source_sha(&digest, expected)?;
            }
            let query_count = ["--uuid", "--list", "--texture-index", "--animation-uuid", "--surface-uuid", "--face-alpha-uuid", "--alpha-uuid", "--audit"]
                .iter().filter(|key| options.contains_key(*key)).count();
            if query_count > 1 ||
                (!options.contains_key("--list") &&
                    (options.contains_key("--offset") || options.contains_key("--limit"))) ||
                (!options.contains_key("--animation-uuid") &&
                    (options.contains_key("--bone-uuid") ||
                     options.contains_key("--frame-offset") ||
                     options.contains_key("--frame-limit"))) ||
                (!options.contains_key("--bone-uuid") &&
                    (options.contains_key("--frame-offset") ||
                     options.contains_key("--frame-limit") ||
                     options.contains_key("--track-channel"))) {
                return Err(fail("INSPECT_QUERY_CONFLICT"));
            }
            if let Some(uuid) = options.get("--uuid") {
                let element = focused_element(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"element":element}))
            } else if let Some(uuid) = options.get("--surface-uuid") {
                let surfaces = inspect_cube_surfaces(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"surfaces":surfaces}))
            } else if let Some(uuid) = options.get("--face-alpha-uuid") {
                let face_alpha = inspect_cube_uv_alpha(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"face_alpha":face_alpha}))
            } else if let Some(kind) = options.get("--list") {
                let offset = options.get("--offset").map(|s|s.parse::<usize>())
                    .transpose().map_err(|_| fail("INSPECT_OFFSET_INVALID"))?.unwrap_or(0);
                let limit = options.get("--limit").map(|s|s.parse::<usize>())
                    .transpose().map_err(|_| fail("INSPECT_LIMIT_INVALID"))?.unwrap_or(32);
                if limit == 0 || limit > 64 { return Err(fail("INSPECT_LIMIT_INVALID")); }
                let catalog = inspect_catalog(session.document(), kind, offset, limit)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"catalog":catalog}))
            } else if let Some(index) = options.get("--texture-index") {
                let asset = inspect_asset(session.document(), "texture", index)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"asset":asset}))
            } else if let Some(uuid) = options.get("--alpha-uuid") {
                let alpha = inspect_paint_alpha(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"alpha":alpha}))
            } else if let Some(uuid) = options.get("--animation-uuid") {
                if let Some(bone_uuid) = options.get("--bone-uuid") {
                    let offset = options.get("--frame-offset").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(0);
                    let limit = options.get("--frame-limit").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(32);
                    let track = if let Some(channel) = options.get("--track-channel") {
                        inspect_transform_track(session.document(), uuid, bone_uuid,
                            channel, offset, limit)?
                    } else {
                        inspect_rotation_track(session.document(), uuid, bone_uuid, offset, limit)?
                    };
                    Ok(json!({"status":"OK","sha256":digest,
                        "summary":session.summary(),"track":track}))
                } else {
                    let asset = inspect_asset(session.document(), "animation", uuid)?;
                    Ok(json!({"status":"OK","sha256":digest,
                        "summary":session.summary(),"asset":asset}))
                }
            } else if let Some(scope) = options.get("--audit") {
                if scope != "model" { return Err(fail("INSPECT_AUDIT_UNSUPPORTED")); }
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"audit":inspect_model_audit(session.document())}))
            } else {
                Ok(json!({"status":"OK","sha256":digest,"summary":session.summary()}))
            }
        }
        "semantic-map" => {
            option_set(&options, &[
                "--input", "--expected-sha256", "--category", "--offset", "--limit",
            ])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&bytes)?;
            let category = option(&options, "--category")?;
            let offset = options.get("--offset").map(|s|s.parse::<usize>())
                .transpose().map_err(|_| fail("SEMANTIC_MAP_PAGE_INVALID"))?.unwrap_or(0);
            let limit = options.get("--limit").map(|s|s.parse::<usize>())
                .transpose().map_err(|_| fail("SEMANTIC_MAP_PAGE_INVALID"))?.unwrap_or(16);
            let map = session.semantic_map(category, offset, limit)?;
            Ok(json!({"status":"OK","sha256":actual_sha,
                "summary":session.summary(),"map":map}))
        }
        "plan-geometry-resize-propagation" => {
            // Read-only SHA-bound G2.2 plan. Explicit attachments do not
            // persist as constraints and never acquire mutation authority.
            option_set(&options, &["--input", "--propagation", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, source_sha256) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let request_bytes = read_bounded(
                Path::new(option(&options, "--propagation")?), MAX_PLAN_BYTES
            )?;
            let request: GeometryResizePropagationRequest =
                serde_json::from_slice(&request_bytes)
                    .map_err(|_| fail("GEOMETRY_PROPAGATION_INPUT_INVALID"))?;
            let session = EditorSession::open(&bytes)?;
            let proposal = session.plan_geometry_resize_propagation(&request)?;
            Ok(json!({
                "status":"OK","sha256":source_sha256,"summary":session.summary(),
                "plan":proposal.plan,"preflight":proposal.preflight,
                "diagnostic":proposal.diagnostic,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "plan-geometry-attachment" => {
            // Read-only G2: one source-local face pair, no persistent
            // constraints, new publisher, or extra write approval bypass.
            option_set(&options, &["--input", "--attachment", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let request_bytes = read_bounded(
                Path::new(option(&options, "--attachment")?), MAX_PLAN_BYTES
            )?;
            let request: GeometryFaceAttachmentRequest =
                serde_json::from_slice(&request_bytes)
                .map_err(|_| fail("GEOMETRY_ATTACHMENT_INPUT_INVALID"))?;
            let session = EditorSession::open(&bytes)?;
            let proposal = session.plan_geometry_attachment(&request)?;
            Ok(json!({
                "status":"OK","sha256":actual_sha,
                "summary":session.summary(),
                "plan":proposal.plan,"preflight":proposal.preflight,
                "diagnostic":proposal.diagnostic,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "plan-geometry-assembly" => {
            // Read-only structure-first compilation; no output path, file
            // mutation, new authority or implicit artist/reference approval.
            option_set(&options, &["--input", "--assembly", "--expected-sha256", "--void-zones"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let request_bytes = read_bounded(
                Path::new(option(&options, "--assembly")?), MAX_PLAN_BYTES
            )?;
            let request: GeometryAssemblyRequest = serde_json::from_slice(&request_bytes)
                .map_err(|_| fail("GEOMETRY_ASSEMBLY_INPUT_INVALID"))?;
            let session = EditorSession::open(&bytes)?;
            let proposed = session.plan_geometry_assembly(&request)?;
            // Optional source-local negative-space guard. A passing local
            // AABB check never certifies whole-model topology or visual fit.
            let void_evidence = if let Some(path)=options.get("--void-zones") {
                let content=read_bounded(Path::new(path),MAX_PLAN_BYTES)?;
                let zones:Vec<GeometryVoidZone>=serde_json::from_slice(&content)
                    .map_err(|_|fail("GEOMETRY_VOID_ZONE_INVALID"))?;
                Some(check_geometry_void_zones(&proposed.plan,&zones)?)
            } else {None};
            let mut receipt=json!({
                "status":"OK","sha256":actual_sha,"summary":session.summary(),
                "plan":proposed.plan,"preflight":proposed.preflight,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED",
            });
            if let Some(evidence)=void_evidence {receipt["void_evidence"]=evidence;}
            Ok(receipt)
        }
        "plan-periodic-rotation" => {
            // A1 Rust-owned wave bake. Read-only source SHA, no publisher
            // and no inference of contact, visual fit or write authority.
            option_set(&options,&["--input","--intent","--expected-sha256"])?;
            let input=PathBuf::from(option(&options,"--input")?);
            let (bytes,actual_sha)=read_verified_source(
                &input,option(&options,"--expected-sha256")?)?;
            let data=read_bounded(
                Path::new(option(&options,"--intent")?),MAX_PLAN_BYTES)?;
            let request:PeriodicRotationIntent=serde_json::from_slice(&data)
                .map_err(|_|fail("PERIODIC_ROTATION_INTENT_INVALID"))?;
            let session=EditorSession::open(&bytes)?;
            let proposal=session.plan_periodic_rotation(&request)?;
            Ok(json!({
                "status":"OK","sha256":actual_sha,"summary":session.summary(),
                "plan":proposal.plan,"preflight":proposal.preflight,
                "motion_evidence":proposal.motion_evidence,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "plan-semantic-animation" => {
            // Read-only authored key poses + contact/temporal review hints.
            // Source SHA and independent Rust Apply remain mandatory.
            option_set(&options,&["--input","--intent","--expected-sha256"])?;
            let input=PathBuf::from(option(&options,"--input")?);
            let (bytes,actual_sha)=read_verified_source(
                &input,option(&options,"--expected-sha256")?)?;
            let data=read_bounded(
                Path::new(option(&options,"--intent")?),MAX_PLAN_BYTES)?;
            let request:SemanticAnimationIntent=serde_json::from_slice(&data)
                .map_err(|_|fail("SEMANTIC_ANIMATION_INPUT_INVALID"))?;
            let session=EditorSession::open(&bytes)?;
            let proposal=session.plan_semantic_animation(&request)?;
            Ok(json!({
                "status":"OK","sha256":actual_sha,"summary":session.summary(),
                "plan":proposal.plan,"preflight":proposal.preflight,
                "motion_evidence":proposal.motion_evidence,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "review-existing-animation" => {
            // Source-SHA-bound review; optional exact key correction is one
            // uncommitted native EditPlan, NOT a write/publisher or visual pass.
            option_set(&options,&["--input","--intent","--expected-sha256"])?;
            let input=PathBuf::from(option(&options,"--input")?);
            let (bytes,actual_sha)=read_verified_source(
                &input,option(&options,"--expected-sha256")?)?;
            let data=read_bounded(
                Path::new(option(&options,"--intent")?),MAX_PLAN_BYTES)?;
            let request:ExistingAnimationIntent=serde_json::from_slice(&data)
                .map_err(|_|fail("EXISTING_ANIMATION_INTENT_INVALID"))?;
            let session=EditorSession::open(&bytes)?;
            let review=session.review_existing_animation(&request)?;
            Ok(json!({
                "status":"OK","sha256":actual_sha,"summary":session.summary(),
                "analysis":review.analysis,"plan":review.plan,
                "preflight":review.preflight,
                "correction_evidence":review.correction_evidence,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "plan-semantic-material" => {
            // P0 only: bounded reviewer-authored material intent, Rust
            // source pixels/UV and disposable preflight. NO file publisher.
            option_set(&options, &["--input","--intent","--expected-sha256"])?;
            let input=PathBuf::from(option(&options,"--input")?);
            let (bytes,actual_sha)=read_verified_source(
                &input,option(&options,"--expected-sha256")?)?;
            let content=read_bounded(
                Path::new(option(&options,"--intent")?),MAX_PLAN_BYTES)?;
            let intent:SemanticMaterialIntent=serde_json::from_slice(&content)
                .map_err(|_|fail("SEMANTIC_MATERIAL_INPUT_INVALID"))?;
            let session=EditorSession::open(&bytes)?;
            let proposal=session.plan_semantic_material(&intent)?;
            Ok(json!({
                "status":"OK","sha256":actual_sha,
                "summary":session.summary(),
                "plan":proposal.plan,"preflight":proposal.preflight,
                "material_evidence":proposal.material_evidence,
                "write_authority":"NOT_GRANTED","visual_verdict":"UNVERIFIED"
            }))
        }
        "preflight" => {
            // Read-only dry-run: no output filename, file publisher, native
            // Save, model state commit or implicit mutation authorization.
            option_set(&options, &["--input", "--plan", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let plan_bytes = read_bounded(
                Path::new(option(&options, "--plan")?), MAX_PLAN_BYTES
            )?;
            let plan: EditPlan = serde_json::from_slice(&plan_bytes)
                .map_err(|_| fail("PREFLIGHT_PLAN_INVALID"))?;
            let session = EditorSession::open(&bytes)?;
            let preflight = session.preflight(&plan)?;
            Ok(json!({"status":"OK","sha256":actual_sha,
                "summary":session.summary(),"preflight":preflight}))
        }
        "inspect-batch" => {
            option_set(&options, &["--input", "--queries", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            // One model open across all bounded, read-only selectors.
            let session = EditorSession::open(&bytes)?;
            let query_bytes = read_bounded(
                Path::new(option(&options, "--queries")?), MAX_PLAN_BYTES
            )?;
            let queries: InspectBatchInput = serde_json::from_slice(&query_bytes)
                .map_err(|_| fail("INSPECT_BATCH_INVALID"))?;
            let results = inspect_batch_session(&session, queries.requests)?;
            let response = json!({
                "status":"OK","sha256":actual_sha,
                "summary":session.summary(),"results":results
            });
            if serde_json::to_vec(&response)
                .map_err(|_| fail("INSPECT_BATCH_SERIALIZE_FAILED"))?.len()
                > MAX_INSPECT_BATCH_RESULT_BYTES {
                return Err(fail("INSPECT_BATCH_RESULT_TOO_LARGE"));
            }
            Ok(response)
        }
        "inspect-visual-pair" => {
            option_set(&options, &[
                "--input", "--expected-sha256",
                "--reference", "--reference-sha256",
                "--capture", "--capture-sha256",
            ])?;
            let source = PathBuf::from(option(&options, "--input")?);
            let (_, model_sha) = read_verified_source(
                &source, option(&options, "--expected-sha256")?)?;
            let reference = PathBuf::from(option(&options, "--reference")?);
            let capture = PathBuf::from(option(&options, "--capture")?);
            png(&reference)?;
            png(&capture)?;
            let original = read_bounded(&reference, MAX_VISUAL_PNG_BYTES)?;
            let observed = read_bounded(&capture, MAX_VISUAL_PNG_BYTES)?;
            let reference_sha = sha256(&original);
            let capture_sha = sha256(&observed);
            let expected_reference = option(&options, "--reference-sha256")?;
            let expected_capture = option(&options, "--capture-sha256")?;
            if expected_reference.len() != 64 ||
                !expected_reference.bytes().all(|b| b.is_ascii_hexdigit()) ||
                !reference_sha.eq_ignore_ascii_case(expected_reference) {
                return Err(fail("VISUAL_PAIR_REFERENCE_SHA_STALE"));
            }
            if expected_capture.len() != 64 ||
                !expected_capture.bytes().all(|b| b.is_ascii_hexdigit()) ||
                !capture_sha.eq_ignore_ascii_case(expected_capture) {
                return Err(fail("VISUAL_PAIR_CAPTURE_SHA_STALE"));
            }
            let report = inspect_visual_png_pair(&original, &observed)?;
            if sha256(&read_bounded(&source, MAX_MODEL_BYTES)?) != model_sha {
                return Err(fail("SOURCE_CHANGED_DURING_VISUAL_INSPECTION"));
            }
            Ok(json!({
                "status":"OK","source_model_sha256":model_sha,
                "reference_png_sha256":reference_sha,
                "capture_png_sha256":capture_sha,
                "comparison":report
            }))
        }
        "apply" => {
            option_set(&options, &["--input", "--output", "--plan", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            bbmodel(&output)?;
            same_directory(&input, &output)?;
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let plan_bytes = read_bounded(
                Path::new(option(&options, "--plan")?), MAX_PLAN_BYTES
            )?;
            let plan: EditPlan = serde_json::from_slice(&plan_bytes)
                .map_err(|_| fail("EDIT_PLAN_INVALID"))?;
            let mut session = EditorSession::open(&bytes)?;
            let receipt = session.apply_with_correction_scope(
                plan.expected_revision, &plan.operations,
                plan.correction_scope.as_ref(),
            )?;
            // Every declared correction region has an explicit diagnostic.
            // Pixel statistics never certify form-following artistic quality;
            // unmeasured regions stay visible in the receipt.
            let styling_evidence=plan.correction_scope.as_ref().map(|scope|{
                let regions:Vec<MaterialPatchRegion>=scope.allowed_regions.iter()
                    .map(|r|MaterialPatchRegion{from:r.from,to:r.to}).collect();
                inspect_texture_styling_regions(
                    session.document(),&scope.texture_uuid,&regions
                ).unwrap_or_else(|_|json!({
                    "scope":"all_declared_correction_regions",
                    "texture_uuid":scope.texture_uuid,
                    "region_count":regions.len(),
                    "source_measured_regions":0,
                    "source_unavailable_regions":regions.len(),
                    "warning_regions":0,
                    "coverage":"partial",
                    "regions":regions.iter().enumerate().map(|(index,r)|json!({
                        "index":index,"region":r,"status":"NOT_EVALUATED",
                        "source_measured":false,
                        "reason":"TEXTURE_STYLING_INSPECTION_UNAVAILABLE",
                        "review_hints":[]
                    })).collect::<Vec<_>>(),
                    "visual_verdict":"UNVERIFIED",
                    "texture_completion_attested":false
                }))
            });
            let out = session.export()?;
            // Another writer may have changed the source while the batch ran.
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != actual_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &out, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK","source_sha256":actual_sha,"output_sha256":sha256(&out),
                "summary":session.summary(),"mutation":receipt,
                "texture_styling_evidence":styling_evidence,
                "correction_scope":plan.correction_scope.as_ref().map(|scope|json!({
                    "status":"enforced","texture_uuid":scope.texture_uuid,
                    "protected_regions":scope.protected_regions.len(),
                    "expected_before_pixels":scope.expected_before_pixels.len(),
                    "editable_before_rgba":scope.editable_before_rgba.len(),
                    "visual_verdict":"UNVERIFIED"
                }))
            }))
        }
        "import-png" => {
            option_set(&options, &[
                "--input", "--output", "--png", "--uuid", "--name", "--expected-sha256",
            ])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            let image = PathBuf::from(option(&options, "--png")?);
            bbmodel(&output)?;
            same_directory(&input, &output)?;
            png(&image)?;
            let (bytes, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let png_bytes = read_bounded(&image, MAX_IMPORT_PNG_BYTES)?;
            // Only the original embedded image enters Rust model state.
            // The input file path is never written into the .bbmodel.
            let source = format!("data:image/png;base64,{}", STANDARD.encode(png_bytes));
            let mut session = EditorSession::open(&bytes)?;
            let receipt = session.apply(0, &[EditOperation::ImportPaintTexture {
                uuid: option(&options, "--uuid")?.to_owned(),
                name: option(&options, "--name")?.to_owned(),
                source,
            }])?;
            let output_bytes = session.export()?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &output_bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&output_bytes), "summary":session.summary(),
                "mutation":receipt
            }))
        }
        "export-png" => {
            option_set(&options, &[
                "--input", "--output", "--texture-uuid", "--expected-sha256",
            ])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            png(&output)?;
            same_directory(&input, &output)?;
            let (bytes, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&bytes)?;
            let uuid = option(&options, "--texture-uuid")?;
            let png_bytes = export_paint_png(session.document(), uuid)?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&png_bytes),
                "texture_uuid":uuid, "bytes":png_bytes.len(),
                "summary":session.summary()
            }))
        }
        "export-geometry" => {
            option_set(&options, &["--input", "--output", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            geometry_json(&output)?;
            same_directory(&input, &output)?;
            let (original, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&original)?;
            let bytes = export_bedrock_geometry(session.document())?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&bytes), "bytes":bytes.len(),
                "format":"minecraft:geometry", "summary":session.summary()
            }))
        }
        "export-animation" => {
            option_set(&options, &["--input", "--output", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            animation_json(&output)?;
            same_directory(&input, &output)?;
            let (original, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&original)?;
            let bytes = export_bedrock_animations(session.document())?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_animation(&output, &bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&bytes), "bytes":bytes.len(),
                "format":"minecraft:animation",
                "curve_fidelity":bedrock_animation_curve_fidelity(session.document()),
                "summary":session.summary()
            }))
        }
        _ => Err(fail("UNKNOWN_COMMAND_USE_NEW_INSPECT_INSPECT_VISUAL_PAIR_APPLY_IMPORT_PNG_EXPORT_PNG_EXPORT_GEOMETRY_EXPORT_ANIMATION")),
    }
}
