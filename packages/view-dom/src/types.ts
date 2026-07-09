import type { EditorState, Line, TextRange, Transaction } from '@milkup/core'
import type { AssetProvider } from '@milkup/assets'

export type ViewMode = 'source' | 'live'

export interface Decoration extends TextRange {
  readonly className?: string
  readonly attributes?: Readonly<Record<string, string>>
}

export interface BlockView {
  readonly from: number
  readonly to: number
  readonly dom: HTMLElement
  update?(state: EditorState): boolean
  destroy?(): void
}

export interface ViewUpdate {
  readonly view: EditorViewLike
  readonly previousState: EditorState
  readonly state: EditorState
  readonly transactions?: readonly Transaction[]
}

export interface EditorViewLike {
  readonly state: EditorState
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement
  readonly selectionLayerDOM: HTMLElement
  readonly cursorLayerDOM: HTMLElement
  readonly inputDOM: HTMLTextAreaElement
}

export type EditorViewDispatch = (transaction: Transaction, view: EditorViewLike) => void

export interface VirtualViewportConfig {
  readonly enabled: boolean
  readonly lineHeight?: number
  readonly overscanLines?: number
  readonly viewportHeight?: number
}

export interface EditorViewConfig {
  readonly parent: HTMLElement
  readonly state: EditorState
  readonly mode?: ViewMode
  readonly editable?: boolean
  readonly assetProvider?: AssetProvider
  readonly virtualViewport?: VirtualViewportConfig
  readonly document?: Document
  readonly dispatch?: EditorViewDispatch
}

export interface PositionLineOffset {
  readonly line: Line
  readonly offset: number
}

export interface ViewCoordinate {
  readonly x: number
  readonly y: number
}

export interface ViewRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface ViewMetrics {
  readonly charWidth: number
  readonly lineHeight: number
}

export interface CursorVisibilityOptions {
  readonly metrics?: Partial<ViewMetrics>
  readonly scrollPadding?: number
  readonly viewportHeight?: number
}
