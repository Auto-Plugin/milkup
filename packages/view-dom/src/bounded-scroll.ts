// Leave headroom below engine-specific layout height/coordinate limits. Visible
// lines keep their actual pixel size; only the offscreen space is compressed.
export const maxVirtualContentHeight = 8_000_000

export function boundedScrollGeometry(
  lineCount: number,
  lineHeight: number,
  viewportHeight: number,
  padding = 0,
) {
  const logicalHeight = lineCount * lineHeight
  const physicalHeight = Math.min(logicalHeight, maxVirtualContentHeight)
  const logicalRange = Math.max(0, logicalHeight + padding - viewportHeight)
  const physicalRange = Math.max(0, physicalHeight + padding - viewportHeight)
  // Keep the document edges unscaled so padding, the caret and the first/last
  // viewport retain pixel precision. Compress only the offscreen middle span.
  const edge = Math.min(2048, physicalRange / 4)
  const scale =
    physicalRange > 2 * edge ? (logicalRange - 2 * edge) / (physicalRange - 2 * edge) : 1
  const toLogical = (offset: number) => {
    const value = Math.max(0, Math.min(offset, physicalRange))
    if (value <= edge) return value
    if (value >= physicalRange - edge) return logicalRange - (physicalRange - value)
    return edge + (value - edge) * scale
  }
  const toPhysical = (offset: number) => {
    const value = Math.max(0, Math.min(offset, logicalRange))
    if (value <= edge) return value
    if (value >= logicalRange - edge) return physicalRange - (logicalRange - value)
    return edge + (value - edge) / scale
  }
  return {
    compressed: logicalHeight > physicalHeight,
    physicalHeight,
    toLogical,
    toPhysical,
    spacers(fromLine: number, toLine: number, scrollTop: number) {
      const physical = Math.max(0, Math.min(scrollTop, physicalRange))
      const top = Math.max(0, physical - toLogical(physical) + (fromLine - 1) * lineHeight)
      return {
        top,
        bottom: Math.max(0, physicalHeight - top - (toLine - fromLine + 1) * lineHeight),
      }
    },
  }
}
