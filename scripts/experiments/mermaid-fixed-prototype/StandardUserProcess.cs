// Test-only supervisor. No credential text reaches logs, files or command lines.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using System.Threading;

public static class StandardUserProcess
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public uint cb; public string reserved, desktop, title;
        public uint x,y,width,height,xChars,yChars,fill,flags;
        public ushort show,reservedSize; public IntPtr reservedBytes,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long processTime,jobTime; public uint flags;
        public UIntPtr minWorking,maxWorking; public uint activeLimit;
        public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits basic; public IoCounters io;
        public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long user,kernel,periodUser,periodKernel;
        public uint faults,total,active,terminated;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Luid { public uint low; public int high; }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool CreateProcessWithLogonW(string user,string domain,IntPtr password,uint logon,
        string application,StringBuilder command,uint flags,IntPtr environment,string directory,
        ref Startup startup,out ProcessInfo process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,IntPtr name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimits value,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting value,uint size,IntPtr returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,uint size,out uint needed);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertSidToStringSidW(IntPtr sid,out IntPtr text);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool LookupPrivilegeValueW(string system,string name,out Luid value);
    [DllImport("userenv.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeleteProfileW(string sid,string path,string computer);

    static void Check(bool ok,string operation) {
        if (!ok) {
            int error=Marshal.GetLastWin32Error();
            throw new Win32Exception(error,operation+" (Win32 "+error+")");
        }
    }
    static string Sid(IntPtr pointer) {
        IntPtr text=IntPtr.Zero;
        Check(ConvertSidToStringSidW(pointer,out text),"Read token SID");
        try { return Marshal.PtrToStringUni(text); } finally { LocalFree(text); }
    }
    static IntPtr TokenData(IntPtr token,int kind) {
        uint size;
        GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
        if (size<4 || size>1048576) throw new InvalidOperationException("Token information size rejected");
        IntPtr data=Marshal.AllocHGlobal((int)size);
        try { Check(GetTokenInformation(token,kind,data,size,out size),"Read token information"); return data; }
        catch { Marshal.FreeHGlobal(data); throw; }
    }
    static int Scalar(IntPtr token,int kind) {
        IntPtr data=TokenData(token,kind);
        try { return Marshal.ReadInt32(data); } finally { Marshal.FreeHGlobal(data); }
    }
    static Dictionary<string,object> Token(IntPtr process) {
        IntPtr token;
        Check(OpenProcessToken(process,8,out token),"Open suspended process token for query");
        try {
            string sid;
            IntPtr data=TokenData(token,1);
            try { sid=Sid(Marshal.ReadIntPtr(data)); } finally { Marshal.FreeHGlobal(data); }
            bool admin=false,debug=false;
            data=TokenData(token,2);
            try {
                int count=Marshal.ReadInt32(data), offset=IntPtr.Size==8?8:4, stride=IntPtr.Size==8?16:8;
                for(int i=0;i<count;i++) if(Sid(Marshal.ReadIntPtr(data,offset+i*stride))=="S-1-5-32-544") admin=true;
            } finally { Marshal.FreeHGlobal(data); }
            Luid debugId;
            Check(LookupPrivilegeValueW(null,"SeDebugPrivilege",out debugId),"Resolve privilege identifier only");
            data=TokenData(token,3);
            try {
                int count=Marshal.ReadInt32(data);
                for(int i=0;i<count;i++) {
                    int offset=4+i*12;
                    if(unchecked((uint)Marshal.ReadInt32(data,offset))==debugId.low && Marshal.ReadInt32(data,offset+4)==debugId.high) debug=true;
                }
            } finally { Marshal.FreeHGlobal(data); }
            bool elevated=Scalar(token,20)!=0;
            int elevationType=Scalar(token,18);
            return new Dictionary<string,object> {
                {"sid",sid},{"elevated",elevated},{"elevationType",elevationType},
                {"administratorsGroupPresentIncludingDenyOnly",admin},{"seDebugPrivilegePresent",debug},
                {"standardUser",!elevated && !admin && !debug && elevationType==1}
            };
        } finally { CloseHandle(token); }
    }
    static uint Active(IntPtr job) {
        Accounting accounting;
        Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf<Accounting>(),IntPtr.Zero),"Query owned supervisor Job");
        return accounting.active;
    }
    public static Dictionary<string,object> Run(string user,SecureString secret,string expectedSid,
        string application,string arguments,string directory,string[] environment,uint timeoutMs) {
        var audit=new Dictionary<string,object> {
            {"success",false},{"resumed",false},{"jobAssigned",false},{"jobEmpty",false},
            {"inheritedParentEnvironment",false},{"existingDesktopAclChanged",false}
        };
        var cleanup=new List<string>();
        IntPtr job=IntPtr.Zero,password=IntPtr.Zero,env=IntPtr.Zero;
        ProcessInfo process=default(ProcessInfo);
        bool assigned=false;
        try {
            if(application.IndexOf('"')>=0 || directory.IndexOf('"')>=0) throw new ArgumentException("Quoted path rejected");
            var command=new StringBuilder("\""+application+"\" "+arguments);
            if(command.Length>=1024) throw new ArgumentException("Native command length rejected");
            job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);
            Check(job!=IntPtr.Zero,"Create private supervisor Job");
            var limits=new ExtendedLimits(); limits.basic.flags=0x2000;
            Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf<ExtendedLimits>()),"Set kill-on-close Job");
            Array.Sort(environment,StringComparer.OrdinalIgnoreCase);
            env=Marshal.StringToHGlobalUni(String.Join("\0",environment)+"\0\0");
            var startup=new Startup(); startup.cb=(uint)Marshal.SizeOf<Startup>();
            // Use only the existing desktop permissions. Failure is a blocker;
            // never modify WinSta0/default DACLs or request interactive elevation.
            password=Marshal.SecureStringToGlobalAllocUnicode(secret);
            try {
                Check(CreateProcessWithLogonW(user,".",password,1,application,command,
                    0x4|0x400|0x08000000,env,directory,ref startup,out process),"Create suspended temporary-user prototype");
            } finally {
                Marshal.ZeroFreeGlobalAllocUnicode(password);
                password=IntPtr.Zero;
            }
            audit["pid"]=process.pid;
            Check(AssignProcessToJobObject(job,process.process),"Assign suspended process to owned Job");
            assigned=true; audit["jobAssigned"]=true;
            bool inJob;
            Check(IsProcessInJob(process.process,job,out inJob),"Verify supervisor Job binding");
            if(!inJob) throw new InvalidOperationException("Process not in supervisor Job");
            var token=Token(process.process); audit["suspendedToken"]=token;
            if(!Equals(token["sid"],expectedSid) || !Equals(token["standardUser"],true))
                throw new InvalidOperationException("Temporary standard-user token gate rejected");
            Check(ResumeThread(process.thread)!=UInt32.MaxValue,"Resume verified standard-user prototype");
            audit["resumed"]=true;
            uint wait=WaitForSingleObject(process.process,timeoutMs);
            if(wait==258) throw new TimeoutException("Owned prototype execution timed out");
            Check(wait==0,"Wait for owned prototype process");
            uint code; Check(GetExitCodeProcess(process.process,out code),"Read prototype exit code");
            audit["exitCode"]=code;
            audit["success"]=code==0;
        } catch(Exception error) { audit["error"]=error.Message; }
        finally {
            if(password!=IntPtr.Zero) Marshal.ZeroFreeGlobalAllocUnicode(password);
            if(env!=IntPtr.Zero) Marshal.FreeHGlobal(env);
            try {
                if(assigned) {
                    Check(TerminateJobObject(job,0xE100),"Stop only owned Job descendants");
                    var deadline=DateTime.UtcNow.AddSeconds(15);
                    while(Active(job)!=0 && DateTime.UtcNow<deadline) Thread.Sleep(100);
                    audit["jobEmpty"]=Active(job)==0;
                    if(!Equals(audit["jobEmpty"],true)) cleanup.Add("Owned Job did not become empty");
                } else if(process.process!=IntPtr.Zero) {
                    Check(TerminateProcess(process.process,0xE101),"Stop owned unresumed process handle");
                    Check(WaitForSingleObject(process.process,15000)==0,"Wait unresumed owned process");
                    audit["jobEmpty"]=true;
                } else audit["jobEmpty"]=true;
            } catch(Exception error) { cleanup.Add(error.Message); }
            if(process.thread!=IntPtr.Zero && !CloseHandle(process.thread)) cleanup.Add("Close owned thread failed");
            if(process.process!=IntPtr.Zero && !CloseHandle(process.process)) cleanup.Add("Close owned process failed");
            if(job!=IntPtr.Zero && !CloseHandle(job)) cleanup.Add("Close owned Job failed");
            audit["cleanupErrors"]=cleanup.ToArray();
            if(cleanup.Count!=0) audit["success"]=false;
        }
        return audit;
    }
    public static void DeleteTemporaryProfile(string sid) {
        Check(DeleteProfileW(sid,null,null),"Delete exact temporary-user profile");
    }
}
