import type { DocumentLoadingState } from './document-open-flow'

export interface DocumentLoadingVisibilityController {
  readonly visible: boolean
  update(state: DocumentLoadingState): void
  reveal(): void
  dispose(): void
}

export interface DocumentLoadingVisibilityOptions {
  readonly delayMs?: number
  readonly onChange: () => void
}

const defaultDelayMs = 150

export function createDocumentLoadingVisibilityController(
  options: DocumentLoadingVisibilityOptions,
): DocumentLoadingVisibilityController {
  const delayMs = Math.max(0, options.delayMs ?? defaultDelayMs)
  let visible = false
  let revealTimer: ReturnType<typeof setTimeout> | undefined

  const cancelReveal = (): void => {
    if (revealTimer !== undefined) {
      clearTimeout(revealTimer)
      revealTimer = undefined
    }
  }

  const setVisible = (nextVisible: boolean): void => {
    if (visible === nextVisible) {
      return
    }

    visible = nextVisible
    options.onChange()
  }

  return {
    get visible(): boolean {
      return visible
    },
    update(state: DocumentLoadingState): void {
      if (state.phase === 'opening' || state.phase === 'indexing') {
        if (visible || revealTimer !== undefined) {
          return
        }

        revealTimer = setTimeout(() => {
          revealTimer = undefined
          setVisible(true)
        }, delayMs)
        return
      }

      cancelReveal()
      setVisible(state.phase === 'closing' || state.phase === 'failed')
    },
    reveal(): void {
      cancelReveal()
      setVisible(true)
    },
    dispose(): void {
      cancelReveal()
    },
  }
}
