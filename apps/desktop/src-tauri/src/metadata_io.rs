//! Small Desktop-owned JSON only; never call for Blockbench/user assets.
use rand::Rng;
use std::{fs::{self, OpenOptions}, io::{self, Write}, path::Path};

pub(crate) fn replace_metadata(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().filter(|p| p.is_dir())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Metadata parent directory unavailable."))?;
    let name = path.file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing metadata filename."))?;
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.file_type().is_file() =>
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Metadata target must be a regular file.")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
        _ => {}
    }
    for _ in 0..8 {
        let mut nonce = [0u8; 8];
        rand::rng().fill_bytes(&mut nonce);
        let temp = parent.join(format!(".{}.{}.tmp", name.to_string_lossy(), u64::from_le_bytes(nonce)));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => file,
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        };
        let result = (|| -> io::Result<()> {
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            // Same-directory rename replaces complete contents, never unlinking the old file first.
            fs::rename(&temp, path)
        })();
        if result.is_err() { let _ = fs::remove_file(&temp); }
        return result;
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "No unique metadata staging path available."))
}

/** Bounded regular-file read; never follow links or read arbitrary large assets. */
pub(crate) fn read_metadata_bounded(path: &Path) -> io::Result<Option<Vec<u8>>> {
    const MAX_BYTES: u64 = 64 * 1024;
    let stat = match fs::symlink_metadata(path) {
        Ok(stat) => stat,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !stat.file_type().is_file() || stat.len() > MAX_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Metadata must be a bounded regular file."));
    }
    let bytes = fs::read(path)?;
    if bytes.len() > MAX_BYTES as usize {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Metadata exceeds the size limit."));
    }
    Ok(Some(bytes))
}

pub(crate) fn recovery_path(path: &Path) -> io::Result<std::path::PathBuf> {
    let name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Metadata filename is missing.")
    })?;
    Ok(path.with_file_name(format!("{}.bak", name.to_string_lossy())))
}

/// Best-effort snapshot comparison under Desktop single-instance ownership.
/// Not a cross-process compare-and-swap or an across-files transaction.
pub(crate) fn replace_metadata_if_unchanged(
    path: &Path, next: &[u8], expected: Option<&[u8]>, preserve_previous: bool,
) -> io::Result<()> {
    if next.len() > 64 * 1024 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Metadata exceeds the size limit."));
    }
    let current = read_metadata_bounded(path)?;
    if current.as_deref() != expected {
        return Err(io::Error::new(io::ErrorKind::WouldBlock, "Metadata changed since it was read."));
    }
    if preserve_previous {
        if let Some(previous) = current.as_deref() {
            replace_metadata(&recovery_path(path)?, previous)?;
        }
    }
    if read_metadata_bounded(path)?.as_deref() != expected {
        return Err(io::Error::new(io::ErrorKind::WouldBlock, "Metadata changed during checkpoint."));
    }
    replace_metadata(path, next)
}

/// Preserve malformed original independently before any explicit restoration.
pub(crate) fn preserve_damaged_metadata(path: &Path, original: &[u8]) -> io::Result<std::path::PathBuf> {
    if read_metadata_bounded(path)?.as_deref() != Some(original) {
        return Err(io::Error::new(io::ErrorKind::WouldBlock, "Damaged metadata changed."));
    }
    let parent = path.parent().filter(|p| p.is_dir())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Metadata directory unavailable."))?;
    let name = path.file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Metadata filename unavailable."))?;
    for _ in 0..8 {
        let mut nonce = [0u8; 8];
        rand::rng().fill_bytes(&mut nonce);
        let saved = parent.join(format!("{}.corrupt-{:016x}.bak", name.to_string_lossy(), u64::from_le_bytes(nonce)));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&saved) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let result = (|| -> io::Result<()> {
            file.write_all(original)?;
            file.sync_all()
        })();
        if result.is_err() { let _ = fs::remove_file(&saved); }
        result?;
        return Ok(saved);
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "Cannot reserve damage-preservation file."))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ld-metadata-{}-{}", std::process::id(), rand::random::<u64>()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn creates_and_replaces_whole_file_without_orphan_staging() {
        let dir = fixture(); let path = dir.join("preferences.json");
        replace_metadata(&path, b"old").unwrap();
        replace_metadata(&path, b"replacement").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"replacement");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn never_overwrites_directory_target() {
        let dir = fixture(); let path = dir.join("preferences.json");
        fs::create_dir(&path).unwrap();
        assert!(replace_metadata(&path, b"overwrite").is_err());
        assert!(path.is_dir());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn compare_guard_keeps_previous_and_rejects_stale_mutation() {
        let dir = fixture(); let path = dir.join("preferences.json");
        replace_metadata_if_unchanged(&path, b"first", None, true).unwrap();
        assert!(!recovery_path(&path).unwrap().exists());
        replace_metadata_if_unchanged(&path, b"second", Some(b"first"), true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read(recovery_path(&path).unwrap()).unwrap(), b"first");
        assert_eq!(replace_metadata_if_unchanged(&path, b"stale", Some(b"first"), true)
            .unwrap_err().kind(), io::ErrorKind::WouldBlock);
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read(recovery_path(&path).unwrap()).unwrap(), b"first");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn damaged_copy_survives_restoration_without_overwriting_good_backup() {
        let dir = fixture(); let path = dir.join("preferences.json");
        replace_metadata_if_unchanged(&path, b"old", None, true).unwrap();
        replace_metadata_if_unchanged(&path, b"new", Some(b"old"), true).unwrap();
        replace_metadata(&path, b"broken").unwrap();
        let preserved = preserve_damaged_metadata(&path, b"broken").unwrap();
        let previous = fs::read(recovery_path(&path).unwrap()).unwrap();
        replace_metadata_if_unchanged(&path, &previous, Some(b"broken"), false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"old");
        assert_eq!(fs::read(&preserved).unwrap(), b"broken");
        assert_eq!(fs::read(recovery_path(&path).unwrap()).unwrap(), b"old");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bounded_read_refuses_large_metadata() {
        let dir = fixture(); let path = dir.join("preferences.json");
        replace_metadata(&path, &vec![0u8; 65537]).unwrap();
        assert!(read_metadata_bounded(&path).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_existing_symlink_target() {
        let dir = fixture(); let original = dir.join("source"); let link = dir.join("preferences.json");
        fs::write(&original, b"source").unwrap();
        std::os::unix::fs::symlink(&original, &link).unwrap();
        assert!(replace_metadata(&link, b"overwrite").is_err());
        assert_eq!(fs::read(original).unwrap(), b"source");
        fs::remove_dir_all(dir).unwrap();
    }
}
