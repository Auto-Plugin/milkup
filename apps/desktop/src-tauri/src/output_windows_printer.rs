//! Native printer choice followed by observable WebView2 print submission.
//! Unlike ShowPrintUI, the Print API has a completion/failure callback. Known
//! file printers never receive a path: PDF goes back through the host's guarded
//! save picker and publication, while other file formats are rejected.
use super::{wide, PageSize};
use ::windows::{
    core::{w, Interface, PCWSTR},
    Win32::{
        Foundation::{GlobalFree, E_FAIL, E_NOTIMPL, HANDLE, HGLOBAL, HWND, LPARAM, WPARAM},
        Graphics::Gdi::*,
        System::Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        UI::{
            Controls::Dialogs::*,
            Input::KeyboardAndMouse::{EnableWindow, IsWindowEnabled},
            WindowsAndMessaging::*,
        },
    },
};
use std::mem::size_of;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
type Result<T> = ::windows::core::Result<T>;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Selection {
    Cancelled,
    Printer,
    Pdf,
}
fn unsupported(message: &str) -> ::windows::core::Error {
    ::windows::core::Error::new(E_NOTIMPL, format!("Unsupported print option: {message}"))
}
fn file_destination_port(port: &str) -> bool {
    let upper = port.to_ascii_uppercase();
    matches!(upper.as_str(), "PORTPROMPT:" | "FILE:" | "XPSPORT:")
        || port.contains(['\\', '/'])
        || (port.as_bytes().get(1) == Some(&b':') && port.as_bytes()[0].is_ascii_alphabetic())
}
struct Dialog(PRINTDLGW);
impl Drop for Dialog {
    fn drop(&mut self) {
        unsafe {
            if !self.0.hDevMode.is_invalid() {
                let _ = GlobalFree(Some(self.0.hDevMode));
            }
            if !self.0.hDevNames.is_invalid() {
                let _ = GlobalFree(Some(self.0.hDevNames));
            }
            if !self.0.hDC.is_invalid() {
                let _ = DeleteDC(self.0.hDC);
            }
        }
    }
}
struct Locked {
    handle: HGLOBAL,
    ptr: *mut u8,
    len: usize,
}
impl Locked {
    unsafe fn new(handle: HGLOBAL) -> Result<Self> {
        let len = GlobalSize(handle);
        let ptr = GlobalLock(handle).cast::<u8>();
        if ptr.is_null() || len == 0 {
            if !ptr.is_null() {
                let _ = GlobalUnlock(handle);
            }
            return Err(E_FAIL.into());
        }
        Ok(Self { handle, ptr, len })
    }
    unsafe fn name(&self, offset: u16) -> Result<String> {
        let units = std::slice::from_raw_parts(self.ptr.cast::<u16>(), self.len / 2);
        let name = units
            .get(offset as usize..)
            .ok_or_else(|| ::windows::core::Error::from(E_FAIL))?;
        let end = name
            .iter()
            .take(32768)
            .position(|&x| x == 0)
            .ok_or_else(|| ::windows::core::Error::from(E_FAIL))?;
        String::from_utf16(&name[..end]).map_err(|_| E_FAIL.into())
    }
}
impl Drop for Locked {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalUnlock(self.handle);
        }
    }
}

