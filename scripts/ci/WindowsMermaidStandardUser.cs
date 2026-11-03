// Test-only outer coordinator and read-only interactive-desktop observation.
// This code does not change token privileges, UAC, desktop/object ACLs or Runtime.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public static class WindowsMermaidStandardUser
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo {
        public uint cb; public string reserved, desktop, title;
        public uint x, y, width, height, xChars, yChars, fill, flags;
        public ushort show, reservedSize; public IntPtr reservedBytes, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorking, maxWorking; public uint activeLimit;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long user, kernel, periodUser, periodKernel;
        public uint faults, total, active, terminated;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Luid { public uint low; public int high; }
    [StructLayout(LayoutKind.Sequential)]
    struct UserObjectFlags { public int inherit, reserved; public uint flags; }
    [StructLayout(LayoutKind.Sequential)]
    struct WtsProcess { public uint session, pid; public IntPtr name, sid; }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessWithLogonW(string user, string domain, IntPtr password, uint logon,
        string application, StringBuilder command, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits value, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ProcessIdToSessionId(uint pid, out uint session);
    [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WTSEnumerateProcessesW(IntPtr server, uint reserved, uint version, out IntPtr records, out uint count);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr text);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValueW(string system, string name, out Luid value);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool DeleteProfileW(string sid, string path, string computer);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetUserObjectInformationW(IntPtr handle, int kind, IntPtr data, uint size, out uint needed);

    static void Check(bool ok, string operation) {
        if (!ok) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, operation + " (Win32 " + error + ")");
        }
    }
    static string Sid(IntPtr pointer) {
        IntPtr text;
        Check(ConvertSidToStringSidW(pointer, out text), "Read token SID");
        try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    }
    sealed class TokenBuffer : IDisposable {
        public readonly IntPtr Data;
        public readonly uint Size;
        public TokenBuffer(IntPtr token, int kind) {
            uint size;
            GetTokenInformation(token, kind, IntPtr.Zero, 0, out size);
            if (size < 4 || size > 1048576) throw new InvalidOperationException("Token buffer budget rejected");
            Data = Marshal.AllocHGlobal((int)size);
            try {
                uint returned;
                Check(GetTokenInformation(token, kind, Data, size, out returned), "Read token information");
                if (returned > size || returned < 4) throw new InvalidOperationException("Token buffer length mismatch");
                Size = returned;
            } catch { Marshal.FreeHGlobal(Data); throw; }
        }
        public void Dispose() { Marshal.FreeHGlobal(Data); }
    }
    static int Scalar(IntPtr token, int kind) {
        using (var data = new TokenBuffer(token, kind)) {
            if (data.Size != 4) throw new InvalidOperationException("Unexpected token scalar size");
            return Marshal.ReadInt32(data.Data);
        }
    }
    static Dictionary<string, object> Token(IntPtr process) {
        IntPtr token;
        Check(OpenProcessToken(process, 8, out token), "Open process token for query only");
        try {
            string sid;
            using (var data = new TokenBuffer(token, 1)) {
                if (data.Size < IntPtr.Size) throw new InvalidOperationException("Missing token user");
                sid = Sid(Marshal.ReadIntPtr(data.Data));
            }
            bool admin = false, debug = false;
            using (var data = new TokenBuffer(token, 2)) {
                int count = Marshal.ReadInt32(data.Data), offset = IntPtr.Size == 8 ? 8 : 4;
                int stride = IntPtr.Size == 8 ? 16 : 8;
                if (count < 0 || (long)offset + (long)count * stride > data.Size)
                    throw new InvalidOperationException("Token group extent rejected");
                for (int i = 0; i < count; i++)
                    if (Sid(Marshal.ReadIntPtr(data.Data, offset + i * stride)) == "S-1-5-32-544") admin = true;
            }
            Luid debugId;
            Check(LookupPrivilegeValueW(null, "SeDebugPrivilege", out debugId), "Resolve debug privilege identifier without adjustment");
            using (var data = new TokenBuffer(token, 3)) {
                int count = Marshal.ReadInt32(data.Data);
                if (count < 0 || 4L + (long)count * 12 > data.Size)
                    throw new InvalidOperationException("Token privilege extent rejected");
                for (int i = 0; i < count; i++) {
                    int offset = 4 + i * 12;
                    if (unchecked((uint)Marshal.ReadInt32(data.Data, offset)) == debugId.low &&
                        Marshal.ReadInt32(data.Data, offset + 4) == debugId.high) debug = true;
                }
            }
            bool elevated = Scalar(token, 20) != 0;
            int elevationType = Scalar(token, 18);
            return new Dictionary<string, object> {
                { "sid", sid }, { "elevated", elevated }, { "elevationType", elevationType },
                { "sessionId", Scalar(token, 12) },
                { "administratorsGroupPresentIncludingDenyOnly", admin },
                { "seDebugPrivilegePresent", debug },
                { "pureStandardUser", !elevated && !admin && !debug && elevationType == 1 }
            };
        } finally { CloseHandle(token); }
    }
    static string ObjectName(IntPtr handle) {
        uint needed;
        GetUserObjectInformationW(handle, 2, IntPtr.Zero, 0, out needed);
        if (needed < 2 || needed > 16384) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot size desktop/window-station name");
        IntPtr data = Marshal.AllocHGlobal((int)needed);
        try {
            Check(GetUserObjectInformationW(handle, 2, data, needed, out needed), "Observe desktop/window-station name");
            return Marshal.PtrToStringUni(data);
        } finally { Marshal.FreeHGlobal(data); }
    }
    static uint WindowStationFlags(IntPtr handle) {
        int size = Marshal.SizeOf<UserObjectFlags>();
        IntPtr data = Marshal.AllocHGlobal(size);
        try {
            uint needed;
            Check(GetUserObjectInformationW(handle, 1, data, (uint)size, out needed), "Observe window-station flags");
            if (needed > size) throw new InvalidOperationException("Unexpected window-station flags size");
            return Marshal.PtrToStructure<UserObjectFlags>(data).flags;
        } finally { Marshal.FreeHGlobal(data); }
    }
    public static Dictionary<string, object> ObserveCurrentContext() {
        var result = new Dictionary<string, object> {
            { "pid", GetCurrentProcessId() }, { "existingDesktopAclChanged", false },
            { "privilegesAdjusted", false }, { "desktopEligible", false }
        };
        var reasons = new List<string>();
        try {
            result["token"] = Token(GetCurrentProcess());
            uint session;
            Check(ProcessIdToSessionId(GetCurrentProcessId(), out session), "Observe process session");
            result["sessionId"] = session;
            result["activeConsoleSessionId"] = WTSGetActiveConsoleSessionId();
            if (session == 0) reasons.Add("The process is in non-interactive session zero");
            IntPtr station = GetProcessWindowStation();
            Check(station != IntPtr.Zero, "Observe current window station");
            string stationName = ObjectName(station);
            uint flags = WindowStationFlags(station);
            result["windowStation"] = stationName;
            result["windowStationFlags"] = flags;
            result["windowStationVisible"] = (flags & 1) != 0;
            if ((flags & 1) == 0 || !String.Equals(stationName, "WinSta0", StringComparison.OrdinalIgnoreCase))
                reasons.Add("Current window station does not expose the interactive display");
            IntPtr desktop = GetThreadDesktop(GetCurrentThreadId());
            Check(desktop != IntPtr.Zero, "Observe current thread desktop");
            string threadDesktop = ObjectName(desktop);
            result["threadDesktop"] = threadDesktop;
            // Read-only access. No SwitchDesktop, SetThreadDesktop, ACE, hook or
            // desktop creation is attempted when this access is unavailable.
            IntPtr input = OpenInputDesktop(0, false, 0x0001);
            result["inputDesktopOpened"] = input != IntPtr.Zero;
            if (input == IntPtr.Zero) {
                result["inputDesktopWin32Error"] = Marshal.GetLastWin32Error();
                reasons.Add("OpenInputDesktop(DESKTOP_READOBJECTS) failed under existing permissions");
            } else {
                try {
                    string inputDesktop = ObjectName(input);
                    result["inputDesktop"] = inputDesktop;
                    bool same = String.Equals(threadDesktop, inputDesktop, StringComparison.Ordinal);
                    result["sameInputDesktop"] = same;
                    if (!same) reasons.Add("Thread desktop is not the current input desktop");
                } finally { Check(CloseDesktop(input), "Close read-only input desktop handle"); }
            }
        } catch (Exception error) { reasons.Add(error.Message); }
        result["blockedReasons"] = reasons.ToArray();
        result["desktopEligible"] = reasons.Count == 0;
        return result;
    }
    public static Dictionary<string, object>[] ObserveProcesses(uint[] pids) {
        if (pids == null || pids.Length == 0 || pids.Length > 8) throw new ArgumentException("Process observation budget rejected");
        var observations = new List<Dictionary<string, object>>();
        foreach (uint pid in pids) {
            var record = new Dictionary<string, object> { { "pid", pid }, { "readOnly", true } };
            IntPtr process = IntPtr.Zero;
            try {
                process = OpenProcess(0x1000, false, pid); // QUERY_LIMITED_INFORMATION only.
                Check(process != IntPtr.Zero, "Open exact process for identity observation");
                long creation, exit, kernel, user;
                Check(GetProcessTimes(process, out creation, out exit, out kernel, out user), "Observe held process creation time");
                record["creationFileTime"] = creation.ToString(System.Globalization.CultureInfo.InvariantCulture);
                record["creationUtc"] = DateTime.FromFileTimeUtc(creation).ToString("o");
                uint count = 32768;
                var image = new StringBuilder((int)count);
                Check(QueryFullProcessImageNameW(process, 0, image, ref count), "Observe held process image");
                record["image"] = image.ToString();
                record["token"] = Token(process);
                uint code;
                Check(GetExitCodeProcess(process, out code), "Observe held process liveness");
                record["stillActive"] = code == 259;
            } catch (Exception error) { record["error"] = error.Message; }
            finally { if (process != IntPtr.Zero) CloseHandle(process); }
            observations.Add(record);
        }
        return observations.ToArray();
    }
    static uint Active(IntPtr job) {
        Accounting value;
        Check(QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero), "Query exact owned outer Job");
        return value.active;
    }
    static string QueryProcessSid(uint pid) {
        IntPtr process = IntPtr.Zero, token = IntPtr.Zero;
        try {
            process = OpenProcess(0x1000, false, pid); // QUERY_LIMITED_INFORMATION only.
            Check(process != IntPtr.Zero, "Query missing process-owner SID");
            Check(OpenProcessToken(process, 8, out token), "Open process token for SID query only");
            using (var data = new TokenBuffer(token, 1)) {
                if (data.Size < IntPtr.Size) throw new InvalidOperationException("Missing token user");
                return Sid(Marshal.ReadIntPtr(data.Data));
            }
        } finally {
            if (token != IntPtr.Zero) CloseHandle(token);
            if (process != IntPtr.Zero) CloseHandle(process);
        }
    }
    static string ResolveProcessSid(uint pid, string snapshotSid, Func<uint, string> query) {
        if (!String.IsNullOrEmpty(snapshotSid)) return snapshotSid;
        if (pid == 0 || pid == 4) return null;
        string observedSid = query(pid);
        if (String.IsNullOrEmpty(observedSid)) throw new InvalidOperationException("Process-owner SID query returned no identity");
        return observedSid;
    }
    public static Dictionary<string, object> ObserveExactSidProcesses(string expectedSid) {
        if (!System.Text.RegularExpressions.Regex.IsMatch(expectedSid, @"^S-1-5-21-\d+-\d+-\d+-\d+$"))
            throw new ArgumentException("Expected exact temporary local-account SID");
        var records = new List<Dictionary<string, object>>();
        var errors = new List<string>();
        var result = new Dictionary<string, object> {
            { "sid", expectedSid }, { "readOnly", true }, { "complete", false },
            { "recordLimit", 64 }, { "kernelEntriesWithoutSid", 0 }
        };
        IntPtr memory = IntPtr.Zero;
        try {
            uint count;
            Check(WTSEnumerateProcessesW(IntPtr.Zero, 0, 1, out memory, out count), "Observe local process-owner SID snapshot");
            if (count > 4096) throw new InvalidOperationException("Local process snapshot exceeds observation budget");
            int stride = Marshal.SizeOf<WtsProcess>();
            int matchingEntries = 0;
            for (int index = 0; index < count; index++) {
                var entry = Marshal.PtrToStructure<WtsProcess>(IntPtr.Add(memory, index * stride));
                string ownerSid;
                try {
                    ownerSid = ResolveProcessSid(entry.pid, entry.sid == IntPtr.Zero ? null : Sid(entry.sid), QueryProcessSid);
                } catch (Exception error) {
                    errors.Add("PID " + entry.pid + " owner SID remains unconfirmed: " + error.Message);
                    continue;
                }
                if (ownerSid == null) {
                    result["kernelEntriesWithoutSid"] = (int)result["kernelEntriesWithoutSid"] + 1;
                    continue;
                }
                if (!String.Equals(ownerSid, expectedSid, StringComparison.Ordinal)) continue;
                if (++matchingEntries > 64) throw new InvalidOperationException("Exact-SID process observation exceeds 64-record budget");
                var record = ObserveProcesses(new[] { entry.pid })[0];
                object observedToken;
                var token = record.TryGetValue("token", out observedToken) ? observedToken as Dictionary<string, object> : null;
                if (token == null || !Equals(token["sid"], expectedSid) || Convert.ToInt64(token["sessionId"]) != entry.session) {
                    // Do not retain a replacement process belonging to another SID.
                    errors.Add("Exact-SID PID " + entry.pid + " identity could not be confirmed against its snapshot");
                    continue;
                }
                record["enumeratedSid"] = expectedSid;
                record["enumeratedSessionId"] = entry.session;
                object imageValue;
                string image = record.TryGetValue("image", out imageValue) ? imageValue as string : null;
                record["imageTruncated"] = image != null && image.Length > 1024;
                if (image != null) record["image"] = image.Substring(0, Math.Min(image.Length, 1024));
                string name = Marshal.PtrToStringUni(entry.name);
                record["enumeratedImageTruncated"] = name != null && name.Length > 256;
                record["enumeratedImage"] = name == null ? null : name.Substring(0, Math.Min(name.Length, 256));
                records.Add(record);
            }
            result["complete"] = errors.Count == 0;
        } catch (Exception error) { errors.Add(error.Message); }
        finally { if (memory != IntPtr.Zero) WTSFreeMemory(memory); }
        result["records"] = records.ToArray();
        result["matchCount"] = records.Count;
        result["errors"] = errors.ToArray();
        return result;
    }
    sealed class BoundedCapture {
        public long Bytes;
        public bool Exceeded;
        public async Task Drain(Stream source, Stream destination, CancellationToken cancellation) {
            const int limit = 2 * 1024 * 1024;
            byte[] buffer = new byte[8192];
            while (true) {
                int count = await source.ReadAsync(buffer, 0, buffer.Length, cancellation).ConfigureAwait(false);
                if (count == 0) return;
                int accepted = (int)Math.Min(count, limit - Interlocked.Read(ref Bytes));
                if (accepted > 0) {
                    await destination.WriteAsync(buffer, 0, accepted, cancellation).ConfigureAwait(false);
                    Interlocked.Add(ref Bytes, accepted);
                }
                if (accepted != count) {
                    Exceeded = true;
                    throw new IOException("Node output exceeded its two-MiB per-stream capture budget");
                }
            }
        }
    }
    // Direct same-token child launch. No shell fallback, credentials, token or
    // Job changes: this child inherits the coordinator's existing owned Job.
    // This method also runs on Unix for local process/pipe regression tests.
    public static Dictionary<string, object> RunNodeHarness(string application, string harness,
        string directory, string stdoutPath, string stderrPath, int timeoutMs) {
        if (timeoutMs < 100 || timeoutMs > 900000) throw new ArgumentException("Node deadline budget rejected");
        var audit = new Dictionary<string, object> {
            { "status", "failed" }, { "started", false }, { "exited", false },
            { "exitCode", null }, { "timedOut", false }, { "streamsDrained", false },
            { "useShellExecute", false }, { "createNoWindow", true },
            { "deadlineMs", timeoutMs }, { "captureLimitPerStream", 2097152 },
            { "forcedNodeTermination", false }, { "error", null }
        };
        var cleanup = new List<string>();
        var watch = Stopwatch.StartNew();
        var output = new BoundedCapture(); var errorOutput = new BoundedCapture();
        var cancellation = new CancellationTokenSource();
        var process = new Process();
        FileStream stdout = null, stderr = null;
        Task outputTask = null, errorTask = null;
        bool started = false;
        try {
            stdout = new FileStream(stdoutPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 8192, true);
            stderr = new FileStream(stderrPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 8192, true);
            var start = new ProcessStartInfo {
                FileName = application, WorkingDirectory = directory,
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.ArgumentList.Add(harness);
            process.StartInfo = start;
            if (!process.Start()) throw new InvalidOperationException("Direct Node launch did not return a process");
            started = true; audit["started"] = true; audit["pid"] = process.Id;
            // No inherited console stdin is needed. Closing our pipe gives Node EOF.
            process.StandardInput.Close();
            outputTask = output.Drain(process.StandardOutput.BaseStream, stdout, cancellation.Token);
            errorTask = errorOutput.Drain(process.StandardError.BaseStream, stderr, cancellation.Token);
            long exitObservedAt = -1;
            while (true) {
                if (outputTask.IsFaulted) outputTask.GetAwaiter().GetResult();
                if (errorTask.IsFaulted) errorTask.GetAwaiter().GetResult();
                if (process.WaitForExit(0)) {
                    audit["exited"] = true; audit["exitCode"] = process.ExitCode;
                    if (exitObservedAt < 0) exitObservedAt = watch.ElapsedMilliseconds;
                    if (outputTask.IsCompleted && errorTask.IsCompleted) {
                        outputTask.GetAwaiter().GetResult(); errorTask.GetAwaiter().GetResult();
                        audit["streamsDrained"] = true;
                        break;
                    }
                    if (watch.ElapsedMilliseconds - exitObservedAt >= 3000)
                        throw new TimeoutException("Node exited but its output pipes did not reach EOF within three seconds");
                }
                if (watch.ElapsedMilliseconds >= timeoutMs) {
                    audit["timedOut"] = true;
                    throw new TimeoutException("Node harness exceeded its explicit deadline");
                }
                Thread.Sleep(20);
            }
            if (process.ExitCode != 0) throw new InvalidOperationException("Node harness exited with code " + process.ExitCode);
            audit["status"] = "passed";
        } catch (Exception error) { audit["error"] = error.Message; }
        finally {
            if (started) {
                try {
                    if (!process.HasExited) {
                        audit["forcedNodeTermination"] = true;
                        // Kill only the Process instance we started and still hold.
                        // The existing outer Job owns all descendant cleanup.
                        process.Kill();
                    }
                    if (!process.WaitForExit(3000)) cleanup.Add("Exact Node process did not confirm exit");
                    else { audit["exited"] = true; audit["exitCode"] = process.ExitCode; }
                } catch (Exception error) { cleanup.Add(error.Message); }
            }
            cancellation.Cancel();
            if (started) {
                try { process.StandardOutput.BaseStream.Dispose(); } catch (Exception error) { cleanup.Add(error.Message); }
                try { process.StandardError.BaseStream.Dispose(); } catch (Exception error) { cleanup.Add(error.Message); }
            }
            if (outputTask != null && errorTask != null) {
                try {
                    if (!Task.WaitAll(new[] { outputTask, errorTask }, 1000)) cleanup.Add("Node output drain tasks exceeded cleanup budget");
                } catch (AggregateException) {
                    // The primary capture failure is already recorded above.
                    // Cancellation during failed-run cleanup is expected.
                    if (Equals(audit["status"], "passed")) cleanup.Add("Node output drain failed during cleanup");
                }
            }
            try { if (stdout != null) stdout.Dispose(); } catch (Exception error) { cleanup.Add(error.Message); }
            try { if (stderr != null) stderr.Dispose(); } catch (Exception error) { cleanup.Add(error.Message); }
            process.Dispose(); cancellation.Dispose();
            audit["stdoutBytes"] = Interlocked.Read(ref output.Bytes);
            audit["stderrBytes"] = Interlocked.Read(ref errorOutput.Bytes);
            audit["captureExceeded"] = output.Exceeded || errorOutput.Exceeded;
            audit["elapsedMs"] = watch.ElapsedMilliseconds;
            audit["cleanupErrors"] = cleanup.ToArray();
            if (cleanup.Count != 0) audit["status"] = "failed";
        }
        return audit;
    }
    public static Dictionary<string, object> Run(string user, SecureString secret, string expectedSid,
        uint expectedSession, string application, string arguments, string directory,
        string[] environment, uint timeoutMs) {
        var audit = new Dictionary<string, object> {
            { "status", "blocked" }, { "success", false }, { "resumed", false },
            { "jobAssigned", false }, { "jobEmpty", false },
            { "inheritedParentEnvironment", false }, { "existingDesktopAclChanged", false },
            { "productInnerCleanupProvedByOuterJob", false }
        };
        var cleanup = new List<string>();
        IntPtr job = IntPtr.Zero, password = IntPtr.Zero, env = IntPtr.Zero;
        ProcessInfo process = default(ProcessInfo);
        bool assigned = false, coordinatorExited = false;
        try {
            if (timeoutMs < 1000 || timeoutMs > 1200000) throw new ArgumentException("Outer deadline budget rejected");
            if (application.IndexOf('"') >= 0 || application.IndexOf('\0') >= 0 || directory.IndexOf('"') >= 0 || directory.IndexOf('\0') >= 0)
                throw new ArgumentException("Unsafe native launch path");
            var command = new StringBuilder("\"" + application + "\" " + arguments);
            if (command.Length >= 1024) throw new ArgumentException("CreateProcessWithLogonW command budget exceeded");
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
            Check(job != IntPtr.Zero, "Create outer coordinator Job");
            var limits = new ExtendedLimits();
            limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()), "Set outer Job ownership");
            Array.Sort(environment, StringComparer.OrdinalIgnoreCase);
            env = Marshal.StringToHGlobalUni(String.Join("\0", environment) + "\0\0");
            var startup = new StartupInfo(); startup.cb = (uint)Marshal.SizeOf<StartupInfo>();
            // Inherit only the existing desktop. Access denial stays blocked.
            password = Marshal.SecureStringToGlobalAllocUnicode(secret);
            try {
                Check(CreateProcessWithLogonW(user, ".", password, 1, application, command,
                    0x4 | 0x400 | 0x08000000, env, directory, ref startup, out process), "Create suspended standard-account coordinator");
            } finally {
                Marshal.ZeroFreeGlobalAllocUnicode(password); password = IntPtr.Zero;
            }
            audit["pid"] = process.pid;
            Check(AssignProcessToJobObject(job, process.process), "Bind suspended coordinator to owned outer Job");
            assigned = true; audit["jobAssigned"] = true;
            bool inJob;
            Check(IsProcessInJob(process.process, job, out inJob), "Verify exact outer Job membership");
            if (!inJob) throw new InvalidOperationException("Outer Job membership was not established");
            var token = Token(process.process); audit["suspendedToken"] = token;
            uint session;
            Check(ProcessIdToSessionId(process.pid, out session), "Observe suspended coordinator session");
            audit["sessionId"] = session;
            if (!Equals(token["sid"], expectedSid) || !Equals(token["pureStandardUser"], true) || session != expectedSession || session == 0)
                throw new InvalidOperationException("Pure-standard SID/session gate rejected the suspended coordinator");
            Check(ResumeThread(process.thread) != UInt32.MaxValue, "Resume owned standard-account coordinator");
            audit["resumed"] = true;
            uint wait = WaitForSingleObject(process.process, timeoutMs);
            if (wait == 258) { audit["status"] = "failed"; throw new TimeoutException("Owned Windows product harness exceeded its deadline"); }
            Check(wait == 0, "Wait for exact coordinator process");
            uint code;
            Check(GetExitCodeProcess(process.process, out code), "Read coordinator exit status");
            coordinatorExited = true;
            audit["exitCode"] = code;
            audit["success"] = code == 0;
            audit["status"] = code == 0 ? "passed" : code == 77 ? "blocked" : "failed";
        } catch (Exception error) { audit["error"] = error.Message; }
        finally {
            if (password != IntPtr.Zero) Marshal.ZeroFreeGlobalAllocUnicode(password);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
            try {
                if (assigned) {
                    // Give already-exiting owned descendants a bounded grace,
                    // then keep the pre-kill count. Outer kill is never a pass
                    // for the product's own same-login cleanup contract.
                    var grace = System.Diagnostics.Stopwatch.StartNew();
                    while (coordinatorExited && Active(job) != 0 && grace.ElapsedMilliseconds < 3000) Thread.Sleep(50);
                    uint beforeCleanup = Active(job);
                    audit["activeBeforeOuterCleanup"] = beforeCleanup;
                    if (coordinatorExited && Equals(audit["success"], true) && beforeCleanup != 0) {
                        audit["success"] = false; audit["status"] = "failed";
                        audit["error"] = "Product/driver descendants remained after the same-login coordinator exited";
                    }
                    Check(TerminateJobObject(job, 0xE110), "Terminate only exact outer Job descendants");
                    var deadline = System.Diagnostics.Stopwatch.StartNew();
                    while (Active(job) != 0 && deadline.ElapsedMilliseconds < 15000) Thread.Sleep(50);
                    audit["jobEmpty"] = Active(job) == 0;
                    if (!Equals(audit["jobEmpty"], true)) cleanup.Add("Outer Job did not become empty within cleanup budget");
                    if (process.process != IntPtr.Zero && WaitForSingleObject(process.process, 15000) != 0)
                        cleanup.Add("Exact coordinator process did not confirm exit");
                } else if (process.process != IntPtr.Zero) {
                    Check(TerminateProcess(process.process, 0xE111), "Stop owned unresumed coordinator");
                    Check(WaitForSingleObject(process.process, 15000) == 0, "Wait for unresumed coordinator exit");
                    audit["jobEmpty"] = true;
                } else audit["jobEmpty"] = true;
            } catch (Exception error) { cleanup.Add(error.Message); }
            if (process.thread != IntPtr.Zero && !CloseHandle(process.thread)) cleanup.Add("Close exact thread handle failed");
            if (process.process != IntPtr.Zero && !CloseHandle(process.process)) cleanup.Add("Close exact process handle failed");
            if (job != IntPtr.Zero && !CloseHandle(job)) cleanup.Add("Close outer Job handle failed");
            audit["cleanupErrors"] = cleanup.ToArray();
            if (cleanup.Count != 0) { audit["success"] = false; audit["status"] = "failed"; }
        }
        return audit;
    }
    public static void DeleteTemporaryProfile(string sid) {
        Check(DeleteProfileW(sid, null, null), "Delete only the exact temporary-account profile");
    }
}
