//! Shared bounded local project file I/O for CLI and Desktop authoring.
//! Publishing is no-overwrite only; never claim native Windows proof from source.

use rand::RngCore;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

pub fn read_bounded(path: &Path, max: usize) -> Result<Vec<u8>> {
    let stat = fs::symlink_metadata(path).map_err(|_| fail("INPUT_NOT_AVAILABLE"))?;
    if !stat.file_type().is_file() || stat.len() > max as u64 {
        return Err(fail("INPUT_TYPE_OR_SIZE_INVALID"));
    }
    let file = File::open(path).map_err(|_| fail("INPUT_OPEN_FAILED"))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes).map_err(|_| fail("INPUT_READ_FAILED"))?;
    if bytes.is_empty() || bytes.len() > max { return Err(fail("INPUT_SIZE_INVALID")); }
    Ok(bytes)
}

pub fn parent(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

pub fn bbmodel(path: &Path) -> Result<()> {
    if path.extension().and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("bbmodel")) {
        Ok(())
    } else {
        Err(fail("BBMODEL_EXTENSION_REQUIRED"))
    }
}

/// Output must be a new sibling of the input. This protects references that
/// Blockbench wrote relative to the original project directory.
pub fn same_directory(input: &Path, output: &Path) -> Result<()> {
    let a = fs::canonicalize(parent(input)).map_err(|_| fail("SOURCE_PARENT_UNAVAILABLE"))?;
    let b = fs::canonicalize(parent(output)).map_err(|_| fail("OUTPUT_PARENT_UNAVAILABLE"))?;
    if a != b { Err(fail("OUTPUT_MUST_BE_SOURCE_SIBLING")) } else { Ok(()) }
}

/// Publish a new complete file using a private sync'd stage and an exclusive
/// hard link. Existing files are NEVER overwritten. Unsupported file systems
/// fail closed. This is not proven against adversarial directory replacement.
pub fn publish_new(path: &Path, data: &[u8], limit: usize) -> Result<()> {
    bbmodel(path)?;
    if data.is_empty() || data.len() > limit { return Err(fail("OUTPUT_SIZE_INVALID")); }
    if fs::symlink_metadata(path).is_ok() { return Err(fail("OUTPUT_ALREADY_EXISTS")); }
    let dir = parent(path);
    if !dir.is_dir() { return Err(fail("OUTPUT_PARENT_UNAVAILABLE")); }
    let name = path.file_name().and_then(|s| s.to_str())
        .ok_or_else(|| fail("OUTPUT_FILENAME_INVALID"))?;
    for _ in 0..8 {
        let temporary = dir.join(format!(".{name}.{:016x}.tmp", rand::rng().next_u64()));
        let mut file = match OpenOptions::new().create_new(true).write(true).open(&temporary) {
            Ok(value) => value,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(fail("OUTPUT_STAGE_FAILED")),
        };
        let result = (|| -> Result<()> {
            file.write_all(data).map_err(|_| fail("OUTPUT_WRITE_FAILED"))?;
            file.sync_all().map_err(|_| fail("OUTPUT_SYNC_FAILED"))?;
            drop(file);
            fs::hard_link(&temporary, path)
                .map_err(|_| fail("OUTPUT_EXISTS_OR_HARDLINK_UNAVAILABLE"))?;
            Ok(())
        })();
        let _ = fs::remove_file(&temporary);
        return result;
    }
    Err(fail("OUTPUT_STAGE_COLLISION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Authored-only regression; NOT_EXECUTED under the repository test hold.
    #[test]
    fn output_never_overwrites_existing() {
        let dir = std::env::temp_dir()
            .join(format!("lazydesigner-io-{:016x}", rand::rng().next_u64()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("original.bbmodel");
        fs::write(&path, b"untouched").unwrap();
        assert_eq!(publish_new(&path, b"replace", 1024).unwrap_err(),
            "OUTPUT_ALREADY_EXISTS");
        assert_eq!(fs::read(&path).unwrap(), b"untouched");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
