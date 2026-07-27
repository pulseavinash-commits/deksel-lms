import { db } from './db';

/**
 * DB-backed fixed-window rate limiter (works across function instances).
 * Returns true when the request is ALLOWED.
 */
export async function rateLimit(
  bucket: string,
  identifier: string,
  maxInWindow: number,
  windowSeconds: number,
): Promise<boolean> {
  // Safe storage key: strip anything unexpected from the identifier.
  const safeId = identifier.replace(/[^a-zA-Z0-9.:_-]/g, '').slice(0, 64);
  const key = `${bucket}:${safeId}`;
  const { data, error } = await db().rpc('bump_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed for auth-sensitive buckets.
    console.error('rate limit error', error.message);
    return false;
  }
  return (data as number) <= maxInWindow;
}
