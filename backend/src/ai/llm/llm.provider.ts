/**
 * LLM provider abstraction. The application never imports a vendor SDK directly; it talks to this
 * interface, which is selected by configuration (LLM_PROVIDER / LLM_API_KEY / LLM_MODEL / LLM_BASE_URL).
 * API keys are only ever read from the environment.
 */
export interface LlmRequest {
  system: string;
  user: string;
  /** Ask the provider to return a single JSON object. */
  expectJson: boolean;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

const TIMEOUT_MS = 25_000;

/** Any OpenAI-compatible Chat Completions endpoint (OpenAI, Azure gateways, local servers...). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai';
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: request.maxTokens ?? 1200,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        ...(request.expectJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LLM provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { text: body.choices?.[0]?.message?.content ?? '', provider: this.name, model: this.model };
  }
}

/** Anthropic Messages API. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 1200,
        temperature: 0,
        system: request.expectJson
          ? `${request.system}\n\nRespond with a single valid JSON object and nothing else.`
          : request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LLM provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return { text, provider: this.name, model: this.model };
  }
}

/** Extracts the first JSON object from model output (tolerates code fences and prose). */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object in LLM output');
  return JSON.parse(text.slice(start, end + 1));
}
