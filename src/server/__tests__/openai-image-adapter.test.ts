import { describe, test, expect } from 'bun:test'
import { OpenAIImageAdapter } from '../services/generation/openaiImageAdapter.js'
import type { GenerateArtifactRequest } from '../types/generation.js'
import type { SavedProvider } from '../types/provider.js'

function provider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    id: 'provider-1',
    presetId: 'custom',
    name: 'Image Provider',
    apiKey: 'token-1',
    baseUrl: 'https://93.184.216.34/',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
    models: {
      main: 'claude-sonnet',
      haiku: 'claude-haiku',
      sonnet: 'claude-sonnet',
      opus: 'claude-opus',
    },
    ...overrides,
  }
}

const request: GenerateArtifactRequest = {
  kind: 'image',
  prompt: 'draw a cat',
  sessionId: 'session-1',
  constraints: {
    size: '1024x1024',
    format: 'webp',
    count: 2,
  },
}

describe('OpenAIImageAdapter', () => {
  test('calls OpenAI Images-compatible endpoint and decodes base64 output', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const signal = new AbortController().signal
    const adapter = new OpenAIImageAdapter({
      fetch: (async (url, init) => {
        capturedUrl = String(url)
        capturedInit = init
        return Response.json({
          data: [
            { b64_json: Buffer.from('image-one').toString('base64') },
            { b64_json: Buffer.from('image-two').toString('base64') },
          ],
        })
      }) as typeof fetch,
    })

    const outputs = await adapter.generate({ ...request, signal }, {
      provider: provider(),
      model: {
        id: 'gpt-image-1',
        adapter: 'openai_images',
        outputFormats: ['webp'],
      },
    })

    expect(capturedUrl).toBe('https://93.184.216.34/v1/images/generations')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.redirect).toBe('manual')
    expect(capturedInit?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-1',
    })
    expect(capturedInit?.signal).toBe(signal)
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: 'gpt-image-1',
      prompt: 'draw a cat',
      size: '1024x1024',
      n: 2,
      response_format: 'b64_json',
    })
    expect(outputs).toEqual([
      {
        fileName: 'image-1.png',
        mimeType: 'image/png',
        data: Buffer.from('image-one'),
      },
      {
        fileName: 'image-2.png',
        mimeType: 'image/png',
        data: Buffer.from('image-two'),
      },
    ])
  })

  test('rejects restricted provider base URLs before fetching', async () => {
    let called = false
    const adapter = new OpenAIImageAdapter({
      fetch: (async () => {
        called = true
        return Response.json({ data: [] })
      }) as typeof fetch,
    })

    await expect(adapter.generate(request, {
      provider: provider({ baseUrl: 'https://127.0.0.1:8080' }),
      model: { id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'] },
    })).rejects.toThrow('restricted network address')
    expect(called).toBe(false)
  })

  test('rejects plaintext provider base URLs before fetching', async () => {
    let called = false
    const adapter = new OpenAIImageAdapter({
      fetch: (async () => {
        called = true
        return Response.json({ data: [] })
      }) as typeof fetch,
    })

    await expect(adapter.generate(request, {
      provider: provider({ baseUrl: 'http://93.184.216.34' }),
      model: { id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'] },
    })).rejects.toThrow('must use HTTPS')
    expect(called).toBe(false)
  })

  test('rejects responses without base64 image data', async () => {
    const adapter = new OpenAIImageAdapter({
      fetch: (async () => Response.json({ data: [{ url: 'https://example.com/image.png' }] })) as typeof fetch,
    })

    await expect(adapter.generate(request, {
      provider: provider(),
      model: { id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'] },
    })).rejects.toThrow('Image generation provider returned no base64 image data')
  })

  test('rejects non-OK provider responses', async () => {
    const adapter = new OpenAIImageAdapter({
      fetch: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
    })

    await expect(adapter.generate(request, {
      provider: provider(),
      model: { id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'] },
    })).rejects.toThrow('Image generation provider failed with HTTP 429')
  })

  test('propagates invalid JSON provider responses', async () => {
    const adapter = new OpenAIImageAdapter({
      fetch: (async () => new Response('not json', {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
    })

    await expect(adapter.generate(request, {
      provider: provider(),
      model: { id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'] },
    })).rejects.toThrow()
  })
})
