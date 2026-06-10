import { describe, test, expect } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { GenerationService } from '../services/generation/generationService.js'
import type { GenerateArtifactRequest } from '../types/generation.js'
import type { SavedProvider } from '../types/provider.js'
import type { GenerationProviderAdapter, ImageGenerationAdapterContext } from '../services/generation/providerAdapters.js'

function imageProvider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    id: 'provider-1',
    presetId: 'custom',
    name: 'Image Provider',
    apiKey: 'token',
    baseUrl: 'https://api.example.com',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
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
          label: 'GPT Image',
          adapter: 'openai_images',
          outputFormats: ['png'],
          defaultSize: '1024x1024',
        }],
      },
    },
    ...overrides,
  }
}

function providerService(providers: SavedProvider[], activeId: string | null = providers[0]?.id ?? null) {
  return {
    async getProvider(id: string) {
      const provider = providers.find((candidate) => candidate.id === id)
      if (!provider) throw new Error(`not found: ${id}`)
      return provider
    },
    async listProviders() {
      return { providers, activeId }
    },
  }
}

function adapter(generate?: GenerationProviderAdapter['generate']): GenerationProviderAdapter {
  return {
    id: 'openai_images',
    generate: generate ?? (async () => [{
      fileName: 'image.png',
      mimeType: 'image/png',
      data: Buffer.from('image-data'),
      width: 1024,
      height: 1024,
    }]),
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-service-test-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

function request(workDir: string, overrides: Partial<GenerateArtifactRequest> = {}): GenerateArtifactRequest {
  return {
    kind: 'image',
    prompt: 'draw a dashboard',
    sessionId: 'session-1',
    workDir,
    ...overrides,
  }
}

describe('GenerationService', () => {
  test('generates an image artifact with the active image provider', async () => {
    await withTempDir(async (workDir) => {
      const svc = new GenerationService({
        providerService: providerService([imageProvider()]),
        adapters: [adapter()],
      })

      const result = await svc.generate(request(workDir))

      expect(result.artifacts).toHaveLength(1)
      const artifact = result.artifacts[0]
      expect(artifact).toMatchObject({
        kind: 'image',
        status: 'completed',
        title: 'GPT Image',
        providerId: 'provider-1',
        modelId: 'gpt-image-1',
        adapter: 'openai_images',
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
      })
      expect(artifact.relativePath).toContain('.echoflow/artifacts/session-1/')
      await expect(fs.readFile(path.join(workDir, artifact.relativePath!), 'utf-8')).resolves.toBe('image-data')
    })
  })

  test('uses explicit provider and model before defaults', async () => {
    await withTempDir(async (workDir) => {
      let contextSeen: ImageGenerationAdapterContext | undefined
      const provider = imageProvider({
        id: 'provider-2',
        generationCapabilities: {
          image: {
            enabled: true,
            models: [
              { id: 'default-image', adapter: 'openai_images', outputFormats: ['png'] },
              { id: 'requested-image', adapter: 'openai_images', outputFormats: ['webp'] },
            ],
          },
        },
      })
      const svc = new GenerationService({
        providerService: providerService([imageProvider(), provider]),
        adapters: [adapter(async (_request, context) => {
          contextSeen = context
          return [{ fileName: 'requested.webp', mimeType: 'image/webp', data: Buffer.from('webp') }]
        })],
      })

      await svc.generate(request(workDir, { providerId: 'provider-2', modelId: 'requested-image' }))

      expect(contextSeen?.provider.id).toBe('provider-2')
      expect(contextSeen?.model.id).toBe('requested-image')
    })
  })

  test('rejects generation when no provider has image capability enabled', async () => {
    await withTempDir(async (workDir) => {
      const svc = new GenerationService({
        providerService: providerService([imageProvider({ generationCapabilities: undefined })]),
        adapters: [adapter()],
      })

      await expect(svc.generate(request(workDir))).rejects.toThrow('No provider with image generation enabled is configured')
    })
  })

  test('falls back to the first image-capable provider when the active provider cannot generate images', async () => {
    await withTempDir(async (workDir) => {
      let providerSeen: string | undefined
      const activeTextProvider = imageProvider({
        id: 'text-provider',
        generationCapabilities: undefined,
      })
      const fallbackImageProvider = imageProvider({ id: 'image-provider' })
      const svc = new GenerationService({
        providerService: providerService([activeTextProvider, fallbackImageProvider], 'text-provider'),
        adapters: [adapter(async (_request, context) => {
          providerSeen = context.provider.id
          return [{ fileName: 'image.png', mimeType: 'image/png', data: Buffer.from('image-data') }]
        })],
      })

      const result = await svc.generate(request(workDir))

      expect(providerSeen).toBe('image-provider')
      expect(result.artifacts[0].providerId).toBe('image-provider')
    })
  })

  test('does not fall back when an explicit provider cannot generate images', async () => {
    await withTempDir(async (workDir) => {
      let called = false
      const textProvider = imageProvider({
        id: 'text-provider',
        generationCapabilities: undefined,
      })
      const fallbackImageProvider = imageProvider({ id: 'image-provider' })
      const svc = new GenerationService({
        providerService: providerService([textProvider, fallbackImageProvider], 'image-provider'),
        adapters: [adapter(async () => {
          called = true
          return [{ fileName: 'image.png', mimeType: 'image/png', data: Buffer.from('image-data') }]
        })],
      })

      await expect(svc.generate(request(workDir, { providerId: 'text-provider' })))
        .rejects.toThrow('does not have image generation enabled')
      expect(called).toBe(false)
    })
  })

  test('marks the pending artifact failed when adapter throws', async () => {
    await withTempDir(async (workDir) => {
      const svc = new GenerationService({
        providerService: providerService([imageProvider()]),
        adapters: [adapter(async () => {
          throw new Error('upstream failed')
        })],
      })

      await expect(svc.generate(request(workDir))).rejects.toThrow('upstream failed')

      const artifactRoot = path.join(workDir, '.echoflow', 'artifacts', 'session-1')
      const [artifactId] = await fs.readdir(artifactRoot)
      const metadata = JSON.parse(await fs.readFile(path.join(artifactRoot, artifactId, 'artifact.json'), 'utf-8'))
      expect(metadata).toMatchObject({
        status: 'failed',
        error: 'upstream failed',
      })
    })
  })
})
