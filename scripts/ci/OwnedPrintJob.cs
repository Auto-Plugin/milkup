using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.RegularExpressions;

// Test-only: local, generated queue, exact captured job generation, current owner.
// OpenPrinter(NULL defaults) asks only for PRINTER_ACCESS_USE; no ACL/policy changes.
public static class OwnedPrintJob {
 public static Dictionary<string,object> Last = new Dictionary<string,object>();
 [StructLayout(LayoutKind.Sequential)] struct SystemTime { public ushort year,month,dayOfWeek,day,hour,minute,second,millisecond; }
 [StructLayout(LayoutKind.Sequential)] struct JobInfo1 {
  public uint id; public IntPtr printer,machine,user,document,datatype,statusText;
  public uint status,priority,position,totalPages,pagesPrinted; public SystemTime submitted;
 }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinterW(string name,out IntPtr printer,IntPtr defaults);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr printer);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetJobW(IntPtr printer,uint id,uint level,IntPtr data,uint bytes,out uint needed);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetJobW(IntPtr printer,uint id,uint level,IntPtr data,uint command);
 static void Require(bool ok,string reason){if(!ok)throw new InvalidOperationException(reason);}
 public static void Cancel(string queue,uint id,string document,string user,string sid,DateTime submitted) {
  Last=new Dictionary<string,object>{{"api","OpenPrinterW(PRINTER_ACCESS_USE), GetJobW(level 1), SetJobW(JOB_CONTROL_DELETE)"},{"queue",queue},{"jobId",id},{"accessMask",8},{"setJobCalled",false}};
  Require(Regex.IsMatch(queue,"^Milkup-Isolated-[a-f0-9]{32}$")&&id>0&&Regex.IsMatch(document,"^MILKUP_SPOOL_[a-f0-9]{32}$"),"Exact isolated queue/document and positive ID required");
  Require(WindowsIdentity.GetCurrent().User.Value==sid,"Current ordinary job owner required");
  IntPtr h; bool opened=OpenPrinterW(queue,out h,IntPtr.Zero);int error=opened?0:Marshal.GetLastWin32Error();Last["openWin32"]=error;if(!opened)throw new Win32Exception(error,"Open exact local queue with USE access");
  try {
   uint needed;bool queried=GetJobW(h,id,1,IntPtr.Zero,0,out needed);error=queried?0:Marshal.GetLastWin32Error();
   Require(!queried&&error==122&&needed>0&&needed<=65536,"Bounded native job evidence required");
   IntPtr buffer=Marshal.AllocHGlobal((int)needed);
   try {
    queried=GetJobW(h,id,1,buffer,needed,out needed);error=queried?0:Marshal.GetLastWin32Error();Last["getWin32"]=error;if(!queried)throw new Win32Exception(error,"Get exact job");
    JobInfo1 j=Marshal.PtrToStructure<JobInfo1>(buffer);
    string actualQueue=Marshal.PtrToStringUni(j.printer),actualUser=Marshal.PtrToStringUni(j.user),actualDocument=Marshal.PtrToStringUni(j.document);
    var t=j.submitted;var actualTime=new DateTime(t.year,t.month,t.day,t.hour,t.minute,t.second,t.millisecond,DateTimeKind.Utc);
    string actualSid=((SecurityIdentifier)new NTAccount(actualUser).Translate(typeof(SecurityIdentifier))).Value;
    Last["job"]=new Dictionary<string,object>{{"id",j.id},{"queue",actualQueue},{"user",actualUser},{"ownerSid",actualSid},{"document",actualDocument},{"submittedUtc",actualTime.ToString("o")},{"status",j.status}};
    Require(j.id==id&&actualQueue==queue&&actualUser==user&&actualDocument==document&&actualSid==sid&&actualTime==submitted.ToUniversalTime(),"Exact native job generation/owner changed; no cancellation");
    Last["setJobCalled"]=true;bool deleted=SetJobW(h,id,0,IntPtr.Zero,5);error=deleted?0:Marshal.GetLastWin32Error();Last["deleteWin32"]=error;if(!deleted)throw new Win32Exception(error,"Delete exact owned job");
   } finally {Marshal.FreeHGlobal(buffer);}
  } finally {bool closed=ClosePrinter(h);Last["handleClosed"]=closed;}
 }
}
