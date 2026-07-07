import { describe, expect, it } from 'vitest'

import { ActionRegistry, createBuiltinActions } from '@milkup/core'

import { createMcpResources, createMcpTools } from './projection'

describe('MCP projection', () => {
  it('generates MCP tools from the Action Registry', () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const tools = createMcpTools(registry, {
      permissions: ['document:read', 'document:write', 'view:write', 'app:control'],
    })
    const replaceSelection = tools.find(
      (tool) => tool.annotations.actionId === 'document.replaceSelection',
    )

    expect(tools.map((tool) => tool.name)).toContain('milkup_action_document__replaceSelection')
    expect(replaceSelection).toMatchObject({
      name: 'milkup_action_document__replaceSelection',
      title: 'Replace Selection',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      annotations: {
        actionId: 'document.replaceSelection',
        category: 'document',
        requiredPermissions: ['document:write'],
        risk: 'write',
        requiresConfirmation: false,
        readOnlyHint: false,
        destructiveHint: false,
      },
    })
  })

  it('filters MCP tools by permissions', () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const tools = createMcpTools(registry, {
      permissions: ['document:read', 'view:write'],
    })
    const actionIds = tools.map((tool) => tool.annotations.actionId)

    expect(actionIds).toContain('document.setSelection')
    expect(actionIds).toContain('view.setMode')
    expect(actionIds).not.toContain('document.replaceSelection')
    expect(actionIds).not.toContain('file.close')
  })

  it('applies action allowlists before exposing tools', () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const tools = createMcpTools(registry, {
      permissions: ['document:read', 'document:write', 'view:write'],
      allowlist: ['document.replaceSelection'],
    })

    expect(tools.map((tool) => tool.annotations.actionId)).toEqual(['document.replaceSelection'])
  })

  it('marks destructive actions as confirmation-required metadata', () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const tools = createMcpTools(registry, {
      permissions: ['app:control'],
      allowlist: ['file.close'],
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]?.annotations).toMatchObject({
      actionId: 'file.close',
      risk: 'destructive',
      requiresConfirmation: true,
      destructiveHint: true,
    })
  })

  it('exposes current document, selection, and workspace file resources', () => {
    const resources = createMcpResources({
      currentDocument: {
        documentId: 'doc 1',
        text: '# Title',
      },
      currentSelection: {
        anchor: 1,
        head: 4,
      },
      workspaceFiles: ['b.md', 'a.md'],
    })

    expect(resources).toEqual([
      {
        uri: 'milkup://documents/doc%201/source',
        name: 'Current Document',
        mimeType: 'text/markdown',
        text: '# Title',
      },
      {
        uri: 'milkup://selection/current',
        name: 'Current Selection',
        mimeType: 'application/json',
        text: '{\n  "anchor": 1,\n  "head": 4\n}',
      },
      {
        uri: 'milkup://workspace/files',
        name: 'Workspace Files',
        mimeType: 'application/json',
        text: '[\n  "a.md",\n  "b.md"\n]',
      },
    ])
  })
})
