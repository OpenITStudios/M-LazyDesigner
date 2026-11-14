//! Standalone headless adapter to the canonical Rust authoring library.
//! SOURCE ONLY: Windows CLI, filesystem and Blockbench behavior NOT_EXECUTED.

use lazydesigner::authoring::{
    sha256, AuthoringDocument, EditPlan, EditorSession, MAX_MODEL_BYTES, MAX_PLAN_BYTES,
};
use rand::RngCore;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.into() }

fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>> {
    let stat = fs::symlink_metadata(path).map_err(|_| fail("INPUT_NOT_AVAILABLE"))?;
    if !stat.file_type().is_file() || stat.len() > max as u64 {
        return Err(fail("INPUT_TYPE_OR_SIZE_INVALID"));
    }
    let file = File::open(path).map_err(|_| fail("INPUT_OPEN_FAILED"))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| fail("INPUT_READ_FAILED"))?;
    if bytes.is_empty() || bytes.len() > max { return Err(fail("INPUT_SIZE_INVALID")); }
    Ok(bytes)
}
fn parent(path: &Path) -> &Path {
    match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    }
}
fn bbmodel(path: &Path) -> Result<()> {
    if path.extension().and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("bbmodel")) { Ok(()) }
    else { Err(fail("BBMODEL_EXTENSION_REQUIRED")) }
}

/// An exclusive non-overwriting publish. Hard-link creation is atomic on
/// supported filesystems; unsupported filesystems fail closed without damage.
fn publish_new(path: &Path, content: &[u8]) -> Result<()> {
    bbmodel(path)?;
    if content.is_empty() || content.len() > MAX_MODEL_BYTES {
        return Err(fail("OUTPUT_SIZE_INVALID"));
    }
    if fs::symlink_metadata(path).is_ok() { return Err(fail("OUTPUT_ALREADY_EXISTS")); }
    let directory = parent(path);
    if !directory.is_dir() { return Err(fail("OUTPUT_PARENT_UNAVAILABLE")); }
    let filename = path.file_name().and_then(|v| v.to_str())
        .ok_or_else(|| fail("OUTPUT_FILENAME_INVALID"))?;
    for _ in 0..8 {
        let temp = directory.join(format!(".{filename}.{:016x}.tmp", rand::rng().next_u64()));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(fail("OUTPUT_STAGE_FAILED")),
        };
        let result = (|| -> Result<()> {
            file.write_all(content).map_err(|_| fail("OUTPUT_WRITE_FAILED"))?;
            file.sync_all().map_err(|_| fail("OUTPUT_SYNC_FAILED"))?;
            drop(file);
            fs::hard_link(&temp, path)
                .map_err(|_| fail("OUTPUT_EXISTS_OR_HARDLINK_UNAVAILABLE"))?;
            Ok(())
        })();
        let _ = fs::remove_file(&temp);
        return result;
    }
    Err(fail("OUTPUT_STAGE_COLLISION"))
}

fn same_directory(input: &Path, output: &Path) -> Result<()> {
    let left = fs::canonicalize(parent(input)).map_err(|_| fail("SOURCE_PARENT_UNAVAILABLE"))?;
    let right = fs::canonicalize(parent(output)).map_err(|_| fail("OUTPUT_PARENT_UNAVAILABLE"))?;
    if left != right { Err(fail("OUTPUT_MUST_BE_SOURCE_SIBLING")) } else { Ok(()) }
}

fn arguments() -> Result<(String, BTreeMap<String, String>)> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or_else(|| fail("COMMAND_REQUIRED"))?;
    let mut options = BTreeMap::new();
    while let Some(key) = args.next() {
        if !key.starts_with("--") || key.len() < 3 { return Err(fail("OPTION_INVALID")); }
        let value = args.next().ok_or_else(|| fail("OPTION_VALUE_REQUIRED"))?;
        if value.starts_with("--") || options.insert(key, value).is_some() {
            return Err(fail("OPTION_DUPLICATE_OR_INVALID"));
        }
    }
    Ok((command, options))
}
fn option<'a>(options: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str> {
    options.get(key).map(String::as_str).ok_or_else(|| fail("OPTION_REQUIRED"))
}
fn option_set(options: &BTreeMap<String, String>, allowed: &[&str]) -> Result<()> {
    let allowed: HashSet<&str> = allowed.iter().copied().collect();
    if options.keys().any(|k| !allowed.contains(k.as_str())) {
        Err(fail("OPTION_UNKNOWN"))
    } else { Ok(()) }
}

fn execute() -> Result<Value> {
    let (command, options) = arguments()?;
    match command.as_str() {
        "new" => {
            option_set(&options, &["--output", "--name", "--model-identifier"])?;
            let path = PathBuf::from(option(&options, "--output")?);
            let doc = AuthoringDocument::new_bedrock(
                option(&options, "--name")?, option(&options, "--model-identifier")?
            )?;
            let data = doc.export_bbmodel()?;
            publish_new(&path, &data)?;
            Ok(json!({"status":"OK","sha256":sha256(&data),"summary":doc.summary(0)}))
        }
        "inspect" => {
            option_set(&options, &["--input"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            bbmodel(&input)?;
            let bytes = read_bounded(&input, MAX_MODEL_BYTES)?;
            let session = EditorSession::open(&bytes)?;
            Ok(json!({"status":"OK","sha256":sha256(&bytes),"summary":session.summary()}))
        }
        "apply" => {
            option_set(&options, &["--input", "--output", "--plan", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            bbmodel(&input)?;
            bbmodel(&output)?;
            same_directory(&input, &output)?;
            let bytes = read_bounded(&input, MAX_MODEL_BYTES)?;
            let actual_sha = sha256(&bytes);
            let expected_sha = option(&options, "--expected-sha256")?;
            if expected_sha.len() != 64 ||
               !expected_sha.bytes().all(|b| b.is_ascii_hexdigit()) ||
               !actual_sha.eq_ignore_ascii_case(expected_sha) {
                return Err(fail("SOURCE_SHA256_STALE"));
            }
            let plan_bytes = read_bounded(
                Path::new(option(&options, "--plan")?), MAX_PLAN_BYTES
            )?;
            let plan: EditPlan = serde_json::from_slice(&plan_bytes)
                .map_err(|_| fail("EDIT_PLAN_INVALID"))?;
            let mut session = EditorSession::open(&bytes)?;
            let receipt = session.apply(plan.expected_revision, &plan.operations)?;
            let out = session.export()?;
            // Another writer may have changed the source while the batch ran.
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != actual_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &out)?;
            Ok(json!({
                "status":"OK","source_sha256":actual_sha,"output_sha256":sha256(&out),
                "summary":session.summary(),"mutation":receipt
            }))
        }
        _ => Err(fail("UNKNOWN_COMMAND_USE_NEW_INSPECT_APPLY")),
    }
}

fn main() {
    match execute() {
        Ok(report) => println!("{}", report),
        Err(code) => {
            println!("{}", json!({"status":"ERROR","code":code}));
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Source-authored regression only; native filesystem execution is held.
    #[test]
    fn refuses_to_overwrite_an_existing_project() {
        let folder = std::env::temp_dir().join(
            format!("lazydesigner-regression-{:016x}", rand::rng().next_u64())
        );
        fs::create_dir(&folder).unwrap();
        let target = folder.join("existing.bbmodel");
        fs::write(&target, b"original").unwrap();
        assert_eq!(publish_new(&target, b"replacement").unwrap_err(), "OUTPUT_ALREADY_EXISTS");
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(target).unwrap();
        fs::remove_dir(folder).unwrap();
    }
}
