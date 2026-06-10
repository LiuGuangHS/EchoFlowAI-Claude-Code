import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { ArtifactKind, GeneratedArtifact } from '../types/artifact.js'

type ArtifactStoreOptions = {
  sessionId: string
  workDir?: string | null
  now?: () => string
  createId?: () => string
}

type CreatePendingInput = {
  kind: ArtifactKind
  title: string
  prompt?: string
  providerId?: string
  modelId?: string
  adapter?: string
}

type CompleteInput = {
  mimeType?: string
  width?: number
  height?: number
}

export type ArtifactFileInput = {
  fileName: string
  data: Buffer
  mimeType?: string
  width?: number
  height?: number
}

export class ArtifactStore {
  private readonly sessionId: string
  private readonly workDir: string | null
  private readonly now: () => string
  private readonly createId: () => string

  constructor(options: ArtifactStoreOptions) {
    this.sessionId = sanitizePathSegment(options.sessionId)
    this.workDir = options.workDir ? path.resolve(options.workDir) : null
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => `artifact_${crypto.randomUUID()}`)
  }

  async createPending(input: CreatePendingInput): Promise<GeneratedArtifact> {
    const timestamp = this.now()
    const artifact: GeneratedArtifact = {
      id: sanitizePathSegment(this.createId()),
      kind: input.kind,
      status: 'pending',
      title: input.title,
      ...(input.prompt !== undefined && { prompt: input.prompt }),
      ...(input.providerId !== undefined && { providerId: input.providerId }),
      ...(input.modelId !== undefined && { modelId: input.modelId }),
      ...(input.adapter !== undefined && { adapter: input.adapter }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await this.writeMetadata(artifact)
    return artifact
  }

  async writeFile(artifact: GeneratedArtifact, input: ArtifactFileInput): Promise<GeneratedArtifact> {
    const artifactDir = await this.getArtifactDir(artifact.id)
    await fs.mkdir(artifactDir, { recursive: true })

    const fileName = sanitizeFileName(input.fileName)
    const absolutePath = assertInsideRoot(artifactDir, path.resolve(artifactDir, fileName))
    await fs.writeFile(absolutePath, input.data)

    const completed: GeneratedArtifact = {
      ...artifact,
      status: 'running',
      absolutePath,
      relativePath: this.toRelativePath(absolutePath),
      sizeBytes: input.data.byteLength,
      ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
      ...(input.width !== undefined && { width: input.width }),
      ...(input.height !== undefined && { height: input.height }),
      updatedAt: this.now(),
    }
    await this.writeMetadata(completed)
    return completed
  }

  async complete(artifact: GeneratedArtifact, input: CompleteInput = {}): Promise<GeneratedArtifact> {
    const completed: GeneratedArtifact = {
      ...artifact,
      status: 'completed',
      ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
      ...(input.width !== undefined && { width: input.width }),
      ...(input.height !== undefined && { height: input.height }),
      updatedAt: this.now(),
    }
    await this.writeMetadata(completed)
    return completed
  }

  async fail(artifact: GeneratedArtifact, error: string): Promise<GeneratedArtifact> {
    const failed: GeneratedArtifact = {
      ...artifact,
      status: 'failed',
      error,
      updatedAt: this.now(),
    }
    await this.writeMetadata(failed)
    return failed
  }

  async read(id: string): Promise<GeneratedArtifact | null> {
    try {
      const raw = await fs.readFile(await this.getMetadataPath(sanitizePathSegment(id)), 'utf-8')
      return JSON.parse(raw) as GeneratedArtifact
    } catch {
      return null
    }
  }

  private async writeMetadata(artifact: GeneratedArtifact): Promise<void> {
    const artifactDir = await this.getArtifactDir(artifact.id)
    await fs.mkdir(artifactDir, { recursive: true })
    const metadataPath = assertInsideRoot(artifactDir, path.resolve(artifactDir, 'artifact.json'))
    await fs.writeFile(metadataPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8')
  }

  private async getArtifactDir(id: string): Promise<string> {
    const artifactsRoot = await this.getArtifactsRoot()
    return assertInsideRoot(artifactsRoot, path.resolve(artifactsRoot, this.sessionId, sanitizePathSegment(id)))
  }

  private async getMetadataPath(id: string): Promise<string> {
    const artifactDir = await this.getArtifactDir(id)
    return assertInsideRoot(artifactDir, path.resolve(artifactDir, 'artifact.json'))
  }

  private async getArtifactsRoot(): Promise<string> {
    const artifactsRoot = this.workDir
      ? path.join(this.workDir, '.echoflow', 'artifacts')
      : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'echoflow-artifacts')

    await fs.mkdir(artifactsRoot, { recursive: true })
    return fs.realpath(artifactsRoot)
  }

  private toRelativePath(absolutePath: string): string {
    if (!this.workDir) return absolutePath
    return toPosixPath(path.relative(this.workDir, absolutePath))
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/\.+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!sanitized) return 'artifact'
  return sanitized
}

function sanitizeFileName(value: string): string {
  const extension = path.extname(value).replace(/[^a-zA-Z0-9.]/g, '') || '.png'
  const name = path.basename(value, path.extname(value))
    .replace(/\.+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name || 'image'}${extension}`
}

function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedTarget
  }

  throw new Error('Artifact path escaped artifact root')
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}
