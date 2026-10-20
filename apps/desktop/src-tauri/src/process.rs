use std::{io::{BufRead, BufReader, Read}, process::{Command, ExitStatus, Output, Stdio}, sync::mpsc, thread, time::{Duration, Instant}};

/// Fresh identity inventory for editor/Runtime guards; no telemetry or cached PID state.
pub(crate) fn process_snapshot() -> sysinfo::System {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    system
}

pub fn run_output(command: &mut Command, timeout: Duration, label: &str) -> Result<Output, String> {
    run_output_with_stderr_lines(command, timeout, label, |_| {})
}

pub fn run_output_with_stderr_lines<F>(command: &mut Command, timeout: Duration, label: &str, mut on_stderr_line: F) -> Result<Output, String>
where F: FnMut(&str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Captured background helpers must never create a visible console.
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| format!("{label} could not start: {error}"))?;
    let mut stdout = child.stdout.take().ok_or_else(|| format!("{label} stdout is unavailable."))?;
    let stderr = child.stderr.take().ok_or_else(|| format!("{label} stderr is unavailable."))?;
    let stdout_reader = thread::spawn(move || { let mut bytes = Vec::new(); stdout.read_to_end(&mut bytes).map(|_| bytes) });
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new(); let mut reader = BufReader::new(stderr);
        loop { let mut line = String::new(); match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => { bytes.extend_from_slice(line.as_bytes()); let _ = line_tx.send(line.trim_end_matches(&['\r', '\n'][..]).to_string()); },
            Err(error) => return Err(error),
        }}
        Ok(bytes)
    });
    let started = Instant::now();
    let status: ExitStatus = loop {
        while let Ok(line) = line_rx.try_recv() { on_stderr_line(&line); }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            Ok(None) => { let _=child.kill(); let _=child.wait(); let _=stdout_reader.join(); let _=stderr_reader.join(); return Err(format!("{label} timed out after {} seconds.", timeout.as_secs())); },
            Err(error) => { let _=child.kill(); let _=child.wait(); let _=stdout_reader.join(); let _=stderr_reader.join(); return Err(format!("{label} process state could not be read: {error}")); }
        }
    };
    while let Ok(line) = line_rx.try_recv() { on_stderr_line(&line); }
    let stdout = stdout_reader.join().map_err(|_| format!("{label} stdout reader panicked."))?.map_err(|e| format!("{label} stdout could not be collected: {e}"))?;
    let stderr = stderr_reader.join().map_err(|_| format!("{label} stderr reader panicked."))?.map_err(|e| format!("{label} stderr could not be collected: {e}"))?;
    Ok(Output { status, stdout, stderr })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn process_snapshot_observes_exit_without_reusing_stale_pid_state() {
        use std::os::windows::process::CommandExt;
        struct OwnedChild(std::process::Child);
        impl Drop for OwnedChild {
            fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
        }
        let mut child = OwnedChild(Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"])
            .creation_flags(0x08000000)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().expect("owned background fixture must start"));
        let pid = sysinfo::Pid::from_u32(child.0.id());
        let live = process_snapshot();
        let process = live.process(pid).expect("fresh inventory must see the live fixture");
        assert!(process.name().eq_ignore_ascii_case("powershell.exe"));
        assert!(process.exe().is_some());
        child.0.kill().expect("fixture must stop");
        child.0.wait().expect("fixture exit must be observed");
        assert!(process_snapshot().process(pid).is_none());
    }


    #[test]
    fn background_powershell_has_no_console_and_keeps_captured_output() {
        let output = run_output(
            Command::new("powershell.exe").args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                "Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow();' -Name ConsoleProbe -Namespace Test; [Console]::Out.Write([Test.ConsoleProbe]::GetConsoleWindow().ToInt64()); [Console]::Error.Write('captured')"]),
            // Cold Windows PowerShell 5.1 startup plus Add-Type's first C# compilation
            // can exceed 20s on a fresh hosted runner. Preserve real GetConsoleWindow
            // and captured stdout/stderr assertions rather than substituting a mock.
            Duration::from_secs(90), "console probe",
        ).unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "0");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "captured");
    }
}
