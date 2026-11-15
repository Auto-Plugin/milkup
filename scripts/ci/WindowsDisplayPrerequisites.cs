using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Isolated read-only topology probe. Awareness changes apply ONLY to this
// calling thread, are restored, and never stand in for an OS DPI change.
public static class WindowsDisplayPrerequisites {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct MonitorInfo {
        public uint size; public Rect monitor, work; public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string device;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct DisplayDevice {
        public uint size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key;
    }
    delegate bool MonitorProc(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorProc callback,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetMonitorInfoW(IntPtr monitor,ref MonitorInfo info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string device,uint index,ref DisplayDevice info,uint flags);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr a,IntPtr b);
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
    [DllImport("shcore.dll")] static extern int GetScaleFactorForMonitor(IntPtr monitor,out int scale);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowExW(uint exStyle,string className,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
    [DllImport("user32.dll",SetLastError=true)] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WTSQuerySessionInformationW(IntPtr server,int session,int info,out IntPtr value,out int bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr value);

    static int[] Box(Rect r) { return new[]{r.left,r.top,r.right,r.bottom}; }
    static uint WindowDpi(IntPtr monitor,Rect box,IntPtr expectedContext) {
        IntPtr window=CreateWindowExW(0x08000080,"STATIC","Milkup owned DPI preflight",0x00CF0000,box.left+8,box.top+8,160,100,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        if(window==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"Create owned DPI probe");
        try {
            if(MonitorFromWindow(window,0)!=monitor)throw new Exception("Probe did not belong to requested monitor");
            if(!AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window),expectedContext))throw new Exception("Probe window awareness was virtualized");
            uint dpi=GetDpiForWindow(window);
            if(dpi<48||dpi>768)throw new Exception("Invalid native DPI");
            return dpi;
        } finally {
            if(!DestroyWindow(window)||IsWindow(window))throw new Exception("Owned probe window cleanup failed");
        }
    }
    public static Dictionary<string,object> Capture() {
        int session=Process.GetCurrentProcess().SessionId;
        IntPtr data;int bytes;
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,16,out data,out bytes))throw new Win32Exception(Marshal.GetLastWin32Error(),"Query session protocol");
        int protocol;
        try {if(bytes<2)throw new Exception("Incomplete session protocol");protocol=(ushort)Marshal.ReadInt16(data);}finally{WTSFreeMemory(data);}
        var result=new Dictionary<string,object>{{"sessionId",session},{"activeConsoleSessionId",WTSGetActiveConsoleSessionId()},{"sessionProtocol",protocol},{"remoteSessionMetric",GetSystemMetrics(0x1000)!=0},{"systemSettingsChanged",false},{"hiddenOwnedWindowsOnly",true}};
        var pmv2=new IntPtr(-4);IntPtr before=SetThreadDpiAwarenessContext(pmv2);
        if(before==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"Set own probe thread awareness");
        try {
            if(!AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),pmv2))throw new Exception("Per-monitor V2 probe context not effective");
            result["threadPerMonitorV2"]=true;result["awareness"]=GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext());
            result["systemDpi"]=GetDpiForSystem();result["virtualBounds"]=new[]{GetSystemMetrics(76),GetSystemMetrics(77),GetSystemMetrics(78),GetSystemMetrics(79)};
            var monitors=new List<Dictionary<string,object>>();Exception callbackError=null;
            MonitorProc callback=(handle,dc,rect,arg)=>{
                try {
                    if(monitors.Count>=8)throw new Exception("Monitor evidence bound exceeded");
                    var info=new MonitorInfo{size=(uint)Marshal.SizeOf<MonitorInfo>()};
                    if(!GetMonitorInfoW(handle,ref info))throw new Win32Exception(Marshal.GetLastWin32Error(),"GetMonitorInfo");
                    uint dpi=WindowDpi(handle,info.work,pmv2);
                    int scale;int hr=GetScaleFactorForMonitor(handle,out scale);
                    if(hr!=0)throw new Exception("GetScaleFactorForMonitor HRESULT "+hr);
                    var adapter=new DisplayDevice{size=(uint)Marshal.SizeOf<DisplayDevice>()};
                    string description=null;uint adapterFlags=0;
                    for(uint n=0;n<32;n++){
                        adapter.size=(uint)Marshal.SizeOf<DisplayDevice>();
                        if(!EnumDisplayDevicesW(null,n,ref adapter,0))break;
                        if(adapter.name==info.device){description=adapter.description;adapterFlags=adapter.flags;break;}
                        if(n==31)throw new Exception("Adapter evidence bound exceeded");
                    }
                    if(description==null)throw new Exception("Active monitor adapter identity missing");
                    var displays=new List<Dictionary<string,object>>();
                    for(uint n=0;n<16;n++){
                        var display=new DisplayDevice{size=(uint)Marshal.SizeOf<DisplayDevice>()};
                        if(!EnumDisplayDevicesW(info.device,n,ref display,0))break;
                        displays.Add(new Dictionary<string,object>{{"name",display.name},{"description",display.description},{"flags",display.flags}});
                        if(n==15)throw new Exception("Display evidence bound exceeded");
                    }
                    monitors.Add(new Dictionary<string,object>{{"device",info.device},{"bounds",Box(info.monitor)},{"workArea",Box(info.work)},{"primary",(info.flags&1)!=0},{"windowDpi",dpi},{"scalePercent",scale},{"adapter",description},{"adapterFlags",adapterFlags},{"displays",displays},{"windowDestroyed",true}});
                    return true;
                }catch(Exception e){callbackError=e;return false;}
            };
            bool enumerated=EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,callback,IntPtr.Zero);
            GC.KeepAlive(callback);
            if(callbackError!=null)throw callbackError;
            if(!enumerated||monitors.Count==0)throw new Exception("No complete active topology");
            result["monitors"]=monitors;
        } finally {
            if(SetThreadDpiAwarenessContext(before)==IntPtr.Zero||!AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),before))throw new Exception("Probe thread awareness restore failed");
            result["threadAwarenessRestored"]=true;
        }
        return result;
    }
}
