//! Provisional semantic-material candidate validation for the Rust desktop.
//! Reuses the canonical Rust plan and temporary EditorSession. The caller's
//! detached_edit/epoch/revision gate remains the *only* live editor publisher;
//! this is not an AI guest authorizer or independent material/bitmap engine.
//! SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn preview_semantic_candidate(
    source:&EditorSession, intent:&SemanticMaterialIntent,
) -> Result<(SemanticMaterialProposal,EditorSession),DesktopError> {
    let proposal=source.plan_semantic_material(intent).map_err(model_failure)?;
    let mut candidate=source.clone();
    candidate.apply_with_correction_scope(
        intent.expected_revision,&proposal.plan.operations,
        proposal.plan.correction_scope.as_ref(),
    ).map_err(model_failure)?;
    let candidate_sha=candidate.canonical_sha256().map_err(model_failure)?;
    if proposal.preflight["candidate_sha256"].as_str()!=Some(candidate_sha.as_str()) ||
       proposal.preflight["visual_verdict"]!="UNVERIFIED" ||
       proposal.preflight["write_authority"]!="NOT_GRANTED" {
        return Err(failure("SEMANTIC_PREVIEW_NATIVE_MISMATCH",
            "The provisional candidate did not match the Rust dry-run."));
    }
    Ok((proposal,candidate))
}


/// The same exact source/model/candidate contract applies to direct-user
/// commits as to the last ephemeral visual preview. Never partially mutate
/// even an intermediate EditorSession if the final candidate SHA diverges.
pub(super) fn apply_checked_semantic_candidate(
    session:&mut EditorSession,
    intent:&SemanticMaterialIntent,
    expected_source_sha:&str,
    expected_candidate_sha:&str,
) -> Result<(),DesktopError> {
    if session.canonical_sha256().map_err(model_failure)?!=expected_source_sha {
        return Err(failure("SEMANTIC_PREVIEW_SOURCE_STALE",
            "The original model changed since the candidate preview."));
    }
    let proposal=session.plan_semantic_material(intent).map_err(model_failure)?;
    if proposal.preflight["candidate_sha256"].as_str()!=Some(expected_candidate_sha) {
        return Err(failure("SEMANTIC_PREVIEW_CANDIDATE_STALE",
            "Regenerate and inspect the current material preview."));
    }
    let mut candidate=session.clone();
    candidate.apply_with_correction_scope(
        intent.expected_revision,&proposal.plan.operations,
        proposal.plan.correction_scope.as_ref(),
    ).map_err(model_failure)?;
    if candidate.canonical_sha256().map_err(model_failure)?!=expected_candidate_sha {
        return Err(failure("SEMANTIC_PREVIEW_APPLY_MISMATCH",
            "The candidate changed during the protected Paint transaction."));
    }
    *session=candidate; // Publish only after all checksum/source guards pass.
    Ok(())
}
