import type { GenerateArtifactRequest } from '../../types/generation.js'
import type { SavedProvider, ProviderImageGenerationModel } from '../../types/provider.js'

export interface GeneratedBinaryOutput {
  fileName: string
  mimeType: string
  data: Buffer
  width?: number
  height?: number
}

export interface ImageGenerationAdapterContext {
  provider: SavedProvider
  model: ProviderImageGenerationModel
}

export interface GenerationProviderAdapter {
  readonly id: ProviderImageGenerationModel['adapter']
  generate(
    request: GenerateArtifactRequest,
    context: ImageGenerationAdapterContext,
  ): Promise<GeneratedBinaryOutput[]>
}
