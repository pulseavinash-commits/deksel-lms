export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Opts {
  method?: string;
  body?: unknown;
  formData?: FormData;
}

/**
 * All API calls send the X-Requested-With header — combined with
 * SameSite=Lax HTTP-only cookies this is the CSRF defense. No tokens or
 * secrets are ever kept in localStorage.
 */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch' };
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Network error — check your internet connection', 0, 'NETWORK');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code ?? null);
  }
  return data as T;
}
