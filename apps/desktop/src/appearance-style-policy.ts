/** Reuse only the nonce on our static HTML style, which Tauri authorizes per response. */
export function hostStyleNonce(owner: Document): string | undefined {
  const seed = owner.getElementById('milkup-style-authority')
  const nonce = seed?.tagName === 'STYLE' ? (seed as HTMLStyleElement).nonce : ''
  if (nonce) return validateStyleNonce(nonce)
  if (owner.defaultView && '__TAURI_INTERNALS__' in owner.defaultView)
    throw new Error('桌面样式授权缺失，主题未应用。请重新打开应用。')
  return undefined
}

export function validateStyleNonce(nonce: string): string {
  if (!/^[A-Za-z0-9+/_-]{1,128}={0,2}$/.test(nonce)) throw new Error('样式授权无效，主题未应用。')
  return nonce
}

/** Only compiled theme CSS reaches this sink; no nonce or policy is persisted. */
export function applyCompiledThemeStyle(style: HTMLStyleElement, css: string): void {
  const owner = style.ownerDocument
  const nonce = hostStyleNonce(owner)
  const previous = {
    text: style.textContent,
    nonce: style.nonce ?? '',
    connected: style.isConnected,
  }
  if (nonce) style.nonce = nonce
  style.textContent = css
  if (!style.isConnected) owner.head.append(style)
  if (!style.sheet) {
    style.nonce = previous.nonce
    style.textContent = previous.text
    if (!previous.connected) style.remove()
    throw new Error('主题样式被内容安全策略阻止，未应用。')
  }
}

export function previewStyleNonce(owner: Document): string {
  const nonce = hostStyleNonce(owner)
  if (nonce) return nonce
  // Browser development has no Tauri policy. Its opaque previews still receive
  // a nonce-only style policy instead of allowing arbitrary inline styles.
  const bytes = new Uint8Array(16)
  owner.defaultView!.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
