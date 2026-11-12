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
