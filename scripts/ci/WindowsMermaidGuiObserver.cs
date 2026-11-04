// Test-only native GUI observation. No token/ACL/desktop changes, no arbitrary
// command dispatch, and no termination by PID. All control processes are owned
// from creation by a retained Job. Product processes are queried, never killed.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public sealed class WindowsMermaidGuiObserver : IDisposable
{
    const int MaxEvents = 2048, MaxProcesses = 256, MaxWindows = 256;
    const uint CreateEvent = 0x8000, DestroyEvent = 0x8001, ShowEvent = 0x8002, HideEvent = 0x8003;
    readonly object gate = new object();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();
    readonly List<string> errors = new List<string>();
    readonly Dictionary<long, WindowFact> previous = new Dictionary<long, WindowFact>();
    readonly HashSet<string> baselineVisible = new HashSet<string>(StringComparer.Ordinal);
    readonly Dictionary<uint, ProcessFact> processes = new Dictionary<uint, ProcessFact>();
    readonly List<Product> products = new List<Product>();
    readonly HashSet<string> visibleProductConsoles = new HashSet<string>(StringComparer.Ordinal);
    readonly HashSet<string> visibleUnknownConsoles = new HashSet<string>(StringComparer.Ordinal);
    readonly ManualResetEventSlim ready = new ManualResetEventSlim(false);
    Thread pump;
    WinEvent callback;
    IntPtr hook;
    volatile bool stopping;
    bool started, overflow, productPhase, positiveActive, positiveDetected, positiveCaptureAttempted, failureCaptureAttempted, positiveCaptureComplete;
    string phase = "observer-start", positiveTitle, nodePath, fixtureRoot, evidenceDirectory;
    Dictionary<string, object> positive, desktopContext;
    long sequence;
    uint session;

    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public Point point; public uint reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo { public uint cb; public string reserved, desktop, title; public uint x, y, width, height, xChars, yChars, fill, flags; public ushort show, reservedSize; public IntPtr reservedBytes, input, output, error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx { public StartupInfo startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long processTime, jobTime; public uint flags; public UIntPtr minWorking, maxWorking; public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long user, kernel, periodUser, periodKernel; public uint faults, total, active, terminated; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProcessEntry { public uint size, usage, pid; public UIntPtr defaultHeap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string executable; }
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo { public uint size, flags; public IntPtr active, focus, capture, menuOwner, moveSize, caret; public Rect caretRect; }
    [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public KeyboardInput keyboard; [FieldOffset(0)] public MouseInput mouse; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public InputUnion data; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfoHeader { public uint size; public int width, height; public ushort planes, bits; public uint compression, imageSize; public int xPixels, yPixels; public uint used, important; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo { public BitmapInfoHeader header; public uint color; }
    delegate bool EnumWindow(IntPtr hwnd, IntPtr data);
    delegate void WinEvent(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint threadId, uint eventTime);

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEvent callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool PeekMessageW(out Message message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref Message message);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, IntPtr data, uint length, out uint needed);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out uint value, uint bytes);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint operation);
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint count, byte[] data, ref BitmapInfo info, uint usage);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr attributes);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);

    sealed class WindowFact { public IntPtr Handle; public uint Pid; public string Class, Title, Identity; public bool Visible, Baseline; public uint? Cloaked; public Rect Rect; public long Creation; }
    sealed class ProcessFact { public uint Pid, Parent; public long Creation; public string Image; }
    sealed class Product { public IntPtr Handle; public uint Pid; public long Creation; public string Image; }
    static void Check(bool result, string operation) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string Bounded(string text, int limit) { return text == null ? "" : text.Length <= limit ? text : text.Substring(0, limit); }
    static string HandleText(IntPtr value) { return "0x" + value.ToInt64().ToString("x"); }
    static string ClassName(IntPtr hwnd) { var text = new StringBuilder(65); GetClassNameW(hwnd, text, text.Capacity); return text.ToString(); }
    static bool IntersectsDesktop(Rect rect) { int x = GetSystemMetrics(76), y = GetSystemMetrics(77), width = GetSystemMetrics(78), height = GetSystemMetrics(79); return width > 0 && height > 0 && rect.right > x && rect.bottom > y && rect.left < (long)x + width && rect.top < (long)y + height; }
    public static bool IsConsoleClass(string name) { return name == "ConsoleWindowClass" || name == "CASCADIA_HOSTING_WINDOW_CLASS" || name == "PseudoConsoleWindow"; }
    public static bool IsPhaseName(string name) { return name != null && Regex.IsMatch(name, "^[a-z][a-z0-9-]{0,47}$", RegexOptions.CultureInvariant); }
    public static string ValidateFixturePath(string root, string path) {
        if (String.IsNullOrWhiteSpace(root) || String.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(root) || !Path.IsPathFullyQualified(path) || path.IndexOfAny(new char[] { '\0', '\r', '\n', '"' }) >= 0) throw new ArgumentException("Absolute plain fixture path required");
        string fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(path);
        if (!full.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase) || !full.EndsWith(".md", StringComparison.OrdinalIgnoreCase) || full.Length > 2048) throw new ArgumentException("Fixture must be an owned Markdown file");
        return full;
    }
    static string ObjectName(IntPtr handle) {
        uint size; GetUserObjectInformationW(handle, 2, IntPtr.Zero, 0, out size);
        if (size < 2 || size > 16384) throw new InvalidOperationException("Cannot size desktop name");
        IntPtr data = Marshal.AllocHGlobal((int)size);
        try { Check(GetUserObjectInformationW(handle, 2, data, size, out size), "Read desktop name"); return Marshal.PtrToStringUni(data); }
        finally { Marshal.FreeHGlobal(data); }
    }
    static Dictionary<string, object> CurrentDesktop() {
        uint processSession; Check(ProcessIdToSessionId(GetCurrentProcessId(), out processSession), "Read observer session");
        IntPtr own = GetThreadDesktop(GetCurrentThreadId()); Check(own != IntPtr.Zero, "Read observer desktop");
        IntPtr input = OpenInputDesktop(0, false, 1); Check(input != IntPtr.Zero, "Open existing input desktop read-only");
        try {
            string ownName = ObjectName(own), inputName = ObjectName(input);
            if (processSession == 0 || ownName != inputName) throw new InvalidOperationException("Observer is not on the interactive input desktop");
            return new Dictionary<string, object> { { "sessionId", processSession }, { "threadDesktop", ownName }, { "inputDesktop", inputName }, { "sameInputDesktop", true }, { "desktopChanged", false } };
        } finally { CloseDesktop(input); }
    }
    static ProcessFact ProcessIdentity(uint pid, uint parent) {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return null;
        try {
            long creation, exit, kernel, user;
            if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) return null;
            uint count = 32768; var image = new StringBuilder((int)count);
            if (!QueryFullProcessImageNameW(process, 0, image, ref count)) return null;
            return new ProcessFact { Pid = pid, Parent = parent, Creation = creation, Image = Bounded(image.ToString(), 512) };
        } finally { CloseHandle(process); }
    }
    void ScanProcesses() {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) { AddError("Process snapshot unavailable"); return; }
        try {
            var item = new ProcessEntry { size = (uint)Marshal.SizeOf<ProcessEntry>() };
            bool more = Process32FirstW(snapshot, ref item);
            while (more) {
                uint candidateSession;
                if (ProcessIdToSessionId(item.pid, out candidateSession) && candidateSession == session) {
                    // Refresh creation times even when the PID and parent PID
                    // match: Windows may reuse both between observations.
                    ProcessFact fact = ProcessIdentity(item.pid, item.parent);
                    if (fact != null) lock (gate) {
                        if (processes.Count < MaxProcesses || processes.ContainsKey(item.pid)) processes[item.pid] = fact;
                        else overflow = true;
                    }
                }
                more = Process32NextW(snapshot, ref item);
            }
        } finally { CloseHandle(snapshot); }
    }
    void AddError(string error) { lock (gate) { if (errors.Count < 16) errors.Add(Bounded(error, 320)); else overflow = true; } }
    string Attribution(uint pid, long creation) {
        uint current = pid; long childTime = creation;
        var visited = new HashSet<uint>();
        for (int depth = 0; depth < 32 && visited.Add(current); depth++) {
            ProcessFact fact;
            if (!processes.TryGetValue(current, out fact) || fact.Creation <= 0 || fact.Creation > childTime || (current == pid && fact.Creation != creation)) break;
            foreach (Product product in products) if (product.Pid == current && product.Creation == fact.Creation && WaitForSingleObject(product.Handle, 0) == 258) return current == pid ? "product" : "product-descendant";
            if (fact.Parent == 0) break;
            childTime = fact.Creation; current = fact.Parent;
        }
        return "unattributed";
    }
    WindowFact ReadWindow(IntPtr hwnd) {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        string klass = ClassName(hwnd);
        if (pid == 0 || klass.Length == 0) return null;
        var title = new StringBuilder(97); GetWindowTextW(hwnd, title, title.Capacity);
        Rect rect; GetWindowRect(hwnd, out rect);
        uint cloaked; int hr = DwmGetWindowAttribute(hwnd, 14, out cloaked, 4);
        // A window handle and PID can both be reused. Never borrow a cached
        // creation time to establish the identity of a currently live window.
        ProcessFact process = ProcessIdentity(pid, 0);
        long creation = process == null ? 0 : process.Creation;
        string identity = HandleText(hwnd) + ":" + pid + ":" + creation;
        return new WindowFact { Handle = hwnd, Pid = pid, Class = klass, Title = title.ToString(), Visible = IsWindowVisible(hwnd), Cloaked = hr >= 0 ? (uint?)cloaked : null, Rect = rect, Creation = creation, Identity = identity, Baseline = baselineVisible.Contains(identity) };
    }
    void Observe(IntPtr hwnd, string kind, bool showEvent, bool baseline) {
        if (hwnd == IntPtr.Zero) return;
        bool live = IsWindow(hwnd);
        if (live && GetAncestor(hwnd, 2) != hwnd) return;
        WindowFact fact = ReadWindow(hwnd), old = null;
        lock (gate) {
            previous.TryGetValue(hwnd.ToInt64(), out old);
            if (fact == null) fact = old;
            if (fact == null) {
                if (showEvent && productPhase) AddError("A top-level show event lost its window identity before observation: " + HandleText(hwnd));
                return;
            }
            if (baseline && fact.Visible && fact.Cloaked == 0) { baselineVisible.Add(fact.Identity); fact.Baseline = true; }
            bool console = IsConsoleClass(fact.Class);
            string attribution = Attribution(fact.Pid, fact.Creation);
            bool product = attribution != "unattributed";
            bool changed = old == null || old.Identity != fact.Identity || old.Visible != fact.Visible || old.Title != fact.Title;
            if (previous.Count < MaxWindows || previous.ContainsKey(hwnd.ToInt64())) previous[hwnd.ToInt64()] = fact; else overflow = true;
            if (!console && !product) return;
            bool currentVisible = live && fact.Visible && fact.Cloaked == 0 && fact.Rect.right > fact.Rect.left && fact.Rect.bottom > fact.Rect.top && IntersectsDesktop(fact.Rect);
            bool observedShow = console && showEvent && !fact.Baseline;
            if (console && positiveActive && fact.Title == positiveTitle && currentVisible) positiveDetected = true;
            if (console && productPhase && !positiveActive && !fact.Baseline && (currentVisible || observedShow)) {
                if (product) visibleProductConsoles.Add(fact.Identity); else visibleUnknownConsoles.Add(fact.Identity);
            }
            if (kind == "poll" && !changed) return;
            if (events.Count >= MaxEvents) { overflow = true; return; }
            events.Add(new Dictionary<string, object> {
                { "sequence", ++sequence }, { "elapsedMs", clock.ElapsedMilliseconds }, { "phase", phase }, { "kind", kind }, { "hwnd", HandleText(hwnd) },
                { "pid", fact.Pid }, { "processCreationFileTime", fact.Creation > 0 ? fact.Creation.ToString() : null }, { "className", fact.Class }, { "title", fact.Title },
                { "visibleNow", live && fact.Visible }, { "cloaked", fact.Cloaked }, { "showEvent", showEvent }, { "consoleCandidate", console }, { "positiveControlInterval", positiveActive }, { "productObservationInterval", productPhase }, { "observedVisible", currentVisible || observedShow },
                { "baselineVisible", fact.Baseline }, { "attribution", attribution }, { "rect", new int[] { fact.Rect.left, fact.Rect.top, fact.Rect.right, fact.Rect.bottom } }
            });
        }
    }
    void Enumerate(bool baseline) { Check(EnumWindows((hwnd, data) => { Observe(hwnd, baseline ? "baseline" : "poll", false, baseline); return true; }, IntPtr.Zero), "Enumerate desktop windows"); }
    void Pump() {
        try {
            desktopContext = CurrentDesktop(); session = (uint)desktopContext["sessionId"];
            callback = (h, kind, hwnd, objectId, childId, thread, time) => {
                if (objectId != 0 || childId != 0) return;
                try { Observe(hwnd, kind == CreateEvent ? "create" : kind == DestroyEvent ? "destroy" : kind == ShowEvent ? "show" : "hide", kind == ShowEvent, false); }
                catch (Exception error) { AddError(error.Message); }
            };
            hook = SetWinEventHook(CreateEvent, HideEvent, IntPtr.Zero, callback, 0, 0, 0);
            Check(hook != IntPtr.Zero, "Install out-of-context window event hook");
            ScanProcesses(); Enumerate(true); ready.Set();
            long processScan = 0;
            while (!stopping) {
                Message message;
                int drained = 0;
                while (drained++ < 512 && PeekMessageW(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessageW(ref message); }
                if (clock.ElapsedMilliseconds >= processScan) { ScanProcesses(); processScan = clock.ElapsedMilliseconds + 100; }
                Enumerate(false);
                if (positiveDetected && positiveActive && !positiveCaptureAttempted) {
                    positiveCaptureAttempted = true; try { CaptureDesktop("gui-console-positive.png"); lock (gate) positiveCaptureComplete = true; } catch (Exception error) { AddError("Positive screenshot: " + error.Message); }
                }
                if (productPhase && !failureCaptureAttempted && (visibleProductConsoles.Count + visibleUnknownConsoles.Count > 0)) {
                    failureCaptureAttempted = true; try { CaptureDesktop("gui-native-failure.png"); } catch (Exception error) { AddError("Failure screenshot: " + error.Message); }
                }
                Thread.Sleep(25);
            }
            Message finalMessage;
            int finalCount = 0;
            while (finalCount++ < 2048 && PeekMessageW(out finalMessage, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref finalMessage); DispatchMessageW(ref finalMessage); }
            if (finalCount > 2048) AddError("Final native event drain exceeded its budget");
            Enumerate(false);
        } catch (Exception error) { AddError(error.Message); ready.Set(); }
        finally { if (hook != IntPtr.Zero) { if (!UnhookWinEvent(hook)) AddError("UnhookWinEvent failed"); hook = IntPtr.Zero; } }
    }
    public Dictionary<string, object> Start(string node, string fixtures, string evidence) {
        if (started) throw new InvalidOperationException("Observer may start only once");
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Native GUI observation requires Windows");
        foreach (string path in new string[] { node, fixtures, evidence }) if (String.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path) || path.IndexOfAny(new char[] { '\0', '\r', '\n', '"' }) >= 0) throw new ArgumentException("Plain absolute observer paths required");
        if (!File.Exists(node) || !Path.GetFileName(node).Equals("node.exe", StringComparison.OrdinalIgnoreCase) || !Directory.Exists(fixtures) || !Directory.Exists(evidence)) throw new ArgumentException("Existing Node and owned roots required");
        nodePath = Path.GetFullPath(node); fixtureRoot = Path.GetFullPath(fixtures); evidenceDirectory = Path.GetFullPath(evidence);
        started = true; pump = new Thread(Pump) { IsBackground = true, Name = "Milkup GUI WinEvent observer" }; pump.SetApartmentState(ApartmentState.STA); pump.Start();
        if (!ready.Wait(10000) || errors.Count != 0 || hook == IntPtr.Zero) throw new InvalidOperationException("Native desktop observer could not start: " + String.Join("; ", errors));
        return new Dictionary<string, object> { { "ready", true }, { "context", desktopContext }, { "hookInstalled", true }, { "pollMilliseconds", 25 }, { "observerPid", GetCurrentProcessId() } };
    }
    // An observation error invalidates acceptance, but must not erase the rest
    // of the user-visible failure chain. Fixed input commands may continue
    // while the hook is alive; their own identity/desktop checks still apply.
    void RequireStarted() { if (!started || stopping || hook == IntPtr.Zero) throw new InvalidOperationException("Observer is unavailable"); }
    public Dictionary<string, object> Phase(string name) { RequireStarted(); if (!IsPhaseName(name)) throw new ArgumentException("Closed short phase identifier required"); lock (gate) phase = name; return new Dictionary<string, object> { { "phase", name }, { "elapsedMs", clock.ElapsedMilliseconds } }; }
    static uint Active(IntPtr job) { Accounting value; Check(QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero), "Read owned control Job"); return value.active; }
    public Dictionary<string, object> PositiveControl() {
        RequireStarted(); if (positive != null || products.Count != 0) throw new InvalidOperationException("One positive control before product launch is required");
        positive = new Dictionary<string, object> { { "detectedVisible", false }, { "heldProcessSignaled", false }, { "naturalExit", false }, { "exitCode", null }, { "jobActiveAfterStop", null }, { "cleanupComplete", false }, { "sameInputDesktop", true }, { "screenshot", "gui-console-positive.png" } };
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobValue = IntPtr.Zero; ProcessInfo info = new ProcessInfo(); bool initialized = false, resumed = false, clean = false;
        lock (gate) { positiveActive = true; phase = "positive-control"; positiveTitle = "MilkupGuiControl-" + Guid.NewGuid().ToString("N"); }
        try {
            CurrentDesktop(); job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero); Check(job != IntPtr.Zero, "Create owned console control Job");
            var limits = new ExtendedLimits(); limits.basic.flags = 0x2000 | 8; limits.basic.activeLimit = 4;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()), "Set owned control Job limits");
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); if (size.ToInt64() <= 0 || size.ToInt64() > 65536) throw new InvalidOperationException("Invalid process attribute budget");
            attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "Initialize control attributes"); initialized = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Bind control Job at creation");
            var startup = new StartupInfoEx(); startup.startup.cb = (uint)Marshal.SizeOf<StartupInfoEx>(); startup.startup.title = positiveTitle; startup.startup.flags = 1; startup.startup.show = 5; startup.attributes = attributes;
            string code = "process.title='" + positiveTitle + "';setTimeout(()=>process.exit(0),1800)";
            var command = new StringBuilder("\"" + nodePath + "\" -e \"" + code + "\"");
            Check(CreateProcessW(nodePath, command, IntPtr.Zero, IntPtr.Zero, false, 0x10 | 4 | 0x80000, IntPtr.Zero, fixtureRoot, ref startup, out info), "Create visible owned console control");
            positive["pid"] = info.pid; positive["title"] = positiveTitle;
            Check(ResumeThread(info.thread) != UInt32.MaxValue, "Resume fixed control"); resumed = true;
            long deadline = clock.ElapsedMilliseconds + 10000;
            while (WaitForSingleObject(info.process, 20) == 258 && clock.ElapsedMilliseconds < deadline) { }
            bool signaled = WaitForSingleObject(info.process, 0) == 0; positive["heldProcessSignaled"] = signaled;
            if (signaled) { uint codeResult; Check(GetExitCodeProcess(info.process, out codeResult), "Read control exit"); positive["exitCode"] = codeResult; positive["naturalExit"] = codeResult == 0; }
            long cleanup = clock.ElapsedMilliseconds + 3000;
            while (Active(job) != 0 && clock.ElapsedMilliseconds < cleanup) Thread.Sleep(20);
            uint active = Active(job); positive["jobActiveAfterStop"] = active;
            lock (gate) positive["detectedVisible"] = positiveDetected;
            lock (gate) positive["screenshotCaptured"] = positiveCaptureComplete;
            clean = signaled && active == 0; positive["cleanupComplete"] = clean;
            if (!clean || !(bool)positive["naturalExit"] || !positiveDetected || !(bool)positive["screenshotCaptured"]) throw new InvalidOperationException("Visible-console positive control was not fully observed and cleaned");
            lock (gate) if (errors.Count != 0 || overflow) throw new InvalidOperationException("Positive-control observation is incomplete");
            CurrentDesktop(); positive["passed"] = true;
            return new Dictionary<string, object>(positive);
        } catch (Exception error) { positive["passed"] = false; positive["error"] = Bounded(error.Message, 320); throw; }
        finally {
            if (!clean && job != IntPtr.Zero) {
                positive["forcedOwnedJobCleanup"] = TerminateJobObject(job, 23);
                if (info.process != IntPtr.Zero) positive["heldProcessSignaledAfterCleanup"] = WaitForSingleObject(info.process, 2000) == 0;
                try {
                    long until = clock.ElapsedMilliseconds + 2000;
                    while (Active(job) != 0 && clock.ElapsedMilliseconds < until) Thread.Sleep(20);
                    uint remaining = Active(job); positive["jobActiveAfterCleanup"] = remaining; positive["cleanupComplete"] = remaining == 0;
                } catch (Exception error) { positive["cleanupComplete"] = false; AddError("Owned positive control cleanup: " + error.Message); }
            }
            if (info.thread != IntPtr.Zero) CloseHandle(info.thread); if (info.process != IntPtr.Zero) CloseHandle(info.process);
            if (initialized) DeleteProcThreadAttributeList(attributes); if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue); if (job != IntPtr.Zero) CloseHandle(job);
            lock (gate) { positiveActive = false; productPhase = clean && positiveDetected && positive.ContainsKey("passed") && (bool)positive["passed"]; phase = productPhase ? "product-awaiting-identity" : "positive-control-failed"; }
            GC.KeepAlive(resumed);
        }
    }
    public Dictionary<string, object> SetProduct(uint pid, string image, string creationFileTime) {
        RequireStarted(); if (!productPhase || products.Count >= 8) throw new InvalidOperationException("Positive control and bounded product count required");
        long expected; if (pid == 0 || !Int64.TryParse(creationFileTime, out expected) || expected <= 0 || !Path.IsPathFullyQualified(image)) throw new ArgumentException("Exact product identity required");
        IntPtr process = OpenProcess(0x1000 | 0x100000, false, pid); Check(process != IntPtr.Zero, "Hold exact product for read-only observation");
        try {
            long creation, exit, kernel, user; Check(GetProcessTimes(process, out creation, out exit, out kernel, out user), "Read product creation time");
            uint length = 32768; var path = new StringBuilder((int)length); Check(QueryFullProcessImageNameW(process, 0, path, ref length), "Read product image");
            uint productSession; Check(ProcessIdToSessionId(pid, out productSession), "Read product session");
            if (creation != expected || !String.Equals(path.ToString(), Path.GetFullPath(image), StringComparison.OrdinalIgnoreCase) || productSession != session || WaitForSingleObject(process, 0) != 258) throw new InvalidOperationException("Held product identity/session mismatch");
            lock (gate) products.Add(new Product { Handle = process, Pid = pid, Creation = creation, Image = path.ToString() }); process = IntPtr.Zero;
            return new Dictionary<string, object> { { "pid", pid }, { "creationFileTime", creation.ToString() }, { "image", path.ToString() }, { "identityVerified", true }, { "heldQueryAndSynchronizeOnly", true } };
        } finally { if (process != IntPtr.Zero) CloseHandle(process); }
    }
    public Dictionary<string, object> ChooseFile(string path) {
        RequireStarted(); string file = ValidateFixturePath(fixtureRoot, path);
        if (!File.Exists(file) || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Existing plain owned Markdown fixture required");
        for (DirectoryInfo directory = new FileInfo(file).Directory; directory != null; directory = directory.Parent) if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Reparse fixture ancestor rejected");
        CurrentDesktop(); Product product; lock (gate) { if (products.Count == 0) throw new InvalidOperationException("No tracked product"); product = products[products.Count - 1]; }
        if (WaitForSingleObject(product.Handle, 0) != 258) throw new InvalidOperationException("Tracked product already exited");
        IntPtr dialog = IntPtr.Zero; uint dialogThread = 0; long deadline = clock.ElapsedMilliseconds + 10000;
        while (dialog == IntPtr.Zero && clock.ElapsedMilliseconds < deadline) {
            var matches = new List<IntPtr>();
            Check(EnumWindows((hwnd, ignored) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == product.Pid && IsWindowVisible(hwnd) && ClassName(hwnd) == "#32770") matches.Add(hwnd); return true; }, IntPtr.Zero), "Find owned native file dialog");
            if (matches.Count > 1) throw new InvalidOperationException("Ambiguous owned modal dialogs");
            if (matches.Count == 1) { dialog = matches[0]; uint pid; dialogThread = GetWindowThreadProcessId(dialog, out pid); }
            else Thread.Sleep(25);
        }
        if (dialog == IntPtr.Zero) throw new InvalidOperationException("Owned native file picker did not appear");
        var edits = new List<IntPtr>();
        Check(EnumChildWindows(dialog, (hwnd, ignored) => {
            if (ClassName(hwnd) != "Edit") return true;
            IntPtr ancestor = hwnd;
            for (int depth = 0; depth < 6 && ancestor != IntPtr.Zero && ancestor != dialog; depth++, ancestor = GetParent(ancestor)) if (GetDlgCtrlID(ancestor) == 1148) { edits.Add(hwnd); break; }
            return true;
        }, IntPtr.Zero), "Find native filename control");
        if (edits.Count != 1 || GetDlgItem(dialog, 1) == IntPtr.Zero) throw new InvalidOperationException("Exact native filename Edit/Open controls are unavailable");
        SetForegroundWindow(dialog);
        UIntPtr returned; Check(SendMessageTimeoutW(dialog, 0x28, edits[0], new IntPtr(1), 2, 2000, out returned) != IntPtr.Zero, "Focus native filename control");
        var gui = new GuiThreadInfo { size = (uint)Marshal.SizeOf<GuiThreadInfo>() }; Check(GetGUIThreadInfo(dialogThread, ref gui), "Verify native filename focus");
        if (gui.focus != edits[0] || GetAncestor(GetForegroundWindow(), 2) != dialog) throw new InvalidOperationException("Native filename field is not the foreground input target");
        var inputs = new List<Input>();
        inputs.Add(Key(0x11, 0, 0)); inputs.Add(Key(0x41, 0, 0)); inputs.Add(Key(0x41, 0, 2)); inputs.Add(Key(0x11, 0, 2));
        foreach (char value in file) { inputs.Add(Key(0, value, 4)); inputs.Add(Key(0, value, 6)); }
        inputs.Add(Key(0x0d, 0, 0)); inputs.Add(Key(0x0d, 0, 2));
        Input[] array = inputs.ToArray(); Check(SendInput((uint)array.Length, array, Marshal.SizeOf<Input>()) == array.Length, "Send native fixture filename keystrokes");
        long until = clock.ElapsedMilliseconds + 10000;
        while (IsWindow(dialog) && IsWindowVisible(dialog) && clock.ElapsedMilliseconds < until) Thread.Sleep(25);
        if (IsWindow(dialog) && IsWindowVisible(dialog)) throw new InvalidOperationException("Native file picker did not accept the selected fixture");
        return new Dictionary<string, object> { { "accepted", true }, { "path", file }, { "productPid", product.Pid }, { "dialogHwnd", HandleText(dialog) }, { "filenameControlId", 1148 }, { "usedNativeSendInput", true }, { "dialogClosed", true }, { "privateInvokeUsed", false } };
    }
    static Input Key(ushort key, ushort scan, uint flags) { return new Input { type = 1, data = new InputUnion { keyboard = new KeyboardInput { key = key, scan = scan, flags = flags } } }; }
    static byte[] U32(uint value) { return new byte[] { (byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value }; }
    static void Chunk(Stream output, string name, byte[] bytes) {
        byte[] type = Encoding.ASCII.GetBytes(name); output.Write(U32((uint)bytes.Length)); output.Write(type); output.Write(bytes);
        uint crc = 0xffffffff; foreach (byte value in type) { crc ^= value; for (int i = 0; i < 8; i++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xedb88320 : crc >> 1; }
        foreach (byte value in bytes) { crc ^= value; for (int i = 0; i < 8; i++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xedb88320 : crc >> 1; } output.Write(U32(crc ^ 0xffffffff));
    }
    void CaptureDesktop(string name) {
        if (name != "gui-console-positive.png" && name != "gui-native-failure.png") throw new ArgumentException("Fixed screenshot name required");
        string target = Path.Combine(evidenceDirectory, name); if (File.Exists(target)) throw new InvalidOperationException("Native screenshot cannot be overwritten");
        int width = GetSystemMetrics(0), height = GetSystemMetrics(1);
        if (width < 1 || height < 1 || width > 8192 || height > 8192 || (long)width * height > 16777216) throw new InvalidOperationException("Desktop screenshot dimensions exceed budget");
        IntPtr screen = GetDC(IntPtr.Zero), memory = IntPtr.Zero, bitmap = IntPtr.Zero, previousObject = IntPtr.Zero;
        try {
            Check(screen != IntPtr.Zero, "Get desktop DC"); memory = CreateCompatibleDC(screen); Check(memory != IntPtr.Zero, "Create capture DC"); bitmap = CreateCompatibleBitmap(screen, width, height); Check(bitmap != IntPtr.Zero, "Create capture bitmap");
            previousObject = SelectObject(memory, bitmap); Check(previousObject != IntPtr.Zero && previousObject != new IntPtr(-1), "Select capture bitmap");
            Check(BitBlt(memory, 0, 0, width, height, screen, 0, 0, 0x00cc0020 | 0x40000000), "Capture actual desktop");
            SelectObject(memory, previousObject); previousObject = IntPtr.Zero;
            var pixels = new byte[checked(width * height * 4)]; var info = new BitmapInfo(); info.header.size = (uint)Marshal.SizeOf<BitmapInfoHeader>(); info.header.width = width; info.header.height = -height; info.header.planes = 1; info.header.bits = 32;
            Check(GetDIBits(memory, bitmap, 0, (uint)height, pixels, ref info, 0) == height, "Read desktop pixels");
            using (var compressed = new MemoryStream()) {
                using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, true)) {
                    var row = new byte[1 + width * 4];
                    for (int y = 0; y < height; y++) { for (int x = 0; x < width; x++) { int source = (y * width + x) * 4, targetIndex = 1 + x * 4; row[targetIndex] = pixels[source + 2]; row[targetIndex + 1] = pixels[source + 1]; row[targetIndex + 2] = pixels[source]; row[targetIndex + 3] = 255; } zlib.Write(row); }
                }
                if (compressed.Length > 32 * 1024 * 1024 - 128) throw new InvalidOperationException("Desktop PNG exceeds budget");
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { output.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }); var header = new byte[13]; Buffer.BlockCopy(U32((uint)width), 0, header, 0, 4); Buffer.BlockCopy(U32((uint)height), 0, header, 4, 4); header[8] = 8; header[9] = 6; Chunk(output, "IHDR", header); Chunk(output, "IDAT", compressed.ToArray()); Chunk(output, "IEND", Array.Empty<byte>()); }
            }
        } finally { if (previousObject != IntPtr.Zero) SelectObject(memory, previousObject); if (bitmap != IntPtr.Zero) DeleteObject(bitmap); if (memory != IntPtr.Zero) DeleteDC(memory); if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen); }
    }
    public Dictionary<string, object> Stop() {
        if (!started) throw new InvalidOperationException("Observer was not started");
        stopping = true; bool joined = pump.Join(5000); if (!joined) AddError("Native hook thread did not terminate");
        lock (gate) {
            var tracked = new List<Dictionary<string, object>>(); foreach (Product product in products) tracked.Add(new Dictionary<string, object> { { "pid", product.Pid }, { "image", product.Image }, { "creationFileTime", product.Creation.ToString() }, { "heldProcessSignaledAtStop", WaitForSingleObject(product.Handle, 0) == 0 } });
            var processRows = new List<Dictionary<string, object>>(); foreach (ProcessFact process in processes.Values) processRows.Add(new Dictionary<string, object> { { "pid", process.Pid }, { "parentPid", process.Parent }, { "creationFileTime", process.Creation.ToString() }, { "image", process.Image } });
            return new Dictionary<string, object> { { "schema", 1 }, { "complete", joined && errors.Count == 0 && !overflow }, { "positiveControlPassed", positive != null && positive.ContainsKey("passed") && (bool)positive["passed"] }, { "context", desktopContext }, { "positiveControl", positive }, { "events", events.ToArray() }, { "processes", processRows.ToArray() }, { "trackedProducts", tracked.ToArray() }, { "productVisibleConsoleCount", visibleProductConsoles.Count }, { "unattributedVisibleConsoleCount", visibleUnknownConsoles.Count }, { "overflow", overflow }, { "observerErrors", errors.ToArray() }, { "elapsedMs", clock.ElapsedMilliseconds }, { "pollMilliseconds", 25 }, { "windowEventHookUsed", true }, { "desktopOrAclChanged", false }, { "productTerminatedByObserver", false } };
        }
    }
    public void Dispose() { if (started && !stopping) { try { Stop(); } catch { } } foreach (Product product in products) if (product.Handle != IntPtr.Zero) { CloseHandle(product.Handle); product.Handle = IntPtr.Zero; } ready.Dispose(); }
}
