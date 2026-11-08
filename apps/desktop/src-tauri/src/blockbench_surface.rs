//! Debug-only, user-initiated Blockbench native window composition.
//! Blockbench stays an independent top-level process. No SetParent, input
//! forwarding, DWM fake-interactivity, taskbar style changes or model mutation.
//! Do not enable in release until real Windows focus/dialog/crash recovery proof.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct EditorViewport {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pixel_ratio: f64,
}

impl EditorViewport {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height, self.pixel_ratio]
            .iter().all(|value| value.is_finite())
            && (0.0..=10000.0).contains(&self.x) && (0.0..=10000.0).contains(&self.y)
            && (320.0..=10000.0).contains(&self.width)
            && (220.0..=10000.0).contains(&self.height)
            && (0.75..=4.0).contains(&self.pixel_ratio)
    }
}

#[derive(Debug, Serialize)]
pub struct EditorSurfaceReceipt {
    pub status: &'static str,
    pub note: &'static str,
}

fn receipt(status: &'static str, note: &'static str) -> EditorSurfaceReceipt {
    EditorSurfaceReceipt { status, note }
}

#[cfg(all(windows, debug_assertions))]
mod platform {
    use super::{receipt, EditorSurfaceReceipt, EditorViewport};
    use std::{collections::HashSet, ffi::c_void, io, ptr, sync::{Mutex, OnceLock}};

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;
    const GW_OWNER: u32 = 4;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: isize = 0x00000008;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const HWND_TOP: Hwnd = ptr::null_mut();

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point { x: i32, y: i32 }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileTime { low: u32, high: u32 }
    #[derive(Clone, Copy)]
    struct Placement { x: i32, y: i32, width: i32, height: i32 }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>, param: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
        fn GetWindow(hwnd: Hwnd, command: u32) -> Hwnd;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, buffer: *mut u16, max: i32) -> i32;
        fn GetClassNameW(hwnd: Hwnd, buffer: *mut u16, max: i32) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn IsWindow(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn IsZoomed(hwnd: Hwnd) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn GetClientRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
        fn GetDpiForWindow(hwnd: Hwnd) -> u32;
        fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
        fn SetWindowPos(hwnd: Hwnd, insert_after: Hwnd, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn GetProcessTimes(process: Handle, created: *mut FileTime, exited: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn CloseHandle(process: Handle) -> i32;
    }

    fn win_error(action: &str) -> String {
        format!("{action}: {}", io::Error::last_os_error())
    }
    fn pid_and_thread(hwnd: Hwnd) -> (u32, u32) {
        let mut pid = 0;
        let thread = unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid, thread)
    }
    fn window_text(hwnd: Hwnd) -> String {
        let mut buffer = [0u16; 300];
        let size = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..size.max(0) as usize])
    }
    fn window_class(hwnd: Hwnd) -> String {
        let mut buffer = [0u16; 300];
        let size = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..size.max(0) as usize])
    }
    fn process_birth(pid: u32) -> Result<u64, String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() { return Err(win_error("Blockbench process identity unavailable")); }
            let mut a = FileTime::default();
            let mut b = FileTime::default();
            let mut c = FileTime::default();
            let mut d = FileTime::default();
            let result = GetProcessTimes(handle, &mut a, &mut b, &mut c, &mut d);
            let _ = CloseHandle(handle);
            if result == 0 { return Err(win_error("Blockbench process creation time unavailable")); }
            Ok((u64::from(a.high) << 32) | u64::from(a.low))
        }
    }

    struct Windows {
        manager: Vec<usize>,
        editors: Vec<usize>,
        allowed: HashSet<u32>,
    }
    unsafe extern "system" fn enumerate(hwnd: Hwnd, parameter: isize) -> i32 {
        let candidates = &mut *(parameter as *mut Windows);
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null()
            || GetWindowTextLengthW(hwnd) <= 0 { return 1; }
        let (pid, _) = pid_and_thread(hwnd);
        if pid == std::process::id() && window_text(hwnd) == "LazyDesigner" {
            candidates.manager.push(hwnd as usize);
        } else if candidates.allowed.contains(&pid) {
            candidates.editors.push(hwnd as usize);
        }
        1
    }
    fn unique(values: &[usize], label: &str) -> Result<usize, String> {
        match values {
            [value] => Ok(*value),
            [] => Err(format!("{label} window unavailable; no window was moved.")),
            _ => Err(format!("Ambiguous {label} windows; no window was moved.")),
        }
    }
    fn discover() -> Result<(usize, usize, u32), String> {
        let allowed = crate::blockbench::native_surface_processes()?;
        if allowed.is_empty() {
            return Err("No verified Blockbench process is running. Open Blockbench normally first.".into());
        }
        let mut windows = Windows { allowed, manager: Vec::new(), editors: Vec::new() };
        if unsafe { EnumWindows(Some(enumerate), &mut windows as *mut _ as isize) } == 0 {
            return Err(win_error("Windows enumeration failed"));
        }
        let manager = unique(&windows.manager, "LazyDesigner")?;
        let editor = unique(&windows.editors, "Blockbench")?;
        let (pid, _) = pid_and_thread(editor as Hwnd);
        Ok((manager, editor, pid))
    }

    fn window_rect(hwnd: Hwnd) -> Result<Rect, String> {
        let mut rect = Rect::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            return Err(win_error("Cannot read native window bounds"));
        }
        Ok(rect)
    }
    fn placement(manager: usize, view: EditorViewport) -> Result<Placement, String> {
        if !view.valid() { return Err("Viewport is invalid or too small; no window was moved.".into()); }
        let hwnd = manager as Hwnd;
        if unsafe { IsWindow(hwnd) } == 0 || pid_and_thread(hwnd).0 != std::process::id() {
            return Err("LazyDesigner window identity changed.".into());
        }
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        if dpi == 0 { return Err("Native window DPI unavailable.".into()); }
        let scale = dpi as f64 / 96.0;
        if (scale - view.pixel_ratio).abs() > 0.05 {
            return Err("Workspace DPI changed; refresh the layout before retrying.".into());
        }
        let mut client = Rect::default();
        let mut origin = Point::default();
        unsafe {
            if GetClientRect(hwnd, &mut client) == 0 || ClientToScreen(hwnd, &mut origin) == 0 {
                return Err(win_error("Cannot read LazyDesigner client area"));
            }
        }
        let x = (view.x * scale).round() as i32;
        let y = (view.y * scale).round() as i32;
        let width = (view.width * scale).round() as i32;
        let height = (view.height * scale).round() as i32;
        let right = x.checked_add(width).ok_or("Viewport overflow")?;
        let bottom = y.checked_add(height).ok_or("Viewport overflow")?;
        if x < 0 || y < 0 || right > client.right + 1 || bottom > client.bottom + 1 {
            return Err("Viewport is outside the LazyDesigner client area; no window was moved.".into());
        }
        Ok(Placement { x: origin.x + x, y: origin.y + y, width, height })
    }
    fn verify_rect(hwnd: Hwnd, place: Placement) -> Result<(), String> {
        let actual = window_rect(hwnd)?;
        if (actual.left - place.x).abs() > 2 || (actual.top - place.y).abs() > 2
            || ((actual.right - actual.left) - place.width).abs() > 2
            || ((actual.bottom - actual.top) - place.height).abs() > 2 {
            return Err("Blockbench native window did not reach the requested workspace bounds.".into());
        }
        Ok(())
    }
    struct Lease {
        manager: usize,
        editor: usize,
        pid: u32,
        birth: u64,
        thread: u32,
        class: String,
        original: Rect,
    }
    impl Lease {
        fn verify(&self) -> Result<(), String> {
            let hwnd = self.editor as Hwnd;
            if unsafe { IsWindow(hwnd) } == 0
                || unsafe { GetWindow(hwnd, GW_OWNER) } != ptr::null_mut()
                || !crate::blockbench::native_surface_processes()?.contains(&self.pid)
                || pid_and_thread(hwnd) != (self.pid, self.thread)
                || window_class(hwnd) != self.class
                || process_birth(self.pid)? != self.birth {
                return Err("The original Blockbench process/window identity changed; window placement was not retried.".into());
            }
            Ok(())
        }
    }
    static ACTIVE: OnceLock<Mutex<Option<Lease>>> = OnceLock::new();
    fn lease() -> &'static Mutex<Option<Lease>> { ACTIVE.get_or_init(|| Mutex::new(None)) }

    fn place(lease: &Lease, target: Placement, raise: bool) -> Result<(), String> {
        lease.verify()?;
        let hwnd = lease.editor as Hwnd;
        if unsafe { IsIconic(hwnd) != 0 || IsZoomed(hwnd) != 0 } {
            return Err("Restore Blockbench from minimized/maximized state before placing it.".into());
        }
        if unsafe {
            SetWindowPos(hwnd, if raise { HWND_TOP } else { ptr::null_mut() },
                target.x, target.y, target.width, target.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | if raise { 0 } else { SWP_NOZORDER })
        } == 0 {
            return Err(win_error("Unable to position Blockbench"));
        }
        lease.verify()?;
        verify_rect(hwnd, target)
    }
    fn restore(lease: &Lease) -> Result<(), String> {
        lease.verify()?;
        let r = lease.original;
        if unsafe {
            SetWindowPos(lease.editor as Hwnd, ptr::null_mut(), r.left, r.top,
                r.right-r.left, r.bottom-r.top, SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW)
        } == 0 {
            return Err(win_error("Unable to restore Blockbench window bounds"));
        }
        lease.verify()?;
        verify_rect(lease.editor as Hwnd, Placement {
            x: r.left, y: r.top, width: r.right-r.left, height: r.bottom-r.top,
        })
    }

    pub(super) fn run(action: &str, view: Option<EditorViewport>) -> Result<EditorSurfaceReceipt, String> {
        let mut state = lease().lock().map_err(|_| "Native editor presentation lock is unavailable.")?;
        match action {
            "detach" => {
                let Some(existing) = state.as_ref() else { return Ok(receipt("DETACHED", "No native editor lease was active.")); };
                // A changed PID/HWND is *not* permission to reposition a new window.
                restore(existing)?;
                *state = None;
                Ok(receipt("DETACHED", "Original Blockbench window bounds restored."))
            }
            "present" | "update" => {
                let viewport = view.ok_or("Native editor viewport is required.")?;
                if let Some(existing) = state.as_ref() {
                    let manager = discover()?.0;
                    if existing.manager != manager { return Err("LazyDesigner window changed; detach before presenting again.".into()); }
                    let geometry = placement(manager, viewport)?;
                    let foreground = unsafe { GetForegroundWindow() };
                    // No foreground escalation for an unrelated application.
                    let raise = foreground == manager as Hwnd || foreground == existing.editor as Hwnd;
                    place(existing, geometry, raise)?;
                    return Ok(receipt("PRESENTED", "Original Blockbench process remains independent."));
                }
                if action == "update" { return Ok(receipt("DETACHED", "No native editor lease was active.")); }
                let (manager, editor, pid) = discover()?;
                if unsafe { GetForegroundWindow() } != manager as Hwnd {
                    return Err("Bring LazyDesigner to the foreground before placing Blockbench.".into());
                }
                if unsafe { IsIconic(editor as Hwnd) != 0 || IsZoomed(editor as Hwnd) != 0 } {
                    return Err("Restore Blockbench before placing it in the workspace.".into());
                }
                if unsafe { GetWindowLongPtrW(editor as Hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST != 0 } {
                    return Err("Turn off Blockbench Always on Top before presenting it.".into());
                }
                let target = placement(manager, viewport)?;
                let original = window_rect(editor as Hwnd)?;
                let candidate = Lease {
                    manager, editor, pid, birth: process_birth(pid)?,
                    thread: pid_and_thread(editor as Hwnd).1,
                    class: window_class(editor as Hwnd),
                    original,
                };
                if candidate.thread == 0 || candidate.class.is_empty() {
                    return Err("Blockbench window identity was incomplete.".into());
                }
                if let Err(failure) = place(&candidate, target, true) {
                    // Avoid a misleading success after partial positioning.
                    return match restore(&candidate) {
                        Ok(()) => Err(failure),
                        Err(restore_failure) => {
                            *state = Some(candidate);
                            Err(format!("Placement unverified ({failure}); restoration also unverified ({restore_failure}). Use Detach; do not repeat Present."))
                        }
                    };
                }
                *state = Some(candidate);
                Ok(receipt("PRESENTED", "Native Blockbench window positioned; interactive rendering is not yet verified."))
            }
            _ => Err("Unsupported native editor surface action.".into()),
        }
    }
    #[cfg(test)]
    mod window_choice_tests {
        #[test]
        fn refuse_missing_or_ambiguous_native_windows() {
            assert!(super::unique(&[], "Blockbench").is_err());
            assert_eq!(super::unique(&[15], "Blockbench"), Ok(15));
            assert!(super::unique(&[15, 16], "Blockbench").is_err());
        }
    }
    pub(super) fn restore_on_exit() {
        if let Ok(mut state) = lease().lock() {
            if let Some(existing) = state.as_ref() {
                if restore(existing).is_ok() { *state = None; }
            }
        }
    }
}

