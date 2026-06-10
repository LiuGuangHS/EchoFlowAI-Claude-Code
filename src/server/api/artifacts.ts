import { z } from 'zod'
import { errorResponse, ApiError } from '../middleware/errorHandler.js'
import { GenerationService } from '../services/generation/generationService.js'
import { OpenAIImageAdapter } from '../services/generation/openaiImageAdapter.js'
import { sessionService } from '../services/sessionService.js'

const GenerateArtifactSchema = z.object({
  kind: z.literal('image'),
  prompt: z.string().min(1),
  sessionId: z.string().min(1),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  constraints: z.object({
    size: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    format: z.enum(['png', 'jpeg', 'webp']).optional(),
    count: z.number().int().positive().max(10).optional(),
  }).optional(),
})

const generationService = new GenerationService({
  adapters: [new OpenAIImageAdapter()],
})

export async function handleArtifactsApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'generate') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      return await handleGenerate(req)
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleGenerate(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = GenerateArtifactSchema.parse(body)
    const workDir = await sessionService.getSessionWorkDir(input.sessionId)
    if (!workDir) {
      throw ApiError.notFound(`Session not found: ${input.sessionId}`)
    }
    const result = await generationService.generate({
      ...input,
      workDir,
    })
    return Response.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((issue) => issue.message).join('; '))
    throw err
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
