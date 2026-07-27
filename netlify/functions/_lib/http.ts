// Small helpers for the modern Netlify Functions (Request/Response) API.

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function err(message: string, status = 400, code?: string): Response {
  return json({ error: message, code: code ?? null }, status);
}

/**
 * CSRF defense-in-depth for state-changing requests:
 * cookies are SameSite=Lax AND we require this custom header, which
 * cross-origin forms/scripts cannot set without a CORS preflight
 * (which we never allow for foreign origins).
 */
export function csrfCheck(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  return req.headers.get('x-requested-with') === 'fetch';
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
