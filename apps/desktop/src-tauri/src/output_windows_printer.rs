//! Native printer choice followed by observable WebView2 print submission.
//! Unlike ShowPrintUI, the Print API has a completion/failure callback. Known
//! file printers never receive a path: PDF goes back through the host's guarded
//! save picker and publication, while other file formats are rejected.
use super::{wide, PageSize};
use ::windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Foundation::{GlobalFree, E_FAIL, E_NOTIMPL, HGLOBAL, HWND},
        Graphics::Gdi::*,
        System::Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        UI::Controls::Dialogs::*,
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
    unsafe fn mode(&self) -> Result<DEVMODEW> {
        if self.len < size_of::<DEVMODEW>() {
            return Err(E_FAIL.into());
        }
        let mode = self.ptr.cast::<DEVMODEW>().read_unaligned();
        if (mode.dmSize as usize) < size_of::<DEVMODEW>()
            || mode.dmSize as usize + mode.dmDriverExtra as usize > self.len
        {
            return Err(E_FAIL.into());
        }
        Ok(mode)
    }
}
impl Drop for Locked {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalUnlock(self.handle);
        }
    }
}

unsafe fn paper_inches(mode: &DEVMODEW) -> Result<(f64, f64)> {
    let printer = mode.Anonymous1.Anonymous1;
    if mode.dmFields.contains(DM_PAPERWIDTH | DM_PAPERLENGTH)
        && printer.dmPaperWidth > 0
        && printer.dmPaperLength > 0
    {
        return Ok((
            printer.dmPaperWidth as f64 / 254.0,
            printer.dmPaperLength as f64 / 254.0,
        ));
    }
    // A bounded standard paper table avoids trusting a driver's unbounded
    // DeviceCapabilities buffer write. Unknown media is rejected, not replaced.
    let mm = match printer.dmPaperSize as u32 {
        DMPAPER_LETTER => (215.9, 279.4),
        DMPAPER_LEGAL => (215.9, 355.6),
        DMPAPER_A3 => (297.0, 420.0),
        DMPAPER_A4 => (210.0, 297.0),
        DMPAPER_A5 => (148.0, 210.0),
        DMPAPER_B4 => (257.0, 364.0),
        DMPAPER_B5 => (182.0, 257.0),
        DMPAPER_EXECUTIVE => (184.15, 266.7),
        DMPAPER_TABLOID => (279.4, 431.8),
        _ => {
            return Err(unsupported(
                "unsupported paper size; choose A4/Letter or explicit dimensions",
            ))
        }
    };
    Ok((mm.0 / 25.4, mm.1 / 25.4))
}

pub(super) unsafe fn choose(
    settings: &ICoreWebView2PrintSettings,
    owner: HWND,
    page: PageSize,
    landscape: bool,
) -> Result<Selection> {
    let mut dialog = Dialog(PRINTDLGW {
        lStructSize: size_of::<PRINTDLGW>() as u32,
        hwndOwner: owner,
        Flags: PD_RETURNDEFAULT,
        ..Default::default()
    });
    // Seed the dialog with this output's paper/orientation when a default printer
    // exists. If no default exists, the actual dialog can still select one.
    if PrintDlgW(&mut dialog.0).as_bool() {
        let locked = Locked::new(dialog.0.hDevMode)?;
        let mut mode = locked.mode()?;
        mode.dmFields |= DM_PAPERSIZE | DM_ORIENTATION;
        mode.dmFields &= !(DM_PAPERWIDTH | DM_PAPERLENGTH);
        mode.Anonymous1.Anonymous1.dmPaperSize = match page {
            PageSize::A4 => DMPAPER_A4 as i16,
            PageSize::Letter => DMPAPER_LETTER as i16,
        };
        mode.Anonymous1.Anonymous1.dmOrientation = if landscape {
            DMORIENT_LANDSCAPE as i16
        } else {
            DMORIENT_PORTRAIT as i16
        };
        locked.ptr.cast::<DEVMODEW>().write_unaligned(mode);
    } else {
        let code = CommDlgExtendedError();
        if code != PDERR_NODEFAULTPRN {
            return Err(::windows::core::Error::new(
                E_FAIL,
                format!("Cannot query default printer: {:#x}", code.0),
            ));
        }
    }
    dialog.0.Flags = PD_NOSELECTION | PD_DISABLEPRINTTOFILE | PD_HIDEPRINTTOFILE;
    dialog.0.nMinPage = 1;
    dialog.0.nMaxPage = u16::MAX;
    dialog.0.nFromPage = 1;
    dialog.0.nToPage = 1;
    dialog.0.nCopies = 1;
    if !PrintDlgW(&mut dialog.0).as_bool() {
        let code = CommDlgExtendedError().0;
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
    let mode = Locked::new(dialog.0.hDevMode)?.mode()?;
    let copies = dialog.0.nCopies;
    if copies == 0 {
        return Err(unsupported("invalid copy count"));
    }
    let file_printer =
        port.eq_ignore_ascii_case("PORTPROMPT:") || port.eq_ignore_ascii_case("FILE:");
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
    if mode.dmFields.contains(DM_COLOR) {
        settings2.SetColorMode(if mode.dmColor == DMCOLOR_COLOR {
            COREWEBVIEW2_PRINT_COLOR_MODE_COLOR
        } else {
            COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE
        })?;
    }
    if mode.dmFields.contains(DM_DUPLEX) {
        settings2.SetDuplex(match mode.dmDuplex {
            DMDUP_SIMPLEX => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
            DMDUP_VERTICAL => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
            DMDUP_HORIZONTAL => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
            _ => return Err(unsupported("unknown duplex mode")),
        })?;
    }
    let printer = mode.Anonymous1.Anonymous1;
    if mode.dmFields.contains(DM_SCALE) {
        settings.SetScaleFactor(printer.dmScale as f64 / 100.0)?;
    }
    settings.SetOrientation(match printer.dmOrientation {
        x if x == DMORIENT_LANDSCAPE as i16 => COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        x if x == DMORIENT_PORTRAIT as i16 => COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        _ => return Err(unsupported("unknown orientation")),
    })?;
    let (width, height) = paper_inches(&mode)?;
    settings.SetPageWidth(width)?;
    settings.SetPageHeight(height)?;
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
    fn known_and_explicit_paper_sizes_are_preserved_unknown_sizes_rejected() {
        unsafe {
            let mut mode = DEVMODEW::default();
            mode.Anonymous1.Anonymous1.dmPaperSize = DMPAPER_LETTER as i16;
            assert_eq!(paper_inches(&mode).unwrap(), (8.5, 11.0));
            mode.Anonymous1.Anonymous1.dmPaperSize = DMPAPER_A4 as i16;
            let (w, h) = paper_inches(&mode).unwrap();
            assert!((w * 25.4 - 210.0).abs() < 0.001);
            assert!((h * 25.4 - 297.0).abs() < 0.001);
            mode.Anonymous1.Anonymous1.dmPaperSize = 30000;
            assert!(paper_inches(&mode).is_err());
            mode.dmFields = DM_PAPERWIDTH | DM_PAPERLENGTH;
            mode.Anonymous1.Anonymous1.dmPaperWidth = 1000;
            mode.Anonymous1.Anonymous1.dmPaperLength = 2000;
            assert_eq!(
                paper_inches(&mode).unwrap(),
                (1000.0 / 254.0, 2000.0 / 254.0)
            );
        }
    }
}
