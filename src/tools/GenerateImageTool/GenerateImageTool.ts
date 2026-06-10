import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { GenerationService } from '../../server/services/generation/generationService.js'
import { OpenAIImageAdapter } from '../../server/services/generation/openaiImageAdapter.js'
import type { GeneratedArtifact } from '../../server/types/artifact.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { GENERATE_IMAGE_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().min(1).describe('The image generation prompt'),
    providerId: z.string().optional().describe('Optional image-capable provider id to use'),
    modelId: z.string().optional().describe('Optional image generation model id to use'),
    size: z.string().optional().describe('Optional provider size, such as 1024x1024'),
    width: z.number().int().positive().optional().describe('Optional image width in pixels'),
    height: z.number().int().positive().optional().describe('Optional image height in pixels'),
    format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Optional output format'),
    count: z.number().int().positive().max(10).optional().describe('Number of images to generate'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const artifactSchema = z.object({
  id: z.string(),
  kind: z.literal('image'),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  title: z.string(),
  relativePath: z.string().optional(),
  absolutePath: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  adapter: z.string().optional(),
  prompt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
}) satisfies z.ZodType<GeneratedArtifact>

const outputSchema = lazySchema(() =>
  z.object({
    artifacts: z.array(artifactSchema),
    markdown: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const generationService = new GenerationService({
  adapters: [new OpenAIImageAdapter()],
})

export const GenerateImageTool = buildTool({
  name: GENERATE_IMAGE_TOOL_NAME,
  searchHint: 'create generated image artifacts',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Claude wants to generate an image for: ${input.prompt}`
  },
  userFacingName() {
    return 'Generate Image'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  interruptBehavior() {
    return 'cancel'
  },
  toAutoClassifierInput(input) {
    return input.prompt
  },
  async checkPermissions(input): Promise<PermissionResult<Input>> {
    return {
      behavior: 'ask',
      message: 'Claude requested permission to generate image artifacts through a configured provider.',
      updatedInput: input,
      suggestions: [
        {
          type: 'addRules',
          destination: 'localSettings',
          rules: [{ toolName: GENERATE_IMAGE_TOOL_NAME }],
          behavior: 'allow',
        },
      ],
    }
  },
  async prompt() {
    return PROMPT
  },
  renderToolUseMessage(input) {
    return input.prompt ? `Generating image: ${input.prompt}` : 'Generating image'
  },
  renderToolResultMessage(output) {
    const count = output.artifacts.filter((artifact) => artifact.status === 'completed').length
    return count === 1 ? 'Generated 1 image' : `Generated ${count} images`
  },
  async call(input, context) {
    const result = await generationService.generate({
      kind: 'image',
      prompt: input.prompt,
      sessionId: getSessionId(),
      workDir: getCwd(),
      providerId: input.providerId,
      modelId: input.modelId,
      constraints: {
        ...(input.size !== undefined && { size: input.size }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
        ...(input.format !== undefined && { format: input.format }),
        ...(input.count !== undefined && { count: input.count }),
      },
      signal: context.abortController.signal,
    })
    const markdown = result.artifacts
      .filter((artifact) => artifact.status === 'completed' && artifact.relativePath)
      .map((artifact, index) => `![Generated image ${index + 1}](${artifact.relativePath})`)
      .join('\n')

    return {
      data: {
        artifacts: result.artifacts,
        markdown,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines = [
      `Generated ${output.artifacts.length} image artifact${output.artifacts.length === 1 ? '' : 's'}.`,
      '',
      output.markdown,
    ].filter(Boolean)

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
