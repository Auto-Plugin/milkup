import type { PluginSettingsValues } from '@milkup/plugin'
import type { EditorPresentation } from '@milkup/view-dom'
import type { ThemePreference } from './appearance'

export interface AppliedEditorSettings {
  readonly theme: ThemePreference
  readonly zoom: number
  readonly presentation: EditorPresentation
}

/** Reapply all native effects on rollback too: a later view failure does not undo native zoom. */
export async function applyEditorSettings(
  values: PluginSettingsValues,
  effects: {
    theme(value: ThemePreference): Promise<void>
    zoom(value: number): Promise<void>
    editor(value: EditorPresentation): Promise<void>
    applied(value: AppliedEditorSettings): void
  },
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const theme = values['appearance.theme'] as ThemePreference
  const zoom = values['appearance.zoom'] as number
  const presentation: EditorPresentation = {
    fontFamily: values['editor.fontFamily'] as EditorPresentation['fontFamily'],
    fontSize: values['editor.fontSize'] as number,
    lineHeight: values['editor.lineHeight'] as number,
    contentWidth: values['editor.lineWidth'] as number,
    indentation:
      values['editor.indentStyle'] === 'tabs'
        ? 'tabs'
        : values['editor.indentSize'] === 4
          ? 'spaces-4'
          : 'spaces-2',
  }
  await effects.theme(theme)
  signal?.throwIfAborted()
  await effects.zoom(zoom)
  signal?.throwIfAborted()
  await effects.editor(presentation)
  signal?.throwIfAborted()
  effects.applied({ theme, zoom, presentation })
}

/** A document/mode change may replace a view while its asynchronous layout is pending. */
export async function applyPresentationToCurrentViews(
  current: () => readonly [
    { setPresentation(value: EditorPresentation): void } | undefined,
    { setPresentation(value: EditorPresentation): Promise<void> } | undefined,
  ],
  presentation: EditorPresentation,
  signal?: AbortSignal,
): Promise<void> {
  for (;;) {
    signal?.throwIfAborted()
    const [view, source] = current()
    view?.setPresentation(presentation)
    await source?.setPresentation(presentation)
    signal?.throwIfAborted()
    const [nextView, nextSource] = current()
    if (view === nextView && source === nextSource) return
  }
}
