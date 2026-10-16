import { dispatchInsert } from '@milkup/plugin-sdk'
import type { PluginModule } from '@milkup/plugin'

const pluginModule: PluginModule = {
  commands: {
    'workerDemo.insert': (context, input) => {
      const text = readTextInput(input)

      dispatchInsert(context as unknown as Parameters<typeof dispatchInsert>[0], text, {
        commandId: 'workerDemo.insert',
      })

      return { inserted: text }
    },
    'workerDemo.readFile': async (context, input) => {
      const path = readPathInput(input)
      const text = await context.host.readText?.(path)
      const insertText = typeof text === 'string' ? text : ' worker-file'

      dispatchInsert(context as unknown as Parameters<typeof dispatchInsert>[0], insertText, {
        commandId: 'workerDemo.readFile',
      })

      return { read: insertText }
    },
    'workerDemo.fetch': async (context, input) => {
      const url = readUrlInput(input)
      const response = await context.host.fetch?.(url)
      const text = readFetchText(response)

      dispatchInsert(context as unknown as Parameters<typeof dispatchInsert>[0], text, {
        commandId: 'workerDemo.fetch',
      })

      return { fetched: text }
    },
  },
}

export default pluginModule

function readTextInput(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'text' in input &&
    typeof input.text === 'string'
    ? input.text
    : ' worker-plugin'
}

function readUrlInput(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof input.url === 'string'
    ? input.url
    : 'https://playground.local/worker-network'
}

function readPathInput(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'path' in input &&
    typeof input.path === 'string'
    ? input.path
    : '/playground/worker-file.md'
}

function readFetchText(response: unknown): string {
  if (
    typeof response === 'object' &&
    response !== null &&
    'text' in response &&
    typeof response.text === 'string'
  ) {
    return response.text
  }

  return ' worker-network'
}
