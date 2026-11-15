export interface AppConfig {
  port: number;
  trustProxy: number;
  authRateLimit: { limit: number; ttlMs: number };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  corsOrigin: string;
  logLevel: string;
  llm: {
    provider: 'openai' | 'anthropic' | 'heuristic';
    apiKey: string | null;
    model: string;
    baseUrl: string;
  };
}

/** "15m", "7d", "3600" (seconds) -> seconds. */
export function parseDurationSeconds(value: string, fallback: number): number {
  const m = /^(\d+)\s*([smhd]?)$/i.exec(value.trim());
  if (!m) return fallback;
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase() as '' | 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

function jwtSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to a random string of at least 32 characters in production.`);
  }
  // Development and tests only. Never reached in production (the check above throws).
  return `dev-only-insecure-${name.toLowerCase()}-change-me-0123456789`;
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
    // Number of reverse proxies in front of the API (Render = 1). Needed for correct client IPs.
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    authRateLimit: {
      limit: Number(process.env.AUTH_RATE_LIMIT ?? 10),
      ttlMs: parseDurationSeconds(process.env.AUTH_RATE_WINDOW ?? '60s', 60) * 1000,
    },
    jwt: {
      accessSecret: jwtSecret('JWT_ACCESS_SECRET'),
      refreshSecret: jwtSecret('JWT_REFRESH_SECRET'),
      accessTtlSeconds: parseDurationSeconds(process.env.JWT_ACCESS_TTL ?? '15m', 900),
      refreshTtlSeconds: parseDurationSeconds(process.env.JWT_REFRESH_TTL ?? '7d', 604800),
    },
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
