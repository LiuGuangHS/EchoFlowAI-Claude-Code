import type { ArtifactKind, GeneratedArtifact } from './artifact.js'

export interface GenerateArtifactRequest {
  kind: ArtifactKind
  prompt: string
  sessionId: string
  workDir?: string | null
  providerId?: string
  modelId?: string
  signal?: AbortSignal
  constraints?: {
    size?: string
    width?: number
    height?: number
    format?: 'png' | 'jpeg' | 'webp'
    count?: number
  }
}

export interface GenerateArtifactResult {
  artifacts: GeneratedArtifact[]
}
