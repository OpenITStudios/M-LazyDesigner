//! Optional Windows-only read bridge for the active Rust EditorSession.
//! Explicit user pairing, protected Named Pipe, read-only requests.
//! SOURCE_ONLY: native/Windows validation is still on hold.
use crate::desktop_error::DesktopError;
fn error(code: &'static str, reason: &str) -> DesktopError {
    DesktopError::recoverable(code, reason.to_owned())
}
/// This checks the build flag, not whether a pairing is active or secure.
#[tauri::command]
pub fn rust_live_read_available() -> bool {
    cfg!(all(windows, feature = "live-read-bridge"))
}
#[cfg(all(windows, feature = "live-read-bridge"))]
mod enabled {
    use super::*;
    use crate::desktop_authoring::{self, EditorState};
    use rand::RngCore;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use std::{ffi::c_void, ptr, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, Instant}};
    use tauri::{AppHandle, Manager, State};
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::windows::named_pipe::{NamedPipeServer, ServerOptions}};
    use windows_sys::{Win32::Foundation::LocalFree, Win32::Security::{SECURITY_ATTRIBUTES, Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1}}};

    const MAX_REQUEST: usize = 4096;
    const MAX_RESPONSE: usize = 32 * 1024;
    const WAIT: Duration = Duration::from_secs(4);
    // A forgotten read-only pairing must not stay active indefinitely.
    // Monotonic expiry; no background network listener outside this interval.
    const PAIRING_LIFETIME: Duration = Duration::from_secs(15 * 60);
    #[derive(Default)]
    pub struct LiveReadBridgeState {
        active: Mutex<Option<Active>>,
        pending: AtomicBool,
        // Stop/Exit invalidate a native confirmation even if it has not
        // returned from the user-owned Windows dialog yet.
        generation: AtomicU64,
    }
    struct Active { pipe: String, valid: Arc<AtomicBool> }

    struct PendingPairing<'a>(&'a AtomicBool);
    impl Drop for PendingPairing<'_> {
        fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
    }
    fn reserve_pairing(pending: &AtomicBool) -> Result<PendingPairing<'_>, DesktopError> {
        pending.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| error("LIVE_READ_PAIRING_IN_PROGRESS",
                "A native pairing decision is already open."))?;
        Ok(PendingPairing(pending))
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LiveReadPairing { pub pipe: String, pub token: String, pub epoch: u64, pub protocol: u8 }
    #[derive(Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum ReadOperation { Status, SemanticMap }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Request {
        protocol: u8, token: String, operation: ReadOperation,
        expected_epoch: Option<u64>, expected_revision: Option<u64>,
        category: Option<String>, offset: Option<usize>, limit: Option<usize>,
    }
    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    fn pairing_alive(valid: &AtomicBool, deadline: Instant) -> bool {
        valid.load(Ordering::SeqCst) && Instant::now() < deadline
    }
    fn token_matches(left: &str, right: &str) -> bool {
        if left.len() != 64 || right.len() != 64 { return false; }
        left.bytes().zip(right.bytes()).fold(0_u8, |diff,(a,b)| diff | (a ^ b)) == 0
    }

    // Never fall back to Windows' permissive default named-pipe DACL.
    // Owner rights plus LocalSystem are allowed; each actual request also
    // requires an unlogged 256-bit capability. Same-user malware and
    // privileged OS processes are not contained by this boundary.
    struct Descriptor(*mut c_void);
    impl Descriptor {
        fn new() -> Result<Self, DesktopError> {
            let text: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;SY)"
                .encode_utf16().chain(std::iter::once(0)).collect();
            let mut sd: *mut c_void = ptr::null_mut();
            // SAFETY: text is terminated UTF-16, output pointer is valid.
            let ok = unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    text.as_ptr(), SDDL_REVISION_1, &mut sd, ptr::null_mut())
            };
            if ok == 0 || sd.is_null() {
                return Err(error("LIVE_READ_ACL_FAILED","Cannot create protected Windows pipe ACL."));
            }
            Ok(Self(sd))
        }
    }
    impl Drop for Descriptor {
        fn drop(&mut self) { unsafe { LocalFree(self.0); } }
    }
    fn create_pipe(path: &str) -> Result<NamedPipeServer, DesktopError> {
        let descriptor = Descriptor::new()?;
        let mut attrs = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0, bInheritHandle: 0,
        };
        let mut options = ServerOptions::new();
        options.first_pipe_instance(true).reject_remote_clients(true).max_instances(1);
        // SAFETY: attrs and descriptor are owned until CreateNamedPipeW returns.
        unsafe {
            options.create_with_security_attributes_raw(
                path, &mut attrs as *mut _ as *mut c_void)
        }.map_err(|_| error("LIVE_READ_PIPE_FAILED","Cannot open protected local read pipe."))
    }
    // Pure admission owner: verify the exact protocol and pairing capability
    // before accessing the active model. Keeps negative security regression
    // independent of the OS transport and Tauri AppHandle.
    fn admitted_request(
        bytes: &[u8], token: &str, valid: &AtomicBool, deadline: Instant,
    ) -> Result<Request, &'static str> {
        if !valid.load(Ordering::SeqCst) {
            return Err("LIVE_READ_REVOKED");
        }
        let request: Request = serde_json::from_slice(bytes)
            .map_err(|_| "LIVE_READ_REQUEST_INVALID")?;
        if request.protocol != 1 || !token_matches(&request.token, token) {
            return Err("LIVE_READ_ACCESS_DENIED");
        }
        if !pairing_alive(valid, deadline) {
            return Err("LIVE_READ_EXPIRED_OR_REVOKED");
        }
        Ok(request)
    }
    fn dispatch(
        app: &AppHandle, bound_epoch: u64, token: &str,
        valid: &AtomicBool, deadline: Instant, bytes: &[u8],
    ) -> Value {
        let request = match admitted_request(bytes, token, valid, deadline) {
            Ok(request) => request,
            Err(code) => return json!({"status":"ERROR","code":code}),
        };
        let editor = app.state::<EditorState>();
        let outcome = match request.operation {
            ReadOperation::Status if request.expected_epoch.is_none() &&
                request.expected_revision.is_none() && request.category.is_none() &&
                request.offset.is_none() && request.limit.is_none() =>
                    desktop_authoring::live_read_identity(&editor),
            ReadOperation::SemanticMap => {
                if let (Some(epoch), Some(revision), Some(category)) = (
                    request.expected_epoch, request.expected_revision, request.category) {
                    desktop_authoring::live_read_semantic_map(
                        &editor, epoch, revision, &category,
                        request.offset.unwrap_or(0), request.limit.unwrap_or(16))
                } else {
                    Err(error("LIVE_READ_REQUEST_INVALID","Missing semantic read version or category."))
                }
            }
            _ => Err(error("LIVE_READ_OPERATION_DENIED","Only status and semantic_map are supported.")),
        };
        let answer = match outcome {
            Ok(value) if value["epoch"].as_u64() == Some(bound_epoch) => value,
            Ok(_) => json!({"status":"ERROR","code":"LIVE_READ_SESSION_CHANGED"}),
            Err(err) => json!({"status":"ERROR","code":err.code}),
        };
        if pairing_alive(valid, deadline) { answer }
        else { json!({"status":"ERROR","code":"LIVE_READ_EXPIRED_OR_REVOKED"}) }
    }
    async fn exchange(
        app: &AppHandle, epoch: u64, token: &str,
        valid: &AtomicBool, deadline: Instant, pipe: &mut NamedPipeServer,
    ) {
        let mut bytes = Vec::new();
        let frame = async {
            let mut chunk = [0_u8; 1024];
            loop {
                let n = pipe.read(&mut chunk).await?;
                if n == 0 { return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof)); }
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.len() > MAX_REQUEST {
                    return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
                }
                if let Some(pos) = bytes.iter().position(|b| *b == b'\n') {
                    if pos != bytes.len() - 1 {
                        return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
                    }
                    return Ok::<(), std::io::Error>(());
                }
            }
        };
        let value = match tokio::time::timeout(WAIT, frame).await {
            Ok(Ok(())) => dispatch(app, epoch, token, valid, deadline, &bytes[..bytes.len()-1]),
            _ => json!({"status":"ERROR","code":"LIVE_READ_FRAME_INVALID"}),
        };
        let mut response = serde_json::to_vec(&value).unwrap_or_default();
        if response.len() + 1 > MAX_RESPONSE {
            response = b"{\"status\":\"ERROR\",\"code\":\"LIVE_READ_RESULT_TOO_LARGE\"}".to_vec();
        }
        response.push(b'\n');
        if pairing_alive(valid, deadline) {
            if matches!(tokio::time::timeout(WAIT, pipe.write_all(&response)).await,
                Ok(Ok(()))) {
                // The client must consume the entire answer and close its
                // connection before DisconnectNamedPipe. Immediate disconnect
                // after WriteFile can discard unread pipe buffers on Windows.
                let _ = tokio::time::timeout(WAIT, async {
                    let mut byte = [0u8; 1];
                    loop {
                        match pipe.read(&mut byte).await {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                    }
                }).await;
            }
        }
        let _ = pipe.disconnect();
    }
    pub fn revoke(state: &LiveReadBridgeState) {
        state.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = state.active.lock() {
            if let Some(active) = guard.take() {
                active.valid.store(false, Ordering::SeqCst);
                // The cancellable connect() polls valid at most every 250 ms.
            }
        }
    }
    pub async fn start(
        app: AppHandle, state: State<'_, LiveReadBridgeState>,
        expected_epoch: u64,
    ) -> Result<LiveReadPairing, DesktopError> {
        let identity = desktop_authoring::live_read_identity(&app.state::<EditorState>())?;
        if identity["epoch"].as_u64() != Some(expected_epoch) {
            return Err(error("RUST_EDITOR_SESSION_STALE","The active model changed."));
        }
        // The menu button alone is not a security decision: permitted
        // WebView code can invoke a Tauri command. Only a fresh, affirmative
        // *native OS dialog* may create a capability. A concurrent command
        // cannot display multiple confirmation dialogs.
        let pending = reserve_pairing(&state.pending)?;
        let generation = state.generation.load(Ordering::SeqCst);
        {
            let slot = state.active.lock().map_err(|_|
                error("LIVE_READ_UNAVAILABLE","Pairing state is unavailable."))?;
            if slot.is_some() {
                return Err(error("LIVE_READ_ALREADY_ACTIVE",
                    "Stop the earlier pairing first."));
            }
        }
        let approved = tauri::async_runtime::spawn_blocking(|| {
            rfd::MessageDialog::new()
                .set_title("LazyDesigner - Read-only Code Mode")
                .set_description(concat!(
                    "Allow a separately trusted local agent host to read the current ",
                    "model's identity and small semantic pages for up to 15 minutes?\n\n",
                    "No model edits, texture bytes or source paths are shared. ",
                    "Only approve if you initiated this pairing.",
                ))
                .set_buttons(rfd::MessageButtons::YesNo)
                .show()
        }).await.map_err(|_| error("LIVE_READ_CONFIRMATION_UNAVAILABLE",
            "The native approval dialog did not finish."))?;
        if approved != rfd::MessageDialogResult::Yes {
            return Err(error("LIVE_READ_NOT_APPROVED",
                "The native read-only pairing was declined."));
        }
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err(error("LIVE_READ_PAIRING_REVOKED",
                "The pairing was cancelled while awaiting native approval."));
        }
        let mut slot = state.active.lock().map_err(|_|
            error("LIVE_READ_UNAVAILABLE","Pairing state is unavailable."))?;
        if slot.is_some() || state.generation.load(Ordering::SeqCst) != generation {
            return Err(error("LIVE_READ_PAIRING_REVOKED",
                "The pairing changed during native approval."));
        }
        let mut id = [0u8; 16];
        let mut secret = [0u8; 32];
        rand::rng().fill_bytes(&mut id);
        rand::rng().fill_bytes(&mut secret);
        let pipe_path = format!(r"\\.\pipe\LazyDesigner-read-{}", hex(&id));
        let token = hex(&secret);
        let pipe = create_pipe(&pipe_path)?;
        // New/Open/Restore may replace the active model while the OS pipe
        // and DACL are being prepared. Never return a pairing already stale
        // at this second, independent admission.
        let current = desktop_authoring::live_read_identity(&app.state::<EditorState>())?;
        if current["epoch"].as_u64() != Some(expected_epoch) {
            return Err(error("RUST_EDITOR_SESSION_STALE",
                "The active model changed while the local pipe was prepared."));
        }
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err(error("LIVE_READ_PAIRING_REVOKED",
                "The pairing was cancelled before the pipe was admitted."));
        }
        let deadline = Instant::now() + PAIRING_LIFETIME;
        let valid = Arc::new(AtomicBool::new(true));
        let flag = Arc::clone(&valid);
        let background_app = app.clone();
        let background_pipe = pipe_path.clone();
        let background_token = token.clone();
        tauri::async_runtime::spawn(async move {
            let mut server = pipe;
            while pairing_alive(&flag, deadline) {
                // Tokio documents connect() as cancellation safe. A small
                // bounded wait lets Stop revoke without an extra macro crate.
                let result = tokio::time::timeout(
                    Duration::from_millis(250), server.connect()).await;
                if !pairing_alive(&flag, deadline) { break; }
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => break,
                    Err(_) => continue,
                }
                let mut connected = server;
                exchange(
                    &background_app, expected_epoch, &background_token,
                    &flag, deadline, &mut connected,
                ).await;
                // Reuse the same server only after it has disconnected.
                // (Do not create an unprotected replacement instance.)
                if !pairing_alive(&flag, deadline) { break; }
                // Tokio disconnect permits reconnect on this same instance.
                // Move it back to the next accept iteration.
                server = connected;
            }
            flag.store(false, Ordering::SeqCst);
            let state = background_app.state::<LiveReadBridgeState>();
            if let Ok(mut guard) = state.active.lock() {
                if guard.as_ref().is_some_and(|v| v.pipe == background_pipe) {
                    guard.take();
                }
            }
        });
        *slot = Some(Active { pipe: pipe_path.clone(), valid });
        drop(pending);
        Ok(LiveReadPairing {
            pipe: pipe_path, token, epoch: expected_epoch, protocol: 1,
        })
    }
    pub fn stop(state: State<'_, LiveReadBridgeState>) {
        revoke(&state);
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn one_pending_native_confirmation_and_stop_generation_are_enforced() {
            let state = LiveReadBridgeState::default();
            let decision = reserve_pairing(&state.pending).unwrap();
            assert_eq!(reserve_pairing(&state.pending).err().map(|e| e.code),
                Some("LIVE_READ_PAIRING_IN_PROGRESS"));
            let issued = state.generation.load(Ordering::SeqCst);
            revoke(&state);
            assert_ne!(issued, state.generation.load(Ordering::SeqCst));
            drop(decision);
            let next = reserve_pairing(&state.pending).unwrap();
            drop(next);
        }
        #[test]
        fn capability_is_exact() {
            let a = "a".repeat(64);
            assert!(token_matches(&a,&a));
            assert!(!token_matches(&a,&"b".repeat(64)));
            assert!(!token_matches(&a,"a"));
        }
        #[test]
        fn revoked_and_expired_pairings_are_never_live() {
            let valid = AtomicBool::new(true);
            assert!(pairing_alive(&valid, Instant::now() + Duration::from_secs(5)));
            assert!(!pairing_alive(&valid, Instant::now() - Duration::from_millis(1)));
            valid.store(false, Ordering::SeqCst);
            assert!(!pairing_alive(&valid, Instant::now() + Duration::from_secs(5)));
        }
        #[test]
        fn invalid_and_expired_credentials_are_denied_before_model_reads() {
            let token = "a".repeat(64);
            let live = AtomicBool::new(true);
            let deadline = Instant::now() + Duration::from_secs(5);
            let valid = serde_json::to_vec(&json!({
                "protocol":1, "token":token,
                "operation":"status",
            })).unwrap();
            assert!(admitted_request(&valid, &token, &live, deadline).is_ok());
            let wrong = serde_json::to_vec(&json!({
                "protocol":1, "token":"b".repeat(64),
                "operation":"status",
            })).unwrap();
            assert_eq!(admitted_request(&wrong, &token, &live, deadline)
                .err(), Some("LIVE_READ_ACCESS_DENIED"));
            assert_eq!(admitted_request(&valid, &token, &live,
                Instant::now() - Duration::from_millis(1))
                .err(), Some("LIVE_READ_EXPIRED_OR_REVOKED"));
            assert_eq!(admitted_request(b"{", &token, &live, deadline)
                .err(), Some("LIVE_READ_REQUEST_INVALID"));
            let mut forbidden: Value = serde_json::from_slice(&valid).unwrap();
            forbidden["operation"] = json!("apply");
            assert_eq!(admitted_request(
                &serde_json::to_vec(&forbidden).unwrap(), &token, &live, deadline,
            ).err(), Some("LIVE_READ_REQUEST_INVALID"));
            live.store(false, Ordering::SeqCst);
            assert_eq!(admitted_request(&valid, &token, &live, deadline)
                .err(), Some("LIVE_READ_REVOKED"));
        }
        #[test]
        fn only_a_bounded_known_message_shape_is_admitted() {
            let good = serde_json::json!({
                "protocol":1, "token":"a".repeat(64),
                "operation":"semantic_map", "expected_epoch":5,
                "expected_revision":1,"category":"cubes","offset":0,"limit":2
            });
            let parsed: Request = serde_json::from_value(good.clone()).unwrap();
            assert!(matches!(parsed.operation, ReadOperation::SemanticMap));
            assert_eq!(parsed.expected_epoch, Some(5));
            let mut extra = good;
            extra["output"] = json!("forbidden.bbmodel");
            assert!(serde_json::from_value::<Request>(extra).is_err());
            assert!(serde_json::from_value::<Request>(json!({
                "protocol":1, "token":"a".repeat(64),
                "operation":"apply", "operations":[]
            })).is_err());
        }
    }
}
#[cfg(all(windows, feature = "live-read-bridge"))]
pub use enabled::*;
#[cfg(not(all(windows, feature = "live-read-bridge")))]
mod disabled {
    use super::*;
    use tauri::State;
    #[derive(Default)]
    pub struct LiveReadBridgeState;
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LiveReadPairing {
        pub pipe: String, pub token: String, pub epoch: u64, pub protocol: u8,
    }
    pub fn revoke(_: &LiveReadBridgeState) {}
    pub async fn start(
        _app: tauri::AppHandle, _state: State<'_,LiveReadBridgeState>, expected_epoch: u64,
    ) -> Result<LiveReadPairing,DesktopError> {
        let _ = expected_epoch;
        Err(error("LIVE_READ_NOT_BUILT","This build has no Windows read-only bridge."))
    }
    pub fn stop(_state: State<'_,LiveReadBridgeState>) {}
}
#[cfg(not(all(windows, feature = "live-read-bridge")))]
pub use disabled::*;

#[cfg(all(windows, feature = "live-read-bridge"))]
use enabled as implementation;
#[cfg(not(all(windows, feature = "live-read-bridge")))]
use disabled as implementation;

#[tauri::command]
pub async fn rust_live_read_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, LiveReadBridgeState>,
    expected_epoch: u64,
) -> Result<LiveReadPairing, DesktopError> {
    implementation::start(app, state, expected_epoch).await
}
#[tauri::command]
pub fn rust_live_read_stop(state: tauri::State<'_, LiveReadBridgeState>) {
    implementation::stop(state)
}
