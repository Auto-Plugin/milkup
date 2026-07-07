import { describe, expect, it } from 'vitest'

import { parsePluginManifest, validatePluginManifest } from './manifest'

describe('plugin manifest validation', () => {
  it('accepts a manifest with command, keymap, renderer, and markdown syntax contributions', () => {
    const result = validatePluginManifest({
      id: 'milkup.example-tools',
      name: 'Example Tools',
      version: '1.2.3',
      main: './dist/plugin.js',
      description: 'Example plugin',
      permissions: ['document:read', 'document:write', 'network:access'],
      contributes: {
        commands: [
          {
            id: 'example.insertTimestamp',
            title: 'Insert Timestamp',
            action: 'example.insertTimestamp',
            category: 'document',
            permissions: ['document:write'],
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
          },
        ],
        keymaps: [
          {
            command: 'example.insertTimestamp',
            key: 'Mod-Alt-T',
            when: 'editorFocus',
          },
        ],
        renderers: [
          {
            id: 'example-callout',
            nodeType: 'callout',
            module: './dist/callout-renderer.js',
          },
        ],
        markdownSyntax: [
          {
            id: 'example-callout',
            block: true,
          },
        ],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.manifest).toMatchObject({
      id: 'milkup.example-tools',
      permissions: ['document:read', 'document:write', 'network:access'],
      contributes: {
        commands: [
          {
            id: 'example.insertTimestamp',
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
          },
        ],
        keymaps: [{ command: 'example.insertTimestamp' }],
        renderers: [{ nodeType: 'callout' }],
        markdownSyntax: [{ id: 'example-callout', block: true }],
      },
    })
    expect(Object.isFrozen(result.manifest)).toBe(true)
  })

  it('accepts explicit worker and sidecar host declarations', () => {
    expect(
      validatePluginManifest({
        id: 'worker-tools',
        name: 'Worker Tools',
        version: '1.0.0',
        host: 'worker',
      }).manifest,
    ).toMatchObject({
      id: 'worker-tools',
      host: 'worker',
    })

    expect(
      validatePluginManifest({
        id: 'sidecar-tools',
        name: 'Sidecar Tools',
        version: '1.0.0',
        host: 'sidecar',
      }).manifest,
    ).toMatchObject({
      id: 'sidecar-tools',
      host: 'sidecar',
    })
  })

  it('reports missing required top-level fields and invalid identifiers', () => {
    const result = validatePluginManifest({
      id: 'Bad Plugin',
      version: 'v1',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      { path: '$.name', message: 'Expected a non-empty string' },
      { path: '$.id', message: 'Plugin id must be kebab/dot case' },
      { path: '$.version', message: 'Version must be semver-like' },
    ])
  })

  it('rejects unknown plugin host declarations', () => {
    const result = validatePluginManifest({
      id: 'host-tools',
      name: 'Host Tools',
      version: '1.0.0',
      host: 'process',
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: '$.host',
      message: 'Unknown plugin host: process',
    })
  })

  it('rejects unknown permissions and malformed contribution arrays', () => {
    const result = validatePluginManifest({
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      permissions: ['document:read', 'shell:exec'],
      contributes: {
        commands: [
          {
            id: 'not valid',
            title: 'Bad',
            action: 'bad',
          },
        ],
        keymaps: 'Mod-X',
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: '$.permissions[1]',
      message: 'Unknown plugin permission: shell:exec',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].id',
      message: 'Command id must be an action-style id',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].action',
      message: 'Command action must be an action-style id',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.keymaps',
      message: 'Expected an array',
    })
  })

  it('requires command permissions to be declared at the manifest level', () => {
    const result = validatePluginManifest({
      id: 'network-tools',
      name: 'Network Tools',
      version: '1.0.0',
      permissions: ['document:write'],
      contributes: {
        commands: [
          {
            id: 'network.fetch',
            title: 'Fetch',
            action: 'network.fetch',
            permissions: ['network:access'],
          },
        ],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].permissions[0]',
      message: 'Command permission must be declared in top-level permissions: network:access',
    })
  })

  it('rejects duplicate contribution ids and unknown keymap commands', () => {
    const result = validatePluginManifest({
      id: 'duplicate-tools',
      name: 'Duplicate Tools',
      version: '1.0.0',
      contributes: {
        commands: [
          {
            id: 'duplicate.run',
            title: 'Run A',
            action: 'duplicate.run',
          },
          {
            id: 'duplicate.run',
            title: 'Run B',
            action: 'duplicate.other',
          },
          {
            id: 'duplicate.extra',
            title: 'Run C',
            action: 'duplicate.other',
          },
        ],
        keymaps: [
          {
            command: 'duplicate.missing',
            key: 'Mod-Alt-M',
          },
        ],
        renderers: [
          {
            id: 'duplicate-renderer',
            nodeType: 'callout',
            module: './renderer-a.js',
          },
          {
            id: 'duplicate-renderer',
            nodeType: 'note',
            module: './renderer-b.js',
          },
        ],
        markdownSyntax: [
          {
            id: 'duplicate-syntax',
            block: true,
          },
          {
            id: 'duplicate-syntax',
            inline: true,
          },
        ],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[1].id',
      message: 'Duplicate command id: duplicate.run',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[2].action',
      message: 'Duplicate command action: duplicate.other',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.keymaps[0].command',
      message: 'Keymap command must reference a contributed command action: duplicate.missing',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.renderers[1].id',
      message: 'Duplicate renderer id: duplicate-renderer',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.markdownSyntax[1].id',
      message: 'Duplicate markdown syntax id: duplicate-syntax',
    })
  })

  it('rejects malformed command input schemas', () => {
    const result = validatePluginManifest({
      id: 'schema-tools',
      name: 'Schema Tools',
      version: '1.0.0',
      contributes: {
        commands: [
          {
            id: 'schema.run',
            title: 'Run',
            action: 'schema.run',
            inputSchema: {
              type: 'array',
              properties: {
                text: {
                  type: 'string',
                  required: 'yes',
                },
                count: {
                  type: 'integer',
                },
                broken: 'field',
              },
            },
          },
        ],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].inputSchema.type',
      message: 'Input schema type must be object',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].inputSchema.properties.text.required',
      message: 'Expected a boolean',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].inputSchema.properties.count.type',
      message: 'Invalid input schema field type: integer',
    })
    expect(result.errors).toContainEqual({
      path: '$.contributes.commands[0].inputSchema.properties.broken',
      message: 'Input schema property must be an object',
    })
  })

  it('requires markdown syntax contributions to declare block or inline mode', () => {
    const result = validatePluginManifest({
      id: 'syntax-plugin',
      name: 'Syntax Plugin',
      version: '1.0.0',
      contributes: {
        markdownSyntax: [{ id: 'callout' }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      {
        path: '$.contributes.markdownSyntax[0]',
        message: 'Markdown syntax contribution must enable block or inline',
      },
    ])
  })

  it('throws a readable aggregate error when parsing invalid manifests', () => {
    expect(() => parsePluginManifest({})).toThrow(
      'Invalid plugin manifest:\n- $.id: Expected a non-empty string\n- $.name: Expected a non-empty string\n- $.version: Expected a non-empty string',
    )
  })
})
