import { afterEach, describe, expect, it, vi } from 'vitest'

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { runCli } from './milkup'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('milkup CLI actions', () => {
  it('lists built-in actions from the shared Action Registry', async () => {
    const result = await runCli(['action', 'list'])
    const actions = parseStdout(result) as Array<{ id: string; risk: string }>

    expect(result.exitCode).toBe(0)
    expect(actions.map((action) => action.id)).toContain('document.replaceSelection')
    expect(actions.map((action) => action.id)).toContain('view.setMode')
    expect(actions.find((action) => action.id === 'file.close')?.risk).toBe('destructive')
  })

  it('filters listed actions by permissions', async () => {
    const result = await runCli(['action', 'list', '--permissions', 'document:read,view:write'])
    const actions = parseStdout(result) as Array<{ id: string }>
    const ids = actions.map((action) => action.id)

    expect(result.exitCode).toBe(0)
    expect(ids).toContain('document.setSelection')
    expect(ids).toContain('view.setMode')
    expect(ids).not.toContain('document.replaceSelection')
  })

  it('describes an action schema', async () => {
    const result = await runCli(['action', 'describe', 'document.replaceSelection'])
    const action = parseStdout(result) as {
      id: string
      inputSchema: { properties: { text: { type: string; required: boolean } } }
    }

    expect(result.exitCode).toBe(0)
    expect(action.id).toBe('document.replaceSelection')
    expect(action.inputSchema.properties.text).toEqual({ type: 'string', required: true })
  })

  it('runs document actions in a headless editor context', async () => {
    const result = await runCli([
      'action',
      'run',
      'document.replaceSelection',
      '--document',
      'hello world',
      '--selection',
      '6:11',
      '--input',
      '{"text":"milkup"}',
    ])
    const output = parseStdout(result) as {
      action: string
      output: { changed: boolean }
      document: string
      selection: { anchor: number; head: number }
      canUndo: boolean
    }

    expect(result.exitCode).toBe(0)
    expect(output).toEqual({
      action: 'document.replaceSelection',
      output: { changed: true },
      document: 'hello milkup',
      selection: { anchor: 12, head: 12 },
      canUndo: true,
      canRedo: false,
    })
  })

  it('lists actions through an attached app endpoint', async () => {
    const fetch = mockAttachedAppFetch([
      {
        id: 'document.replaceSelection',
        title: 'Replace selection',
        category: 'document',
        permissions: ['document:write'],
        risk: 'write',
        requiresConfirmation: false,
      },
    ])
    const result = await runCli([
      'action',
      'list',
      '--attached-url',
      'http://127.0.0.1:3765/milkup-cli',
      '--permissions',
      'document:write',
    ])
    const actions = parseStdout(result) as Array<{ id: string }>

    expect(result.exitCode).toBe(0)
    expect(actions).toEqual([
      expect.objectContaining({
        id: 'document.replaceSelection',
      }),
    ])
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3765/milkup-cli',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'action/list',
          params: {
            permissions: ['document:write'],
          },
        }),
      }),
    )
  })

  it('runs actions through an attached app endpoint without creating a headless document', async () => {
    mockAttachedAppFetch({
      action: 'document.replaceSelection',
      output: { changed: true },
      documentId: 'desktop-doc',
      selection: { anchor: 5, head: 5 },
    })
    const result = await runCli([
      'action',
      'run',
      'document.replaceSelection',
      '--attached-url',
      'http://127.0.0.1:3765/milkup-cli',
      '--input',
      '{"text":"hello"}',
      '--permissions',
      'document:write',
    ])
    const output = parseStdout(result) as { documentId: string; output: { changed: boolean } }

    expect(result.exitCode).toBe(0)
    expect(output).toEqual({
      action: 'document.replaceSelection',
      output: { changed: true },
      documentId: 'desktop-doc',
      selection: { anchor: 5, head: 5 },
    })
  })

  it('surfaces attached app JSON-RPC failures as CLI failures', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'No active editor window',
        },
      }),
    })) as unknown as typeof fetch

    const result = await runCli([
      'action',
      'describe',
      'document.replaceSelection',
      '--attached-url',
      'http://127.0.0.1:3765/milkup-cli',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No active editor window')
  })

  it('rejects action runs when permissions do not allow the action', async () => {
    const result = await runCli([
      'action',
      'run',
      'document.replaceSelection',
      '--permissions',
      'document:read',
      '--input',
      '{"text":"x"}',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not allowed')
  })

  it('exposes plugin actions from a local manifest', async () => {
    const tempDir = await createCliPluginFixture()

    try {
      const result = await runCli([
        'action',
        'list',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
      ])
      const actions = parseStdout(result) as Array<{ id: string; category: string }>

      expect(result.exitCode).toBe(0)
      expect(actions).toContainEqual(
        expect.objectContaining({
          id: 'example.insertText',
          category: 'plugin',
        }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('runs plugin actions in the headless CLI editor', async () => {
    const tempDir = await createCliPluginFixture()

    try {
      const result = await runCli([
        'action',
        'run',
        'example.insertText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--document',
        'hello',
        '--selection',
        '5',
        '--input',
        '{"text":" plugin"}',
      ])
      const output = parseStdout(result) as {
        action: string
        output: { ok: boolean; value: { inserted: string } }
        document: string
        canUndo: boolean
      }

      expect(result.exitCode).toBe(0)
      expect(output).toEqual({
        action: 'example.insertText',
        output: {
          ok: true,
          value: { inserted: ' plugin' },
        },
        document: 'hello plugin',
        selection: { anchor: 12, head: 12 },
        canUndo: true,
        canRedo: false,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('validates CLI plugin action input through manifest schemas', async () => {
    const tempDir = await createCliPluginFixture({
      insertInputSchema: true,
    })

    try {
      const missingInput = await runCli([
        'action',
        'run',
        'example.insertText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--input',
        '{}',
      ])

      expect(missingInput.exitCode).toBe(1)
      expect(missingInput.stderr).toContain('Missing required action input "text"')

      const validInput = await runCli([
        'action',
        'run',
        'example.insertText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--document',
        'hello',
        '--selection',
        '5',
        '--input',
        '{"text":" schema"}',
      ])
      const output = parseStdout(validInput) as {
        output: { ok: boolean; value: { inserted: string } }
        document: string
      }

      expect(validInput.exitCode).toBe(0)
      expect(output.output).toEqual({
        ok: true,
        value: { inserted: ' schema' },
      })
      expect(output.document).toBe('hello schema')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('runs CLI plugin commands through the isolated module host boundary', async () => {
    const tempDir = await createCliPluginFixture({
      inspectEditorShape: true,
    })

    try {
      const result = await runCli([
        'action',
        'run',
        'example.inspectEditor',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--document',
        'hello',
        '--selection',
        '5',
      ])
      const output = parseStdout(result) as {
        output: {
          ok: boolean
          value: {
            hasEditor: boolean
            hasDocumentText: boolean
            selectionHead: number
          }
        }
      }

      expect(result.exitCode).toBe(0)
      expect(output.output).toEqual({
        ok: true,
        value: {
          hasEditor: true,
          hasDocumentText: false,
          selectionHead: 5,
        },
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('routes plugin file host capabilities through a CLI-scoped broker', async () => {
    const tempDir = await createCliFilePluginFixture()

    try {
      const targetPath = join(tempDir, 'notes', 'doc.md')

      const result = await runCli([
        'action',
        'run',
        'fileTools.update',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--plugin-permissions',
        'file:read,file:write',
        '--permissions',
        'file:read,file:write',
        '--input',
        JSON.stringify({ path: targetPath }),
      ])
      const output = parseStdout(result) as {
        output: { ok: boolean; value: { text: string } }
      }

      expect(result.exitCode).toBe(0)
      expect(output.output).toEqual({
        ok: true,
        value: { text: 'hello' },
      })
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('hello cli')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects CLI plugin file access outside the scoped root', async () => {
    const tempDir = await createCliFilePluginFixture()
    const outsideDir = await mkdtemp(join(process.cwd(), '.tmp-milkup-cli-outside-'))

    try {
      const result = await runCli([
        'action',
        'run',
        'fileTools.update',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--plugin-permissions',
        'file:read,file:write',
        '--permissions',
        'file:read,file:write',
        '--input',
        JSON.stringify({ path: join(outsideDir, 'secret.md') }),
      ])
      const output = parseStdout(result) as {
        output: { ok: boolean; error: { message: string } }
      }

      expect(result.exitCode).toBe(0)
      expect(output.output.ok).toBe(false)
      expect(output.output.error.message).toContain('outside allowed roots')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
      await rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('routes plugin network host capabilities through a CLI broker', async () => {
    const tempDir = await createCliNetworkPluginFixture()

    try {
      const result = await runCli([
        'action',
        'run',
        'networkTools.fetchText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--plugin-permissions',
        'network:access',
        '--permissions',
        'network:access',
        '--input',
        JSON.stringify({ url: 'data:text/plain,hello%20cli' }),
      ])
      const output = parseStdout(result) as {
        output: { ok: boolean; value: { text: string } }
      }

      expect(result.exitCode).toBe(0)
      expect(output.output).toEqual({
        ok: true,
        value: { text: 'hello cli' },
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('requires action-level network permission before running CLI network plugins', async () => {
    const tempDir = await createCliNetworkPluginFixture()

    try {
      const result = await runCli([
        'action',
        'run',
        'networkTools.fetchText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--plugin-permissions',
        'network:access',
        '--input',
        JSON.stringify({ url: 'data:text/plain,hello%20cli' }),
      ])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Action is not allowed: networkTools.fetchText')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects CLI plugin network access outside the allowed origins', async () => {
    const tempDir = await createCliNetworkPluginFixture()

    try {
      const result = await runCli([
        'action',
        'run',
        'networkTools.fetchText',
        '--plugin-manifest',
        join(tempDir, 'plugin.json'),
        '--plugin-permissions',
        'network:access',
        '--permissions',
        'network:access',
        '--plugin-network-origin',
        'https://api.example.test',
        '--input',
        JSON.stringify({ url: 'https://blocked.example.test/data' }),
      ])
      const output = parseStdout(result) as {
        output: { ok: boolean; error: { message: string } }
      }

      expect(result.exitCode).toBe(0)
      expect(output.output.ok).toBe(false)
      expect(output.output.error.message).toContain(
        'Plugin network origin is not allowed: https://blocked.example.test',
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('milkup CLI export', () => {
  it('exports HTML from a headless document to stdout', async () => {
    const result = await runCli([
      'export',
      '--format',
      'html',
      '--document',
      '# Title\n\nHello **world**',
      '--document-id',
      'doc-1',
      '--title',
      'Doc One',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('<title>Doc One</title>')
    expect(result.stdout).toContain('<h1>Title</h1>')
    expect(result.stdout).toContain('<strong>world</strong>')
  })

  it('exports Markdown from a file to an output file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'milkup-cli-'))

    try {
      const inputPath = join(tempDir, 'input.md')
      const outputPath = join(tempDir, 'output.md')

      await writeFile(inputPath, '# From File\n', 'utf8')

      const result = await runCli([
        'export',
        '--format',
        'markdown',
        '--from-file',
        inputPath,
        '--out',
        outputPath,
      ])
      const summary = parseStdout(result) as { format: string; out: string; bytes: number }

      expect(result.exitCode).toBe(0)
      expect(summary).toMatchObject({ format: 'markdown', out: outputPath })
      expect(summary.bytes).toBeGreaterThan(0)
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('# From File\n')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('exports baseline PDF bytes to an output file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'milkup-cli-'))

    try {
      const outputPath = join(tempDir, 'output.pdf')
      const result = await runCli([
        'export',
        '--format',
        'pdf',
        '--document',
        '# PDF\n\nBody',
        '--out',
        outputPath,
      ])
      const summary = parseStdout(result) as { format: string; out: string; bytes: number }
      const file = await readFile(outputPath)

      expect(result.exitCode).toBe(0)
      expect(summary).toMatchObject({ format: 'pdf', out: outputPath })
      expect(summary.bytes).toBe((await stat(outputPath)).size)
      expect(file.subarray(0, 8).toString()).toBe('%PDF-1.4')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects export without an input document', async () => {
    const result = await runCli(['export', '--format', 'html'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Missing export input')
  })
})

function parseStdout(result: { stdout?: string }): unknown {
  expect(result.stdout).toBeTruthy()
  return JSON.parse(result.stdout ?? 'null') as unknown
}

function mockAttachedAppFetch(result: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result,
    }),
  }))

  globalThis.fetch = fetchMock as unknown as typeof fetch

  return fetchMock
}

async function createCliPluginFixture(
  options: {
    readonly inspectEditorShape?: boolean
    readonly insertInputSchema?: boolean
  } = {},
): Promise<string> {
  const tempDir = await mkdtemp(join(process.cwd(), '.tmp-milkup-cli-plugin-'))
  const manifestPath = join(tempDir, 'plugin.json')
  const modulePath = join(tempDir, 'plugin.mjs')

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: 'cli-plugin',
        name: 'CLI Plugin',
        version: '1.0.0',
        main: './plugin.mjs',
        permissions: ['document:write'],
        contributes: {
          commands: [
            {
              id: 'example.insertText',
              title: 'Insert Text',
              action: 'example.insertText',
              ...(options.insertInputSchema
                ? {
                    inputSchema: {
                      type: 'object',
                      properties: {
                        text: {
                          type: 'string',
                          required: true,
                          description: 'Text to insert',
                        },
                      },
                    },
                  }
                : {}),
            },
            ...(options.inspectEditorShape
              ? [
                  {
                    id: 'example.inspectEditor',
                    title: 'Inspect Editor',
                    action: 'example.inspectEditor',
                  },
                ]
              : []),
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    modulePath,
    [
      "import { dispatchInsert } from '@milkup/plugin-sdk'",
      'export default {',
      '  commands: {',
      "    'example.insertText': (context, input) => {",
      "      const text = typeof input.text === 'string' ? input.text : ''",
      "      dispatchInsert(context, text, { commandId: 'example.insertText' })",
      '      return { inserted: text }',
      '    },',
      ...(options.inspectEditorShape
        ? [
            "    'example.inspectEditor': (context) => {",
            '      return {',
            '        hasEditor: Boolean(context.editor),',
            "        hasDocumentText: typeof context.editor?.state?.doc?.text === 'string',",
            '        selectionHead: context.editor?.state?.selection?.main?.head,',
            '      }',
            '    },',
          ]
        : []),
      '  },',
      '}',
    ].join('\n'),
    'utf8',
  )

  return tempDir
}

async function createCliFilePluginFixture(): Promise<string> {
  const tempDir = await mkdtemp(join(process.cwd(), '.tmp-milkup-cli-file-plugin-'))
  const manifestPath = join(tempDir, 'plugin.json')
  const modulePath = join(tempDir, 'plugin.mjs')
  const notesDir = join(tempDir, 'notes')

  await mkdir(notesDir, { recursive: true })
  await writeFile(join(notesDir, 'doc.md'), 'hello', 'utf8')
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: 'cli-file-plugin',
        name: 'CLI File Plugin',
        version: '1.0.0',
        main: './plugin.mjs',
        permissions: ['file:read', 'file:write'],
        contributes: {
          commands: [
            {
              id: 'fileTools.update',
              title: 'Update File',
              action: 'fileTools.update',
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    modulePath,
    [
      'export default {',
      '  commands: {',
      "    'fileTools.update': async (context, input) => {",
      "      const path = typeof input.path === 'string' ? input.path : ''",
      '      const text = await context.host.readText(path)',
      '      await context.host.writeText(path, `${text} cli`)',
      '      return { text }',
      '    },',
      '  },',
      '}',
    ].join('\n'),
    'utf8',
  )

  return tempDir
}

async function createCliNetworkPluginFixture(): Promise<string> {
  const tempDir = await mkdtemp(join(process.cwd(), '.tmp-milkup-cli-network-plugin-'))
  const manifestPath = join(tempDir, 'plugin.json')
  const modulePath = join(tempDir, 'plugin.mjs')

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: 'cli-network-plugin',
        name: 'CLI Network Plugin',
        version: '1.0.0',
        main: './plugin.mjs',
        permissions: ['network:access'],
        contributes: {
          commands: [
            {
              id: 'networkTools.fetchText',
              title: 'Fetch Text',
              action: 'networkTools.fetchText',
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(
    modulePath,
    [
      'export default {',
      '  commands: {',
      "    'networkTools.fetchText': async (context, input) => {",
      "      const url = typeof input.url === 'string' ? input.url : ''",
      '      const response = await context.host.fetch(url)',
      '      const text = await response.text()',
      '      return { text }',
      '    },',
      '  },',
      '}',
    ].join('\n'),
    'utf8',
  )

  return tempDir
}