// Microsoft's PrnSetup.Dlg maps Properties to psh2; dlgs.h defines 0x0401.
// https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/PrnSetup.Dlg
const PROPERTIES: i32 = 0x0401;
const ENFORCE_OPTIONS: u32 = WM_APP + 27;
#[derive(Default)]
struct ChoiceGuard {
    initialized: bool,
    failed: bool,
}
unsafe fn enforce_options(window: HWND, guard: &mut ChoiceGuard) {
    let valid = (|| -> Result<()> {
        let button = GetDlgItem(Some(window), PROPERTIES)?;
        let mut class = [0u16; 32];
        let length = GetClassNameW(button, &mut class);
        let style = GetWindowLongPtrW(button, GWL_STYLE) as u32 & BS_TYPEMASK as u32;
        if String::from_utf16_lossy(&class[..length.max(0) as usize]) != "Button"
            || (style != BS_PUSHBUTTON as u32 && style != BS_DEFPUSHBUTTON as u32)
        {
            return Err(E_FAIL.into());
        }
        let _ = EnableWindow(button, false);
        if IsWindowEnabled(button).as_bool() {
            return Err(E_FAIL.into());
        }
        Ok(())
    })();
    if valid.is_err() {
        guard.failed = true;
        // PrintHookProc must not call EndDialog. Preserve failure separately
        // from a user cancel, then use the documented IDABORT command.
        let _ = PostMessageW(
            Some(window),
            WM_COMMAND,
            WPARAM(IDABORT.0 as usize),
            LPARAM(0),
        );
    }
}
unsafe extern "system" fn print_hook(
    window: HWND,
    message: u32,
    word: WPARAM,
    param: LPARAM,
) -> usize {
    if message == WM_INITDIALOG {
        let dialog = param.0 as *const PRINTDLGW;
        if dialog.is_null() {
            return 0;
        }
        let guard = (*dialog).lCustData.0 as *mut ChoiceGuard;
        if guard.is_null() {
            return 0;
        }
        (*guard).initialized = true;
        if SetPropW(
            window,
            w!("MilkupOutputChoiceGuard"),
            Some(HANDLE(guard.cast())),
        )
        .is_err()
        {
            (*guard).failed = true;
            let _ = PostMessageW(
                Some(window),
                WM_COMMAND,
                WPARAM(IDABORT.0 as usize),
                LPARAM(0),
            );
        } else {
            enforce_options(window, &mut *guard);
            let _ = PostMessageW(Some(window), ENFORCE_OPTIONS, WPARAM(0), LPARAM(0));
        }
    } else if message == WM_COMMAND && word.0 & 0xffff == PROPERTIES as usize {
        // Consume mouse and keyboard activation even if the native dialog
        // temporarily re-enabled Properties while changing the printer.
        return 1;
    } else if message == WM_COMMAND {
        let _ = PostMessageW(Some(window), ENFORCE_OPTIONS, WPARAM(0), LPARAM(0));
    } else if message == ENFORCE_OPTIONS {
        let guard = GetPropW(window, w!("MilkupOutputChoiceGuard")).0 as *mut ChoiceGuard;
        if !guard.is_null() {
            enforce_options(window, &mut *guard);
        }
        return 1;
    } else if message == WM_DESTROY {
        let _ = RemovePropW(window, w!("MilkupOutputChoiceGuard"));
    }
    0
}

