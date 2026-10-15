import type {
  SdkDocumentPresentationRequest as Request,
  SdkDocumentPresentationResult as Result,
  SdkDocumentPresentationNode as Node,
  SdkDocumentPresentationFragment as Fragment,
} from '@milkup/plugin-sdk'
import { FootnoteIndex } from './indexer'
const text = (value: string): Node => ({ type: 'text', text: value })
function safe(request: Request, from: number, to: number): boolean {
  return (
    from >= request.from &&
    to <= request.to &&
    to > from &&
    !request.protectedRanges.some((r) => r.from < to && r.to > from) &&
    !request.blocks.some((b) => b.kind !== 'text' && b.from < to && b.to > from)
  )
}
export function present(request: Request, index: FootnoteIndex): Result {
  if (!request.contextKnown) return { fragments: [], complete: false }
  const fragments: Fragment[] = []
  for (const ref of index.references) {
    if (fragments.length >= 128) break
    if (!safe(request, ref.from, ref.to)) continue
    const definition = index.definitions.get(ref.key)
    if (definition) {
      fragments.push({
        from: ref.from,
        to: ref.to,
        layout: 'inline',
        content: {
          type: 'sup',
          children: [
            {
              type: 'reference',
              label: String(ref.number),
              target: {
                documentId: request.documentId,
                version: request.version,
                from: definition.from,
                to: definition.to,
              },
            },
          ],
        },
        accessibleText: `脚注 ${ref.number}，${ref.key}：${definition.body.slice(0, 256)}${definition.truncated || definition.body.length > 256 ? '（摘要已截断）' : ''}`,
      })
    } else {
      const message = index.complete
        ? `脚注 ${ref.key} 未定义`
        : `脚注 ${ref.key} 尚未解析，索引未完成${index.partialReason ? '（' + index.partialReason + '）' : ''}`
      fragments.push({
        from: ref.from,
        to: ref.to,
        layout: 'inline',
        content: text(request.source.slice(ref.from - request.from, ref.to - request.from)),
        accessibleText: message,
        status: 'error',
        message,
      })
    }
  }
  for (const def of [...index.definitions.values(), ...index.duplicates]) {
    if (fragments.length >= 128) break
    if (def.from < request.from || def.to > request.to) continue
    const raw = request.source.slice(def.from - request.from, def.to - request.from),
      close = raw.indexOf(']:')
    if (close < 0) continue
    const end = def.from + close + 2
    if (!safe(request, def.from, end)) continue
    const references = index.references.filter((r) => r.key === def.key),
      number = references[0]?.number,
      duplicate = index.definitions.get(def.key) !== def
    const children: Node[] = [text(number === undefined ? `脚注 ${def.key}：` : `[${number}] `)]
    for (const [i, ref] of references.slice(0, 8).entries())
      children.push({
        type: 'reference',
        label: `返回引用 ${i + 1}`,
        target: {
          documentId: request.documentId,
          version: request.version,
          from: ref.from,
          to: ref.to,
        },
      })
    const message = duplicate
      ? `重复脚注 ${def.key}，使用首次定义`
      : references.length > 8
        ? `共 ${references.length} 处引用；显示前 8 个返回位置`
        : def.truncated
          ? '脚注摘要已截断，完整正文保留在源文中'
          : undefined
    fragments.push({
      from: def.from,
      to: end,
      layout: 'inline',
      content: { type: 'group', children },
      accessibleText: `${number === undefined ? '未引用的脚注' : `脚注 ${number}`} ${def.key}。${message ?? ''}`,
      ...(message ? { status: duplicate ? ('error' as const) : ('ready' as const), message } : {}),
    })
  }
  fragments.sort((a, b) => a.from - b.from || a.to - b.to)
  return { fragments, complete: index.complete && fragments.length < 128 }
}
