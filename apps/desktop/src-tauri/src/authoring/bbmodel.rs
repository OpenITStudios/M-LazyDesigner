//! Pinned Blockbench v5.2.1 editable .bbmodel format adapter (format 5.0).
//! The serde wire shape is NOT the authoritative Rust document schema.

use super::{
    AuthoringDocument, Bone, Cube, OutlinerNode, ProjectMeta, TextureResolution, MAX_MODEL_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::{self, Write};
type Result<T> = std::result::Result<T, String>;

#[derive(Serialize, Deserialize)]
struct BlockbenchV5 {
    meta: ProjectMeta,
    resolution: TextureResolution,
    elements: Vec<Cube>,
    groups: Vec<Bone>,
    outliner: Vec<OutlinerNode>,
    textures: Vec<Value>,
    #[serde(default)]
    animations: Vec<Value>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl From<BlockbenchV5> for AuthoringDocument {
    fn from(wire: BlockbenchV5) -> Self {
        Self {
            meta: wire.meta, resolution: wire.resolution,
            cubes: wire.elements, bones: wire.groups, hierarchy: wire.outliner,
            texture_assets: wire.textures, animation_assets: wire.animations,
            extensions: wire.extra,
        }
    }
}

// The owned wire is still required for deserialization. On export it used to
// clone every Cube, Bone, PNG Base64 string, animation and opaque extension
// before serde allocated the final JSON buffer. A borrowed wire preserves the
// same field names/order/flattening while serializing the canonical document
// without that second complete asset allocation.
#[derive(Serialize)]
struct BorrowedBlockbenchV5<'a> {
    meta: &'a ProjectMeta,
    resolution: &'a TextureResolution,
    elements: &'a [Cube],
    groups: &'a [Bone],
    outliner: &'a [OutlinerNode],
    textures: &'a [Value],
    animations: &'a [Value],
    #[serde(flatten)]
    extra: &'a Map<String, Value>,
}

impl<'a> From<&'a AuthoringDocument> for BorrowedBlockbenchV5<'a> {
    fn from(doc: &'a AuthoringDocument) -> Self {
        Self {
            meta: &doc.meta, resolution: &doc.resolution,
            elements: &doc.cubes, groups: &doc.bones,
            outliner: &doc.hierarchy, textures: &doc.texture_assets,
            animations: &doc.animation_assets, extra: &doc.extensions,
        }
    }
}

// Keep the original cloning encoder only for byte-for-byte regression
// comparison. It is not part of production export or the Undo/Dirty path.
#[cfg(test)]
impl From<&AuthoringDocument> for BlockbenchV5 {
    fn from(doc: &AuthoringDocument) -> Self {
        Self {
            meta: doc.meta.clone(), resolution: doc.resolution.clone(),
            elements: doc.cubes.clone(), groups: doc.bones.clone(),
            outliner: doc.hierarchy.clone(), textures: doc.texture_assets.clone(),
            animations: doc.animation_assets.clone(), extra: doc.extensions.clone(),
        }
    }
}

pub(super) fn decode(bytes: &[u8]) -> Result<AuthoringDocument> {
    if bytes.is_empty() || bytes.len() > MAX_MODEL_BYTES || bytes.starts_with(b"<lz>") {
        return Err("BBMODEL_INPUT_UNSUPPORTED".into());
    }
    let wire: BlockbenchV5 = serde_json::from_slice(bytes)
        .map_err(|_| "BBMODEL_PARSE_INVALID".to_string())?;
    let doc = AuthoringDocument::from(wire);
    doc.validate()?;
    Ok(doc)
}

pub(super) fn encode(doc: &AuthoringDocument) -> Result<Vec<u8>> {
    doc.validate()?;
    let wire = BorrowedBlockbenchV5::from(doc);
    let mut out = serde_json::to_vec_pretty(&wire)
        .map_err(|_| "BBMODEL_SERIALIZE_FAILED".to_string())?;
    out.push(b'\n');
    if out.len() > MAX_MODEL_BYTES { return Err("BBMODEL_OUTPUT_TOO_LARGE".into()); }
    Ok(out)
}

