import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { AssistantMessage } from '../../types/message.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { resetStateForTests, switchSession } from '../../bootstrap/state.js'
import { ProviderService } from '../../server/services/providerService.js'
import { runToolUse } from '../../services/tools/toolExecution.js'
import { asSessionId } from '../../types/ids.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { GenerateImageTool } from './GenerateImageTool.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  resetStateForTests()
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
})

function parentMessage(): AssistantMessage {
  return {
    uuid: 'assistant-1',
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      id: 'msg-1',
      role: 'assistant',
      content: [],
      model: 'test-model',
      stop_reason: null,
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  } as AssistantMessage
}

function context(workDir: string, tools: Tool[] = []): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], agentsByType: {}, errors: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map() as ToolUseContext['readFileState'],
    getAppState: () => ({
      replBridgeEnabled: false,
      toolPermissionContext: getEmptyToolPermissionContext(),
    }) as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    messages: [],
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as ToolUseContext
}

describe('GenerateImageTool', () => {
  test('generates workspace image artifacts from runtime session context', async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => Response.json({
      data: [{ b64_json: Buffer.from('image-data').toString('base64') }],
    })) as typeof fetch

    try {
      const providerService = new ProviderService()
      const provider = await providerService.addProvider({
        presetId: 'custom',
        name: 'Image Provider',
        apiKey: 'image-token',
        authStrategy: 'auth_token',
        baseUrl: 'https://93.184.216.34',
        apiFormat: 'anthropic',
        models: {
          main: 'claude-sonnet',
          haiku: 'claude-haiku',
          sonnet: 'claude-sonnet',
          opus: 'claude-opus',
        },
        generationCapabilities: {
          image: {
            enabled: true,
            defaultModelId: 'gpt-image-1',
            models: [{
              id: 'gpt-image-1',
              adapter: 'openai_images',
              outputFormats: ['png'],
              defaultSize: '1024x1024',
            }],
          },
        },
      })
      await providerService.activateProvider(provider.id)
      switchSession(asSessionId('generate-image-session'))

      const output = await runWithCwdOverride(workDir, () =>
        GenerateImageTool.call(
          {
            prompt: 'draw a dashboard',
            modelId: 'gpt-image-1',
          },
          context(workDir),
          async () => ({ behavior: 'allow', updatedInput: {} }),
          parentMessage(),
        ),
      )

      expect(output.data.artifacts).toHaveLength(1)
      expect(output.data.markdown).toContain('![Generated image 1](')
      expect(output.data.artifacts[0].relativePath).toContain('.echoflow/artifacts/generate-image-session/')
      await expect(fs.readFile(path.join(workDir, output.data.artifacts[0].relativePath!), 'utf-8')).resolves.toBe('image-data')
    } finally {
      globalThis.fetch = originalFetch
      await fs.rm(workDir, { recursive: true, force: true })
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })

  test('asks for permission before provider network generation', async () => {
    const decision = await GenerateImageTool.checkPermissions(
      { prompt: 'draw a cat' },
      context(process.cwd()),
    )

    expect(decision.behavior).toBe('ask')
    expect(decision.suggestions?.[0]).toMatchObject({
      type: 'addRules',
      rules: [{ toolName: 'GenerateImage' }],
      behavior: 'allow',
    })
  })

  test('does not call provider when tool execution permission is denied', async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-deny-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-deny-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async () => Response.json({
      data: [{ b64_json: Buffer.from('image-data').toString('base64') }],
    }))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const providerService = new ProviderService()
      const provider = await providerService.addProvider({
        presetId: 'custom',
        name: 'Image Provider',
        apiKey: 'image-token',
        authStrategy: 'auth_token',
        baseUrl: 'https://93.184.216.34',
        apiFormat: 'anthropic',
        models: {
          main: 'claude-sonnet',
          haiku: 'claude-haiku',
          sonnet: 'claude-sonnet',
          opus: 'claude-opus',
        },
        generationCapabilities: {
          image: {
            enabled: true,
            defaultModelId: 'gpt-image-1',
            models: [{
              id: 'gpt-image-1',
              adapter: 'openai_images',
              outputFormats: ['png'],
              defaultSize: '1024x1024',
            }],
          },
        },
      })
      await providerService.activateProvider(provider.id)
      switchSession(asSessionId('generate-image-denied-session'))

      const updates = []
      for await (const update of runToolUse(
        {
          id: 'toolu-generate-image-denied',
          name: 'GenerateImage',
          type: 'tool_use',
          input: { prompt: 'draw a dashboard' },
        } as ToolUseBlock,
        parentMessage(),
        async () => ({
          behavior: 'deny',
          message: 'Image generation denied',
          decisionReason: { type: 'other', reason: 'test denial' },
        }),
        context(workDir, [GenerateImageTool as Tool]),
      )) {
        updates.push(update)
      }

      expect(fetchMock).not.toHaveBeenCalled()
      expect(updates).toHaveLength(1)
      expect(updates[0]?.message.type).toBe('user')
      expect(updates[0]?.message.toolUseResult).toStartWith('Error:')
      await expect(fs.stat(path.join(workDir, '.echoflow'))).rejects.toThrow()
    } finally {
      globalThis.fetch = originalFetch
      await fs.rm(workDir, { recursive: true, force: true })
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })

  test('passes abort signal to provider and propagates aborted generation failure', async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-abort-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generate-image-tool-abort-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    const originalFetch = globalThis.fetch
    const abortingContext = context(workDir)
    const fetchMock = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(abortingContext.abortController.signal)
      abortingContext.abortController.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const providerService = new ProviderService()
      const provider = await providerService.addProvider({
        presetId: 'custom',
        name: 'Image Provider',
        apiKey: 'image-token',
        authStrategy: 'auth_token',
        baseUrl: 'https://93.184.216.34',
        apiFormat: 'anthropic',
        models: {
          main: 'claude-sonnet',
          haiku: 'claude-haiku',
          sonnet: 'claude-sonnet',
          opus: 'claude-opus',
        },
        generationCapabilities: {
          image: {
            enabled: true,
            defaultModelId: 'gpt-image-1',
            models: [{
              id: 'gpt-image-1',
              adapter: 'openai_images',
              outputFormats: ['png'],
              defaultSize: '1024x1024',
            }],
          },
        },
      })
      await providerService.activateProvider(provider.id)
      switchSession(asSessionId('generate-image-abort-session'))

      await expect(runWithCwdOverride(workDir, () =>
        GenerateImageTool.call(
          { prompt: 'draw an interrupted dashboard' },
          abortingContext,
          async () => ({ behavior: 'allow', updatedInput: {} }),
          parentMessage(),
        ),
      )).rejects.toThrow('Aborted')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const sessionArtifactDir = path.join(
        workDir,
        '.echoflow',
        'artifacts',
        'generate-image-abort-session',
      )
      const [artifactId] = await fs.readdir(sessionArtifactDir)
      const metadata = JSON.parse(await fs.readFile(
        path.join(
          sessionArtifactDir,
          artifactId!,
          'artifact.json',
        ),
        'utf-8',
      ))
      expect(metadata).toMatchObject({
        status: 'failed',
        error: 'Aborted',
      })
    } finally {
      globalThis.fetch = originalFetch
      await fs.rm(workDir, { recursive: true, force: true })
      await fs.rm(configDir, { recursive: true, force: true })
    }
  })
})
