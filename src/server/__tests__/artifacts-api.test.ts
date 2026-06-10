import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleApiRequest } from '../router.js'
import { ProviderService } from '../services/providerService.js'
import { sessionService } from '../services/sessionService.js'

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifacts-api-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function makeRequest(body: Record<string, unknown>): { req: Request; url: URL } {
  const url = new URL('http://localhost:3456/api/artifacts/generate')
  return {
    url,
    req: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

describe('artifacts API', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('generates an image artifact through the active image provider', async () => {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifacts-api-workdir-'))
    const untrustedWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifacts-api-untrusted-'))
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: init?.headers as Record<string, string>,
      })
      return Response.json({
        data: [{ b64_json: Buffer.from('generated-image').toString('base64') }],
      })
    }) as typeof fetch

    try {
      const providerService = new ProviderService()
      const { sessionId } = await sessionService.createSession(workDir)
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

      const { req, url } = makeRequest({
        kind: 'image',
        prompt: 'draw a product UI',
        sessionId,
        workDir: untrustedWorkDir,
      })
      const response = await handleApiRequest(req, url)
      const json = await response.json() as { artifacts: Array<{ relativePath: string; status: string; mimeType: string }> }

      expect(response.status).toBe(200)
      expect(calls[0]).toMatchObject({
        url: 'https://93.184.216.34/v1/images/generations',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer image-token',
        },
        body: {
          model: 'gpt-image-1',
          prompt: 'draw a product UI',
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json',
        },
      })
      expect(json.artifacts[0]).toMatchObject({
        status: 'completed',
        mimeType: 'image/png',
      })
      await expect(fs.readFile(path.join(workDir, json.artifacts[0].relativePath), 'utf-8')).resolves.toBe('generated-image')
      await expect(fs.readdir(untrustedWorkDir)).resolves.toEqual([])
    } finally {
      globalThis.fetch = originalFetch
      await fs.rm(workDir, { recursive: true, force: true })
      await fs.rm(untrustedWorkDir, { recursive: true, force: true })
    }
  })
})