// Streaming canonical fingerprint for the editor's Dirty indicator. The
// SHA-256 input is the same pretty-printed .bbmodel byte stream, including
// its final newline, as encode(). A bounded Write sink avoids materializing
// an extra multi-megabyte JSON buffer on every Apply/Undo/Redo.
struct CanonicalDigestSink {
    digest: Sha256,
    bytes: usize,
    over_limit: bool,
}

impl CanonicalDigestSink {
    fn new() -> Self {
        Self { digest: Sha256::new(), bytes: 0, over_limit: false }
    }
}

impl Write for CanonicalDigestSink {
    fn write(&mut self, chunk: &[u8]) -> io::Result<usize> {
        let next = self.bytes.checked_add(chunk.len());
        if next.is_none_or(|len| len > MAX_MODEL_BYTES) {
            self.over_limit = true;
            return Err(io::Error::other("BBMODEL_OUTPUT_TOO_LARGE"));
        }
        self.digest.update(chunk);
        self.bytes = next.unwrap();
        Ok(chunk.len())
    }

    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

pub(super) fn canonical_sha256(doc: &AuthoringDocument) -> Result<String> {
    doc.validate()?;
    let wire = BorrowedBlockbenchV5::from(doc);
    let mut sink = CanonicalDigestSink::new();
    if serde_json::to_writer_pretty(&mut sink, &wire).is_err() ||
       sink.write_all(b"\n").is_err() {
        return Err(if sink.over_limit {
            "BBMODEL_OUTPUT_TOO_LARGE".into()
        } else {
            "BBMODEL_SERIALIZE_FAILED".into()
        });
    }
    Ok(format!("{:x}", sink.digest.finalize()))
}

// SOURCE-AUTHORED_NOT_RUN: executable Rust/Windows and native Blockbench
// checks remain on hold. The old owned serializer is the byte-level oracle.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn previous_owned_encode(doc: &AuthoringDocument) -> Vec<u8> {
        doc.validate().unwrap();
        let cloned_wire = BlockbenchV5::from(doc);
        let mut out = serde_json::to_vec_pretty(&cloned_wire).unwrap();
        out.push(b'\n');
        out
    }

    #[test]
    fn borrowed_export_is_byte_identical_to_owned_v5_format_with_opaque_assets() {
        const BASIC: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        const TEXTURED: &[u8] =
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel");

        let plain = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let textured = AuthoringDocument::import_bbmodel(TEXTURED).unwrap();
        let mut extended = plain.clone();
        extended.extensions.insert("vendor_extension".into(), json!({
            "nested": ["preserve", {"enabled": true, "opaque": [3, 2, 1]}],
            "large_note": "keep".repeat(8192),
        }));
        extended.animation_assets.push(json!({
            "uuid": "00000000-0000-4000-8000-000000009901",
            "name": "animation.source",
            "length": 2.0,
            "animators": {},
            "vendor_track_payload": {"unchanged": [true, 42, "native"]},
        }));
        for doc in [plain, textured, extended] {
            let untouched = doc.clone();
            let expected = previous_owned_encode(&doc);
            let actual = encode(&doc).unwrap();
            assert_eq!(canonical_sha256(&doc).unwrap(),
                super::super::sha256(&actual));
            assert_eq!(actual, expected,
                "borrowed wire must preserve pretty JSON bytes and final newline");
            assert_eq!(AuthoringDocument::import_bbmodel(&actual).unwrap(), doc);
            assert_eq!(doc, untouched, "export must not mutate canonical state");
        }
    }

    #[test]
    fn streaming_digest_enforces_the_same_output_byte_budget() {
        let mut sink = CanonicalDigestSink::new();
        let chunk = [0_u8; 1024];
        for _ in 0..(MAX_MODEL_BYTES / chunk.len()) {
            sink.write_all(&chunk).unwrap();
        }
        assert_eq!(sink.bytes, MAX_MODEL_BYTES);
        assert!(sink.write_all(b"\n").is_err());
        assert!(sink.over_limit);
    }

    #[test]
    fn borrowed_export_keeps_original_rejection_before_serialization() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.texture_assets.push(Value::Null);
        assert_eq!(encode(&doc).unwrap_err(), "BBMODEL_ASSET_ENTRY_INVALID");
        assert_eq!(canonical_sha256(&doc).unwrap_err(),
            "BBMODEL_ASSET_ENTRY_INVALID");
    }
}
