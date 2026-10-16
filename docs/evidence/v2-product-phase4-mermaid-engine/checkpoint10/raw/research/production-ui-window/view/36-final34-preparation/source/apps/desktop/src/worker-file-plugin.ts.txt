import { ChangeSet, Selection } from '@milkup/core'
import type { PluginModule } from '@milkup/plugin'

const pluginModule: PluginModule = {
  commands: {
    'desktopWorkerFile.readWriteInsert': async (context, input) => {
      const path = readPathInput(input)
      const text = await context.host.readText?.(path)
      const readText = typeof text === 'string' ? text : ''
      const appendText = `${readText}\nworker-brokered`

      await context.host.writeText?.(path, appendText)

      const insert = `\n${readText.trim()}`
      const head = context.editor?.state.selection.main.head ?? 0

      context.editor?.dispatch({
        changes: ChangeSet.replace(head, head, insert),
        selection: Selection.cursor(head + insert.length),
      })

      return { read: readText, wrote: appendText }
    },
  },
}

export default pluginModule

function readPathInput(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'path' in input &&
    typeof input.path === 'string'
  ) {
    return input.path
  }

  throw new Error('Desktop worker file plugin requires a path input')
}
