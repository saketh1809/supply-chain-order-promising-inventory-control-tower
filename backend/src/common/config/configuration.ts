export interface AppConfig {
  port: number;
  corsOrigin: string;
  logLevel: string;
  llm: {
    provider: 'openai' | 'anthropic' | 'heuristic';
    apiKey: string | null;
    model: string;
    baseUrl: string;
  };
}

export default (): AppConfig => {
  const rawProvider = (process.env.LLM_PROVIDER ?? 'heuristic').toLowerCase();
  const apiKey = process.env.LLM_API_KEY?.trim() || null;
  // Without a key we fall back to the deterministic provider so the app is fully usable offline.
  const provider: AppConfig['llm']['provider'] =
    apiKey && (rawProvider === 'openai' || rawProvider === 'anthropic') ? rawProvider : 'heuristic';
  const defaultModel = provider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-4.1-mini';
  return {
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    logLevel: process.env.LOG_LEVEL ?? 'log',
    llm: {
      provider,
      apiKey,
      model: process.env.LLM_MODEL?.trim() || defaultModel,
      baseUrl: process.env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
    },
  };
};
