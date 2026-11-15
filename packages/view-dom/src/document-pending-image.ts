/** Host-only loading presentation. Original nodes and their layout remain intact;
 * this owns neither renderer work nor an image lease. Never accept plugin HTML. */
export class DocumentPendingImage {
  private readonly lines = new Map<
    HTMLElement,
    {
      source: HTMLSpanElement
      label?: HTMLSpanElement
      position: string
    }
  >()

  clear(): void {
    for (const [line, saved] of this.lines) this.restore(line, saved)
    this.lines.clear()
  }

  update(groups: readonly { from: number; lines: readonly HTMLElement[] }[]): void {
    const wanted = new Set(groups.flatMap((g) => [...g.lines]))
    for (const [line, saved] of this.lines) {
      if (!wanted.has(line) || saved.source.parentNode !== line) {
        this.restore(line, saved)
        this.lines.delete(line)
      }
    }
    for (const group of groups) {
      // Keep all original line heights, including wrapped code and delimiters.
      const first =
        group.lines.find((line) => line.getBoundingClientRect().height > 0) ?? group.lines[0]
      for (const line of group.lines) {
        if (this.lines.has(line)) continue
        const source = line.ownerDocument.createElement('span')
        source.dataset.presentationPendingSource = 'true'
        source.style.display = 'contents'
        source.style.visibility = 'hidden'
        source.setAttribute('aria-hidden', 'true')
        source.append(...Array.from(line.childNodes))
        const saved: { source: HTMLSpanElement; label?: HTMLSpanElement; position: string } = {
          source,
          position: line.style.position,
        }
        line.append(source)
        if (line === first) {
          const label = line.ownerDocument.createElement('span')
          label.dataset.documentPresentation = 'pending-image'
          label.dataset.presentationFrom = String(group.from)
          label.dataset.presentationPending = 'true'
          label.setAttribute('role', 'status')
          label.setAttribute('aria-live', 'polite')
          label.textContent = '正在生成图表…'
          label.style.cssText =
            'position:absolute;inset:0 auto auto 0;pointer-events:none;font:inherit;color:inherit;white-space:nowrap'
          const position = line.ownerDocument.defaultView?.getComputedStyle(line).position
          if (!position || position === 'static') line.style.position = 'relative'
          line.append(label)
          saved.label = label
        }
        this.lines.set(line, saved)
      }
    }
  }

  private restore(
    line: HTMLElement,
    saved: { source: HTMLSpanElement; label?: HTMLSpanElement; position: string },
  ): void {
    // A virtual view may already have replaced this line's children. Never
    // resurrect obsolete source nodes into a newer render.
    if (saved.source.parentNode === line)
      saved.source.replaceWith(...Array.from(saved.source.childNodes))
    saved.label?.remove()
    if (saved.label && line.style.position === 'relative') line.style.position = saved.position
  }
}
