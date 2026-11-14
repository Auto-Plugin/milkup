"""Real XTest input and read-only state polling; no WebDriver or DOM edits."""
import ctypes
import json
import os
import time
import urllib.request


class XTest:
    def __init__(self, window):
        self.x = ctypes.CDLL('libX11.so.6')
        self.t = ctypes.CDLL('libXtst.so.6')
        self.x.XOpenDisplay.restype = ctypes.c_void_p
        self.x.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.x.XStringToKeysym.restype = ctypes.c_ulong
        self.x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        self.x.XFlush.argtypes = [ctypes.c_void_p]
        self.x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.t.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        self.t.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.display = self.x.XOpenDisplay(None)
        assert self.display
        self.x.XSetInputFocus(self.display, int(window, 16), 2, 0)
        self.x.XFlush(self.display)

    def chord(self, *keys, delay=0.025):
        codes = [self.x.XKeysymToKeycode(self.display, self.x.XStringToKeysym(key.encode())) for key in keys]
        assert all(codes), keys
        for code in codes:
            self.t.XTestFakeKeyEvent(self.display, code, 1, 0)
        for code in reversed(codes):
            self.t.XTestFakeKeyEvent(self.display, code, 0, 0)
        self.x.XFlush(self.display)
        if delay:
            time.sleep(delay)

    def key(self, key, **kwargs):
        self.chord(key, **kwargs)

    def shortcut(self, key, **kwargs):
        self.chord('Control_L', key, **kwargs)

    def move(self, x, y):
        self.t.XTestFakeMotionEvent(self.display, -1, round(x), round(y), 0)
        self.x.XFlush(self.display)

    def button(self, number, down, delay=.03):
        self.t.XTestFakeButtonEvent(self.display, number, int(down), 0)
        self.x.XFlush(self.display)
        if delay: time.sleep(delay)

    def click(self, x, y):
        self.move(x, y)
        self.button(1, True)
        self.button(1, False)

    def close(self):
        self.x.XCloseDisplay(self.display)

    def barrier(self):
        # A server flush is not a WebKit event barrier. Wait until a harmless
        # sentinel reaches the app before checking that its edit queue is idle.
        sent = int(time.time() * 1000)
        self.key('F8', delay=0)
        start = time.monotonic()
        while time.monotonic() - start < 15:
            current = observation()
            if any(e.get('key') == 'F8' and e['wall'] >= sent for e in current['events']):
                return current['state']
            time.sleep(.05)
        raise AssertionError('XTest event delivery barrier timed out')


def observation():
    with urllib.request.urlopen('http://127.0.0.1:1420/__milkup_native_observation', timeout=3) as response:
        return json.load(response)


def until(predicate, label, timeout=15):
    start = time.monotonic()
    last = None
    while time.monotonic() - start < timeout:
        last = observation()['state']
        if last and predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(f'{label}: {last}')


def idle(path):
    return until(lambda s: s.get('path') == str(path) and s['loading'] == 'ready'
                 and not s['saving'] and not s['pending'] and s['editable'], 'editor idle')
