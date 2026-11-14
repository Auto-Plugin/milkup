using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Installation smoke only. Never infer the product HWND from Process.MainWindowHandle:
// WebView startup can expose another top-level window before the hidden Tauri root.
public static class MilkupInstallWindow {
    delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    // Unlike a later Get-Process lookup, this owns the exact process handle from
    // before the close request through exit-code collection. No PID reopening.
    public sealed class ExitWitness : IDisposable {
        readonly Process process;
        readonly IntPtr handle;
        readonly int pid;
        readonly string creationTicks;
        public ExitWitness(int pid, long creationTicks, string image) {
            process = Process.GetProcessById(pid);
            try {
                handle = process.Handle;
                if (WaitForSingleObject(handle, 0) != 0x102 ||
                    process.StartTime.ToUniversalTime().Ticks != creationTicks ||
                    !String.Equals(process.MainModule.FileName, image, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Exit witness requires exact live process generation/image");
                this.pid = pid;
                this.creationTicks = creationTicks.ToString(System.Globalization.CultureInfo.InvariantCulture);
            } catch { process.Dispose(); throw; }
        }
        public Dictionary<string, object> Wait(int milliseconds) {
            if (milliseconds < 0 || milliseconds > 15000) throw new ArgumentOutOfRangeException("milliseconds");
            uint result = WaitForSingleObject(handle, (uint)milliseconds);
            if (result != 0 && result != 0x102) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            uint code;
            if (!GetExitCodeProcess(handle, out code)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return new Dictionary<string, object> {
                {"exited", result == 0}, {"exitCode", result == 0 ? (object)code : null},
                {"waitResult", result}, {"heldProcessHandle", true},
                {"pid", pid}, {"creationTicks", creationTicks}
            };
        }
        public void Dispose() { process.Dispose(); }
    }

    static string ReadText(IntPtr window, bool className) {
        var text = new StringBuilder(256);
        if (className) GetClassNameW(window, text, text.Capacity);
        else GetWindowTextW(window, text, text.Capacity);
        return text.ToString();
    }
    static void VerifyProcess(int pid, long creationTicks, string image) {
        using (var process = Process.GetProcessById(pid)) {
            if (process.HasExited || process.StartTime.ToUniversalTime().Ticks != creationTicks ||
                !String.Equals(process.MainModule.FileName, image, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Installation process identity changed");
        }
    }
    public static Dictionary<string, object>[] Observe(int pid, long creationTicks, string image) {
        VerifyProcess(pid, creationTicks, image);
        var result = new List<Dictionary<string, object>>();
        bool overflow = false;
        if (!EnumWindows((window, ignored) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != pid || !IsWindowVisible(window)) return true;
            if (result.Count >= 64) { overflow = true; return false; }
            var className = ReadText(window, true);
            var title = ReadText(window, false);
            bool unowned = GetWindow(window, 4) == IntPtr.Zero;
            result.Add(new Dictionary<string, object> {
                {"hwnd", window.ToInt64()}, {"className", className}, {"title", title},
                {"unowned", unowned}, {"productRoot", unowned && className == "Tauri Window" && title == "milkup"}
            });
            return true;
        }, IntPtr.Zero) || overflow) throw new InvalidOperationException("Native window observation failed or exceeded its budget");
        VerifyProcess(pid, creationTicks, image);
        return result.ToArray();
    }
    public static void Close(long handle, int pid, long creationTicks, string image) {
        var matches = new List<Dictionary<string, object>>();
        foreach (var row in Observe(pid, creationTicks, image))
            if ((bool)row["productRoot"]) matches.Add(row);
        if (matches.Count != 1 || (long)matches[0]["hwnd"] != handle)
            throw new InvalidOperationException("Unique current owned Tauri window required before close");
        if (!PostMessageW(new IntPtr(handle), 0x0010, IntPtr.Zero, IntPtr.Zero))
            throw new InvalidOperationException("Owned native window close request failed");
    }
}