pub(super) unsafe fn choose(
    settings: &ICoreWebView2PrintSettings,
    owner: HWND,
    page: PageSize,
    landscape: bool,
) -> Result<Selection> {
    let mut guard = ChoiceGuard::default();
    let mut dialog = Dialog(PRINTDLGW {
        lStructSize: size_of::<PRINTDLGW>() as u32,
        hwndOwner: owner,
        Flags: PD_NOSELECTION | PD_DISABLEPRINTTOFILE | PD_HIDEPRINTTOFILE | PD_ENABLEPRINTHOOK,
        lpfnPrintHook: Some(print_hook),
        lCustData: LPARAM((&mut guard as *mut ChoiceGuard) as isize),
        ..Default::default()
    });
    dialog.0.nMinPage = 1;
    dialog.0.nMaxPage = u16::MAX;
    dialog.0.nFromPage = 1;
    dialog.0.nToPage = 1;
    dialog.0.nCopies = 1;
    let accepted = PrintDlgW(&mut dialog.0).as_bool();
    let dialog_error = if accepted {
        0
    } else {
        CommDlgExtendedError().0
    };
    if !accepted && !guard.initialized && dialog_error != 0 {
        return Err(::windows::core::Error::new(
            E_FAIL,
            format!("Native print dialog failed before initialization: {dialog_error:#x}"),
        ));
    }
    if !guard.initialized || guard.failed {
        return Err(unsupported(
            "native printer chooser template cannot enforce supported options",
        ));
    }
    if !accepted {
        let code = dialog_error;
        return if code == 0 {
            Ok(Selection::Cancelled)
        } else {
            Err(::windows::core::Error::new(
                E_FAIL,
                format!("Native print dialog failed: {code:#x}"),
            ))
        };
    }
    if dialog.0.Flags.contains(PD_PRINTTOFILE) {
        return Err(unsupported("use Export PDF for file destinations"));
    }
    let names = Locked::new(dialog.0.hDevNames)?;
    if names.len < size_of::<DEVNAMES>() {
        return Err(E_FAIL.into());
    }
    let metadata = names.ptr.cast::<DEVNAMES>().read_unaligned();
    let name = names.name(metadata.wDeviceOffset)?;
    let port = names.name(metadata.wOutputOffset)?;
    if name.is_empty() || port.is_empty() {
        return Err(E_FAIL.into());
    }
    let copies = dialog.0.nCopies;
    if copies == 0 {
        return Err(unsupported("invalid copy count"));
    }
    // A configured Local Port can be an absolute/relative filename, not just
    // FILE:. Never send those destinations to a driver outside our save lease.
    let file_printer = file_destination_port(&port);
    let pdf = name.eq_ignore_ascii_case("Microsoft Print to PDF");
    if file_printer && !pdf {
        return Err(unsupported("use Export PDF instead of this file printer"));
    }
    if pdf && copies != 1 {
        return Err(unsupported("PDF file output requires one copy"));
    }
    let settings2 = settings.cast::<ICoreWebView2PrintSettings2>()?;
    settings2.SetPrinterName(PCWSTR(wide(&name).as_ptr()))?;
    settings2.SetCopies(copies as i32)?;
    settings2.SetMediaSize(COREWEBVIEW2_PRINT_MEDIA_SIZE_CUSTOM)?;
    settings2.SetCollation(if dialog.0.Flags.contains(PD_COLLATE) {
        COREWEBVIEW2_PRINT_COLLATION_COLLATED
    } else {
        COREWEBVIEW2_PRINT_COLLATION_UNCOLLATED
    })?;
    if dialog.0.Flags.contains(PD_PAGENUMS) {
        if dialog.0.nFromPage == 0 || dialog.0.nToPage < dialog.0.nFromPage {
            return Err(unsupported("invalid page range"));
        }
        settings2.SetPageRanges(PCWSTR(
            wide(&format!("{}-{}", dialog.0.nFromPage, dialog.0.nToPage)).as_ptr(),
        ))?;
    }
    // The chooser exposes only printer/page-range/copies/collation. Vendor
    // Properties is blocked, rather than accepting choices we cannot forward.
    settings2.SetColorMode(COREWEBVIEW2_PRINT_COLOR_MODE_DEFAULT)?;
    settings2.SetDuplex(COREWEBVIEW2_PRINT_DUPLEX_DEFAULT)?;
    let (width, height) = match page {
        PageSize::A4 => (210.0 / 25.4, 297.0 / 25.4),
        PageSize::Letter => (8.5, 11.0),
    };
    settings.SetPageWidth(width)?;
    settings.SetPageHeight(height)?;
    settings.SetOrientation(if landscape {
        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
    } else {
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
    })?;
    Ok(if pdf {
        Selection::Pdf
    } else {
        Selection::Printer
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_and_path_ports_cannot_bypass_the_guarded_save_target() {
        for port in [
            "FILE:",
            "portprompt:",
            "XPSPort:",
            "C:\\source.md",
            "C:source.md",
            "\\\\server\\share\\source.md",
            "relative/output.pdf",
            "relative\\output.pdf",
        ] {
            assert!(file_destination_port(port), "{port}");
        }
        for port in ["USB001", "LPT1:", "IP_192.0.2.1", "WSD-fixture"] {
            assert!(!file_destination_port(port), "{port}");
        }
    }
    #[test]
    fn native_properties_guard_disables_supported_control_and_rejects_wrong_template() {
        unsafe {
            let window = CreateWindowExW(
                Default::default(),
                w!("STATIC"),
                w!("Output guard test"),
                WS_POPUP,
                0,
                0,
                100,
                100,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let mut guard = ChoiceGuard::default();
            enforce_options(window, &mut guard);
            assert!(guard.failed);
            let button = CreateWindowExW(
                Default::default(),
                w!("BUTTON"),
                w!("Properties"),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                80,
                24,
                Some(window),
                Some(HMENU(PROPERTIES as usize as *mut _)),
                None,
                None,
            )
            .unwrap();
            let mut guard = ChoiceGuard::default();
            enforce_options(window, &mut guard);
            assert!(!guard.failed);
            assert!(!IsWindowEnabled(button).as_bool());
            assert_eq!(
                print_hook(window, WM_COMMAND, WPARAM(PROPERTIES as usize), LPARAM(0)),
                1
            );
            // A printer change can enable the control again; enforcement must
            // disable it again rather than accepting unmapped driver settings.
            let _ = EnableWindow(button, true);
            enforce_options(window, &mut guard);
            assert!(!IsWindowEnabled(button).as_bool());
            DestroyWindow(window).unwrap();
        }
    }
}
