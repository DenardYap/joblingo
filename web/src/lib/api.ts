export class ApiError extends Error {
  constructor(message: string, public status = 0, public retryable = false) { super(message); this.name = 'ApiError'; }
}
export async function responseBody<T>(response: Response): Promise<T> {
  if (response.status === 401) window.dispatchEvent(new Event('workspace-auth'));
  let text: string;
  try { text = await response.text(); }
  catch { throw new ApiError('The connection was interrupted. Please try again.', response.status, true); }
  let body: unknown;
  try { body = text.trim() ? JSON.parse(text) : undefined; } catch { /* A proxy or restarting server can return HTML or an empty body. */ }
  if (response.status === 204 && response.ok) return undefined as T;
  if (!response.ok) {
    const supplied = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null;
    const fallback = response.status === 401 ? 'Sign in to your workspace.'
      : response.status === 429 ? 'Too many requests. Please try again shortly.'
        : response.status >= 500 ? 'The server is temporarily unavailable. Please try again in a moment.'
          : 'The request could not finish. Please try again.';
    throw new ApiError(supplied || fallback, response.status, response.status >= 500);
  }
  if (body === undefined) throw new ApiError('The server returned an incomplete response. Please try again in a moment.', response.status, true);
  return body as T;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  // Only retry reads. A mutation may have committed before its response was lost.
  const attempts = method === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let response: Response;
      try { response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } }); }
      catch (error) {
        if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, true);
      }
      return await responseBody<T>(response);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable || attempt === attempts - 1 || options.signal?.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new ApiError('The request could not finish. Please try again.');
}
export const post = <T>(path: string, data: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function localDate(value: string, timezone = 'America/Los_Angeles') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function displayDate(value: string, timezone = 'America/Los_Angeles') { if (!Number.isFinite(Date.parse(value))) return 'Not listed'; return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
export function timeAgo(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Not listed';
  const time=Date.parse(value); if(!Number.isFinite(time))return 'Not listed';
  const seconds=Math.max(0,(Date.now()-time)/1000);
  if(seconds<60)return 'Just now';
  if(seconds<3600){const n=Math.floor(seconds/60);return `${n} min ago`;}
  if(seconds<86400){const n=Math.floor(seconds/3600);return `${n} hr ago`;}
  const days=Math.floor(seconds/86400);return `${days} ${days===1?'day':'days'} ago`;
}
