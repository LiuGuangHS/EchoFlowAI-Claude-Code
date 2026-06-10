import { describe, expect, it } from 'vitest'
import type { ProviderGenerationCapabilities } from '../types/provider'
import {
  buildImageGenerationCapabilities,
  createDefaultGenerationCapabilities,
  createDefaultImageGenerationModel,
  formatImageGenerationSummary,
  getImageGenerationCapabilities,
  normalizeImageGenerationModels,
  validateImageGenerationCapabilities,
} from './Settings'

function capabilities(
  overrides: Partial<ProviderGenerationCapabilities['image']> = {},
): ProviderGenerationCapabilities {
  return {
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
      ...overrides,
    },
  }
}

describe('validateImageGenerationCapabilities', () => {
  it('accepts disabled or valid image generation settings', () => {
    expect(validateImageGenerationCapabilities(undefined)).toBeNull()
    expect(validateImageGenerationCapabilities({ image: { enabled: false, models: [] } })).toBeNull()
    expect(validateImageGenerationCapabilities(capabilities())).toBeNull()
  })

  it('rejects image generation settings that cannot be saved safely', () => {
    expect(validateImageGenerationCapabilities(capabilities({ models: [] }))).toContain('at least one')
    expect(validateImageGenerationCapabilities(capabilities({
      models: [{ id: ' ', adapter: 'openai_images', outputFormats: ['png'] }],
    }))).toContain('model ID')
    expect(validateImageGenerationCapabilities(capabilities({
      defaultModelId: 'missing-model',
    }))).toContain('Default image model')
    expect(validateImageGenerationCapabilities(capabilities({
      models: [{ id: 'gpt-image-1', adapter: 'openai_images', outputFormats: [] }],
    }))).toContain('output format')
    expect(validateImageGenerationCapabilities(capabilities({
      models: [{ id: 'gpt-image-1', adapter: 'openai_images', outputFormats: ['png'], defaultSize: 'large' }],
    }))).toContain('1024x1024')
  })
})

describe('image generation provider settings helpers', () => {
  it('creates a complete OpenAI Images-compatible default model', () => {
    expect(createDefaultImageGenerationModel()).toEqual({
      id: 'gpt-image-1',
      label: 'GPT Image 1',
      adapter: 'openai_images',
      outputFormats: ['png'],
      defaultSize: '1024x1024',
    })
    expect(createDefaultGenerationCapabilities()).toEqual({
      image: {
        enabled: true,
        defaultModelId: 'gpt-image-1',
        models: [createDefaultImageGenerationModel()],
      },
    })
  })

  it('normalizes missing or empty image model lists to a saveable default', () => {
    expect(getImageGenerationCapabilities(undefined)).toEqual(createDefaultGenerationCapabilities())
    expect(normalizeImageGenerationModels(undefined)).toEqual([createDefaultImageGenerationModel()])
    expect(normalizeImageGenerationModels({ image: { enabled: true, models: [] } })).toEqual([
      createDefaultImageGenerationModel(),
    ])
  })

  it('summarizes disabled, empty, singular, and plural image model states', () => {
    expect(formatImageGenerationSummary(undefined)).toBe('Disabled')
    expect(formatImageGenerationSummary({ image: { enabled: false, models: [] } })).toBe('Disabled')
    expect(formatImageGenerationSummary({ image: { enabled: true, models: [] } })).toBe('Enabled, no image models configured')
    expect(formatImageGenerationSummary(capabilities())).toBe('1 image model configured')
    expect(formatImageGenerationSummary(capabilities({
      models: [
        { id: 'image-a', adapter: 'openai_images', outputFormats: ['png'] },
        { id: 'image-b', adapter: 'openai_images', outputFormats: ['webp'] },
      ],
    }))).toBe('2 image models configured')
  })

  it('builds image generation capabilities and falls back to the first model when the default is removed', () => {
    expect(buildImageGenerationCapabilities(false, [], undefined)).toEqual({
      image: {
        enabled: false,
        models: [],
      },
    })
    expect(buildImageGenerationCapabilities(true, [
      { id: 'image-a', adapter: 'openai_images', outputFormats: ['png'] },
      { id: 'image-b', adapter: 'openai_images', outputFormats: ['webp'] },
    ], 'image-b')).toEqual({
      image: {
        enabled: true,
        defaultModelId: 'image-b',
        models: [
          { id: 'image-a', adapter: 'openai_images', outputFormats: ['png'] },
          { id: 'image-b', adapter: 'openai_images', outputFormats: ['webp'] },
        ],
      },
    })
    expect(buildImageGenerationCapabilities(true, [
      { id: 'image-a', adapter: 'openai_images', outputFormats: ['png'] },
    ], 'removed')).toEqual({
      image: {
        enabled: true,
        defaultModelId: 'image-a',
        models: [{ id: 'image-a', adapter: 'openai_images', outputFormats: ['png'] }],
      },
    })
  })
})
