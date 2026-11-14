using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Test-only native input. Exact held process, live dialog/control identity, and a
// destruction hook are rechecked before every input. Never invokes application IPC.
public static class IsolatedPrintDialog {
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
    public static bool MatchesModernFilenameShape(string[] classes,int[] ids) {
        string[] expected={"Edit","ComboBox","FloatNotifySink","DirectUIHWND","DUIViewWndClassName"};
        if(classes.Length!=expected.Length||ids.Length!=expected.Length)return false;
        for(int i=0;i<expected.Length;i++)if(classes[i]!=expected[i]||ids[i]!=(i==0?1001:0))return false;
        return true;
    }
    static bool ModernFilename(IntPtr h,IntPtr dialog) {
        var classes=new List<string>();var ids=new List<int>();var a=h;
        for(int i=0;i<5&&a!=IntPtr.Zero&&a!=dialog;i++,a=GetParent(a)){classes.Add(Text(a,true));ids.Add(GetDlgCtrlID(a));}
        return a==dialog&&MatchesModernFilenameShape(classes.ToArray(),ids.ToArray());
    }
    static void Send(params Input[] input) { Require(SendInput((uint)input.Length,input,Marshal.SizeOf<Input>())==input.Length,"Native input was not completely queued"); }
    static Input Key(ushort vk,bool up=false) { return new Input{type=1,data=new Union{key=new Keyboard{vk=vk,flags=up?2u:0u}}}; }
    static void Click(IntPtr h) { Rect r;Require(GetWindowRect(h,out r)&&r.right>r.left&&r.bottom>r.top,"Visible native control geometry required");Require(SetCursorPos((r.left+r.right)/2,(r.top+r.bottom)/2),"Native pointer move failed");Send(new Input{type=0,data=new Union{mouse=new Mouse{flags=2}}},new Input{type=0,data=new Union{mouse=new Mouse{flags=4}}}); }

    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeoutW(IntPtr hwnd,uint msg,UIntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);
    static long Number(IntPtr h,uint msg,int index=0) {UIntPtr result;Require(SendMessageTimeoutW(h,msg,new UIntPtr((uint)index),IntPtr.Zero,2,1000,out result)!=IntPtr.Zero,"Bounded combo query failed");return unchecked((long)result.ToUInt64());}
    public static Dictionary<string,object> SubmitPrint(int pid,long birthTicks,string image,string queue,bool cancel) {
      Require(queue.StartsWith("Milkup-Isolated-")&&queue.Length==48,"Owned queue name required");
      using(var process=Process.GetProcessById(pid)) {
        var held=process.Handle;
        Action identity=()=>{process.Refresh();Require(!process.HasExited&&process.StartTime.ToUniversalTime().Ticks==birthTicks&&String.Equals(process.MainModule.FileName,image,StringComparison.OrdinalIgnoreCase),"Held print helper identity changed");};
        identity();var destroyed=new HashSet<IntPtr>();EventProc cb=(hook,kind,h,obj,child,thread,time)=>{if(obj==0&&child==0)destroyed.Add(h);};
        IntPtr hook=SetWinEventHook(0x8001,0x8001,IntPtr.Zero,cb,(uint)pid,0,0);Require(hook!=IntPtr.Zero,"Print destruction hook required");
        try {
          var clock=Stopwatch.StartNew();IntPtr dialog=IntPtr.Zero,combo=IntPtr.Zero,button=IntPtr.Zero;
          while(clock.ElapsedMilliseconds<20000) {
            Pump();identity();var dialogs=new List<IntPtr>();
            Require(EnumWindows((h,d)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)&&Text(h,true)=="#32770")dialogs.Add(h);return true;},IntPtr.Zero),"Print dialog enumeration failed");
            Require(dialogs.Count<=1,"Ambiguous owned print dialog");
            if(dialogs.Count==1){dialog=dialogs[0];break;}Thread.Sleep(10);
          }
          Require(dialog!=IntPtr.Zero,"Owned print dialog absent");uint owner;uint tid=GetWindowThreadProcessId(dialog,out owner);
          var controls=new List<object>();var candidates=new List<IntPtr>();
          Require(EnumChildWindows(dialog,(h,d)=>{Require(controls.Count<128,"Print control budget");string cls=Text(h,true);controls.Add(new{hwnd=h.ToInt64(),cls,id=GetDlgCtrlID(h),text=Text(h),visible=IsWindowVisible(h),enabled=IsWindowEnabled(h)});if(cls=="ComboBox"&&IsWindowVisible(h)&&IsWindowEnabled(h))candidates.Add(h);return true;},IntPtr.Zero),"Print controls unavailable");
          LastObservation=new Dictionary<string,object>{{"stage","controls"},{"controls",controls},{"pid",pid},{"birth",birthTicks.ToString()},{"dialog",dialog.ToInt64()}};
          Require(candidates.Count==1,"Unique native printer combo required");combo=candidates[0];button=GetDlgItem(dialog,cancel?2:1);
          Require(button!=IntPtr.Zero&&Text(button,true)=="Button"&&IsWindowVisible(button)&&IsWindowEnabled(button),"Exact print action button required");
          Action guard=()=>{Pump();identity();uint p;Require(destroyed.Count<512&&!destroyed.Contains(dialog)&&!destroyed.Contains(combo)&&!destroyed.Contains(button)&&GetWindowThreadProcessId(dialog,out p)==tid&&p==pid&&Text(dialog,true)=="#32770"&&IsWindowVisible(dialog)&&GetAncestor(combo,2)==dialog&&GetAncestor(button,2)==dialog,"Original print dialog generation changed");};
          guard();SetForegroundWindow(dialog);Click(combo);Thread.Sleep(20);guard();Require(GetAncestor(GetForegroundWindow(),2)==dialog,"Print dialog not foreground");
          long count=Number(combo,0x0146);Require(count>0&&count<=64,"Bounded printers required");int selected=-1;
          for(int i=0;i<count;i++){var b=new StringBuilder(1024);UIntPtr result;Require(Number(combo,0x0149,i)>0&&Number(combo,0x0149,i)<1024,"Printer name budget");Require(SendMessageTimeoutW(combo,0x0148,new UIntPtr((uint)i),b,2,1000,out result)!=IntPtr.Zero,"Printer item read failed");if(b.ToString()==queue){Require(selected<0,"Duplicate target queue");selected=i;}}
          Require(selected>=0,"Exact isolated queue not listed");
          Send(Key(0x24),Key(0x24,true));for(int i=0;i<selected;i++){guard();Send(Key(0x28),Key(0x28,true));}
          Send(Key(0x0D),Key(0x0D,true));Thread.Sleep(100);guard();
          Require(Number(combo,0x0147)==selected&&EditText(combo)==queue,"Exact queue selection readback failed");
          // Print-to-file must remain unchecked. No printer properties/default changes.
          var toFile=GetDlgItem(dialog,0x0410);if(toFile!=IntPtr.Zero)Require(Number(toFile,0x00F0)==0,"Print to file unexpectedly selected");
          Require(GetAncestor(GetForegroundWindow(),2)==dialog,"Foreground changed before print action");guard();Click(button);
          long end=clock.ElapsedMilliseconds+10000;while(clock.ElapsedMilliseconds<end){Pump();if(destroyed.Contains(dialog)||!IsWindowVisible(dialog))break;Thread.Sleep(10);}
          Require(destroyed.Contains(dialog)||!IsWindowVisible(dialog),"Print dialog did not close");
          return new Dictionary<string,object>{{"pid",pid},{"creationTicks",birthTicks.ToString()},{"queue",queue},{"queueReadbackExact",true},{"nativeSendInput",true},{"action",cancel?"native-dialog-cancel":"native-dialog-print"},{"privateInvokeUsed",false}};
        }finally{UnhookWinEvent(hook);GC.KeepAlive(cb);GC.KeepAlive(held);}
      }
    }
}
