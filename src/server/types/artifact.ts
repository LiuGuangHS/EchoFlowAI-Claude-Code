export type ArtifactKind = 'image'

export type ArtifactStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface GeneratedArtifact {
  id: string
  kind: ArtifactKind
  status: ArtifactStatus
  title: string
  relativePath?: string
  absolutePath?: string
  mimeType?: string
  sizeBytes?: number
  width?: number
  height?: number
  providerId?: string
  modelId?: string
  adapter?: string
  prompt?: string
  createdAt: string
  updatedAt: string
  error?: string
}
