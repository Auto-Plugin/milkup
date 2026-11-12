using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Test-only native input. Exact held process, live dialog/control identity, and a
// destruction hook are rechecked before every input. Never invokes application IPC.
public static class InstalledDialogInput {
    public static Dictionary<string,object> LastObservation = new Dictionary<string,object>();
    delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    delegate void EventProc(IntPtr hook, uint kind, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct Gui { public uint size,flags; public IntPtr active,focus,capture,menu,movesize,caret; public Rect caretRect; }
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wparam; public IntPtr lparam; public uint time; public Point point; public uint extra; }
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Keyboard key; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb,IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd,EnumProc cb,IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd,StringBuilder s,int n);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd,StringBuilder s,int n);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr hwnd,int id);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint tid,ref Gui info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd,uint msg,UIntPtr wparam,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr dll,EventProc cb,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool PeekMessageW(out Message msg,IntPtr hwnd,uint min,uint max,uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref Message msg);
    static void Pump() { Message msg; int count=0; while(PeekMessageW(out msg,IntPtr.Zero,0,0,1)) { if(++count>4096) throw new Exception("Native input message budget"); TranslateMessage(ref msg); DispatchMessageW(ref msg); } }
    static string Text(IntPtr h,bool cls=false) { var b=new StringBuilder(4096); if(cls)GetClassNameW(h,b,b.Capacity);else GetWindowTextW(h,b,b.Capacity);return b.ToString(); }
    static string EditText(IntPtr h) {var b=new StringBuilder(2048);UIntPtr result;Require(SendMessageTimeoutW(h,0x000D,new UIntPtr((uint)b.Capacity),b,2,1000,out result)!=IntPtr.Zero,"Bounded filename text read failed");return b.ToString();}
    static void Require(bool ok,string why) { if(!ok)throw new InvalidOperationException(why); }
    static void Send(params Input[] input) { Require(SendInput((uint)input.Length,input,Marshal.SizeOf<Input>())==input.Length,"Native input was not completely queued"); }
    static Input Key(ushort vk,bool up=false) { return new Input{type=1,data=new Union{key=new Keyboard{vk=vk,flags=up?2u:0u}}}; }
    static void Click(IntPtr h) { Rect r;Require(GetWindowRect(h,out r)&&r.right>r.left&&r.bottom>r.top,"Visible native control geometry required");Require(SetCursorPos((r.left+r.right)/2,(r.top+r.bottom)/2),"Native pointer move failed");Send(new Input{type=0,data=new Union{mouse=new Mouse{flags=2}}},new Input{type=0,data=new Union{mouse=new Mouse{flags=4}}}); }
    public static Dictionary<string,object> Submit(int pid,long birthTicks,string image,string file,string title) {
        LastObservation=new Dictionary<string,object>{{"stage","process-identity"}};
        using(var process=Process.GetProcessById(pid)) {
            // Opening the process handle keeps this exact process instance observable.
            var held=process.Handle;
            Action identity=()=> {process.Refresh();Require(!process.HasExited&&process.StartTime.ToUniversalTime().Ticks==birthTicks&&String.Equals(process.MainModule.FileName,image,StringComparison.OrdinalIgnoreCase),"Held dialog process identity changed");};
            identity();var destroyed=new HashSet<IntPtr>();
            EventProc callback=(hook,kind,hwnd,obj,child,thread,time)=> {if(obj==0&&child==0)destroyed.Add(hwnd);};
            IntPtr hook=SetWinEventHook(0x8001,0x8001,IntPtr.Zero,callback,(uint)pid,0,0);
            Require(hook!=IntPtr.Zero,"Dialog destruction observation required");
            try {
                var clock=Stopwatch.StartNew();IntPtr dialog=IntPtr.Zero;
                while(clock.ElapsedMilliseconds<15000) {
                    identity();Pump();var found=new List<IntPtr>();
                    Require(EnumWindows((h,d)=> {uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)&&Text(h,true)=="#32770"&&(title.Length==0||Text(h)==title))found.Add(h);return true;},IntPtr.Zero),"Dialog enumeration failed");
                    Require(found.Count<=1,"Ambiguous owned dialog");if(found.Count==1){dialog=found[0];break;}Thread.Sleep(10);
                }
                Require(dialog!=IntPtr.Zero,"Owned native file dialog absent");uint owner;uint tid=GetWindowThreadProcessId(dialog,out owner);
                IntPtr button=IntPtr.Zero,edit=IntPtr.Zero;object firstControls=null;int controlPolls=0;
                while(clock.ElapsedMilliseconds<15000) {
                    Pump();identity();uint currentPid;Require(!destroyed.Contains(dialog)&&GetWindowThreadProcessId(dialog,out currentPid)==tid&&currentPid==pid&&IsWindowVisible(dialog)&&Text(dialog,true)=="#32770","Original dialog changed before controls became ready");
                    var edits=new List<IntPtr>();var controls=new List<object>();
                    Require(EnumChildWindows(dialog,(h,d)=> {
                        Require(controls.Count<256,"Bounded native control inventory required");
                        var ancestors=new List<object>();bool filename=false;var a=h;
                        for(int i=0;i<6&&a!=IntPtr.Zero&&a!=dialog;i++,a=GetParent(a)) {int id=GetDlgCtrlID(a);ancestors.Add(new {hwnd=a.ToInt64(),id});if(id==1148)filename=true;}
                        string cls=Text(h,true);bool visible=IsWindowVisible(h),enabled=IsWindowEnabled(h);
                        controls.Add(new {hwnd=h.ToInt64(),cls,id=GetDlgCtrlID(h),visible,enabled,ancestors});
                        if(cls=="Edit"&&filename&&visible&&enabled)edits.Add(h);return true;
                    },IntPtr.Zero),"Filename enumeration failed");
                    button=GetDlgItem(dialog,1);controlPolls++;if(firstControls==null)firstControls=controls;
                    LastObservation=new Dictionary<string,object>{{"stage","waiting-exact-controls"},{"dialogHwnd",dialog.ToInt64()},{"pid",pid},{"tid",tid},{"controlPolls",controlPolls},{"firstControls",firstControls},{"lastControls",controls},{"filenameCandidates",edits.Count},{"acceptHwnd",button.ToInt64()},{"elapsedMs",clock.ElapsedMilliseconds}};
                    Require(edits.Count<=1,"Ambiguous native filename controls");
                    if(edits.Count==1&&button!=IntPtr.Zero&&Text(button,true)=="Button"&&IsWindowVisible(button)&&IsWindowEnabled(button)){edit=edits[0];break;}
                    Thread.Sleep(10);
                }
                Require(edit!=IntPtr.Zero,"Exact filename and acceptance controls required");
                LastObservation["stage"]="exact-controls-ready";
                Action guard=()=> {Pump();identity();uint p;Require(destroyed.Count<=1024&&!destroyed.Contains(dialog)&&!destroyed.Contains(edit)&&!destroyed.Contains(button)&&GetWindowThreadProcessId(dialog,out p)==tid&&p==pid&&IsWindowVisible(dialog)&&Text(dialog,true)=="#32770"&&GetAncestor(edit,2)==dialog&&GetAncestor(button,2)==dialog,"Original dialog/control lifetime changed");};
                guard();SetForegroundWindow(dialog);Click(edit);Thread.Sleep(20);guard();Require(GetAncestor(GetForegroundWindow(),2)==dialog,"Owned dialog must be foreground");
                Send(Key(0x11),Key(0x41),Key(0x41,true),Key(0x11,true));
                string typed="";
                foreach(char c in file) {
                    guard();var gui=new Gui{size=(uint)Marshal.SizeOf<Gui>()};Require(clock.ElapsedMilliseconds<30000&&GetGUIThreadInfo(tid,ref gui)&&gui.focus==edit&&GetAncestor(GetForegroundWindow(),2)==dialog,"Native input focus moved or deadline expired");
                    Send(new Input{type=1,data=new Union{key=new Keyboard{scan=c,flags=4}}},new Input{type=1,data=new Union{key=new Keyboard{scan=c,flags=6}}});typed+=c;
                    long until=clock.ElapsedMilliseconds+1500;while(EditText(edit)!=typed&&clock.ElapsedMilliseconds<until){Pump();Thread.Sleep(5);}Require(EditText(edit)==typed,"Exact native filename readback required");
                }
                guard();Require(EditText(edit)==file&&GetAncestor(GetForegroundWindow(),2)==dialog,"Native filename/focus changed before accept");Click(button);
                long end=clock.ElapsedMilliseconds+10000;while(clock.ElapsedMilliseconds<end){Pump();if(destroyed.Contains(dialog)||!IsWindowVisible(dialog))break;Thread.Sleep(10);}
                Require(destroyed.Contains(dialog)||!IsWindowVisible(dialog),"Native dialog did not close");
                return new Dictionary<string,object>{{"accepted",true},{"pid",pid},{"creationTicks",birthTicks.ToString()},{"image",image},{"dialogHwnd",dialog.ToInt64()},{"path",file},{"filenameReadbackExact",true},{"nativeSendInput",true},{"privateInvokeUsed",false}};
            } finally {UnhookWinEvent(hook);GC.KeepAlive(callback);GC.KeepAlive(held);}
        }
    }
}
