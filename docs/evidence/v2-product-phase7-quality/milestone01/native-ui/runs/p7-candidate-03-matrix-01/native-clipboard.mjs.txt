import { spawn } from 'node:child_process'
// Own the real X11 clipboard until the caller finishes Ctrl+V. No synthetic
// ClipboardEvent or page-side clipboard injection is used.
export async function ownNativeClipboard(text) {
  const child = spawn(
    'python3',
    [
      '-c',
      `
import ctypes as c,sys
G=c.CDLL('libgtk-3.so.0');D=c.CDLL('libgdk-3.so.0')
G.gtk_init(None,None)
D.gdk_atom_intern_static_string.argtypes=[c.c_char_p];D.gdk_atom_intern_static_string.restype=c.c_void_p
G.gtk_clipboard_get.argtypes=[c.c_void_p];G.gtk_clipboard_get.restype=c.c_void_p
G.gtk_clipboard_set_text.argtypes=[c.c_void_p,c.c_char_p,c.c_int]
clip=G.gtk_clipboard_get(D.gdk_atom_intern_static_string(b'CLIPBOARD'))
G.gtk_clipboard_set_text(clip,sys.argv[1].encode('utf-8'),-1)
print('READY',flush=True)
G.gtk_main()
`,
      text,
    ],
    {
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let error = ''
  child.stderr.on('data', (chunk) => {
    error += chunk
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('GTK clipboard startup timed out: ' + error)),
        5000,
      )
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('READY')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('error', (cause) => {
        clearTimeout(timer)
        reject(cause)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(Error('GTK clipboard exited ' + code + ': ' + error))
      })
    })
    return () => child.kill('SIGTERM')
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}
