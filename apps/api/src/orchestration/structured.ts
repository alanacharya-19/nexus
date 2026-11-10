import type { ZodType } from 'zod';
import { extractJsonValue } from '@nexus/shared';
import { Errors } from '../errors.js';
import { completeWithRetry, type StreamOptions } from '../providers/service.js';
import type {
  CompletionResult,
  GenerationRequest,
  ProviderAdapter,
} from '../providers/types.js';

export interface StructuredResult<T> {
  data: T;
  raw: string;
  usage: Pick<CompletionResult, 'inputTokens' | 'outputTokens' | 'estimatedUsage'>;
}

/**
 * Ask a model for structured JSON, validate it with Zod, and make one repair
 * attempt with the validation errors if the first response is unusable. Both
 * attempts' token usage is returned so cost tracking stays accurate.
 */
export async function generateStructured<T>(
  adapter: ProviderAdapter,
  request: GenerationRequest,
  schema: ZodType<T>,
  options: StreamOptions & { maxRepairAttempts?: number } = {}
): Promise<StructuredResult<T>> {
  const maxRepairs = options.maxRepairAttempts ?? 1;

  const first = await completeWithRetry(adapter, { ...request, json: true }, options);
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let estimatedUsage = first.estimatedUsage;

  const firstParse = tryParse(first.text, schema);
  if (firstParse.success) {
    return {
      data: firstParse.data,
      raw: first.text,
      usage: { inputTokens, outputTokens, estimatedUsage },
    };
  }

  let lastRaw = first.text;
  let lastErrors = firstParse.errors;

  for (let repair = 0; repair < maxRepairs; repair += 1) {
    const repairRequest: GenerationRequest = {
      ...request,
      json: true,
      temperature: Math.min(request.temperature, 0.2),
      messages: [
        ...request.messages,
        { role: 'assistant', content: lastRaw },
        {
          role: 'user',
          content: `Your previous response did not satisfy the required JSON schema.

Validation errors:
${lastErrors}

Return a corrected response that is ONLY valid JSON. Do not add markdown fences, explanations, or new facts that are not supported by the task.`,
        },
      ],
    };

    const repaired = await completeWithRetry(adapter, repairRequest, options);
    inputTokens += repaired.inputTokens;
    outputTokens += repaired.outputTokens;
    estimatedUsage = estimatedUsage || repaired.estimatedUsage;
    lastRaw = repaired.text;

    const parsed = tryParse(repaired.text, schema);
    if (parsed.success) {
      return {
        data: parsed.data,
        raw: repaired.text,
        usage: { inputTokens, outputTokens, estimatedUsage },
      };
    }
    lastErrors = parsed.errors;
  }

  throw Errors.aiInvalidOutput(
    'The model did not return valid structured output after a repair attempt.',
    { errors: lastErrors, preview: lastRaw.slice(0, 600) }
  );
}

function tryParse<T>(
  raw: string,
  schema: ZodType<T>
): { success: true; data: T } | { success: false; errors: string } {
  try {
    const json = extractJsonValue(raw);
    const result = schema.safeParse(json);
    if (result.success) return { success: true, data: result.data };
    return {
      success: false,
      errors: result.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    };
  } catch (error) {
    return {
      success: false,
      errors: error instanceof Error ? error.message : 'Response was not valid JSON',
    };
  }
}
