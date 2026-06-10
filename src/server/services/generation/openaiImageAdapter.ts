import * as dns from 'dns/promises'
import * as net from 'net'
import { ApiError } from '../../middleware/errorHandler.js'
import { getPresetAuthStrategy, getPresetDefaultEnv } from '../providerRuntimeEnv.js'
import type { GenerateArtifactRequest } from '../../types/generation.js'
import type { SavedProvider } from '../../types/provider.js'
import type {
  GeneratedBinaryOutput,
  GenerationProviderAdapter,
  ImageGenerationAdapterContext,
} from './providerAdapters.js'

type OpenAIImageResponse = {
  data?: Array<{
    b64_json?: string
    url?: string
    revised_prompt?: string
  }>
}

type FetchLike = typeof fetch

type OpenAIImageAdapterOptions = {
  fetch?: FetchLike
}

export class OpenAIImageAdapter implements GenerationProviderAdapter {
  readonly id = 'openai_images' as const
  private readonly fetchImpl?: FetchLike

  constructor(options: OpenAIImageAdapterOptions = {}) {
    this.fetchImpl = options.fetch
  }

  async generate(
    request: GenerateArtifactRequest,
    context: ImageGenerationAdapterContext,
  ): Promise<GeneratedBinaryOutput[]> {
    const endpoint = await buildSafeImageGenerationEndpoint(context.provider.baseUrl)
    const response = await (this.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(context.provider),
      },
      signal: request.signal,
      body: JSON.stringify({
        model: context.model.id,
        prompt: request.prompt,
        size: resolveSize(request, context.model.defaultSize),
        n: Math.max(1, request.constraints?.count ?? 1),
        response_format: 'b64_json',
      }),
    })

    if (!response.ok) {
      throw ApiError.badRequest(`Image generation provider failed with HTTP ${response.status}`)
    }

    const json = await response.json() as OpenAIImageResponse
    const outputs = json.data?.flatMap((item, index) => {
      if (!item.b64_json) return []
      return [{
        fileName: `image-${index + 1}.png`,
        mimeType: 'image/png',
        data: Buffer.from(item.b64_json, 'base64'),
      }]
    }) ?? []

    if (outputs.length === 0) {
      throw ApiError.badRequest('Image generation provider returned no base64 image data')
    }

    return outputs
  }
}

async function buildSafeImageGenerationEndpoint(baseUrl: string): Promise<string> {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw ApiError.badRequest('Invalid image generation provider base URL')
  }

  if (url.protocol !== 'https:') {
    throw ApiError.badRequest('Image generation provider base URL must use HTTPS')
  }

  await assertPublicHostname(url.hostname)
  return new URL('/v1/images/generations', url).toString()
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const addresses = await resolveHostname(hostname)
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw ApiError.badRequest('Image generation provider base URL resolves to a restricted network address')
  }
}

async function resolveHostname(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return [hostname]

  try {
    return (await dns.lookup(hostname, { all: true })).map((entry) => entry.address)
  } catch {
    throw ApiError.badRequest('Unable to resolve image generation provider hostname')
  }
}

function isBlockedAddress(address: string): boolean {
  return isBlockedIPv4(address) || isBlockedIPv6(address)
}

function isBlockedIPv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false
  const parts = address.split('.').map((part) => Number(part))
  const [a, b] = parts

  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isBlockedIPv6(address: string): boolean {
  if (net.isIP(address) !== 6) return false
  const normalized = address.toLowerCase()

  return normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:169.254.')
}

function buildAuthHeaders(provider: SavedProvider): Record<string, string> {
  const presetEnv = getPresetDefaultEnv(provider.presetId)
  const authStrategy = provider.authStrategy ?? getPresetAuthStrategy(provider.presetId)
  const key = provider.apiKey || presetEnv.ANTHROPIC_AUTH_TOKEN || presetEnv.ANTHROPIC_API_KEY || ''
  if (!key && authStrategy !== 'dual_dummy') return {}

  switch (authStrategy) {
    case 'api_key':
    case 'auth_token':
    case 'auth_token_empty_api_key':
    case 'dual_same_token':
      return { Authorization: `Bearer ${key}` }
    case 'dual_dummy':
      return { Authorization: 'Bearer dummy' }
  }
}

function resolveSize(request: GenerateArtifactRequest, defaultSize?: string): string {
  if (request.constraints?.size) return request.constraints.size
  if (request.constraints?.width && request.constraints?.height) {
    return `${request.constraints.width}x${request.constraints.height}`
  }
  return defaultSize ?? '1024x1024'
}
