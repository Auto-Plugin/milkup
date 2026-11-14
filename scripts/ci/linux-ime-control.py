import gi,json,os,pathlib,sys
gi.require_version('Gtk','3.0');gi.require_version('Gdk','3.0')
from gi.repository import Gtk,Gdk
out=pathlib.Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
win=Gtk.Window(title='MILKUP_IME_CONTROL');win.set_default_size(600,300)
view=Gtk.TextView();win.add(view)
def key(widget,event):
    if event.state&Gdk.ModifierType.CONTROL_MASK:
        if event.keyval==Gdk.KEY_s:
            buf=view.get_buffer();(out/'control.txt').write_text(buf.get_text(*buf.get_bounds(),True));return True
        if event.keyval==Gdk.KEY_q:win.destroy();return True
    return False
win.connect('key-press-event',key);win.connect('destroy',Gtk.main_quit)
win.show_all();view.grab_focus();Gtk.main()
