//! Debug-only, user-initiated Blockbench native window composition.
//! Blockbench stays an independent top-level process. No SetParent, input
//! forwarding, DWM fake-interactivity, taskbar changes or model mutation.
//! Only the native frame bits are temporarily adjusted and restored.
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
    use std::{
        collections::HashSet, ffi::c_void,
        io::{self, BufRead, Read, Write},
        process::{Child, ChildStdin, Command, Stdio},
        ptr,
        sync::{mpsc, Mutex, OnceLock},
        time::{Duration, Instant},
    };
    use serde::{Deserialize, Serialize};

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;
    const GW_OWNER: u32 = 4;
    const GWL_EXSTYLE: i32 = -20;
    const GWL_STYLE: i32 = -16;
    const WS_CAPTION: isize = 0x00c00000;
    const WS_THICKFRAME: isize = 0x00040000;
    const WS_MAXIMIZE: isize = 0x01000000;
    const WS_DISABLED: isize = 0x08000000;
    const FRAME_FLAGS: isize = WS_CAPTION | WS_THICKFRAME | WS_MAXIMIZE;
    const WS_EX_TOPMOST: isize = 0x00000008;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SYNCHRONIZE: u32 = 0x00100000;
    const ERROR_INVALID_PARAMETER: u32 = 87;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;
    const TH32CS_SNAPPROCESS: u32 = 0x00000002;
    const HELPER_ROLE: &str = "--lazydesigner-blockbench-recovery";
    const HELPER_TIMEOUT: Duration = Duration::from_secs(3);
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOSIZE: u32 = 0x0001;
    const RDW_INVALIDATE: u32 = 0x0001;
    const RDW_ERASE: u32 = 0x0004;
    const RDW_ALLCHILDREN: u32 = 0x0080;
    const RDW_FRAME: u32 = 0x0400;
    const GA_ROOT: u32 = 2;
    const HWND_TOP: Hwnd = ptr::null_mut();
    const RGN_DIFF: i32 = 4;
    const RGN_ERROR: i32 = 0;

    #[repr(C)]
    #[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

    #[repr(C)]
    struct ProcessEntry {
        dw_size: u32, cnt_usage: u32, process_id: u32,
        default_heap_id: usize, module_id: u32, threads: u32,
        parent_process_id: u32, base_priority: i32, flags: u32,
        executable_name: [u16; 260],
    }
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
        fn WindowFromPoint(point: Point) -> Hwnd;
        fn GetAncestor(hwnd: Hwnd, flags: u32) -> Hwnd;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn IsHungAppWindow(hwnd: Hwnd) -> i32;
        fn GetClientRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
        fn GetDpiForWindow(hwnd: Hwnd) -> u32;
        fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
        fn RedrawWindow(hwnd: Hwnd, update: *const Rect, region: Handle, flags: u32) -> i32;
        fn GetWindowRgn(hwnd: Hwnd, region: Handle) -> i32;
        fn SetWindowRgn(hwnd: Hwnd, region: Handle, redraw: i32) -> i32;
        fn SetWindowPos(hwnd: Hwnd, insert_after: Hwnd, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn GetProcessTimes(process: Handle, created: *mut FileTime, exited: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn CloseHandle(process: Handle) -> i32;
        fn SetLastError(code: u32);
        fn GetLastError() -> u32;
        fn WaitForSingleObject(handle: Handle, timeout_ms: u32) -> u32;
        fn QueryFullProcessImageNameW(process: Handle, flags: u32, path: *mut u16, size: *mut u32) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> Handle;
        fn CombineRgn(dest: Handle, first: Handle, second: Handle, mode: i32) -> i32;
        fn EqualRgn(first: Handle, second: Handle) -> i32;
        fn DeleteObject(object: Handle) -> i32;
    }

    // Window regions are GDI-owned until SetWindowRgn accepts them. On
    // success Windows takes ownership and must release the handle itself.
    struct Region(Handle);
    impl Region {
        fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Result<Self, String> {
            let raw = unsafe { CreateRectRgn(left, top, right, bottom) };
            if raw.is_null() { Err(win_error("Unable to create native window region")) }
            else { Ok(Self(raw)) }
        }
        fn transfer(&mut self) { self.0 = ptr::null_mut(); }
    }
    impl Drop for Region {
        fn drop(&mut self) {
            if !self.0.is_null() { unsafe { let _ = DeleteObject(self.0); } }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Aperture {
        width: i32,
        height: i32,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    // SetWindowRgn's coordinates are relative to the outer HWND, not the
    // client origin. The frontend passes CSS client bounds, so Rust first
    // translates them into physical screen positions.
    fn aperture_rect(window: Rect, target: Placement) -> Result<Aperture, String> {
        let width = window.right.checked_sub(window.left).ok_or("Window width overflow")?;
        let height = window.bottom.checked_sub(window.top).ok_or("Window height overflow")?;
        let left = target.x.checked_sub(window.left).ok_or("Aperture X overflow")?;
        let top = target.y.checked_sub(window.top).ok_or("Aperture Y overflow")?;
        let right = left.checked_add(target.width).ok_or("Aperture right overflow")?;
        let bottom = top.checked_add(target.height).ok_or("Aperture bottom overflow")?;
        if width <= 0 || height <= 0 || left < 0 || top < 0
            || right > width || bottom > height || right <= left || bottom <= top {
            return Err("Editor viewport does not fit within LazyDesigner's native window.".into());
        }
        Ok(Aperture { width, height, left, top, right, bottom })
    }

    fn region_for(ap: Aperture) -> Result<Region, String> {
        let outer = Region::rect(0, 0, ap.width, ap.height)?;
        let cutout = Region::rect(ap.left, ap.top, ap.right, ap.bottom)?;
        if unsafe { CombineRgn(outer.0, outer.0, cutout.0, RGN_DIFF) } == RGN_ERROR {
            return Err("Unable to calculate native editor cutout.".into());
        }
        Ok(outer)
    }

    // Do not overwrite a pre-existing custom manager region or a region
    // changed since our last admitted aperture. An unknown clip owner is a
    // recovery failure, never permission to silently reinitialize the GUI.
    fn assert_owned_region(hwnd: Hwnd, owned: Option<Aperture>) -> Result<(), String> {
        let current = Region::rect(0, 0, 0, 0)?;
        let kind = unsafe { GetWindowRgn(hwnd, current.0) };
        match owned {
            None if kind == RGN_ERROR => Ok(()),
            None => Err("LazyDesigner already has custom native clipping; editor composition refused.".into()),
            Some(_) if kind == RGN_ERROR => Err("Native editor aperture disappeared; do not overwrite an unverified window region.".into()),
            Some(expected) => {
                let comparison = region_for(expected)?;
                if unsafe { EqualRgn(current.0, comparison.0) } != 0 { Ok(()) }
                else { Err("LazyDesigner native clipping changed externally; it was not overwritten.".into()) }
            }
        }
    }

    fn apply_aperture(lease: &mut Lease, target: Placement) -> Result<(), String> {
        lease.verify_manager()?;
        let manager = lease.manager as Hwnd;
        assert_owned_region(manager, lease.aperture)?;
        let updated = aperture_rect(window_rect(manager)?, target)?;
        let mut region = region_for(updated)?;
        if unsafe { SetWindowRgn(manager, region.0, 1) } == 0 {
            return Err(win_error("Unable to apply native editor aperture"));
        }
        region.transfer(); // Windows now owns this GDI region.
        lease.aperture = Some(updated);
        Ok(())
    }

    fn clear_aperture(lease: &mut Lease) -> Result<(), String> {
        lease.verify_manager()?;
        let manager = lease.manager as Hwnd;
        assert_owned_region(manager, lease.aperture)?;
        if lease.aperture.is_some() {
            if unsafe { SetWindowRgn(manager, ptr::null_mut(), 1) } == 0 {
                return Err(win_error("Unable to clear the editor aperture"));
            }
            lease.aperture = None;
        }
        // Clearing a top-level region does not reliably repaint its WebView children.
        // Retry invalidation even after partial recovery, rather than leaving a hole.
        if unsafe {
            RedrawWindow(manager, ptr::null(), ptr::null_mut(),
                RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN)
        } == 0 {
            return Err(win_error("LazyDesigner child redraw after native detach was refused"));
        }
        Ok(())
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
    fn native_parent_pid() -> Result<u32, String> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot.is_null() || snapshot == (-1isize) as Handle {
                return Err(win_error("Native recovery parent inventory unavailable"));
            }
            let mut entry: ProcessEntry = std::mem::zeroed();
            entry.dw_size = std::mem::size_of::<ProcessEntry>() as u32;
            let mut found = None;
            let mut active = Process32FirstW(snapshot, &mut entry);
            while active != 0 {
                if entry.process_id == std::process::id() {
                    found = Some(entry.parent_process_id);
                    break;
                }
                active = Process32NextW(snapshot, &mut entry);
            }
            let _ = CloseHandle(snapshot);
            found.filter(|pid| *pid != 0)
                .ok_or_else(|| "Native recovery parent identity was not found.".into())
        }
    }

    fn process_image_path(pid: u32) -> Result<std::path::PathBuf, String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() { return Err(win_error("Native recovery parent process unavailable")); }
            let mut size = 32768u32;
            let mut buffer = vec![0u16; size as usize];
            let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
            let _ = CloseHandle(handle);
            if ok == 0 || size == 0 {
                return Err(win_error("Native recovery parent executable unavailable"));
            }
            Ok(std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize])))
        }
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
    // An already-admitted single Blockbench lease must not discover or
    // switch to another editor merely because a second Blockbench window opens.
    // Resolve only the Tauri manager for subsequent layout observations.
    fn discover_manager() -> Result<usize, String> {
        let mut windows = Windows {
            allowed: HashSet::new(), manager: Vec::new(), editors: Vec::new(),
        };
        if unsafe { EnumWindows(Some(enumerate), &mut windows as *mut _ as isize) } == 0 {
            return Err(win_error("LazyDesigner manager enumeration failed"));
        }
        unique(&windows.manager, "LazyDesigner")
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
        guard: Option<RecoveryGuard>,
        manager: usize,
        manager_thread: u32,
        manager_class: String,
        editor: usize,
        pid: u32,
        birth: u64,
        thread: u32,
        class: String,
        original: Rect,
        original_frame_style: isize,
        aperture: Option<Aperture>,
    }
    impl Lease {
        // Exact HWND/thread/class/process lifetime is enough for recovery;
        // dynamic installation discovery must not block restoring an already
        // admitted window after its desktop manager has crashed.
        fn verify_editor_identity(&self) -> Result<(), String> {
            let hwnd = self.editor as Hwnd;
            if unsafe { IsWindow(hwnd) } == 0
                || unsafe { GetWindow(hwnd, GW_OWNER) } != ptr::null_mut()
                || pid_and_thread(hwnd) != (self.pid, self.thread)
                || window_class(hwnd) != self.class
                || process_birth(self.pid)? != self.birth {
                return Err("The original Blockbench HWND identity was replaced or disappeared.".into());
            }
            Ok(())
        }

        fn verify_manager(&self) -> Result<(), String> {
            let hwnd = self.manager as Hwnd;
            if unsafe { IsWindow(hwnd) } == 0
                || pid_and_thread(hwnd) != (std::process::id(), self.manager_thread)
                || window_class(hwnd) != self.manager_class {
                return Err("LazyDesigner host window identity changed; native aperture ownership is unverified.".into());
            }
            Ok(())
        }

        fn verify(&self) -> Result<(), String> {
            self.verify_editor_identity()?;
            if !crate::blockbench::native_surface_processes()?.contains(&self.pid) {
                return Err("Original Blockbench executable is no longer verified; placement was refused.".into());
            }
            Ok(())
        }
    }
    // The recovery helper is the SAME signed/debug executable, but a separate
    // Windows process. It never launches, closes, or edits Blockbench.
    // Exactly one authenticated original HWND checkpoint is allowed.
    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RecoveryCheckpoint {
        schema: u32,
        parent_pid: u32,
        parent_birth: u64,
        manager: usize,
        manager_thread: u32,
        manager_class: String,
        editor: usize,
        pid: u32,
        birth: u64,
        thread: u32,
        class: String,
        original: Rect,
        original_frame_style: isize,
    }
    impl RecoveryCheckpoint {
        fn from_lease(lease: &Lease) -> Result<Self, String> {
            lease.verify_manager()?;
            lease.verify()?;
            if window_rect(lease.editor as Hwnd)? != lease.original {
                return Err("Blockbench moved before its native recovery checkpoint was captured.".into());
            }
            if unsafe { GetWindowLongPtrW(lease.editor as Hwnd, GWL_STYLE) } & FRAME_FLAGS
                != lease.original_frame_style & FRAME_FLAGS {
                return Err("Blockbench frame changed before native recovery admission.".into());
            }
            Ok(Self {
                schema: 1, parent_pid: std::process::id(),
                parent_birth: process_birth(std::process::id())?,
                manager: lease.manager, manager_thread: lease.manager_thread,
                manager_class: lease.manager_class.clone(),
                editor: lease.editor, pid: lease.pid, birth: lease.birth,
                thread: lease.thread, class: lease.class.clone(),
                original: lease.original, original_frame_style: lease.original_frame_style,
            })
        }
        fn lease(&self) -> Lease {
            Lease {
                guard: None,
                manager: self.manager, manager_thread: self.manager_thread,
                manager_class: self.manager_class.clone(),
                editor: self.editor, pid: self.pid, birth: self.birth,
                thread: self.thread, class: self.class.clone(),
                original: self.original, original_frame_style: self.original_frame_style,
                aperture: None,
            }
        }
        fn validate_parent_and_original_window(&self) -> Result<(), String> {
            if self.schema != 1 || self.parent_pid == 0 || self.parent_pid == self.pid
                || self.manager_thread == 0 || self.thread == 0
                || self.manager_class.is_empty() || self.class.is_empty()
                || self.manager_class.len() > 300 || self.class.len() > 300 {
                return Err("Invalid native recovery checkpoint identity.".into());
            }
            if native_parent_pid()? != self.parent_pid
                || process_birth(self.parent_pid)? != self.parent_birth
                || pid_and_thread(self.manager as Hwnd) != (self.parent_pid, self.manager_thread)
                || window_class(self.manager as Hwnd) != self.manager_class
                || window_text(self.manager as Hwnd) != "LazyDesigner" {
                return Err("Native recovery helper was not started by the verified LazyDesigner manager.".into());
            }
            let actual_exe = process_image_path(self.parent_pid)?.canonicalize()
                .map_err(|error| format!("Native recovery parent image inaccessible: {error}"))?;
            let own_exe = std::env::current_exe()
                .and_then(|path| path.canonicalize())
                .map_err(|error| format!("Native recovery helper image inaccessible: {error}"))?;
            if !actual_exe.to_string_lossy().eq_ignore_ascii_case(&own_exe.to_string_lossy()) {
                return Err("Native recovery helper parent executable differs from its own image.".into());
            }
            // Parent authenticated the installed Blockbench executable before
            // handing off this checkpoint. The helper must use the immutable
            // HWND/process birth fingerprint, not repeat optional Desktop
            // installation discovery while the UI waits for READY.
            let lease = self.lease();
            lease.verify_editor_identity()?;
            if window_rect(lease.editor as Hwnd)? != self.original
                || unsafe { GetWindowLongPtrW(lease.editor as Hwnd, GWL_STYLE) } & FRAME_FLAGS
                    != self.original_frame_style & FRAME_FLAGS {
                return Err("Native Blockbench checkpoint no longer matches the original window.".into());
            }
            Ok(())
        }
    }

    // Frame restore when the original Blockbench exited needs proof of that
    // EXACT lifetime, not a missing HWND or an unsuccessful PID query.
    fn original_editor_exited(lease: &Lease) -> Result<bool, String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, lease.pid);
            if handle.is_null() {
                if GetLastError() == ERROR_INVALID_PARAMETER { return Ok(true); }
                return Err(win_error("Original Blockbench process exit could not be verified"));
            }
            let mut a = FileTime::default();
            let mut b = FileTime::default();
            let mut c = FileTime::default();
            let mut d = FileTime::default();
            let identity = GetProcessTimes(handle, &mut a, &mut b, &mut c, &mut d);
            let wait = if identity != 0 { WaitForSingleObject(handle, 0) } else { u32::MAX };
            let _ = CloseHandle(handle);
            if identity == 0 {
                return Err(win_error("Original Blockbench process birth could not be checked"));
            }
            let current = (u64::from(a.high) << 32) | u64::from(a.low);
            if current != lease.birth { return Ok(true); }
            match wait {
                WAIT_OBJECT_0 => Ok(true),
                WAIT_TIMEOUT => Ok(false),
                _ => Err("Original Blockbench exit wait status was not verified.".into()),
            }
        }
    }

    fn bounded_helper_line(input: &mut impl BufRead) -> Result<Option<String>, String> {
        let mut bytes = Vec::new();
        let length = input.take(8193).read_until(b'\n', &mut bytes)
            .map_err(|error| format!("Native recovery IPC read: {error}"))?;
        if length == 0 { return Ok(None); }
        if length > 8192 || bytes.last() != Some(&b'\n') {
            return Err("Native recovery IPC command is truncated or oversized.".into());
        }
        String::from_utf8(bytes).map(Some)
            .map_err(|_| "Native recovery IPC requires UTF-8.".into())
    }

    pub(super) fn run_recovery_helper() {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        let result = (|| -> Result<(), String> {
            let first = bounded_helper_line(&mut input)?
                .ok_or("Native recovery helper did not receive a checkpoint.")?;
            let checkpoint: RecoveryCheckpoint = serde_json::from_str(&first)
                .map_err(|_| "Native recovery checkpoint JSON was invalid.")?;
            checkpoint.validate_parent_and_original_window()?;
            let stdout = io::stdout();
            let mut output = stdout.lock();
            output.write_all(b"READY\n")
                .map_err(|error| format!("Native recovery admission pipe failed: {error}"))?;
            output.flush().map_err(|error| format!("Native recovery READY flush failed: {error}"))?;
            // A clean DISARM follows verified parent-side frame + region
            // restoration. Unexpected EOF means parent crash; recover only
            // the original pinned Blockbench frame and bounds, not the host.
            if !matches!(bounded_helper_line(&mut input), Ok(Some(ref line)) if line == "DISARM\n") {
                restore_window(&checkpoint.lease())?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            // Parent reads only the first bounded admission reply. Post-READY
            // failures cannot be presented as success or launch new surfaces.
            let _ = writeln!(io::stdout(), "ERROR: {}", error.chars().take(250).collect::<String>());
        }
    }

    struct RecoveryGuard {
        child: Child,
        input: Option<ChildStdin>,
    }
    impl RecoveryGuard {
        fn start(lease: &Lease) -> Result<Self, String> {
            let checkpoint = RecoveryCheckpoint::from_lease(lease)?;
            let executable = std::env::current_exe()
                .map_err(|error| format!("Native recovery helper executable unavailable: {error}"))?;
            let mut child = Command::new(executable).arg(HELPER_ROLE)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
                .spawn().map_err(|error| format!("Native recovery helper could not start: {error}"))?;
            let input = child.stdin.take();
            let stdout = child.stdout.take();
            if input.is_none() || stdout.is_none() {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Native recovery helper pipes were not admitted.".into());
            }
            let mut guard = Self { child, input };
            let json = serde_json::to_string(&checkpoint)
                .map_err(|error| format!("Native recovery checkpoint encode failed: {error}"))?;
            if let Err(error) = guard.input.as_mut().unwrap()
                .write_all(format!("{json}\n").as_bytes())
                .and_then(|_| guard.input.as_mut().unwrap().flush()) {
                let _ = guard.child.kill();
                let _ = guard.child.wait();
                return Err(format!("Native recovery handoff failed: {error}"));
            }
            let mut reader = io::BufReader::new(stdout.unwrap());
            let (sender, receiver) = mpsc::sync_channel(1);
            std::thread::spawn(move || {
                let mut response = String::new();
                let result = reader.read_line(&mut response)
                    .map_err(|error| format!("Native recovery helper acknowledgement failed: {error}"))
                    .and_then(|bytes| {
                        if bytes == 0 || bytes > 512 {
                            Err("Native recovery helper acknowledgement was unavailable.".into())
                        } else if response == "READY\n" { Ok(()) }
                        else { Err(format!("Native recovery helper admission: {}", response.trim())) }
                    });
                let _ = sender.send(result);
            });
            let admitted = receiver.recv_timeout(HELPER_TIMEOUT)
                .map_err(|_| "Native recovery helper admission timed out.".to_string())
                .and_then(|result| result);
            if let Err(error) = admitted {
                let _ = guard.child.kill();
                let _ = guard.child.wait();
                return Err(error);
            }
            if let Err(error) = guard.confirm_alive() {
                let _ = guard.child.kill();
                let _ = guard.child.wait();
                return Err(error);
            }
            Ok(guard)
        }
        fn confirm_alive(&mut self) -> Result<(), String> {
            if self.child.try_wait()
                .map_err(|error| format!("Native recovery helper state unavailable: {error}"))?
                .is_some() {
                return Err("Native recovery helper exited; Blockbench presentation is not protected.".into());
            }
            Ok(())
        }
        fn disarm_after_restoration(&mut self) -> Result<(), String> {
            if self.child.try_wait().map_err(|error| error.to_string())?.is_some() {
                return Ok(());
            }
            if let Some(mut input) = self.input.take() {
                input.write_all(b"DISARM\n")
                    .map_err(|error| format!("Native recovery DISARM write failed: {error}"))?;
                input.flush()
                    .map_err(|error| format!("Native recovery DISARM flush failed: {error}"))?;
            }
            // Closing the pipe is safe only after original frame/rect and
            // host aperture were already verified restored.
            let deadline = Instant::now() + HELPER_TIMEOUT;
            loop {
                if self.child.try_wait().map_err(|error| error.to_string())?.is_some() {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    // Only our own helper may be killed. The user's original
                    // Blockbench process must never be terminated here.
                    let _ = self.child.kill();
                    return Err("Native recovery helper did not finish after Detach; retry recovery before another Place.".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    static ACTIVE: OnceLock<Mutex<Option<Lease>>> = OnceLock::new();
    fn lease() -> &'static Mutex<Option<Lease>> { ACTIVE.get_or_init(|| Mutex::new(None)) }

    // A zero previous style can be valid; use the explicit Win32 error value.
    fn change_frame_style(hwnd: Hwnd, next: isize) -> Result<(), String> {
        unsafe {
            SetLastError(0);
            let previous = SetWindowLongPtrW(hwnd, GWL_STYLE, next);
            if previous == 0 && GetLastError() != 0 {
                return Err(win_error("Unable to change the Blockbench window frame"));
            }
        }
        Ok(())
    }

    fn adopted_frame_style(style: isize) -> isize { style & !FRAME_FLAGS }
    fn restored_frame_style(current: isize, original: isize) -> isize {
        (current & !FRAME_FLAGS) | (original & FRAME_FLAGS)
    }

    // No SetParent, persistent topmost, taskbar changes or input injection.
    // Keep Blockbench-owned modal/disabled flags; adopt only the frame.
    fn place(lease: &Lease, target: Placement, raise: bool) -> Result<(), String> {
        lease.verify()?;
        let hwnd = lease.editor as Hwnd;
        if unsafe { IsIconic(hwnd) != 0 || IsZoomed(hwnd) != 0 } {
            return Err("Restore Blockbench from minimized/maximized state before placing it.".into());
        }
        if unsafe { IsHungAppWindow(hwnd) } != 0 {
            return Err("Blockbench is not responding; no native placement was attempted.".into());
        }
        let current_style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
        if current_style & WS_DISABLED != 0 {
            return Err("Close the active Blockbench dialog before repositioning its window.".into());
        }
        let framed = adopted_frame_style(current_style);
        let frame_changed = framed != current_style;
        if frame_changed { change_frame_style(hwnd, framed)?; }
        if unsafe {
            SetWindowPos(hwnd, if raise { HWND_TOP } else { ptr::null_mut() },
                target.x, target.y, target.width, target.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW
                    | (if raise { 0 } else { SWP_NOZORDER })
                    | (if frame_changed { SWP_FRAMECHANGED } else { 0 }))
        } == 0 {
            return Err(win_error("Unable to position Blockbench"));
        }
        lease.verify()?;
        verify_rect(hwnd, target)?;
        if unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & FRAME_FLAGS != 0 {
            return Err("Blockbench frame did not enter native workspace presentation.".into());
        }
        Ok(())
    }

    // Restore original frame flags while leaving Blockbench-owned modal flags
    // untouched. Always attempt original bounds even if frame restoration fails.
    fn restore_window(lease: &Lease) -> Result<(), String> {
        if let Err(window_error) = lease.verify_editor_identity() {
            return match original_editor_exited(lease) {
                Ok(true) => Ok(()), // Original process lifetime has ended; no HWND to mutate.
                Ok(false) => Err(format!("Original Blockbench is still alive but its HWND changed: {window_error}")),
                Err(exit_error) => Err(format!("{window_error}; original process exit remains unverified: {exit_error}")),
            };
        }
        let hwnd = lease.editor as Hwnd;
        let current = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
        let restored = restored_frame_style(current, lease.original_frame_style);
        let changed = current != restored;
        let frame_error = if changed { change_frame_style(hwnd, restored).err() } else { None };
        let r = lease.original;
        let position_error = if unsafe {
            SetWindowPos(hwnd, ptr::null_mut(), r.left, r.top,
                r.right-r.left, r.bottom-r.top,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW
                    | (if changed { SWP_FRAMECHANGED } else { 0 }))
        } == 0 {
            Some(win_error("Unable to restore Blockbench window bounds"))
        } else { None };
        if let Some(error) = frame_error { return Err(error); }
        if let Some(error) = position_error { return Err(error); }
        lease.verify_editor_identity()?;
        verify_rect(hwnd, Placement {
            x: r.left, y: r.top, width: r.right-r.left, height: r.bottom-r.top,
        })?;
        if unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & FRAME_FLAGS
            != lease.original_frame_style & FRAME_FLAGS {
            return Err("Blockbench native frame restoration was not confirmed.".into());
        }
        Ok(())
    }

    fn editor_at_native_center(lease: &Lease, target: Placement) -> Result<bool, String> {
        lease.verify()?;
        verify_rect(lease.editor as Hwnd, target)?;
        let hwnd = lease.editor as Hwnd;
        if unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
            return Err("Blockbench window is not visibly presented.".into());
        }
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
        if style & (WS_DISABLED | FRAME_FLAGS) != 0 {
            return Err("Blockbench has an active dialog or its original frame reappeared.".into());
        }
        let center = Point { x: target.x + target.width / 2, y: target.y + target.height / 2 };
        let hit = unsafe { GetAncestor(WindowFromPoint(center), GA_ROOT) };
        lease.verify()?;
        Ok(hit == hwnd)
    }

    // Use Emulator's real-HWND hit test for ONE editor, not its other DWM tiles.
    // A temporary topmost pulse is synchronously undone; never leave it latched.
    fn confirm_native_hit(lease: &Lease, target: Placement, activate: bool) -> Result<(), String> {
        let manager = lease.manager as Hwnd;
        let editor = lease.editor as Hwnd;
        let foreground = unsafe { GetForegroundWindow() };
        if foreground != manager && foreground != editor {
            return Err("Another app owns the foreground; Blockbench mouse target is unverified.".into());
        }
        if !editor_at_native_center(lease, target)? && foreground == manager {
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
            let raised = unsafe { SetWindowPos(editor, -1isize as Hwnd, 0, 0, 0, 0, flags) };
            // Attempt rollback even when the raise call fails.
            let lowered = unsafe { SetWindowPos(editor, -2isize as Hwnd, 0, 0, 0, 0, flags) };
            if raised == 0 || lowered == 0 {
                return Err("Blockbench stacking pulse could not be safely completed; detach to restore.".into());
            }
        }
        if !editor_at_native_center(lease, target)? {
            return Err("Blockbench is covered at the viewport center; native presentation is not confirmed.".into());
        }
        // Only explicit user Place may request keyboard focus. Windows can deny
        // activation; the user can click the actual Blockbench window afterward.
        if activate && foreground == manager {
            unsafe { let _ = SetForegroundWindow(editor); }
        }
        Ok(())
    }

    fn restore(lease: &mut Lease) -> Result<(), String> {
        // Both resources have independent ownership. Attempt recovery of
        // both even when the first fails, then preserve the lease if either
        // remains unverified; never repeat native placement automatically.
        let region_error = clear_aperture(lease).err();
        let window_error = restore_window(lease).err();
        match (region_error, window_error) {
            (None, None) => {
                // Recovery helper must be fully stopped before a new lease
                // may be admitted, even if the OS already restored geometry.
                if let Some(guard) = lease.guard.as_mut() {
                    guard.disarm_after_restoration()?;
                    lease.guard = None;
                }
                Ok(())
            },
            (Some(region), None) =>
                Err(format!("Blockbench window restored but app aperture is unverified: {region}")),
            (None, Some(window)) =>
                Err(format!("App aperture restored but Blockbench window is unverified: {window}")),
            (Some(region), Some(window)) =>
                Err(format!("Aperture recovery: {region}; Blockbench recovery: {window}")),
        }
    }

    pub(super) fn run(action: &str, view: Option<EditorViewport>) -> Result<EditorSurfaceReceipt, String> {
        let mut state = lease().lock().map_err(|_| "Native editor presentation lock is unavailable.")?;
        match action {
            "detach" => {
                let Some(existing) = state.as_mut() else { return Ok(receipt("DETACHED", "No native editor lease was active.")); };
                // A changed PID/HWND is *not* permission to reposition a new window.
                restore(existing)?;
                *state = None;
                Ok(receipt("DETACHED", "Original Blockbench window bounds restored."))
            }
            "present" | "update" => {
                let viewport = view.ok_or("Native editor viewport is required.")?;
                if let Some(existing) = state.as_mut() {
                    let manager = discover_manager()?;
                    existing.verify_manager()?;
                    existing.guard.as_mut()
                        .ok_or("Native recovery helper checkpoint missing; detach before editing.")?
                        .confirm_alive()?;
                    if existing.manager != manager {
                        return Err("LazyDesigner window changed; detach before presenting again.".into());
                    }
                    let foreground = unsafe { GetForegroundWindow() };
                    if foreground != manager as Hwnd && foreground != existing.editor as Hwnd {
                        return Ok(receipt("DEFERRED", "Another application is active; no native placement was changed."));
                    }
                    let geometry = placement(manager, viewport)?;
                    existing.verify()?;
                    assert_owned_region(manager as Hwnd, existing.aperture)?;
                    let expected_aperture = aperture_rect(window_rect(manager as Hwnd)?, geometry)?;
                    // A reported layout change does not justify another
                    // Win32 mutation when the window and cutout still match.
                    if existing.aperture == Some(expected_aperture)
                        && verify_rect(existing.editor as Hwnd, geometry).is_ok() {
                        confirm_native_hit(existing, geometry, false)?;
                        return Ok(receipt("PRESENTED", "Native Blockbench bounds and mouse hit target confirmed at last check."));
                    }
                    // A failed update retains the original admission checkpoint;
                    // the Svelte caller must stop automatic retry on uncertainty.
                    place(existing, geometry, foreground == manager as Hwnd)?;
                    apply_aperture(existing, geometry)?;
                    confirm_native_hit(existing, geometry, false)?;
                    return Ok(receipt("PRESENTED", "Native Blockbench bounds and mouse hit target confirmed after layout."));
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
                    guard: None,
                    manager,
                    manager_thread: pid_and_thread(manager as Hwnd).1,
                    manager_class: window_class(manager as Hwnd),
                    editor, pid, birth: process_birth(pid)?,
                    thread: pid_and_thread(editor as Hwnd).1,
                    class: window_class(editor as Hwnd),
                    original,
                    original_frame_style: unsafe { GetWindowLongPtrW(editor as Hwnd, GWL_STYLE) },
                    aperture: None,
                };
                if candidate.thread == 0 || candidate.class.is_empty()
                    || candidate.manager_thread == 0 || candidate.manager_class.is_empty() {
                    return Err("Native editor or host window identity was incomplete.".into());
                }
                candidate.verify_manager()?;
                candidate.verify()?;
                let mut candidate = candidate;
                // Helper READY is required BEFORE the first native style,
                // geometry or manager cutout mutation; the original saved
                // window survives even if the Desktop manager exits.
                candidate.guard = Some(RecoveryGuard::start(&candidate)?);
                let placement_result = place(&candidate, target, true)
                    .and_then(|_| apply_aperture(&mut candidate, target))
                    .and_then(|_| confirm_native_hit(&candidate, target, true))
                    .and_then(|_| candidate.guard.as_mut()
                        .ok_or("Native recovery helper was not retained.".to_string())?
                        .confirm_alive());
                if let Err(failure) = placement_result {
                    // The window and region can change independently. Attempt
                    // both restorations and retain any uncertain checkpoint.
                    return match restore(&mut candidate) {
                        Ok(()) => Err(failure),
                        Err(recovery) => {
                            *state = Some(candidate);
                            Err(format!("Presentation unverified ({failure}); restoration unverified ({recovery}). Use Detach, not Present."))
                        }
                    };
                }
                *state = Some(candidate);
                Ok(receipt("PRESENTED", "Original Blockbench window and mouse hit target confirmed; keyboard editing is not yet verified."))
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
            // The manager can be resolved independently of later editor count.
            assert_eq!(super::unique(&[4], "LazyDesigner"), Ok(4));
            assert!(super::unique(&[4, 5], "LazyDesigner").is_err());
        }
    }
    #[cfg(test)]
    mod recovery_identity_tests {
        use super::*;
        #[test]
        fn original_editor_retirement_requires_exact_process_birth() {
            // Synthetic missing PID is not a valid recovery target, and a
            // previously selected HWND is never inferred from a new PID.
            let lease = Lease {
                guard: None, manager: 1, manager_thread: 2, manager_class: "Manager".into(),
                editor: 3, pid: 0, birth: 0, thread: 4,
                class: "Blockbench".into(), original: Rect::default(),
                original_frame_style: 0, aperture: None,
            };
            assert!(lease.verify_editor_identity().is_err());
            let mut lifetime = lease;
            lifetime.pid = std::process::id();
            lifetime.birth = process_birth(std::process::id()).unwrap();
            assert!(!original_editor_exited(&lifetime).unwrap());
            lifetime.birth = 1;
            assert!(original_editor_exited(&lifetime).unwrap());
        }
        #[test]
        fn helper_checkpoint_rejects_cross_process_or_unversioned_requests() {
            let mut cp = RecoveryCheckpoint {
                schema: 0, parent_pid: 10, parent_birth: 2,
                manager: 1, manager_thread: 20, manager_class: "LazyDesigner".into(),
                editor: 3, pid: 11, birth: 4, thread: 30, class: "Blockbench".into(),
                original: Rect::default(), original_frame_style: 0,
            };
            assert!(cp.validate_parent_and_original_window().is_err());
            cp.schema = 1;
            cp.pid = cp.parent_pid;
            assert!(cp.validate_parent_and_original_window().is_err());
        }
    }

    #[cfg(test)]
    mod frame_tests {
        use super::*;

        #[test]
        fn frame_restoration_preserves_live_blockbench_owned_flags() {
            let original = WS_CAPTION | WS_THICKFRAME | WS_DISABLED | 0x00010000isize;
            let adopted = adopted_frame_style(original);
            assert_eq!(adopted & FRAME_FLAGS, 0);
            assert_ne!(adopted & WS_DISABLED, 0);
            let current = adopted & !WS_DISABLED | 0x00020000isize;
            let restored = restored_frame_style(current, original);
            assert_eq!(restored & FRAME_FLAGS, original & FRAME_FLAGS);
            assert_eq!(restored & WS_DISABLED, 0);
            assert_ne!(restored & 0x00020000isize, 0);
        }
    }

    #[cfg(test)]
    mod aperture_tests {
        use super::*;
        #[test]
        fn window_cutout_uses_outer_window_coordinates() {
            let window = Rect { left: 100, top: 70, right: 1500, bottom: 960 };
            let viewport = Placement { x: 220, y: 150, width: 800, height: 400 };
            assert_eq!(aperture_rect(window, viewport).unwrap(),
                Aperture { width: 1400, height: 890, left: 120, top: 80, right: 920, bottom: 480 });
        }
        #[test]
        fn cutout_rejects_outside_or_overflowing_rectangles() {
            let window = Rect { left: -400, top: 100, right: 1000, bottom: 900 };
            assert!(aperture_rect(window, Placement {
                x: 500, y: 700, width: 900, height: 400
            }).is_err());
            assert!(aperture_rect(window, Placement {
                x: i32::MAX, y: 150, width: 500, height: 300
            }).is_err());
        }
    }

    pub(super) fn release_if_manager_minimized() {
        if let Ok(mut state) = lease().lock() {
            if let Some(existing) = state.as_mut() {
                let manager = existing.manager as Hwnd;
                if unsafe { IsWindow(manager) } != 0 && unsafe { IsIconic(manager) } != 0 {
                    if restore(existing).is_ok() { *state = None; }
                }
            }
        }
    }

    pub(super) fn restore_on_exit() {
        if let Ok(mut state) = lease().lock() {
            if let Some(existing) = state.as_mut() {
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
    pub(super) fn release_if_manager_minimized() {}
    pub(super) fn restore_on_exit() {}
}

// The helper is an internal debug-only child role of the same executable.
 // It must be consumed before Tauri instance admission or its own mutex would
 // prevent the crash recovery process from starting.
pub fn maybe_run_recovery_helper() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--lazydesigner-blockbench-recovery") {
        return false;
    }
    #[cfg(all(windows, debug_assertions))]
    platform::run_recovery_helper();
    true
}

pub fn command(action: &str, viewport: Option<EditorViewport>) -> Result<EditorSurfaceReceipt, String> {
    if !matches!(action, "present" | "update" | "detach") { return Err("Unsupported native editor action.".into()); }
    platform::run(action, viewport)
}
pub fn restore_on_exit() { platform::restore_on_exit(); }
pub fn release_if_manager_minimized() { platform::release_if_manager_minimized(); }

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
