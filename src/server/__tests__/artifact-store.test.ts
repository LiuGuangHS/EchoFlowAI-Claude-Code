import { describe, test, expect } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ArtifactStore } from '../services/artifactStore.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-store-test-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('ArtifactStore', () => {
  test('creates pending metadata and completes an image artifact', async () => {
    await withTempDir(async (workDir) => {
      let tick = 0
      const store = new ArtifactStore({
        sessionId: 'session/one',
        workDir,
        createId: () => 'artifact/one',
        now: () => `2026-06-05T00:00:0${tick++}.000Z`,
      })

      const pending = await store.createPending({
        kind: 'image',
        title: 'GPT Image',
        prompt: 'draw a cat',
        providerId: 'provider-1',
        modelId: 'gpt-image-1',
        adapter: 'openai_images',
      })

      expect(pending).toMatchObject({
        id: 'artifact-one',
        status: 'pending',
        prompt: 'draw a cat',
        providerId: 'provider-1',
        modelId: 'gpt-image-1',
      })

      const written = await store.writeFile(pending, {
        fileName: 'image.png',
        data: Buffer.from('png-data'),
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
      })
      const completed = await store.complete(written)

      expect(completed).toMatchObject({
        status: 'completed',
        relativePath: '.echoflow/artifacts/session-one/artifact-one/image.png',
        mimeType: 'image/png',
        sizeBytes: 8,
        width: 1024,
        height: 1024,
      })

      const image = await fs.readFile(path.join(workDir, completed.relativePath!))
      expect(image.toString()).toBe('png-data')

      const metadata = await store.read('artifact-one')
      expect(metadata).toEqual(completed)
    })
  })

  test('keeps sanitized artifact paths inside the artifact root', async () => {
    await withTempDir(async (workDir) => {
      const store = new ArtifactStore({
        sessionId: '../../outside',
        workDir,
        createId: () => '../..',
        now: () => '2026-06-05T00:00:00.000Z',
      })

      const pending = await store.createPending({ kind: 'image', title: 'Image' })
      const written = await store.writeFile(pending, {
        fileName: '../../escape.png',
        data: Buffer.from('safe'),
        mimeType: 'image/png',
      })

      expect(written.relativePath).toBe('.echoflow/artifacts/outside/artifact/escape.png')
      await expect(fs.readFile(path.join(workDir, written.relativePath!), 'utf-8')).resolves.toBe('safe')
      await expect(fs.readdir(path.join(workDir, '.echoflow', 'artifacts'))).resolves.toEqual(['outside'])
    })
  })

  test('records failures without deleting written files', async () => {
    await withTempDir(async (workDir) => {
      const store = new ArtifactStore({
        sessionId: 'session-two',
        workDir,
        createId: () => 'artifact-two',
        now: () => '2026-06-05T00:00:00.000Z',
      })
      const pending = await store.createPending({ kind: 'image', title: 'Image' })
      const written = await store.writeFile(pending, {
        fileName: 'image.png',
        data: Buffer.from('kept'),
        mimeType: 'image/png',
      })

      const failed = await store.fail(written, 'provider failed')

      expect(failed).toMatchObject({
        status: 'failed',
        error: 'provider failed',
        relativePath: '.echoflow/artifacts/session-two/artifact-two/image.png',
      })
      await expect(fs.readFile(path.join(workDir, failed.relativePath!), 'utf-8')).resolves.toBe('kept')
    })
  })
})
