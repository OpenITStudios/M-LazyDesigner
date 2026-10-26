fn main() {
    let output = std::process::Command::new("git").args(["rev-parse", "HEAD"]).output().expect("Git build identity is required");
    let sha = String::from_utf8(output.stdout).expect("Git SHA must be UTF-8");
    let sha = sha.trim();
    assert!(output.status.success() && sha.len() == 40 && sha.bytes().all(|b| b.is_ascii_hexdigit()), "Invalid Desktop source identity");
    println!("cargo:rustc-env=LAZYDESIGNER_DESKTOP_SOURCE_SHA={sha}");
    let reference = std::process::Command::new("git").args(["rev-parse", "--symbolic-full-name", "HEAD"]).output().expect("Git ref is required");
    assert!(reference.status.success());
    for name in ["HEAD", String::from_utf8(reference.stdout).unwrap().trim(), "packed-refs"] {
        let path = std::process::Command::new("git").args(["rev-parse", "--git-path", name]).output().expect("Git path is required");
        assert!(path.status.success());
        println!("cargo:rerun-if-changed={}", String::from_utf8(path.stdout).unwrap().trim());
    }
    tauri_build::build()
}
