import { ApiError } from '../../middleware/errorHandler.js'
import { ArtifactStore } from '../artifactStore.js'
import { ProviderService } from '../providerService.js'
import type { GeneratedArtifact } from '../../types/artifact.js'
import type { GenerateArtifactRequest, GenerateArtifactResult } from '../../types/generation.js'
import type { ProviderImageGenerationModel, SavedProvider } from '../../types/provider.js'
import type { GenerationProviderAdapter } from './providerAdapters.js'

type GenerationServiceOptions = {
  providerService?: Pick<ProviderService, 'getProvider' | 'listProviders'>
  adapters: GenerationProviderAdapter[]
  createArtifactStore?: (request: GenerateArtifactRequest) => ArtifactStore
}

export class GenerationService {
  private readonly providerService: Pick<ProviderService, 'getProvider' | 'listProviders'>
  private readonly adapters: Map<ProviderImageGenerationModel['adapter'], GenerationProviderAdapter>
  private readonly createArtifactStore: (request: GenerateArtifactRequest) => ArtifactStore

  constructor(options: GenerationServiceOptions) {
    this.providerService = options.providerService ?? new ProviderService()
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.id, adapter]))
    this.createArtifactStore = options.createArtifactStore ?? ((request) => new ArtifactStore({
      sessionId: request.sessionId,
      workDir: request.workDir,
    }))
  }

  async generate(request: GenerateArtifactRequest): Promise<GenerateArtifactResult> {
    if (request.kind !== 'image') {
      throw ApiError.badRequest(`Unsupported artifact kind: ${request.kind}`)
    }

    if (!request.prompt.trim()) {
      throw ApiError.badRequest('Image generation prompt is required')
    }

    const provider = await this.resolveProvider(request.providerId)
    const model = this.resolveImageModel(provider, request.modelId)
    const adapter = this.adapters.get(model.adapter)

    if (!adapter) {
      throw ApiError.badRequest(`Unsupported image generation adapter: ${model.adapter}`)
    }

    const store = this.createArtifactStore(request)
    const pendingInput = {
      kind: 'image' as const,
      title: model.label ?? model.id,
      prompt: request.prompt,
      providerId: provider.id,
      modelId: model.id,
      adapter: model.adapter,
    }
    const pending = await store.createPending(pendingInput)

    try {
      const outputs = await adapter.generate(request, { provider, model })
      if (outputs.length === 0) {
        throw new Error('Image provider returned no images')
      }

      const artifacts: GeneratedArtifact[] = []
      for (const [index, output] of outputs.entries()) {
        const baseArtifact = index === 0
          ? pending
          : await store.createPending(pendingInput)
        const written = await store.writeFile(baseArtifact, output)
        artifacts.push(await store.complete(written, {
          mimeType: output.mimeType,
          width: output.width,
          height: output.height,
        }))
      }

      return { artifacts }
    } catch (error) {
      await store.fail(pending, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private async resolveProvider(providerId?: string): Promise<SavedProvider> {
    if (providerId) {
      return this.providerService.getProvider(providerId)
    }

    const { providers, activeId } = await this.providerService.listProviders()
    const activeProvider = activeId
      ? providers.find((provider) => provider.id === activeId)
      : undefined
    const provider = activeProvider && hasEnabledImageGeneration(activeProvider)
      ? activeProvider
      : providers.find(hasEnabledImageGeneration)

    if (!provider || !hasEnabledImageGeneration(provider)) {
      throw ApiError.badRequest('No provider with image generation enabled is configured')
    }

    return provider
  }

  private resolveImageModel(
    provider: SavedProvider,
    requestedModelId?: string,
  ): ProviderImageGenerationModel {
    const image = provider.generationCapabilities?.image
    if (!image?.enabled || image.models.length === 0) {
      throw ApiError.badRequest(`Provider ${provider.name} does not have image generation enabled`)
    }

    const model = requestedModelId
      ? image.models.find((candidate) => candidate.id === requestedModelId)
      : image.models.find((candidate) => candidate.id === image.defaultModelId) ?? image.models[0]

    if (!model) {
      throw ApiError.badRequest(
        requestedModelId
          ? `Image generation model not configured: ${requestedModelId}`
          : `Provider ${provider.name} has no image generation models configured`,
      )
    }

    return model
  }
}

function hasEnabledImageGeneration(provider: SavedProvider): boolean {
  return provider.generationCapabilities?.image.enabled === true &&
    provider.generationCapabilities.image.models.length > 0
}
