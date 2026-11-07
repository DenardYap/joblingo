export function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
  for (const key of ['EXA_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'APP_PASSWORD', 'SESSION_SECRET', 'DATABASE_URL']) {
    const value = process.env[key];
    if (value) message = message.replaceAll(value, '[redacted]');
  }
  return message.replace(/sk-[\w-]+/g, '[redacted]').slice(0, 300);
}

export function providerError(provider: string, error: unknown): Error {
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const billing: Record<string,string> = {
    credit_balance_exhausted:'API credits are exhausted. Add credits in the provider billing settings.',
    insufficient_quota:'API quota is unavailable. Check credits and spending limits.',
    organization_spend_limit_exceeded:'The organization spending limit was reached.',
    project_spend_limit_exceeded:'The project spending limit was reached.',
    organization_usage_limit_exceeded:'The organization usage limit was reached.',
  };
  const message = status === 401 || status === 403 ? 'Check its server credentials and account access.'
    : status === 429 ? billing[code] ?? 'The temporary rate limit persisted after waiting. Retry to continue with saved matches.'
      : 'The request could not finish. Try again shortly.';
  return new Error(`${provider}: ${message}`);
}

export function providerRetryDelay(error: unknown, attempt: number): number | null {
  if (!error || typeof error !== 'object' || !('status' in error) || ![429,503].includes(Number(error.status)) || attempt>=3) return null;
  const code='code' in error ? String(error.code) : '';
  const type='type' in error ? String(error.type) : '';
  if (type==='insufficient_quota' || /quota|credit_balance|spend_limit|usage_limit/.test(code)) return null;
  const headers='headers' in error ? error.headers as {get?:(key:string)=>string|null} : undefined;
  const raw=headers?.get?.('retry-after');
  const requested=raw ? (Number.isFinite(Number(raw)) ? Number(raw)*1000 : Date.parse(raw)-Date.now()) : 0;
  // Honor the service's delay. Very long limits remain an actionable interruption.
  if (requested>180000) return null;
  return Math.max(requested||0,30000*2**attempt)+Math.floor(Math.random()*1000);
}
