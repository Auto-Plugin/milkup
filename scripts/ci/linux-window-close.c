// Request the normal GTK close path; never XDestroyWindow or kill the product.
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  char *end = NULL;
  Window window = strtoul(argv[1], &end, 0);
  if (!window || !end || *end) return 2;
  unsigned long expected_pid = strtoul(argv[2], &end, 10);
  if (!expected_pid || !end || *end) return 2;
  Display *display = XOpenDisplay(NULL);
  if (!display) return 3;
  Atom actual_type; int actual_format; unsigned long count, remaining;
  unsigned char *data = NULL;
  int status = XGetWindowProperty(display, window,
      XInternAtom(display, "_NET_WM_PID", False), 0, 1, False, XA_CARDINAL,
      &actual_type, &actual_format, &count, &remaining, &data);
  int owned = status == Success && actual_type == XA_CARDINAL &&
      actual_format == 32 && count == 1 && data &&
      *(unsigned long *)data == expected_pid;
  if (data) XFree(data);
  if (!owned) { XCloseDisplay(display); return 4; }
  Atom close_atom = XInternAtom(display, "WM_DELETE_WINDOW", False);
  Atom *protocols = NULL; int number = 0, supported = 0;
  if (XGetWMProtocols(display, window, &protocols, &number)) {
    for (int i = 0; i < number; i++) if (protocols[i] == close_atom) supported = 1;
    XFree(protocols);
  }
  if (!supported) { XCloseDisplay(display); return 5; }
  XEvent event; memset(&event, 0, sizeof(event));
  event.xclient.type = ClientMessage;
  event.xclient.window = window;
  event.xclient.message_type = XInternAtom(display, "WM_PROTOCOLS", False);
  event.xclient.format = 32;
  event.xclient.data.l[0] = (long)close_atom;
  event.xclient.data.l[1] = CurrentTime;
  status = XSendEvent(display, window, False, NoEventMask, &event);
  XSync(display, False); XCloseDisplay(display);
  if (!status) return 6;
  printf("{\"window\":%lu,\"pid\":%lu,\"protocolSupported\":true,\"requestSent\":true}\n", window, expected_pid);
  return 0;
}
