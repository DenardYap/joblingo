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
  const message = status === 401 || status === 403 ? 'Check its server credentials and account access.'
    : status === 429 ? 'The account limit was reached. Check quota or try again later.'
      : 'The request could not finish. Try again shortly.';
  return new Error(`${provider}: ${message}`);
}
