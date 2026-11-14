// Synthetic verifier inputs only. These are never Windows/product evidence.
export function syntheticWideInteraction(
  pngSha256 = 'e'.repeat(64),
  naturalWidth = 3200,
  naturalHeight = 160,
) {
  const sample = (natural, scrollLeft = 0) => ({
    mode: natural ? 'natural' : 'fit',
    button: {
      text: natural ? '适应宽度' : '原始尺寸',
      pressed: String(natural),
      visible: true,
      disabled: false,
    },
    image: {
      complete: true,
      sourceSha256: 'd'.repeat(64),
      naturalWidth,
      naturalHeight,
      width: natural ? naturalWidth : 800,
      height: natural ? naturalHeight : (800 * naturalHeight) / naturalWidth,
    },
    viewport: {
      clientWidth: 800,
      clientHeight: natural ? naturalHeight + 17 : (800 * naturalHeight) / naturalWidth,
      scrollWidth: natural ? naturalWidth : 800,
      scrollLeft,
      overflowX: 'auto',
    },
    outer: { clientWidth: 820, scrollWidth: 820 },
    requests: { admitted: 1, pending: 0 },
    dirty: false,
    sourceVisible: false,
  })
  return {
    status: 'passed',
    input: 'W3C-pointer-and-wheel',
    exactBytesUnchanged: true,
    pngSha256,
    naturalPngSha256: pngSha256,
    naturalScreenshot: 'gui-wide-natural-window.png',
    fit: sample(false),
    natural: sample(true),
    scrolled: sample(true, naturalWidth - 800),
    restored: sample(false),
  }
}

export const syntheticRapidScroll = () => ({
  input: 'W3C-wheel-burst',
  deltas: [...Array(6).fill(-1800), ...Array(6).fill(1800), ...Array(6).fill(-1800)],
  durationPerActionMs: 35,
  elapsedMs: 700,
  observed: {
    trustedWheels: 18,
    untrustedWheels: 0,
    overflow: false,
    height: 600,
    positions: [1000, 0, 1000, 0],
  },
})