#[cfg(not(all(windows, debug_assertions)))]
mod platform {
    use super::{receipt, EditorSurfaceReceipt, EditorViewport};
    pub(super) fn run(_action: &str, _view: Option<EditorViewport>) -> Result<EditorSurfaceReceipt, String> {
        Ok(receipt("UNAVAILABLE", "Native window composition is disabled outside Windows development builds."))
    }
    pub(super) fn restore_on_exit() {}
}

pub fn command(action: &str, viewport: Option<EditorViewport>) -> Result<EditorSurfaceReceipt, String> {
    if !matches!(action, "present" | "update" | "detach") { return Err("Unsupported native editor action.".into()); }
    platform::run(action, viewport)
}
pub fn restore_on_exit() { platform::restore_on_exit(); }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn viewport_bounds_are_fail_closed() {
        let base = EditorViewport { x: 10.0, y: 15.0, width: 600.0, height: 340.0, pixel_ratio: 1.0 };
        assert!(base.valid());
        assert!(!EditorViewport { width: 0.0, ..base }.valid());
        assert!(!EditorViewport { x: -1.0, ..base }.valid());
        assert!(!EditorViewport { pixel_ratio: f64::NAN, ..base }.valid());
        assert!(!EditorViewport { width: f64::INFINITY, ..base }.valid());
        assert!(!EditorViewport { pixel_ratio: 10.0, ..base }.valid());
        assert!(!EditorViewport { x: 1e15, ..base }.valid());
        assert!(command("start", None).is_err());
    }
}
