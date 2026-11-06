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
    // Immutable historical identities retain no process handles.
    const int MaxProcessHistory = 4 * MaxProcesses;
    const int MaxLifetimeHistory = 4 * MaxEvents; // Independent bounded immutable history; not queue slots.
    const uint CreateEvent = 0x8000, DestroyEvent = 0x8001, ShowEvent = 0x8002, HideEvent = 0x8003;
    readonly object gate = new object();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly List<Dictionary<string, object>> nativeDiagnostics = new List<Dictionary<string, object>>();
    bool nativeDiagnosticsTruncated;
    readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();
    readonly List<string> errors = new List<string>();
    readonly Dictionary<long, WindowFact> previous = new Dictionary<long, WindowFact>();
    readonly HashSet<string> baselineVisible = new HashSet<string>(StringComparer.Ordinal);
    readonly Dictionary<uint, ProcessFact> processes = new Dictionary<uint, ProcessFact>();
    readonly Dictionary<string, ProcessFact> processEvidence = new Dictionary<string, ProcessFact>(StringComparer.Ordinal);
    readonly List<Dictionary<string, object>> unresolvedEvents = new List<Dictionary<string, object>>();
    readonly List<Dictionary<string, object>> resolvedChildEvents = new List<Dictionary<string, object>>();
    readonly HashSet<string> overflowReasons = new HashSet<string>(StringComparer.Ordinal);
    readonly List<Dictionary<string, object>> productMeasurements = new List<Dictionary<string, object>>();
    readonly List<Dictionary<string, object>> productWindowOperations = new List<Dictionary<string, object>>();
    readonly List<Dictionary<string, object>> productWindowReadiness = new List<Dictionary<string, object>>();
    readonly List<Dictionary<string, object>> filePickerOperations = new List<Dictionary<string, object>>();
    readonly List<Product> products = new List<Product>();
    readonly HashSet<string> visibleProductConsoles = new HashSet<string>(StringComparer.Ordinal);
    readonly HashSet<string> visibleUnknownConsoles = new HashSet<string>(StringComparer.Ordinal);
    readonly ManualResetEventSlim ready = new ManualResetEventSlim(false);
    Thread pump, processSampler;
    WinEvent callback;
    IntPtr hook;
    volatile bool stopping;
    bool started, overflow, productPhase, positiveActive, positiveDetected, positiveCaptureAttempted, failureCaptureAttempted, positiveCaptureComplete;
    string phase = "observer-start", positiveTitle, nodePath, fixtureRoot, evidenceDirectory;
    Dictionary<string, object> positive, desktopContext;
    long sequence;
    uint session;
    uint positiveStartedTick, positiveEndedTick;
    bool positiveEnded;
    long knownChildShowEvents;
    long knownWindowShowEvents;
    long retiredChildHints;
    readonly List<WindowLife> windowLives = new List<WindowLife>();
    readonly List<Dictionary<string, object>> childShowEvidence = new List<Dictionary<string, object>>();
    long nextLifeId, nextShowId, observationStoppedAtTick, observationSequence;
    int workingGenerationPeak;
    readonly Queue<NativeNotice> nativeNotices = new Queue<NativeNotice>();
    readonly List<Dictionary<string, object>> directChildShows = new List<Dictionary<string, object>>();
    int processingNativeNotice;

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
    // WinSDK WinUser.h includes rcDevice only under _MAC, not Windows.
    [StructLayout(LayoutKind.Sequential)] struct WindowPlacement { public uint length, flags, show; public Point min, max; public Rect normal; }
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
    [DllImport("user32.dll", SetLastError = true)] static extern uint MsgWaitForMultipleObjectsEx(uint count, IntPtr handles, uint milliseconds, uint wakeMask, uint flags);
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
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowPlacement(IntPtr hwnd, ref WindowPlacement placement);
    [DllImport("user32.dll", SetLastError = true)] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
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
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetThreadTimes(IntPtr thread, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
    [DllImport("kernel32.dll")] static extern uint GetProcessIdOfThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint GetThreadId(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint GetProcessId(IntPtr process);
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

    sealed class WindowFact { public IntPtr Handle, ObservedRoot; public uint Pid, ThreadId; public string Class, Title, Identity, Attribution; public bool Visible, Baseline, KnownChild, CurrentVisible; public uint? Cloaked; public Rect Rect; public long Creation; public ProcessFact Process; }
    sealed class ProcessFact { public uint Pid, Parent; public long Creation; public string Image; }
    sealed class Product { public IntPtr Handle; public uint Pid; public long Creation; public string Image; }
    sealed class NativeIdentity : IDisposable {
        public IntPtr Thread, Process; public uint Tid; public long ThreadBirth; public ProcessFact Fact;
        public void Dispose() { if (Thread != IntPtr.Zero) { CloseHandle(Thread); Thread = IntPtr.Zero; } if (Process != IntPtr.Zero) { CloseHandle(Process); Process = IntPtr.Zero; } }
    }
    sealed class WindowLife {
        public long Id, Generation; public IntPtr Hwnd; public NativeIdentity Identity;
        public Dictionary<string, object> Create, Confirmation, Retirement, PendingConfirmation, DirectDestroy; public long? Released;
        public Dictionary<string, object> Record() { return new Dictionary<string, object> { { "id", Id }, { "hwnd", HandleText(Hwnd) }, { "generation", Generation }, { "create", Create }, { "confirmation", Confirmation }, { "pendingConfirmation", PendingConfirmation }, { "retirement", Retirement }, { "directDestroy", DirectDestroy }, { "proofReleasedAtTick", Released } }; }
    }
    sealed class NativeNotice { public IntPtr Hwnd; public uint Kind, Time, Tid; public long Order, Tick; public Dictionary<string, object> CallbackWindow; }
    static void Check(bool result, string operation) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string Bounded(string text, int limit) { return text == null ? "" : text.Length <= limit ? text : text.Substring(0, limit); }
    static string HandleText(IntPtr value) { return "0x" + value.ToInt64().ToString("x"); }
    static string ClassName(IntPtr hwnd) { var text = new StringBuilder(65); GetClassNameW(hwnd, text, text.Capacity); return text.ToString(); }
    static Rect DesktopRect() { int x = GetSystemMetrics(76), y = GetSystemMetrics(77); return new Rect { left = x, top = y, right = x + GetSystemMetrics(78), bottom = y + GetSystemMetrics(79) }; }
    static bool IntersectsDesktop(Rect rect, Rect desktop) { return desktop.right > desktop.left && desktop.bottom > desktop.top && rect.right > desktop.left && rect.bottom > desktop.top && rect.left < desktop.right && rect.top < desktop.bottom; }
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
        long snapshotStarted = DateTime.UtcNow.ToFileTimeUtc();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) { AddError("Process snapshot unavailable"); return; }
        try {
            var active = new Dictionary<uint, ProcessFact>();
            var item = new ProcessEntry { size = (uint)Marshal.SizeOf<ProcessEntry>() };
            bool more = Process32FirstW(snapshot, ref item);
            while (more) {
                uint candidateSession;
                if (ProcessIdToSessionId(item.pid, out candidateSession) && candidateSession == session) {
                    // Refresh creation times even when the PID and parent PID
                    // match: Windows may reuse both between observations.
                    ProcessFact fact = ProcessIdentity(item.pid, item.parent);
                    if (fact != null && ExistedBeforeSnapshot(fact.Creation, snapshotStarted)) { if (active.Count < MaxProcesses) active[item.pid] = fact; else MarkOverflow("active-process-cache-budget"); }
                }
                more = Process32NextW(snapshot, ref item);
            }
            // This is a live cache, not a historical PID bucket. Immutable
            // console/process identity evidence is retained separately below.
            lock (gate) { processes.Clear(); foreach (var pair in active) processes.Add(pair.Key, pair.Value); }
        } finally { CloseHandle(snapshot); }
    }
    void SampleProcesses() { try { while (!stopping) { ScanProcesses(); Thread.Sleep(100); } } catch (Exception error) { AddError("Process sampler: " + error.Message); } }
    void MarkOverflow(string reason) { lock (gate) { overflow = true; overflowReasons.Add(reason); } }
    void AddError(string error) { lock (gate) { string value = Bounded(error, 320); if (errors.Contains(value)) return; if (errors.Count < 16) errors.Add(value); else MarkOverflow("observer-error-budget"); } }
    void RememberProcess(ProcessFact fact) {
        if (fact == null || fact.Creation <= 0) return;
        string key = fact.Pid + ":" + fact.Creation;
        ProcessFact existing;
        if (processEvidence.TryGetValue(key, out existing)) {
            if (existing.Image != fact.Image || (existing.Parent != 0 && fact.Parent != 0 && existing.Parent != fact.Parent)) AddError("Conflicting exact process identity evidence");
            else if (existing.Parent == 0 && fact.Parent != 0) processEvidence[key] = new ProcessFact { Pid = fact.Pid, Parent = fact.Parent, Creation = fact.Creation, Image = fact.Image };
            return;
        }
        if (processEvidence.Count >= MaxProcessHistory) { MarkOverflow("historical-process-evidence-budget"); return; }
        processEvidence.Add(key, new ProcessFact { Pid = fact.Pid, Parent = fact.Parent, Creation = fact.Creation, Image = fact.Image });
    }
    static long NativeTick() { ulong value = GetTickCount64(); if (value > 9007199254740991UL) throw new InvalidOperationException("Native uptime exceeds exact JSON integer range"); return (long)value; }
    static long? ExpandEventTick(uint value, long callbackTick) {
        if (callbackTick < 0) return null;
        uint delay = unchecked((uint)callbackTick - value);
        return delay <= 2000 && delay < 0x80000000U && delay <= callbackTick ? (long?)(callbackTick - delay) : null;
    }
    static long Number(Dictionary<string, object> value, string name) { return Convert.ToInt64(value[name]); }
    static long? OptionalTick(Dictionary<string, object> value, string name) { return value[name] == null ? (long?)null : Number(value, name); }
    static Dictionary<string, object> NativeEventRecord(long order, uint time, long tick, uint tid) {
        return new Dictionary<string, object> { { "sequence", order }, { "nativeEventUptimeMs32", time }, { "nativeTick", ExpandEventTick(time, tick) }, { "callbackTick", tick }, { "eventThreadId", tid } };
    }
    // Processing-time snapshots are diagnostic only, never event-time identity proof.
    static Dictionary<string, object> WindowDiagnostic(IntPtr hwnd) {
        long begin = NativeTick(); uint pid; uint tid = GetWindowThreadProcessId(hwnd, out pid);
        bool live = IsWindow(hwnd); IntPtr parent = GetParent(hwnd), root = GetAncestor(hwnd, 2); string klass = Bounded(ClassName(hwnd), 256);
        return new Dictionary<string, object> { { "beginTick", begin }, { "endTick", NativeTick() }, { "hwnd", HandleText(hwnd) }, { "isWindow", live }, { "parentHwnd", HandleText(parent) }, { "rootHwnd", HandleText(root) }, { "pid", pid }, { "threadId", tid }, { "className", klass } };
    }
    static Dictionary<string, object> IdentityWait(IntPtr handle, bool thread, out long birth) {
        birth = 0; uint wait = WaitForSingleObject(handle, 0); long exit, kernel, user;
        if (wait != 0 && wait != 258) return null;
        bool read = thread ? GetThreadTimes(handle, out birth, out exit, out kernel, out user) : GetProcessTimes(handle, out birth, out exit, out kernel, out user);
        if (!read || birth <= 0 || (wait == 0 && exit < birth)) return null;
        // ExitTime is undefined for a live object. Never use or serialize it
        // unless the held object's zero-time wait actually reported signaled.
        return new Dictionary<string, object> { { "result", wait }, { "exitFileTime", wait == 0 ? exit.ToString() : null } };
    }
    static NativeIdentity OpenIdentity(uint tid, uint expectedPid, bool allowExited = false) {
        var identity = new NativeIdentity { Tid = tid };
        try {
            identity.Thread = tid == 0 ? IntPtr.Zero : OpenThread(0x100800, false, tid);
            if (identity.Thread == IntPtr.Zero) return null;
            uint flags, pid = GetProcessIdOfThread(identity.Thread); long creation;
            Dictionary<string, object> threadWait = IdentityWait(identity.Thread, true, out creation);
            if (pid == 0 || (expectedPid != 0 && pid != expectedPid) || GetThreadId(identity.Thread) != tid || !GetHandleInformation(identity.Thread, out flags) || (flags & 1) != 0 || threadWait == null || (!allowExited && Number(threadWait, "result") != 258)) return null;
            identity.ThreadBirth = creation;
            identity.Process = OpenProcess(0x101000, false, pid);
            if (identity.Process == IntPtr.Zero) return null;
            Dictionary<string, object> processWait = IdentityWait(identity.Process, false, out creation);
            if (GetProcessId(identity.Process) != pid || !GetHandleInformation(identity.Process, out flags) || (flags & 1) != 0 || processWait == null || (!allowExited && Number(processWait, "result") != 258) || creation > identity.ThreadBirth) return null;
            uint count = 32768; var image = new StringBuilder((int)count);
            if (!QueryFullProcessImageNameW(identity.Process, 0, image, ref count)) return null;
            identity.Fact = new ProcessFact { Pid = pid, Creation = creation, Image = Bounded(image.ToString(), 512) };
            threadWait = IdentityWait(identity.Thread, true, out creation);
            if (GetProcessIdOfThread(identity.Thread) != pid || threadWait == null || creation != identity.ThreadBirth || (!allowExited && Number(threadWait, "result") != 258)) return null;
            NativeIdentity result = identity; identity = null; return result;
        } finally { if (identity != null) identity.Dispose(); }
    }
    static Dictionary<string, object> ReadHeldIdentity(WindowLife life, uint eventThread) {
        NativeIdentity held = life.Identity;
        if (held == null || held.Thread == IntPtr.Zero || held.Process == IntPtr.Zero || eventThread != held.Tid) return null;
        // The retained original thread object preserves its ID after exit.
        // Still reopen that ID and require exactly the same native births:
        // any query error/not-found/reuse contradicts the proof and fails closed.
        using (NativeIdentity current = OpenIdentity(eventThread, held.Fact.Pid, true)) {
            if (current == null || current.ThreadBirth != held.ThreadBirth || current.Fact.Creation != held.Fact.Creation) return null;
            long threadBirth, processBirth; uint flags;
            Dictionary<string, object> threadWait = IdentityWait(held.Thread, true, out threadBirth), processWait = IdentityWait(held.Process, false, out processBirth);
            if (!GetHandleInformation(held.Thread, out flags) || (flags & 1) != 0 || !GetHandleInformation(held.Process, out flags) || (flags & 1) != 0 || GetThreadId(held.Thread) != held.Tid || GetProcessIdOfThread(held.Thread) != held.Fact.Pid || GetProcessId(held.Process) != held.Fact.Pid || threadWait == null || threadBirth != held.ThreadBirth || processWait == null || processBirth != held.Fact.Creation) return null;
            return new Dictionary<string, object> { { "capturedAtTick", NativeTick() }, { "threadId", held.Tid }, { "threadCreationFileTime", held.ThreadBirth.ToString() }, { "pid", held.Fact.Pid }, { "processCreationFileTime", held.Fact.Creation.ToString() }, { "heldThreadVerified", true }, { "heldProcessVerified", true }, { "heldThreadWait", threadWait }, { "heldProcessWait", processWait }, { "currentThread", new Dictionary<string, object> { { "status", "same-identity" }, { "threadCreationFileTime", current.ThreadBirth.ToString() }, { "pid", current.Fact.Pid }, { "processCreationFileTime", current.Fact.Creation.ToString() } } } };
        }
    }
    int SharedRecordCount() { return events.Count + windowLives.Count + childShowEvidence.Count; }
    bool HasRecordRoom() {
        if (events.Count + childShowEvidence.Count >= MaxEvents) { MarkOverflow("event-evidence-budget"); return false; }
        if (windowLives.Count >= MaxLifetimeHistory) { MarkOverflow("lifetime-archive-budget"); return false; }
        return true;
    }
    WindowLife CurrentLife(IntPtr hwnd) {
        for (int index = windowLives.Count - 1; index >= 0; index--) if (windowLives[index].Hwnd == hwnd) return windowLives[index];
        return null;
    }
    int WorkingLives(long tick) { int count = 0; foreach (WindowLife life in windowLives) if (!life.Released.HasValue || life.Released.Value >= tick) count++; return count; }
    int CombinedWindowSlots(long tick) {
        // Keep the same generation count (including multiple lives for one
        // HWND) while checking cache hints in one pass over the archive.
        int count = 0;
        var represented = new HashSet<long>();
        foreach (WindowLife life in windowLives) if (!life.Released.HasValue || life.Released.Value >= tick) {
            count++;
            represented.Add(life.Hwnd.ToInt64());
        }
        foreach (long hwnd in previous.Keys) if (!represented.Contains(hwnd)) count++;
        return count;
    }
    void ReleaseLife(WindowLife life, long tick) { if (life.Released.HasValue) return; if (life.Identity != null) { life.Identity.Dispose(); life.Identity = null; } life.Released = tick; }
    void ExpireRetiredLives(long tick) {
        foreach (WindowLife life in windowLives) if (!life.Released.HasValue && life.Retirement != null && tick - Number(life.Retirement, "callbackTick") > 2000) ReleaseLife(life, tick);
        // Cache hints do not prove historical identity. Discard dead window
        // hints; immutable CREATE/SHOW evidence and any held proof remain intact.
        var deadChildren = new List<long>();
        foreach (var pair in previous) if (!IsWindow(pair.Value.Handle)) deadChildren.Add(pair.Key);
        foreach (long key in deadChildren) previous.Remove(key);
    }
    void RetireLife(WindowLife life, Dictionary<string, object> source, string reason, long? parent) {
        if (life == null || life.Retirement != null) return;
        var retired = new Dictionary<string, object>(source); retired["reason"] = reason; retired["parentLifeId"] = parent; life.Retirement = retired;
        // An unreadable generation never acquired held native proof handles.
        // Retain its immutable CREATE barrier, but release its working slot now.
        if (life.Confirmation == null && life.Identity == null) ReleaseLife(life, Number(source, "callbackTick"));
    }
    void RecordLifeEvent(IntPtr hwnd, string kind, uint nativeTime, uint eventThread, long tick, long order) {
        ExpireRetiredLives(tick);
        if (kind != "create" && kind != "destroy") return;
        var source = NativeEventRecord(order, nativeTime, tick, eventThread);
        source["processingWindow"] = WindowDiagnostic(hwnd);
        source["eventKind"] = kind;
        WindowLife prior = CurrentLife(hwnd);
        if (kind == "destroy" && prior != null && prior.DirectDestroy == null) prior.DirectDestroy = new Dictionary<string, object>(source);
        if (kind == "create") {
            // Every CREATE is a barrier, even when HWND/class cannot be read.
            RetireLife(prior, source, "new-create", null);
            previous.Remove(hwnd.ToInt64());
            string prefix = HandleText(hwnd) + ":"; var oldBaseline = new List<string>();
            foreach (string key in baselineVisible) if (key.StartsWith(prefix, StringComparison.Ordinal)) oldBaseline.Add(key);
            foreach (string key in oldBaseline) baselineVisible.Remove(key);
            if (!HasRecordRoom() || CombinedWindowSlots(tick) >= MaxWindows) { MarkOverflow("working-generation-budget"); return; }
            var life = new WindowLife { Id = ++nextLifeId, Hwnd = hwnd, Generation = prior == null ? 1 : prior.Generation + 1, Create = source };
            windowLives.Add(life); workingGenerationPeak = Math.Max(workingGenerationPeak, WorkingLives(tick));
        } else if (prior != null && prior.Retirement == null) {
            RetireLife(prior, source, "destroy", null);
            foreach (WindowLife child in windowLives) if (child.Confirmation != null && child.Confirmation["rootLifeId"] != null && Number(child.Confirmation, "rootLifeId") == prior.Id) RetireLife(child, source, "parent-destroy", prior.Id);
        }
    }
    void CapturePendingConfirmation(WindowLife life, IntPtr hwnd, IntPtr root, string klass, uint pid, uint tid) {
        if (life.PendingConfirmation != null || life.Identity != null || life.Confirmation != null || life.Retirement != null) return;
        NativeIdentity identity = OpenIdentity(tid, pid);
        if (identity == null) return;
        try {
            uint againPid; uint againTid = GetWindowThreadProcessId(hwnd, out againPid);
            if (!IsWindow(hwnd) || againPid != pid || againTid != tid || GetAncestor(hwnd, 2) != root || ClassName(hwnd) != klass || CurrentLife(hwnd) != life || HasQueuedBarrier(hwnd)) return;
            life.PendingConfirmation = new Dictionary<string, object> { { "sequence", Interlocked.Increment(ref observationSequence) }, { "callbackTick", NativeTick() }, { "className", klass }, { "rootHwnd", HandleText(root) }, { "pid", pid }, { "threadId", tid }, { "processCreationFileTime", identity.Fact.Creation.ToString() }, { "threadCreationFileTime", identity.ThreadBirth.ToString() }, { "doubleReadMatched", true } };
            life.Identity = identity; identity = null;
        } finally { if (identity != null) identity.Dispose(); }
    }
    void ConfirmPendingChildren(IntPtr root) {
        WindowLife parent = CurrentLife(root);
        if (parent == null || parent.Confirmation == null || parent.Retirement != null) return;
        foreach (WindowLife life in windowLives.ToArray()) {
            if (life.PendingConfirmation != null && life.Confirmation == null && life.Retirement == null && !life.Released.HasValue && (string)life.PendingConfirmation["rootHwnd"] == HandleText(root)) ConfirmWindowLife(life.Hwnd, true);
        }
    }
    WindowLife ConfirmWindowLife(IntPtr hwnd, bool allowChild) {
        WindowLife life = CurrentLife(hwnd);
        if (life == null || life.Retirement != null || life.Released.HasValue) return null;
        uint pid, tid = GetWindowThreadProcessId(hwnd, out pid); IntPtr root = GetAncestor(hwnd, 2); string klass = ClassName(hwnd);
        if (tid == 0 || tid != Convert.ToUInt32(life.Create["eventThreadId"]) || pid == 0 || root == IntPtr.Zero || klass.Length == 0 || !IsWindow(hwnd) || (root != hwnd && (!allowChild || IsConsoleClass(klass)))) return null;
        WindowLife rootLife = root == hwnd ? null : ConfirmWindowLife(root, false);
        if (root != hwnd && rootLife == null) {
            CapturePendingConfirmation(life, hwnd, root, klass, pid, tid);
            return null;
        }
        if (life.Confirmation != null) {
            if ((string)life.Confirmation["className"] != klass || (string)life.Confirmation["rootHwnd"] != HandleText(root) || !Object.Equals(life.Confirmation["rootLifeId"], rootLife == null ? null : (object)rootLife.Id) || ReadHeldIdentity(life, tid) == null) return null;
            return life;
        }
        NativeIdentity identity = OpenIdentity(tid, pid);
        if (identity == null) return null;
        try {
            uint againPid; uint againTid = GetWindowThreadProcessId(hwnd, out againPid);
            if (!IsWindow(hwnd) || againPid != pid || againTid != tid || GetAncestor(hwnd, 2) != root || ClassName(hwnd) != klass || CurrentLife(hwnd) != life || life.Retirement != null || HasQueuedBarrier(hwnd) || HasQueuedBarrier(root) || (rootLife != null && (CurrentLife(root) != rootLife || rootLife.Retirement != null))) return null;
            if (life.PendingConfirmation != null) {
                var pending = life.PendingConfirmation;
                if ((string)pending["className"] != klass || (string)pending["rootHwnd"] != HandleText(root) || life.Identity == null || ReadHeldIdentity(life, tid) == null || life.Identity.ThreadBirth != identity.ThreadBirth || life.Identity.Fact.Creation != identity.Fact.Creation || life.Identity.Fact.Pid != pid) return null;
            }
            long tick = NativeTick();
            RememberProcess(identity.Fact);
            life.Confirmation = new Dictionary<string, object> { { "sequence", Interlocked.Increment(ref observationSequence) }, { "callbackTick", tick }, { "className", klass }, { "rootHwnd", HandleText(root) }, { "rootLifeId", rootLife == null ? null : (object)rootLife.Id }, { "pid", pid }, { "processCreationFileTime", identity.Fact.Creation.ToString() }, { "threadId", tid }, { "threadCreationFileTime", identity.ThreadBirth.ToString() }, { "doubleReadMatched", true } };
            if (life.Identity != null) life.Identity.Dispose();
            life.Identity = identity; identity = null; return life;
        } finally { if (identity != null) identity.Dispose(); }
    }
    public string CaptureWindowLifeId(IntPtr hwnd) { lock (gate) { WindowLife life = ConfirmWindowLife(hwnd, true); return life == null ? null : life.Id.ToString(); } }
    public bool MatchesWindowLifeId(IntPtr hwnd, string id) { lock (gate) { WindowLife life = ConfirmWindowLife(hwnd, true); return life != null && life.Id.ToString() == id; } }
    public void ObserveOwnedDialogChildren(IntPtr dialog) {
        lock (gate) {
            if (ConfirmWindowLife(dialog, false) == null) return;
            Check(EnumChildWindows(dialog, (hwnd, ignored) => { if (GetAncestor(hwnd, 2) == dialog) ConfirmWindowLife(hwnd, true); return true; }, IntPtr.Zero), "Observe actually owned dialog children");
        }
    }
    static bool StrictLifetimeInterval(WindowLife life, Dictionary<string, object> show) {
        if (life.Confirmation == null || life.Retirement == null || life.Create["nativeTick"] == null || life.Retirement["nativeTick"] == null || show["nativeTick"] == null) return false;
        long native = Number(show, "nativeTick");
        // CREATE and SHOW may share a millisecond: the callback-entry FIFO
        // still orders them. The actual snapshot must occur inside that same
        // complete generation, never at/after retirement or across another CREATE.
        return Number(life.Create, "nativeTick") <= native && native < Number(life.Retirement, "nativeTick")
            && Number(life.Create, "sequence") < Number(show, "sequence") && Number(show, "sequence") < Number(life.Retirement, "sequence")
            && Number(life.Confirmation, "callbackTick") >= Number(life.Create, "nativeTick") && Number(life.Confirmation, "callbackTick") < Number(life.Retirement, "nativeTick");
    }
    bool LiveTeardownContinuity(WindowLife life, Dictionary<string, object> show) {
        object value;
        if (!show.TryGetValue("postParentDestroy", out value)) return false;
        var observed = value as Dictionary<string, object>;
        if (observed == null || !Object.Equals(observed["doubleReadMatched"], true) || life.Confirmation == null || life.Retirement == null || life.DirectDestroy == null || (string)life.Retirement["reason"] != "parent-destroy" || Number(observed, "childLifeId") != life.Id) return false;
        WindowLife root = windowLives.Find(item => item.Id == Number(observed, "rootLifeId"));
        if (root == null || root.Confirmation == null || root.Retirement == null || root.Confirmation["rootLifeId"] != null || (string)root.Retirement["reason"] != "destroy" || Number(life.Confirmation, "rootLifeId") != root.Id || Number(life.Retirement, "parentLifeId") != root.Id || Number(life.Retirement, "sequence") != Number(root.Retirement, "sequence")) return false;
        if (life.Create["nativeTick"] == null || show["nativeTick"] == null || life.DirectDestroy["nativeTick"] == null || root.Retirement["nativeTick"] == null) return false;
        if ((string)life.DirectDestroy["eventKind"] != "destroy" || (string)((Dictionary<string, object>)life.DirectDestroy["processingWindow"])["hwnd"] != HandleText(life.Hwnd) || Number(life.Confirmation, "callbackTick") >= Number(root.Retirement, "nativeTick") || Number(life.Confirmation, "sequence") >= Number(root.Retirement, "sequence")) return false;
        long end = 0;
        foreach (var pair in new[] { new object[] { life, "childFirst", "childSecond", "childProof" }, new object[] { root, "rootFirst", "rootSecond", "rootProof" } }) {
            var owner = (WindowLife)pair[0]; var confirmation = owner.Confirmation;
            var first = observed[(string)pair[1]] as Dictionary<string, object>; var second = observed[(string)pair[2]] as Dictionary<string, object>; var proof = observed[(string)pair[3]] as Dictionary<string, object>;
            if (first == null || second == null || proof == null || !Object.Equals(first["isWindow"], true) || !Object.Equals(second["isWindow"], true) || (string)first["hwnd"] != HandleText(owner.Hwnd) || (string)second["hwnd"] != HandleText(owner.Hwnd)) return false;
            foreach (string key in new[] { "className", "rootHwnd", "pid", "threadId" }) if (!Object.Equals(first[key], confirmation[key]) || !Object.Equals(second[key], confirmation[key])) return false;
            foreach (string key in new[] { "pid", "threadId", "processCreationFileTime", "threadCreationFileTime" }) if (!Object.Equals(proof[key], confirmation[key])) return false;
            if (!Object.Equals(proof["heldThreadVerified"], true) || !Object.Equals(proof["heldProcessVerified"], true) || Number((Dictionary<string, object>)proof["heldThreadWait"], "result") != 258 || Number((Dictionary<string, object>)proof["heldProcessWait"], "result") != 258 || (string)((Dictionary<string, object>)proof["currentThread"])["status"] != "same-identity") return false;
            var current = (Dictionary<string, object>)proof["currentThread"];
            foreach (string key in new[] { "pid", "processCreationFileTime", "threadCreationFileTime" }) if (!Object.Equals(current[key], proof[key])) return false;
            if (owner.Released.HasValue && Number(proof, "capturedAtTick") > owner.Released.Value) return false;
            if (Number(first, "beginTick") < Number(show, "callbackTick") || Number(first, "endTick") < Number(first, "beginTick") || Number(second, "beginTick") < Number(first, "endTick") || Number(second, "endTick") < Number(second, "beginTick") || Number(proof, "capturedAtTick") < Number(first, "beginTick") || Number(proof, "capturedAtTick") > Number(second, "endTick")) return false;
            end = Math.Max(end, Number(second, "endTick"));
        }
        long native = Number(show, "nativeTick"), lastOrder = Number(observed, "endSequence");
        if (!(Number(life.Create, "sequence") < Number(show, "sequence") && Number(root.Retirement, "sequence") < Number(show, "sequence") && Number(show, "sequence") <= lastOrder && lastOrder < Number(life.DirectDestroy, "sequence")) || Number(life.Create, "nativeTick") > native || Number(root.Retirement, "nativeTick") > native || native > end || end > Number(life.DirectDestroy, "nativeTick") || end - Number(root.Retirement, "nativeTick") > 2000 || Number(life.DirectDestroy, "nativeTick") - end > 2000 || Number(life.DirectDestroy, "eventThreadId") != Number(life.Confirmation, "threadId")) return false;
        foreach (WindowLife other in windowLives) {
            foreach (WindowLife owner in new[] { life, root }) if (other.Hwnd == owner.Hwnd && other.Id != owner.Id && Number(other.Create, "sequence") > Number(owner.Create, "sequence") && (other.Create["nativeTick"] == null || Number(other.Create, "nativeTick") <= end)) return false;
        }
        return true;
    }
    bool MatchesLifeProof(WindowLife life, Dictionary<string, object> show, bool allowRoot = false) {
        var proof = show["proof"] as Dictionary<string, object>;
        bool teardown = LiveTeardownContinuity(life, show);
        if ((!StrictLifetimeInterval(life, show) && !teardown) || proof == null || life.Hwnd != new IntPtr(Convert.ToInt64(((string)show["hwnd"]).Substring(2), 16)) || (life.Released.HasValue && Number(proof, "capturedAtTick") > life.Released.Value)) return false;
        if (IsConsoleClass((string)life.Confirmation["className"])) return false;
        bool isRoot = life.Confirmation["rootLifeId"] == null;
        if (isRoot != allowRoot) return false;
        foreach (string name in new string[] { "pid", "processCreationFileTime", "threadId", "threadCreationFileTime" }) if (!Object.Equals(proof[name], life.Confirmation[name])) return false;
        WindowLife root = isRoot ? life : windowLives.Find(item => item.Id == Number(life.Confirmation, "rootLifeId"));
        if (root == null || root.Confirmation == null || root.Create["nativeTick"] == null || root.Confirmation["rootLifeId"] != null) return false;
        long native = Number(show, "nativeTick");
        if (!teardown && root.Retirement != null && (root.Retirement["nativeTick"] == null || native >= Number(root.Retirement, "nativeTick"))) return false;
        foreach (WindowLife other in windowLives) {
            if (other.Hwnd == life.Hwnd && other.Id != life.Id && Number(other.Create, "sequence") > Number(life.Create, "sequence") && (other.Create["nativeTick"] == null || Number(other.Create, "nativeTick") <= native)) return false;
            if (other.Hwnd == root.Hwnd && other.Id != root.Id && Number(other.Create, "sequence") > Number(root.Create, "sequence") && (other.Create["nativeTick"] == null || Number(other.Create, "nativeTick") <= native)) return false;
        }
        return true;
    }
    public static Dictionary<string, object> CaptureTeardownReads(Func<Dictionary<string, object>> readChild, Func<Dictionary<string, object>> readRoot, Func<Dictionary<string, object>> proveChild, Func<Dictionary<string, object>> proveRoot) {
        // Complete the short-lived child's bracket before querying the root's
        // identity. The root bracket surrounds it. Both independent held-birth
        // proofs and both pairs of live reads remain required by reconciliation.
        var rootFirst = readRoot();
        var childFirst = readChild();
        var childProof = proveChild();
        var childSecond = readChild();
        var rootProof = proveRoot();
        var rootSecond = readRoot();
        return new Dictionary<string, object> { { "childFirst", childFirst }, { "childSecond", childSecond }, { "rootFirst", rootFirst }, { "rootSecond", rootSecond }, { "childProof", childProof }, { "rootProof", rootProof } };
    }
    Dictionary<string, object> CapturePostParentDestroy(WindowLife life, uint tid) {
        if (life.Confirmation == null || life.Retirement == null || (string)life.Retirement["reason"] != "parent-destroy") return null;
        WindowLife root = windowLives.Find(item => item.Id == Number(life.Retirement, "parentLifeId"));
        if (root == null || root.Confirmation == null || CurrentLife(life.Hwnd) != life || CurrentLife(root.Hwnd) != root) return null;
        var reads = CaptureTeardownReads(() => WindowDiagnostic(life.Hwnd), () => WindowDiagnostic(root.Hwnd), () => ReadHeldIdentity(life, tid), () => ReadHeldIdentity(root, Convert.ToUInt32(root.Confirmation["threadId"])));
        var childFirst = (Dictionary<string, object>)reads["childFirst"]; var childSecond = (Dictionary<string, object>)reads["childSecond"];
        var rootFirst = (Dictionary<string, object>)reads["rootFirst"]; var rootSecond = (Dictionary<string, object>)reads["rootSecond"];
        var childProof = (Dictionary<string, object>)reads["childProof"]; var rootProof = (Dictionary<string, object>)reads["rootProof"];
        bool matched = childProof != null && rootProof != null && !HasQueuedBarrier(life.Hwnd) && !HasQueuedBarrier(root.Hwnd) && CurrentLife(life.Hwnd) == life && CurrentLife(root.Hwnd) == root;
        foreach (var pair in new[] { new[] { childFirst, childSecond, life.Confirmation }, new[] { rootFirst, rootSecond, root.Confirmation } }) {
            matched = matched && Object.Equals(pair[0]["isWindow"], true) && Object.Equals(pair[1]["isWindow"], true);
            foreach (string key in new[] { "pid", "threadId", "className", "rootHwnd" }) matched = matched && Object.Equals(pair[0][key], pair[1][key]) && Object.Equals(pair[0][key], pair[2][key]);
        }
        // Capture only: final reconciliation still requires both live brackets,
        // held births, CREATE barriers and the subsequent direct child DESTROY.
        return new Dictionary<string, object> { { "childLifeId", life.Id }, { "rootLifeId", root.Id }, { "childFirst", childFirst }, { "childSecond", childSecond }, { "rootFirst", rootFirst }, { "rootSecond", rootSecond }, { "childProof", childProof }, { "rootProof", rootProof }, { "doubleReadMatched", matched }, { "endSequence", observationSequence } };
    }
    Dictionary<string, object> NewChildShow(IntPtr hwnd, uint time, uint tid, long tick, long order, string scope) {
        var record = NativeEventRecord(order, time, tick, tid);
        record["processingWindow"] = WindowDiagnostic(hwnd);
        record["eventKind"] = "show";
        record["id"] = ++nextShowId; record["hwnd"] = HandleText(hwnd); record["phase"] = phase;
        record["scope"] = scope;
        record["status"] = "unresolved"; record["lifeId"] = null; record["proof"] = null; record["reason"] = "No unique retained child lifetime with fresh native identity";
        // Do not choose the newest HWND generation. Exactly one retained
        // identity may supply a proof; final reconciliation also checks time.
        WindowLife current = CurrentLife(hwnd);
        if (current != null) record["postParentDestroy"] = CapturePostParentDestroy(current, tid);
        Dictionary<string, object> proof = null; int matches = 0;
        foreach (WindowLife life in windowLives) if (life.Hwnd == hwnd && (life.Confirmation != null || life.PendingConfirmation != null) && !life.Released.HasValue) {
            var observed = life.Confirmation ?? life.PendingConfirmation;
            if (((string)observed["rootHwnd"] == HandleText(hwnd)) != (scope == "root") || Convert.ToUInt32(observed["threadId"]) != tid) continue;
            Dictionary<string, object> candidate = ReadHeldIdentity(life, tid);
            if (candidate != null) { matches++; proof = candidate; }
        }
        if (matches == 1) record["proof"] = proof;
        return record;
    }
    void RecordPendingChildShow(IntPtr hwnd, uint time, uint tid, long tick, long order, Dictionary<string, object> captured = null) {
        if (childShowEvidence.Count >= 128 || !HasRecordRoom()) { MarkOverflow("child-show-evidence-budget"); return; }
        childShowEvidence.Add(captured ?? NewChildShow(hwnd, time, tid, tick, order, "child"));
    }
    void ReconcileChildShows() {
        knownChildShowEvents = 0;
        knownWindowShowEvents = 0;
        var all = new List<Dictionary<string, object>>(childShowEvidence); all.AddRange(directChildShows);
        foreach (Dictionary<string, object> show in all) {
            WindowLife match = null; int count = 0;
            bool isRoot = (string)show["scope"] == "root";
            foreach (WindowLife life in windowLives) if (MatchesLifeProof(life, show, isRoot)) { match = life; count++; }
            if (count == 1) { show["status"] = isRoot ? "resolved-root" : "resolved-child"; show["lifeId"] = match.Id; show["reason"] = LiveTeardownContinuity(match, show) ? "Live parent/child double reads, held births, CREATE barriers and direct child DESTROY prove teardown continuity" : "Unique strict native interval, CREATE barriers and held PID/TID births verified"; knownWindowShowEvents++; if (!isRoot) knownChildShowEvents++; }
            else { show["status"] = "unresolved"; show["lifeId"] = null; show["reason"] = count > 1 ? "Multiple native child lifetimes match; identity remains ambiguous" : "Strict native lifetime/retirement, CREATE barrier or fresh identity proof missing"; }
        }
        if (knownWindowShowEvents != all.Count) AddError("One or more SHOW events lack unique native window lifetime proof; absence of consoles is unverified");
    }
    bool HasQueuedBarrier(IntPtr hwnd) { foreach (NativeNotice notice in nativeNotices) if (notice.Hwnd == hwnd && (notice.Kind == CreateEvent || notice.Kind == DestroyEvent)) return true; return false; }
    NativeNotice DequeueNativeNotice() {
        var ordered = nativeNotices.ToArray();
        Array.Sort(ordered, (left, right) => left.Order.CompareTo(right.Order));
        NativeNotice notice = ordered[0]; nativeNotices.Clear();
        for (int index = 1; index < ordered.Length; index++) nativeNotices.Enqueue(ordered[index]);
        return notice;
    }
    void QueueNativeEvent(uint kind, IntPtr hwnd, uint tid, uint time) {
        // Claim the drainer before native interop or taking an STA lock: either
        // can reenter the hook. Nested callbacks may enqueue before this one,
        // so select by callback-entry sequence, never by enqueue completion.
        long order = Interlocked.Increment(ref observationSequence);
        bool drain = Interlocked.CompareExchange(ref processingNativeNotice, 1, 0) == 0;
        try {
            var notice = new NativeNotice { Kind = kind, Hwnd = hwnd, Tid = tid, Time = time, Order = order, Tick = NativeTick() };
            // Diagnostic only: observe before waiting on our queue/STA lock.
            // Reentrant callbacks retain their entry sequence; this snapshot
            // never confirms a window lifetime or authorizes a SHOW event.
            if (kind == ShowEvent || kind == DestroyEvent) notice.CallbackWindow = WindowDiagnostic(hwnd);
            lock (gate) { if (nativeNotices.Count >= MaxEvents) { MarkOverflow("native-event-queue-budget"); return; } nativeNotices.Enqueue(notice); }
            if (!drain) return;
            while (true) {
                lock (gate) {
                    if (nativeNotices.Count == 0) break;
                    notice = DequeueNativeNotice();
                }
                Observe(notice.Hwnd, notice.Kind == CreateEvent ? "create" : notice.Kind == DestroyEvent ? "destroy" : notice.Kind == ShowEvent ? "show" : "hide", notice.Kind == ShowEvent, false, notice.Time, notice.Tid, notice.Tick, notice.Order, notice.CallbackWindow);
                if (notice.Kind == CreateEvent) { lock (gate) ConfirmPendingChildren(notice.Hwnd); }
            }
        } finally { if (drain) Interlocked.Exchange(ref processingNativeNotice, 0); }
    }
    void CacheWindow(WindowFact fact, bool destroyed) {
        long key = fact.Handle.ToInt64();
        if (destroyed) { DestroyCachedWindow(fact.Handle); return; }
        if (previous.ContainsKey(key) || CurrentLife(fact.Handle) != null && !CurrentLife(fact.Handle).Released.HasValue || CombinedWindowSlots(clock.IsRunning && started ? NativeTick() : 0) < MaxWindows) previous[key] = fact;
        else MarkOverflow("live-window-cache-budget");
    }
    void DestroyCachedWindow(IntPtr hwnd) {
        previous.Remove(hwnd.ToInt64());
        // EVENT_OBJECT_DESTROY for a parent also retires its descendants. A
        // child is not required to emit a separate DESTROY. Only negative
        // live-cache hints are released; recorded evidence is never erased.
        var children = new List<long>();
        foreach (var pair in previous) if (pair.Value.KnownChild && pair.Value.ObservedRoot == hwnd) children.Add(pair.Key);
        foreach (long child in children) { previous.Remove(child); retiredChildHints++; }
    }
    static bool OrderedIdentity(long expected, long actual, long childCreation) { return expected > 0 && actual == expected && actual <= childCreation; }
    static bool WindowStateChanged(WindowFact old, WindowFact current) { return old == null || old.Identity != current.Identity || old.Visible != current.Visible || old.Title != current.Title || old.Attribution != current.Attribution || old.CurrentVisible != current.CurrentVisible; }
    static bool ExistedBeforeSnapshot(long creation, long snapshotStarted) { return creation > 0 && creation <= snapshotStarted; }
    static bool SameThreadOwner(WindowFact prior, uint eventThread, ProcessFact actual) { return prior != null && prior.KnownChild && prior.ThreadId != 0 && prior.ThreadId == eventThread && actual != null && actual.Pid == prior.Pid && prior.Process != null && OrderedIdentity(prior.Process.Creation, actual.Creation, actual.Creation); }
    static ProcessFact ThreadOwner(uint threadId) {
        IntPtr thread = threadId == 0 ? IntPtr.Zero : OpenThread(0x800, false, threadId);
        if (thread == IntPtr.Zero) return null;
        try { return ProcessIdentity(GetProcessIdOfThread(thread), 0); } finally { CloseHandle(thread); }
    }
    string Attribution(ProcessFact leaf, out List<ProcessFact> lineage) {
        lineage = new List<ProcessFact>();
        if (leaf == null) return "unattributed";
        uint current = leaf.Pid; long childTime = leaf.Creation;
        var visited = new HashSet<uint>();
        for (int depth = 0; depth < 32 && visited.Add(current); depth++) {
            ProcessFact fact;
            if (current == leaf.Pid) fact = leaf;
            else if (!processes.TryGetValue(current, out fact)) break;
            if (!OrderedIdentity(fact.Creation, fact.Creation, childTime)) break;
            lineage.Add(fact);
            foreach (Product product in products) if (product.Pid == current && OrderedIdentity(product.Creation, fact.Creation, childTime) && WaitForSingleObject(product.Handle, 0) == 258) return current == leaf.Pid ? "product" : "product-descendant";
            if (fact.Parent == 0) break;
            childTime = fact.Creation; current = fact.Parent;
        }
        return "unattributed";
    }
    WindowFact ReadWindow(IntPtr hwnd) {
        uint pid; uint windowThread = GetWindowThreadProcessId(hwnd, out pid);
        string klass = ClassName(hwnd);
        if (pid == 0 || klass.Length == 0) return null;
        var title = new StringBuilder(97); GetWindowTextW(hwnd, title, title.Capacity);
        Rect rect; GetWindowRect(hwnd, out rect);
        uint cloaked; int hr = DwmGetWindowAttribute(hwnd, 14, out cloaked, 4);
        ProcessFact process;
        lock (gate) processes.TryGetValue(pid, out process);
        if (IsConsoleClass(klass)) {
            // Console evidence always has a freshly queried identity. A short
            // icacls process may begin and end between the background scans.
            ProcessFact exact = ProcessIdentity(pid, 0);
            if (exact != null && process != null && exact.Creation == process.Creation) exact.Parent = process.Parent;
            else if (exact != null) {
                long snapshotStarted = DateTime.UtcNow.ToFileTimeUtc();
                IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
                if (snapshot != new IntPtr(-1)) try {
                    var item = new ProcessEntry { size = (uint)Marshal.SizeOf<ProcessEntry>() };
                    bool more = Process32FirstW(snapshot, ref item);
                    while (more) { if (item.pid == pid) { ProcessFact verified = ProcessIdentity(pid, item.parent); if (verified != null && verified.Creation == exact.Creation && ExistedBeforeSnapshot(verified.Creation, snapshotStarted)) exact = verified; break; } more = Process32NextW(snapshot, ref item); }
                } finally { CloseHandle(snapshot); }
            }
            process = exact;
        }
        long creation = process == null ? 0 : process.Creation;
        string identity = HandleText(hwnd) + ":" + pid + ":" + creation;
        return new WindowFact { Handle = hwnd, Pid = pid, ThreadId = windowThread, Class = klass, Title = title.ToString(), Visible = IsWindowVisible(hwnd), Cloaked = hr >= 0 ? (uint?)cloaked : null, Rect = rect, Creation = creation, Identity = identity, Process = process, Baseline = baselineVisible.Contains(identity) };
    }
    void Observe(IntPtr hwnd, string kind, bool showEvent, bool baseline, uint? nativeEventTime = null, uint eventThread = 0, long? entryTick = null, long? entryOrder = null, Dictionary<string, object> callbackWindow = null) {
        if (hwnd == IntPtr.Zero) return;
        long callbackTick = entryTick ?? NativeTick();
        long order = entryOrder ?? (nativeEventTime.HasValue ? Interlocked.Increment(ref observationSequence) : 0);
        if (nativeEventTime.HasValue && (kind == "show" || kind == "destroy")) {
            lock (gate) {
                if (nativeDiagnostics.Count < 4096) {
                    var diagnostic = NativeEventRecord(order, nativeEventTime.Value, callbackTick, eventThread);
                    diagnostic["eventKind"] = kind; diagnostic["callbackWindow"] = callbackWindow; diagnostic["processingWindow"] = WindowDiagnostic(hwnd);
                    nativeDiagnostics.Add(diagnostic);
                } else nativeDiagnosticsTruncated = true;
            }
        }
        lock (gate) { if (nativeEventTime.HasValue) RecordLifeEvent(hwnd, kind, nativeEventTime.Value, eventThread, callbackTick, order); }
        bool live = IsWindow(hwnd);
        IntPtr observedRoot = live ? GetAncestor(hwnd, 2) : IntPtr.Zero;
        string observedClass = live && observedRoot != IntPtr.Zero && observedRoot != hwnd ? ClassName(hwnd) : "";
        bool currentChild = observedRoot != IntPtr.Zero && observedRoot != hwnd && observedClass.Length != 0 && !IsConsoleClass(observedClass);
        if (currentChild && !showEvent) {
            uint childPid; uint childThread = GetWindowThreadProcessId(hwnd, out childPid);
            lock (gate) { ConfirmWindowLife(hwnd, true); ProcessFact childProcess; processes.TryGetValue(childPid, out childProcess); CacheWindow(new WindowFact { Handle = hwnd, Pid = childPid, ThreadId = childThread, KnownChild = true, ObservedRoot = observedRoot, Class = observedClass, Process = childProcess }, kind == "destroy"); }
            return;
        }
        Dictionary<string, object> earlyChildShow = null;
        if (showEvent && currentChild && nativeEventTime.HasValue) {
            lock (gate) {
                bool controlInterval = positiveActive || (positiveEnded && unchecked(nativeEventTime.Value - positiveStartedTick) <= unchecked(positiveEndedTick - positiveStartedTick));
                WindowLife current = CurrentLife(hwnd);
                if (productPhase && !controlInterval && current != null && current.Retirement != null && (string)current.Retirement["reason"] == "parent-destroy" && HasRecordRoom()) earlyChildShow = NewChildShow(hwnd, nativeEventTime.Value, eventThread, callbackTick, order, "child");
            }
        }
        // Capture identity before title/geometry/DWM queries can outlive a
        // short-lived child. Its proof still faces the same final contract.
        WindowFact fact = ReadWindow(hwnd), old = null;
        lock (gate) {
            // WinEvent delivery is asynchronous. Attribute queued control
            // events by their OS event time, not the later callback phase.
            bool positiveInterval = positiveActive || (nativeEventTime.HasValue && positiveEnded && unchecked(nativeEventTime.Value - positiveStartedTick) <= unchecked(positiveEndedTick - positiveStartedTick));
            WindowLife confirmed = fact != null && live ? ConfirmWindowLife(hwnd, currentChild) : null;
            if (fact != null && currentChild) { fact.KnownChild = true; fact.ObservedRoot = observedRoot; }
            if (fact != null && !IsConsoleClass(fact.Class) && confirmed != null && confirmed.Identity != null) {
                fact.Process = confirmed.Identity.Fact; fact.Creation = fact.Process.Creation; fact.Identity = HandleText(hwnd) + ":" + fact.Pid + ":" + fact.Creation;
            }
            previous.TryGetValue(hwnd.ToInt64(), out old);
            // A new CREATE starts a new HWND lifetime. If it cannot be read,
            // never carry a prior child classification across handle reuse.
            if (kind == "create" && fact == null && old != null && old.KnownChild) { previous.Remove(hwnd.ToInt64()); old = null; }
            // OBJID_WINDOW also includes child controls. Their prior CREATE
            // observation and exact owning thread distinguish them from a
            // genuinely unknown destroyed top-level window; never guess from
            // a missing HWND alone. DESTROY releases only the live cache.
            if (fact == null && old != null && old.KnownChild) {
                if (kind == "destroy") { DestroyCachedWindow(hwnd); return; }
                // A cached child or same thread is not a lifetime proof. Keep
                // the original SHOW for strict final reconciliation instead.
                old = null;
            }
            if (fact == null) fact = old;
            if (fact == null) {
                if (kind == "destroy") { DestroyCachedWindow(hwnd); return; }
                if (showEvent && productPhase && !positiveInterval) {
                    if (nativeEventTime.HasValue) RecordPendingChildShow(hwnd, nativeEventTime.Value, eventThread, callbackTick, order, earlyChildShow);
                    else AddError("SHOW without original native event timestamp cannot establish absence of consoles");
                }
                return;
            }
            bool console = IsConsoleClass(fact.Class);
            bool negativeShow = showEvent && productPhase && !positiveInterval && !console;
            List<ProcessFact> lineage;
            string attribution = Attribution(fact.Process, out lineage);
            bool product = attribution != "unattributed";
            Rect desktop = DesktopRect(); bool intersectsDesktop = IntersectsDesktop(fact.Rect, desktop);
            bool currentVisible = live && fact.Visible && fact.Cloaked == 0 && fact.Rect.right > fact.Rect.left && fact.Rect.bottom > fact.Rect.top && intersectsDesktop;
            if (baseline && currentVisible) { baselineVisible.Add(fact.Identity); fact.Baseline = true; }
            // Preserve the old state even when a destroyed HWND can only be
            // resolved from its cached identity.
            bool changed = old == null || old.Attribution != attribution || old.CurrentVisible != currentVisible;
            fact.Attribution = attribution; fact.CurrentVisible = currentVisible;
            changed = changed || WindowStateChanged(old, fact);
            CacheWindow(fact, kind == "destroy");
            if (!console && !product && !negativeShow) return;
            bool observedShow = console && showEvent && !fact.Baseline;
            // Hidden WebView IME/message/power windows are cached for identity,
            // but do not consume the console/visible-product evidence budget.
            if (!console && !currentVisible && !showEvent && !((kind == "hide" || kind == "destroy") && old != null && old.Visible)) return;
            if (console && positiveActive && fact.Title == positiveTitle && currentVisible) positiveDetected = true;
            if (console && productPhase && !positiveInterval && !fact.Baseline && (currentVisible || observedShow)) {
                HashSet<string> identities = product ? visibleProductConsoles : visibleUnknownConsoles;
                if (identities.Count < MaxEvents || identities.Contains(fact.Identity)) identities.Add(fact.Identity); else MarkOverflow("console-identity-budget");
            }
            if (kind == "poll" && !changed) return;
            if (!HasRecordRoom()) return;
            Dictionary<string, object> windowShow = negativeShow && nativeEventTime.HasValue ? (earlyChildShow ?? NewChildShow(hwnd, nativeEventTime.Value, eventThread, callbackTick, order, currentChild ? "child" : "root")) : null;
            if (negativeShow && windowShow == null) AddError("Non-console SHOW lacks its original native event time");
            var lineageKeys = new List<string>();
            foreach (ProcessFact ancestor in lineage) { if (lineageKeys.Count < 8) { RememberProcess(ancestor); lineageKeys.Add(ancestor.Pid + ":" + ancestor.Creation); } else if (product) MarkOverflow("event-lineage-budget"); }
            events.Add(new Dictionary<string, object> {
                { "sequence", ++sequence }, { "elapsedMs", clock.ElapsedMilliseconds }, { "nativeEventUptimeMs32", nativeEventTime }, { "eventThreadId", eventThread }, { "callbackDelayMs", nativeEventTime.HasValue ? (object)unchecked((uint)Environment.TickCount - nativeEventTime.Value) : null }, { "phase", phase }, { "kind", kind }, { "hwnd", HandleText(hwnd) },
                { "pid", fact.Pid }, { "processCreationFileTime", fact.Creation > 0 ? fact.Creation.ToString() : null }, { "className", fact.Class }, { "title", fact.Title },
                { "parentPid", fact.Process == null ? 0 : fact.Process.Parent }, { "processLineage", lineageKeys.ToArray() }, { "lineageVerifiedToProduct", product },
                { "visibleNow", live && fact.Visible }, { "cloaked", fact.Cloaked }, { "showEvent", showEvent }, { "consoleCandidate", console }, { "positiveControlInterval", positiveInterval }, { "productObservationInterval", productPhase }, { "observedVisible", currentVisible || observedShow }, { "intersectsDesktop", intersectsDesktop }, { "desktopRect", new int[] { desktop.left, desktop.top, desktop.right, desktop.bottom } },
                { "baselineVisible", fact.Baseline }, { "attribution", attribution }, { "rect", new int[] { fact.Rect.left, fact.Rect.top, fact.Rect.right, fact.Rect.bottom } }, { "windowLifeShow", windowShow }
            });
            if (windowShow != null) directChildShows.Add(windowShow);
        }
    }
    void Enumerate(bool baseline) { Check(EnumWindows((hwnd, data) => { Observe(hwnd, baseline ? "baseline" : "poll", false, baseline); return true; }, IntPtr.Zero), "Enumerate desktop windows"); }
    void Pump() {
        try {
            desktopContext = CurrentDesktop(); session = (uint)desktopContext["sessionId"];
            callback = (h, kind, hwnd, objectId, childId, thread, time) => {
                if (objectId != 0 || childId != 0) return;
                try { QueueNativeEvent(kind, hwnd, thread, time); }
                catch (Exception error) { AddError(error.Message); }
            };
            hook = SetWinEventHook(CreateEvent, HideEvent, IntPtr.Zero, callback, 0, 0, 0);
            Check(hook != IntPtr.Zero, "Install out-of-context window event hook");
            ScanProcesses(); Enumerate(true);
            processSampler = new Thread(SampleProcesses) { IsBackground = true, Name = "Milkup GUI process identity sampler" }; processSampler.Start(); ready.Set();
            long nextWindowPoll = NativeTick();
            while (!stopping) {
                Message message;
                int drained = 0;
                while (drained++ < 512 && PeekMessageW(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessageW(ref message); }
                long now = NativeTick();
                if (now >= nextWindowPoll) {
                    Enumerate(false);
                    lock (gate) ExpireRetiredLives(NativeTick());
                    nextWindowPoll = NativeTick() + 25;
                }
                if (positiveDetected && positiveActive && !positiveCaptureAttempted) {
                    positiveCaptureAttempted = true; try { CaptureDesktop("gui-console-positive.png"); lock (gate) positiveCaptureComplete = true; } catch (Exception error) { AddError("Positive screenshot: " + error.Message); }
                }
                if (productPhase && !failureCaptureAttempted && (visibleProductConsoles.Count + visibleUnknownConsoles.Count > 0)) {
                    failureCaptureAttempted = true; try { CaptureDesktop("gui-native-failure.png"); } catch (Exception error) { AddError("Failure screenshot: " + error.Message); }
                }
                // WinEvents are dispatched by this message thread. A fixed sleep
                // postpones CREATE/SHOW snapshots until short-lived HWNDs vanish.
                // Wake for queued input immediately; keep the existing 25ms poll.
                uint remaining = (uint)Math.Max(0L, Math.Min(25L, nextWindowPoll - NativeTick()));
                uint wake = MsgWaitForMultipleObjectsEx(0, IntPtr.Zero, remaining, 0x04FF, 0x0004);
                Check(wake != 0xffffffff, "Wait for native window events");
            }
            Message finalMessage;
            int finalCount = 0;
            while (finalCount++ < 2048 && PeekMessageW(out finalMessage, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref finalMessage); DispatchMessageW(ref finalMessage); }
            if (finalCount > 2048) AddError("Final native event drain exceeded its budget");
            Enumerate(false);
            lock (gate) ReconcileChildShows();
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
    int VisibleControlWindows() {
        int count = 0;
        Check(EnumWindows((hwnd, ignored) => {
            if (IsWindowVisible(hwnd) && IsConsoleClass(ClassName(hwnd))) {
                var title = new StringBuilder(97); GetWindowTextW(hwnd, title, title.Capacity);
                if (title.ToString() == positiveTitle) count++;
            }
            return true;
        }, IntPtr.Zero), "Confirm owned control window disappeared");
        return count;
    }
    public Dictionary<string, object> PositiveControl() {
        RequireStarted(); if (positive != null || products.Count != 0) throw new InvalidOperationException("One positive control before product launch is required");
        positive = new Dictionary<string, object> { { "detectedVisible", false }, { "heldProcessSignaled", false }, { "naturalExit", false }, { "exitCode", null }, { "jobActiveAfterStop", null }, { "cleanupComplete", false }, { "sameInputDesktop", true }, { "screenshot", "gui-console-positive.png" } };
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobValue = IntPtr.Zero; ProcessInfo info = new ProcessInfo(); bool initialized = false, resumed = false, clean = false;
        lock (gate) { positiveStartedTick = unchecked((uint)Environment.TickCount); positiveActive = true; phase = "positive-control"; positiveTitle = "MilkupGuiControl-" + Guid.NewGuid().ToString("N"); }
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
            long windowDeadline = clock.ElapsedMilliseconds + 3000;
            int controlWindows;
            while ((controlWindows = VisibleControlWindows()) != 0 && clock.ElapsedMilliseconds < windowDeadline) Thread.Sleep(20);
            positive["visibleControlWindowsAfterStop"] = controlWindows;
            lock (gate) positive["detectedVisible"] = positiveDetected;
            lock (gate) positive["screenshotCaptured"] = positiveCaptureComplete;
            clean = signaled && active == 0 && controlWindows == 0; positive["cleanupComplete"] = clean;
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
            lock (gate) { positiveEndedTick = unchecked((uint)Environment.TickCount); positiveEnded = true; positiveActive = false; productPhase = clean && positiveDetected && positive.ContainsKey("passed") && (bool)positive["passed"]; phase = productPhase ? "product-awaiting-identity" : "positive-control-failed"; }
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
    sealed class PickerTarget { public Product Product; public IntPtr Dialog; public uint ThreadId; public string LifeId; }
    public Dictionary<string, object> ChooseFile(string path) {
        RequireStarted();
        var record = new Dictionary<string, object> { { "path", path }, { "startedElapsedMs", clock.ElapsedMilliseconds }, { "ok", false } };
        lock (gate) { if (filePickerOperations.Count >= 16) throw new InvalidOperationException("File picker operation budget exceeded"); record["pickerSequence"] = filePickerOperations.Count + 1; filePickerOperations.Add(record); }
        var target = new PickerTarget();
        try { var result = ChooseFileCore(path, record, target); record["ok"] = true; record["result"] = result; return result; }
        catch (Exception error) { record["error"] = Bounded(error.Message, 512); if (!File.Exists(Path.Combine(evidenceDirectory, "gui-native-failure.png"))) { try { CaptureDesktop("gui-native-failure.png"); record["failureScreenshot"] = "gui-native-failure.png"; } catch (Exception captureError) { record["screenshotError"] = Bounded(captureError.Message, 256); } } record["failureCleanup"] = CancelFailedPicker(target); throw; }
        finally { record["finishedElapsedMs"] = clock.ElapsedMilliseconds; }
    }
    public static string[] FilenameInputChunks(string value) {
        if (String.IsNullOrEmpty(value) || value.Length > 2048) throw new ArgumentException("Bounded filename input required");
        for (int i = 0; i < value.Length; i++) {
            if (Char.IsHighSurrogate(value[i])) { if (++i >= value.Length || !Char.IsLowSurrogate(value[i])) throw new ArgumentException("Unpaired filename surrogate"); }
            else if (Char.IsLowSurrogate(value[i])) throw new ArgumentException("Unpaired filename surrogate");
        }
        var chunks = new List<string>();
        for (int start = 0; start < value.Length;) {
            int length = Math.Min(16, value.Length - start);
            if (Char.IsHighSurrogate(value[start + length - 1])) length--;
            chunks.Add(value.Substring(start, length)); start += length;
        }
        return chunks.ToArray();
    }
    static string ReadOwnedEditText(IntPtr edit) {
        IntPtr buffer = Marshal.AllocHGlobal(4100);
        try { Marshal.WriteInt16(buffer, 0); UIntPtr copied; Check(SendMessageTimeoutW(edit, 0x0d, new IntPtr(2050), buffer, 2, 2000, out copied) != IntPtr.Zero, "Read owned native filename field"); if (copied.ToUInt64() > 2048) throw new InvalidOperationException("Filename readback exceeds fixture bound"); return Marshal.PtrToStringUni(buffer, (int)copied.ToUInt64()); }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    bool SameDialog(IntPtr dialog, uint productPid, uint threadId) { uint actualPid; uint actualThread = GetWindowThreadProcessId(dialog, out actualPid); return IsWindow(dialog) && actualPid == productPid && actualThread == threadId && ClassName(dialog) == "#32770"; }
    bool SamePickerTarget(PickerTarget target) { return target.Product != null && target.Dialog != IntPtr.Zero && target.LifeId != null && WaitForSingleObject(target.Product.Handle, 0) == 258 && SameDialog(target.Dialog, target.Product.Pid, target.ThreadId) && MatchesWindowLifeId(target.Dialog, target.LifeId); }
    Dictionary<string, object> CancelFailedPicker(PickerTarget target) {
        var cleanup = new Dictionary<string, object> { { "attempted", false }, { "completed", false }, { "productKilled", false }, { "privateInvokeUsed", false } };
        if (target.Product == null || target.Dialog == IntPtr.Zero) { cleanup["reason"] = "No exact original dialog was acquired"; return cleanup; }
        try {
            CurrentDesktop();
            if (!SameDialog(target.Dialog, target.Product.Pid, target.ThreadId) || !IsWindowVisible(target.Dialog)) { cleanup["reason"] = "Original dialog no longer visible; no input sent"; cleanup["originalDialogVisible"] = false; return cleanup; }
            if (!SamePickerTarget(target)) throw new InvalidOperationException("Original dialog generation or held product identity is unproven; cancellation withheld");
            SetForegroundWindow(target.Dialog);
            var clickEvidence = ClickOwnedDialogButton(target, 2);
            cleanup["attempted"] = true; cleanup["submission"] = "native-cancel-button-mouse"; cleanup["clickEvidence"] = clickEvidence;
            long until = clock.ElapsedMilliseconds + 2000;
            while (SamePickerTarget(target) && IsWindowVisible(target.Dialog) && clock.ElapsedMilliseconds < until) Thread.Sleep(25);
            bool originalStillVisible = SameDialog(target.Dialog, target.Product.Pid, target.ThreadId) && IsWindowVisible(target.Dialog);
            var dialogs = new List<string>();
            Check(EnumWindows((hwnd, ignored) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == target.Product.Pid && IsWindowVisible(hwnd) && ClassName(hwnd) == "#32770") dialogs.Add(HandleText(hwnd)); return true; }, IntPtr.Zero), "Check remaining owned dialogs after cancellation");
            cleanup["originalDialogVisible"] = originalStillVisible; cleanup["remainingOwnedDialogs"] = dialogs; cleanup["completed"] = !originalStillVisible && dialogs.Count == 0;
            if (!(bool)cleanup["completed"]) cleanup["error"] = "Owned file dialog cancellation did not establish an empty modal set";
        } catch (Exception error) { cleanup["error"] = Bounded(error.Message, 512); }
        return cleanup;
    }
    Dictionary<string, object> ClickOwnedDialogButton(PickerTarget target, int controlId) {
        if (controlId != 1 && controlId != 2) throw new ArgumentException("Only the native Open and Cancel controls are permitted");
        if (!SamePickerTarget(target) || GetAncestor(GetForegroundWindow(), 2) != target.Dialog) throw new InvalidOperationException("Original file picker is no longer the proven foreground target");
        IntPtr buttonHandle = GetDlgItem(target.Dialog, controlId); uint buttonPid; uint buttonThread = GetWindowThreadProcessId(buttonHandle, out buttonPid);
        Rect button, desktop = DesktopRect(); Check(GetWindowRect(buttonHandle, out button), "Read native dialog button bounds");
        if (ClassName(buttonHandle) != "Button" || GetAncestor(buttonHandle, 2) != target.Dialog || buttonPid != target.Product.Pid || buttonThread != target.ThreadId || !IsWindowVisible(buttonHandle) || !IsWindowEnabled(buttonHandle) || button.right <= button.left || button.bottom <= button.top || !IntersectsDesktop(button, desktop)) throw new InvalidOperationException("Owned dialog button is not an actual visible input target");
        int x = button.left + (button.right - button.left) / 2, y = button.top + (button.bottom - button.top) / 2;
        if (x < desktop.left || x >= desktop.right || y < desktop.top || y >= desktop.bottom) throw new InvalidOperationException("Native dialog button center lies outside desktop");
        IntPtr hit = WindowFromPoint(new Point { x = x, y = y }); string hitText = HandleText(hit);
        bool ownsHit = false; for (int depth = 0; depth < 8 && hit != IntPtr.Zero; depth++, hit = GetParent(hit)) if (hit == buttonHandle) { ownsHit = true; break; }
        if (!ownsHit || !SamePickerTarget(target) || GetDlgItem(target.Dialog, controlId) != buttonHandle) throw new InvalidOperationException("Native dialog button was covered or changed before input");
        var click = new Input[] { Mouse(x, y, desktop, 0x8000 | 0x4000 | 1), Mouse(x, y, desktop, 0x8000 | 0x4000 | 2), Mouse(x, y, desktop, 0x8000 | 0x4000 | 4) };
        Check(SendInput((uint)click.Length, click, Marshal.SizeOf<Input>()) == click.Length, "Click exact owned native dialog button");
        return new Dictionary<string, object> { { "controlId", controlId }, { "buttonHwnd", HandleText(buttonHandle) }, { "buttonRect", RectReport(button) }, { "desktopRect", RectReport(desktop) }, { "hitHwnd", hitText }, { "dialogLifeId", target.LifeId }, { "inputCount", click.Length } };
    }
    Dictionary<string, object> ChooseFileCore(string path, Dictionary<string, object> record, PickerTarget target) {
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
        target.Product = product; target.Dialog = dialog; target.ThreadId = dialogThread;
        long generationDeadline = clock.ElapsedMilliseconds + 250; int generationAttempts = 0;
        do { generationAttempts++; ObserveOwnedDialogChildren(dialog); target.LifeId = CaptureWindowLifeId(dialog); if (target.LifeId != null) break; Thread.Sleep(10); } while (SameDialog(dialog, product.Pid, dialogThread) && clock.ElapsedMilliseconds < generationDeadline);
        record["generationCaptureAttempts"] = generationAttempts;
        record["dialogLifeId"] = target.LifeId;
        if (!SamePickerTarget(target)) throw new InvalidOperationException("Original native dialog generation could not be proven");
        record["productPid"] = product.Pid; record["productCreationFileTime"] = product.Creation.ToString(); record["dialogHwnd"] = HandleText(dialog); record["dialogThreadId"] = dialogThread;
        var edits = new List<IntPtr>();
        Check(EnumChildWindows(dialog, (hwnd, ignored) => {
            if (ClassName(hwnd) != "Edit") return true;
            IntPtr ancestor = hwnd;
            for (int depth = 0; depth < 6 && ancestor != IntPtr.Zero && ancestor != dialog; depth++, ancestor = GetParent(ancestor)) if (GetDlgCtrlID(ancestor) == 1148) { edits.Add(hwnd); break; }
            return true;
        }, IntPtr.Zero), "Find native filename control");
        IntPtr openButton = GetDlgItem(dialog, 1);
        if (edits.Count != 1 || openButton == IntPtr.Zero || ClassName(openButton) != "Button") throw new InvalidOperationException("Exact native filename Edit/Open controls are unavailable");
        record["filenameEditHwnd"] = HandleText(edits[0]); record["openButtonHwnd"] = HandleText(openButton);
        SetForegroundWindow(dialog);
        UIntPtr returned; Check(SendMessageTimeoutW(dialog, 0x28, edits[0], new IntPtr(1), 2, 2000, out returned) != IntPtr.Zero, "Focus native filename control");
        var gui = new GuiThreadInfo { size = (uint)Marshal.SizeOf<GuiThreadInfo>() }; Check(GetGUIThreadInfo(dialogThread, ref gui), "Verify native filename focus");
        if (gui.focus != edits[0] || GetAncestor(GetForegroundWindow(), 2) != dialog) throw new InvalidOperationException("Native filename field is not the foreground input target");
        // SendInput acknowledges queued events, not completed Edit text. A real
        // Windows failure accepted all events but retained only 53/121 UTF-16
        // units while the shell suggestion popup was visible. Pace actual input
        // with exact prefix acknowledgements; never rewrite/retry missing text.
        long until = clock.ElapsedMilliseconds + 10000, readbackDeadline = clock.ElapsedMilliseconds + 2000;
        var receipts = new List<Dictionary<string, object>>(); record["filenameInputChunks"] = receipts;
        int sentUnits = 0; string typed = "";
        foreach (string chunk in FilenameInputChunks(file)) {
            if (clock.ElapsedMilliseconds >= readbackDeadline) throw new InvalidOperationException("Native filename input deadline elapsed");
            if (!SamePickerTarget(target)) throw new InvalidOperationException("Original file picker identity changed during input");
            gui = new GuiThreadInfo { size = (uint)Marshal.SizeOf<GuiThreadInfo>() }; Check(GetGUIThreadInfo(dialogThread, ref gui), "Recheck native filename focus");
            uint editPid; uint editThread = GetWindowThreadProcessId(edits[0], out editPid);
            if (gui.focus != edits[0] || GetAncestor(GetForegroundWindow(), 2) != dialog || GetAncestor(edits[0], 2) != dialog || editPid != product.Pid || editThread != dialogThread || ClassName(edits[0]) != "Edit") throw new InvalidOperationException("Native filename input target changed");
            var inputs = new List<Input>();
            if (sentUnits == 0) { inputs.Add(Key(0x11, 0, 0)); inputs.Add(Key(0x41, 0, 0)); inputs.Add(Key(0x41, 0, 2)); inputs.Add(Key(0x11, 0, 2)); }
            foreach (char value in chunk) { inputs.Add(Key(0, value, 4)); inputs.Add(Key(0, value, 6)); }
            Input[] array = inputs.ToArray(); uint delivered = SendInput((uint)array.Length, array, Marshal.SizeOf<Input>());
            sentUnits += chunk.Length;
            var receipt = new Dictionary<string, object> { { "sentUtf16Units", sentUnits }, { "inputCount", array.Length }, { "queuedInputCount", delivered }, { "startedElapsedMs", clock.ElapsedMilliseconds }, { "readbackExact", false } }; receipts.Add(receipt);
            Check(delivered == array.Length, "Send native fixture filename keystrokes");
            string expectedPrefix = file.Substring(0, sentUnits); int stableReads = 0;
            do {
                if (!SamePickerTarget(target)) throw new InvalidOperationException("Original file picker identity changed during input");
                typed = ReadOwnedEditText(edits[0]);
                if (clock.ElapsedMilliseconds >= readbackDeadline) break;
                stableReads = String.Equals(typed, expectedPrefix, StringComparison.Ordinal) ? stableReads + 1 : 0;
                if (stableReads >= 2) break;
                Thread.Sleep(25);
            } while (clock.ElapsedMilliseconds < readbackDeadline);
            receipt["readbackExact"] = stableReads >= 2; receipt["readbackUtf16Units"] = typed.Length; receipt["finishedElapsedMs"] = clock.ElapsedMilliseconds;
            record["filenameReadback"] = typed; record["filenameReadbackExact"] = String.Equals(typed, file, StringComparison.Ordinal);
            if (stableReads < 2) throw new InvalidOperationException("Native filename chunk did not reach the exact acknowledged prefix");
        }
        if (!(bool)record["filenameReadbackExact"]) throw new InvalidOperationException("Native filename field did not contain the exact owned fixture");
        // Enter can accept shell autocomplete without activating Open. Click
        // the actual, identity-checked native button after exact field readback.
        ObserveOwnedDialogChildren(dialog);
        record["filenameBeforeOpenExact"] = String.Equals(ReadOwnedEditText(edits[0]), file, StringComparison.Ordinal);
        if (!(bool)record["filenameBeforeOpenExact"]) throw new InvalidOperationException("Native filename changed before Open");
        if (clock.ElapsedMilliseconds >= until) throw new InvalidOperationException("Native file picker input deadline elapsed before Open");
        record["openClick"] = ClickOwnedDialogButton(target, 1); record["submission"] = "native-open-button-mouse";
        while (SameDialog(dialog, product.Pid, dialogThread) && IsWindowVisible(dialog) && clock.ElapsedMilliseconds < until) Thread.Sleep(25);
        record["sameDialogAtEnd"] = SameDialog(dialog, product.Pid, dialogThread); record["dialogVisibleAtEnd"] = IsWindowVisible(dialog);
        if ((bool)record["sameDialogAtEnd"] && (bool)record["dialogVisibleAtEnd"]) { record["filenameAtFailure"] = ReadOwnedEditText(edits[0]); throw new InvalidOperationException("Native file picker did not accept the selected fixture"); }
        return new Dictionary<string, object> { { "accepted", true }, { "pickerSequence", record["pickerSequence"] }, { "path", file }, { "productPid", product.Pid }, { "dialogHwnd", HandleText(dialog) }, { "filenameControlId", 1148 }, { "filenameReadbackExact", true }, { "submission", "native-open-button-mouse" }, { "usedNativeSendInput", true }, { "dialogClosed", true }, { "privateInvokeUsed", false } };
    }
    static Input Mouse(int x, int y, Rect desktop, uint flags) { if (desktop.right - desktop.left <= 1 || desktop.bottom - desktop.top <= 1 || x < desktop.left || x >= desktop.right || y < desktop.top || y >= desktop.bottom) throw new ArgumentException("Observed desktop and actual target point required"); return new Input { type = 0, data = new InputUnion { mouse = new MouseInput { x = (int)((long)(x - desktop.left) * 65535 / (desktop.right - desktop.left - 1)), y = (int)((long)(y - desktop.top) * 65535 / (desktop.bottom - desktop.top - 1)), flags = flags } } }; }
    static Dictionary<string, object> RectReport(Rect value) { return new Dictionary<string, object> { { "left", value.left }, { "top", value.top }, { "right", value.right }, { "bottom", value.bottom }, { "width", value.right - value.left }, { "height", value.bottom - value.top } }; }
    sealed class MainWindowCountException : InvalidOperationException { public int Count; public MainWindowCountException(int count) : base("Registered visible product main window count=" + count) { Count = count; } }
    public Dictionary<string, object> AwaitProductWindow() {
        RequireStarted();
        var request = new Dictionary<string, object> { { "startedElapsedMs", clock.ElapsedMilliseconds }, { "ok", false }, { "attempts", 0 }, { "zeroMatches", 0 } };
        lock (gate) { if (productWindowReadiness.Count >= 8) throw new InvalidOperationException("Product readiness budget exceeded"); request["requestSequence"] = productWindowReadiness.Count + 1; productWindowReadiness.Add(request); }
        long deadline = clock.ElapsedMilliseconds + 8000; Dictionary<string, object> previousMeasurement = null;
        try {
            do {
                request["attempts"] = (int)request["attempts"] + 1;
                try {
                    var current = MeasureProductSnapshot(); request["lastMeasurement"] = current;
                    if (previousMeasurement != null && SameMeasuredWindowState(previousMeasurement, current)) {
                        request["ok"] = true;
                        current["readiness"] = new Dictionary<string, object> { { "attempts", request["attempts"] }, { "zeroMatches", request["zeroMatches"] }, { "elapsedMs", clock.ElapsedMilliseconds - (long)request["startedElapsedMs"] }, { "stableSamples", 2 } };
                        return StoreMeasurement(current);
                    }
                    previousMeasurement = current;
                } catch (MainWindowCountException error) { request["lastWindowCount"] = error.Count; if (error.Count != 0) throw; request["zeroMatches"] = (int)request["zeroMatches"] + 1; previousMeasurement = null; }
                Thread.Sleep(25);
            } while (clock.ElapsedMilliseconds < deadline);
            throw new InvalidOperationException("Registered main window did not become uniquely visible within readiness deadline");
        } catch (Exception error) { request["error"] = Bounded(error.Message, 512); throw; }
        finally { request["finishedElapsedMs"] = clock.ElapsedMilliseconds; }
    }
    Dictionary<string, object> StoreMeasurement(Dictionary<string, object> result) {
        lock (gate) { if (productMeasurements.Count >= 64) { MarkOverflow("product-measurement-budget"); throw new InvalidOperationException("Product measurement budget exceeded"); } result["measurementSequence"] = productMeasurements.Count + 1; result["measurementElapsedMs"] = clock.ElapsedMilliseconds; productMeasurements.Add(result); }
        return result;
    }
    public Dictionary<string, object> MeasureProduct() {
        RequireStarted();
        return StoreMeasurement(MeasureProductSnapshot());
    }
    Dictionary<string, object> MeasureProductSnapshot() {
        RequireStarted(); CurrentDesktop();
        Product product; lock (gate) { if (products.Count == 0) throw new InvalidOperationException("No tracked product"); product = products[products.Count - 1]; }
        if (WaitForSingleObject(product.Handle, 0) != 258) throw new InvalidOperationException("Tracked product already exited");
        var matches = new List<IntPtr>();
        Check(EnumWindows((hwnd, ignored) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pid == product.Pid && IsWindowVisible(hwnd) && GetWindow(hwnd, 4) == IntPtr.Zero && ClassName(hwnd) == "Tauri Window") matches.Add(hwnd); return true; }, IntPtr.Zero), "Find registered product main window");
        if (matches.Count != 1) throw new MainWindowCountException(matches.Count);
        IntPtr window = matches[0];
        ProcessFact actual = ProcessIdentity(product.Pid, 0);
        if (actual == null || actual.Creation != product.Creation || !String.Equals(actual.Image, product.Image, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Product window process identity changed");
        uint dpi = GetDpiForWindow(window); IntPtr awarenessContext = GetWindowDpiAwarenessContext(window);
        int awareness = GetAwarenessFromDpiAwarenessContext(awarenessContext), observerAwareness = GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
        if (dpi == 0 || awarenessContext == IntPtr.Zero || awareness < 0 || observerAwareness < 0) throw new InvalidOperationException("Product window DPI or awareness could not be observed");
        Rect rect, client; Check(GetWindowRect(window, out rect), "Read product window bounds"); Check(GetClientRect(window, out client), "Read product client bounds");
        var first = new Point { x = client.left, y = client.top }; var last = new Point { x = client.right, y = client.bottom };
        Check(ClientToScreen(window, ref first) && ClientToScreen(window, ref last), "Read client bounds in observer screen coordinates");
        if (rect.right <= rect.left || rect.bottom <= rect.top || client.right <= client.left || client.bottom <= client.top) throw new InvalidOperationException("Product window dimensions unavailable");
        var placement = new WindowPlacement { length = (uint)Marshal.SizeOf<WindowPlacement>() }; Check(GetWindowPlacement(window, ref placement), "Read product window placement");
        return new Dictionary<string, object> { { "observed", true }, { "pid", product.Pid }, { "creationFileTime", product.Creation.ToString() }, { "hwnd", HandleText(window) }, { "className", "Tauri Window" }, { "dpi", dpi }, { "dpiAwareness", awareness }, { "dpiAwarenessContext", HandleText(awarenessContext) }, { "observerThreadDpiAwareness", observerAwareness }, { "windowRect", RectReport(rect) }, { "clientRect", RectReport(client) }, { "clientScreenRect", RectReport(new Rect { left = first.x, top = first.y, right = last.x, bottom = last.y }) }, { "desktopRect", RectReport(DesktopRect()) }, { "maximized", IsZoomed(window) }, { "minimized", IsIconic(window) }, { "placementShowCommand", placement.show }, { "normalPlacementRect", RectReport(placement.normal) }, { "normalPlacementCoordinateSpace", "Win32 workspace coordinates; never passed to SetWindowPos" }, { "coordinateSpace", "Win32 coordinates under the reported observer thread DPI awareness" }, { "displaySettingsChanged", false } };
    }
    static bool SameMeasuredProduct(Dictionary<string, object> before, Dictionary<string, object> after) { return Equals(before["pid"], after["pid"]) && Equals(before["creationFileTime"], after["creationFileTime"]) && Equals(before["hwnd"], after["hwnd"]); }
    static bool SameMeasuredWindowState(Dictionary<string, object> before, Dictionary<string, object> after) {
        if (!SameMeasuredProduct(before, after) || !Equals(before["dpi"], after["dpi"]) || !Equals(before["maximized"], after["maximized"]) || !Equals(before["minimized"], after["minimized"])) return false;
        foreach (string field in new string[] { "windowRect", "clientRect" }) {
            var first = (Dictionary<string, object>)before[field]; var second = (Dictionary<string, object>)after[field];
            foreach (string dimension in new string[] { "left", "top", "right", "bottom", "width", "height" }) if (!Equals(first[dimension], second[dimension])) return false;
        }
        return true;
    }
    static bool ValidResizeRequest(string mode, int width, int height, int desktopWidth, int desktopHeight) { return mode == "normal" ? width >= 480 && height >= 360 && width <= desktopWidth && height <= desktopHeight && width <= 4096 && height <= 4096 : (mode == "maximize" || mode == "restore") && width == 0 && height == 0; }
    Dictionary<string, object> WaitForProductWindow(Dictionary<string, object> before, string mode, int width, int height, Dictionary<string, object> record) {
        long deadline = clock.ElapsedMilliseconds + 5000; string last = null; int stable = 0;
        do {
            Dictionary<string, object> sample = MeasureProductSnapshot(); record["lastAfter"] = sample;
            if (!SameMeasuredProduct(before, sample)) throw new InvalidOperationException("Registered product window identity changed during native operation");
            var rect = (Dictionary<string, object>)sample["windowRect"];
            bool state = !(bool)sample["minimized"] && (mode == "maximize" ? (bool)sample["maximized"] && (uint)sample["placementShowCommand"] == 3 : !(bool)sample["maximized"] && (uint)sample["placementShowCommand"] == 1);
            bool size = mode != "normal" || ((int)rect["width"] == width && (int)rect["height"] == height);
            string current = rect["left"] + ":" + rect["top"] + ":" + rect["width"] + ":" + rect["height"];
            stable = state && size ? current == last ? stable + 1 : 1 : 0;
            if (stable >= 3) return sample;
            last = current; Thread.Sleep(25);
        } while (clock.ElapsedMilliseconds < deadline);
        throw new InvalidOperationException("Registered product native window did not reach requested stable state and bounds");
    }
    public Dictionary<string, object> ResizeProduct(string mode, int width, int height) {
        RequireStarted();
        var requested = new Dictionary<string, object> { { "mode", mode } }; if (mode == "normal") { requested["width"] = width; requested["height"] = height; }
        var record = new Dictionary<string, object> { { "requested", requested }, { "nativeWindowOperation", true }, { "displaySettingsChanged", false }, { "dpiContextChanged", false }, { "ok", false }, { "startedElapsedMs", clock.ElapsedMilliseconds } };
        lock (gate) { if (productWindowOperations.Count >= 16) { MarkOverflow("product-window-operation-budget"); throw new InvalidOperationException("Product window operation budget exceeded"); } record["operationSequence"] = productWindowOperations.Count + 1; productWindowOperations.Add(record); }
        try {
            Dictionary<string, object> before = MeasureProductSnapshot(); record["before"] = before;
            var desktop = (Dictionary<string, object>)before["desktopRect"];
            if (!ValidResizeRequest(mode, width, height, (int)desktop["width"], (int)desktop["height"])) throw new ArgumentException("Closed native window mode and dimensions within the observed desktop are required");
            IntPtr window = new IntPtr(Convert.ToInt64(((string)before["hwnd"]).Substring(2), 16));
            // Both calls post work to the registered UI thread. API return
            // values establish only dispatch; measured state establishes success.
            Check(ShowWindowAsync(window, mode == "maximize" ? 3 : 9), "Post registered product show-state operation");
            if (mode == "normal") {
                WaitForProductWindow(before, "restore", 0, 0, record);
                Dictionary<string, object> verified = MeasureProductSnapshot();
                if (!SameMeasuredProduct(before, verified)) throw new InvalidOperationException("Registered HWND changed before SetWindowPos");
                Check(SetWindowPos(window, IntPtr.Zero, 0, 0, width, height, 0x4000 | 0x10 | 4 | 2), "Post registered product native resize");
            }
            record["after"] = WaitForProductWindow(before, mode, width, height, record);
            record["ok"] = true; return record;
        } catch (Exception error) { record["error"] = Bounded(error.Message, 512); throw; }
        finally { record["finishedElapsedMs"] = clock.ElapsedMilliseconds; }
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
        bool samplerJoined = processSampler == null || processSampler.Join(5000); if (!samplerJoined) AddError("Process sampler did not terminate");
        lock (gate) {
            observationStoppedAtTick = NativeTick();
            ReconcileChildShows();
            foreach (WindowLife life in windowLives) ReleaseLife(life, observationStoppedAtTick);
            var lifeRows = new List<Dictionary<string, object>>(); foreach (WindowLife life in windowLives) lifeRows.Add(life.Record());
            var tracked = new List<Dictionary<string, object>>(); foreach (Product product in products) tracked.Add(new Dictionary<string, object> { { "pid", product.Pid }, { "image", product.Image }, { "creationFileTime", product.Creation.ToString() }, { "heldProcessSignaledAtStop", WaitForSingleObject(product.Handle, 0) == 0 } });
            var processRows = new List<Dictionary<string, object>>(); foreach (ProcessFact process in processEvidence.Values) processRows.Add(new Dictionary<string, object> { { "pid", process.Pid }, { "parentPid", process.Parent }, { "creationFileTime", process.Creation.ToString() }, { "image", process.Image } });
            return new Dictionary<string, object> { { "nativeDiagnostics", nativeDiagnostics.ToArray() }, { "nativeDiagnosticsTruncated", nativeDiagnosticsTruncated }, { "schema", 1 }, { "complete", joined && samplerJoined && errors.Count == 0 && !overflow }, { "positiveControlPassed", positive != null && positive.ContainsKey("passed") && (bool)positive["passed"] }, { "context", desktopContext }, { "positiveControl", positive }, { "events", events.ToArray() }, { "processes", processRows.ToArray() }, { "trackedProducts", tracked.ToArray() }, { "productVisibleConsoleCount", visibleProductConsoles.Count }, { "unattributedVisibleConsoleCount", visibleUnknownConsoles.Count }, { "overflow", overflow }, { "overflowReasons", new List<string>(overflowReasons).ToArray() }, { "unresolvedEvents", unresolvedEvents.ToArray() }, { "retiredChildHints", retiredChildHints }, { "productMeasurements", productMeasurements.ToArray() }, { "productWindowOperations", productWindowOperations.ToArray() }, { "productWindowReadiness", productWindowReadiness.ToArray() }, { "filePickerOperations", filePickerOperations.ToArray() }, { "knownChildShowEvents", knownChildShowEvents }, { "knownWindowShowEvents", knownWindowShowEvents }, { "resolvedChildEvents", resolvedChildEvents.ToArray() }, { "observerErrors", errors.ToArray() }, { "activeProcessCacheCount", processes.Count }, { "liveWindowCacheCount", previous.Count }, { "elapsedMs", clock.ElapsedMilliseconds }, { "pollMilliseconds", 25 }, { "windowEventHookUsed", true }, { "desktopOrAclChanged", false }, { "productTerminatedByObserver", false }, { "childLifeVersion", 1 }, { "windowLifetimes", lifeRows.ToArray() }, { "childShowEvidence", childShowEvidence.ToArray() }, { "observationStoppedAtTick", observationStoppedAtTick }, { "workingGenerationPeak", workingGenerationPeak }, { "sharedRecordCount", SharedRecordCount() }, { "lifetimeArchiveVersion", 1 }, { "processArchiveVersion", 1 } };
        }
    }
    public void Dispose() { if (started && !stopping) { try { Stop(); } catch { } } lock (gate) foreach (WindowLife life in windowLives) if (life.Identity != null) { life.Identity.Dispose(); life.Identity = null; } foreach (Product product in products) if (product.Handle != IntPtr.Zero) { CloseHandle(product.Handle); product.Handle = IntPtr.Zero; } ready.Dispose(); }
}
