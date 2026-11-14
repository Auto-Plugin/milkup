# Document render contract (SDK 0.3.3, additive to 0.3.2)

Canonical initial types follow. Existing UI renderers remain unchanged. The SDK exports identical structural types with `Sdk` prefixes; public plugins require only @milkup/plugin-sdk. Module and activation gain optional documentRenderers maps keyed by manifest declaration id. Manifest contributes.documentRenderers is an optional array of DocumentRendererDeclaration. document:read permission is required.

Every range, selection, and reference uses absolute UTF-16 offsets; from/to are half-open. source.length === to-from. Blocks describe trusted host context; unknown context always source fallback. Fence info is the bounded original info string; language matching uses its first whitespace-delimited token. A fence renderer can replace only a complete declared-language fence (exact block range); text renderers cannot intersect protectedRanges or any code/fence/unknown block. Results are sorted, nonoverlapping and fully within request. Unknown fields or invalid trees reject the result, never sanitize executable markup into accepted output.

Input: 64 Ki UTF-16 / 256 lines. Output: 256 KiB UTF-8 JSON, 4096 combined semantic/math/vector nodes, depth 64, <=128 fragments. Dimensions and coordinates finite <=8192 (coordinates may be negative), font sizes 8..72; <=1024 points per primitive, bounded in total by output quota. Accessible text/message are plain strings, at most 8192/1000 UTF-16 units respectively. Each vector point counts toward the combined 4096-node budget. Reference target must match request documentId/version; navigation separately revalidates current document/version and range. No URLs, HTML/XML strings, CSS, DOM, arbitrary attrs or commands.

One in-flight render per plugin, queue <=2. Two-second host watchdog revokes and terminates an unresponsive Worker/process, reports fixed error status and requires explicit re-enable. Cancellation sends job cancellation, ignores late results, and retains the watchdog until the remote execution acknowledges settlement; cancellation alone cannot release a CPU runaway. Runtime/realm post-await activation-generation checks plus host view document-version/render-epoch checks prevent stale mounts. Disable/switch/revoke cancel jobs and clear caches. Cache only validated immutable semantics, bounded by bytes/count; no DOM cache. Export reuses these same semantics and validators.

