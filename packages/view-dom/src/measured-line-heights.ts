// Bounded numeric geometry cache; no document text or DOM is retained.
export class MeasuredLineHeights {
  private readonly values = new Map<number, number>()
  clear(): void {
    this.values.clear()
  }
  set(line: number, height: number): void {
    this.values.delete(line)
    this.values.set(line, height)
    while (this.values.size > 2048) this.values.delete(this.values.keys().next().value!)
  }
  top(line: number, base: number): number {
    let top = (line - 1) * base
    for (const [number, height] of this.values) if (number < line) top += height - base
    return top
  }
  lineAt(top: number, count: number, base: number): number {
    let low = 1,
      high = count
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (this.top(mid, base) <= top) low = mid
      else high = mid - 1
    }
    return low
  }
}