```ts
/** Shared, inert document presentation data. All source offsets are absolute UTF-16. */
export interface DocumentPresentationRange {
  readonly from: number
  readonly to: number
}
export interface DocumentPresentationBlock extends DocumentPresentationRange {
  readonly kind: 'text' | 'fence' | 'code' | 'unknown'
  readonly complete: boolean
  readonly info?: string
  readonly contentRanges: readonly DocumentPresentationRange[]
}
export interface DocumentPresentationRequest extends DocumentPresentationRange {
  readonly documentId: string
  readonly version: number
  readonly source: string
  readonly fromLine: number
  readonly toLine: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
  readonly contextKnown: boolean
  readonly protectedRanges: readonly DocumentPresentationRange[]
  readonly blocks: readonly DocumentPresentationBlock[]
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly theme: 'light' | 'dark'
  readonly target: 'screen' | 'export'
  readonly width: number
}
export type DocumentPresentationTone = 'foreground' | 'muted' | 'accent' | 'background' | 'border'
export type DocumentMathTag =
  | 'math'
  | 'mrow'
  | 'mi'
  | 'mn'
  | 'mo'
  | 'mtext'
  | 'mspace'
  | 'msup'
  | 'msub'
  | 'msubsup'
  | 'mfrac'
  | 'msqrt'
  | 'mroot'
  | 'mover'
  | 'munder'
  | 'munderover'
  | 'mtable'
  | 'mtr'
  | 'mtd'
  | 'mstyle'
export interface DocumentMathNode {
  readonly tag: DocumentMathTag
  readonly text?: string
  readonly children?: readonly DocumentMathNode[]
  readonly attributes?: {
    readonly scriptLevel?: number
    readonly displayStyle?: boolean
    readonly rowSpacingEm?: readonly number[]
    readonly columnSpacingEm?: readonly number[]
    readonly columnAlign?: readonly ('left' | 'center' | 'right')[]
    readonly widthEm?: number
    readonly lspaceEm?: number
    readonly rspaceEm?: number
    readonly display?: 'inline' | 'block'
    readonly mathvariant?:
      | 'normal'
      | 'bold'
      | 'italic'
      | 'bold-italic'
      | 'double-struck'
      | 'script'
      | 'fraktur'
      | 'monospace'
    readonly stretchy?: boolean
    readonly fence?: boolean
    readonly separator?: boolean
    readonly accent?: boolean
  }
}
export interface DocumentVectorStyle {
  readonly stroke?: DocumentPresentationTone
  readonly fill?: DocumentPresentationTone | 'none'
  readonly strokeWidth?: number
}
export type DocumentVectorPrimitive =
  | (DocumentVectorStyle & {
      readonly type: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly radius?: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    })
  | (DocumentVectorStyle & {
      readonly type: 'polyline' | 'polygon'
      readonly points: readonly { readonly x: number; readonly y: number }[]
    })
  | {
      readonly type: 'text'
      readonly x: number
      readonly y: number
      readonly text: string
      readonly tone?: DocumentPresentationTone
      readonly fontSize?: number
      readonly anchor?: 'start' | 'middle' | 'end'
    }
export type DocumentPresentationNode =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'group' | 'emphasis' | 'code' | 'sup' | 'sub'
      readonly children: readonly DocumentPresentationNode[]
    }
  | {
      readonly type: 'reference'
      readonly label: string
      readonly target: {
        readonly documentId: string
        readonly version: number
        readonly from: number
        readonly to: number
      }
    }
  | { readonly type: 'math'; readonly tree: DocumentMathNode }
  | {
      readonly type: 'vector'
      readonly width: number
      readonly height: number
      readonly children: readonly DocumentVectorPrimitive[]
    }
export interface DocumentPresentationFragment extends DocumentPresentationRange {
  readonly layout: 'inline' | 'block'
  readonly content: DocumentPresentationNode
  readonly accessibleText: string
  readonly status?: 'ready' | 'error'
  readonly message?: string
}
export interface DocumentPresentationResult {
  readonly fragments: readonly DocumentPresentationFragment[]
  readonly complete: boolean
}
export interface DocumentRendererDeclaration {
  readonly id: string
  readonly contexts: readonly ('text' | 'fence')[]
  readonly fenceLanguages?: readonly string[]
}
export type DocumentRenderer = (
  request: DocumentPresentationRequest,
  options: { readonly signal: AbortSignal },
) => DocumentPresentationResult | Promise<DocumentPresentationResult>
```

Background indexes: host.document.readWindow({documentId,version,fromLine,lineCount},{signal}) → exact bounded lines and text (4096 lines/128Ki UTF16). host.document.invalidatePresentation({documentId,version,rendererId}) is owner-bound and 4/s coalesced; render returns cached/partial promptly. host.ui.revealLocation({documentId,version,from,to?},{signal}) validates immediately before host navigation.

## Selection and cache clarification (host integration, SDK tarball unchanged)

The official math, diagrams, and footnotes providers return all eligible source fragments for the bounded request. They must not remove a fragment merely because request.selection touches it. The host view owns the live editing behavior: it displays original source for intersecting selections and restores the cached presentation when the selection leaves.

The frozen SDK 0.3.3 exposes selection without an output-independence requirement. Consequently, a third-party provider may legitimately vary semantic output with selection. A generic host cannot assume cross-selection cache equivalence solely from the official providers' behavior. The recommended compatible host rule is to include anchor/head in render cache and pending-job identity, and discard late results from an earlier selection. Cross-selection reuse requires an explicit future opt-in declaration or another enforceable independence contract; it cannot be inferred from a provider ID. This clarification does not change the tarball or retroactively narrow its public API.
