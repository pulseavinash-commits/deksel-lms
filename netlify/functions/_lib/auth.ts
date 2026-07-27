import { SignJWT, jwtVerify } from 'jose';

const ADMIN_COOKIE = 'admin_session';
const LEARNER_COOKIE = 'learner_session';
const ADMIN_TTL_S = 60 * 60 * 8;       // 8 hours
const LEARNER_TTL_S = 60 * 60 * 24 * 3; // 3 days (long modules, resume support)

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET not configured');
  return new TextEncoder().encode(s);
}

export interface AdminClaims {
  sub: string; // admin id
  email: string;
  role: 'admin';
}

export interface LearnerClaims {
  sub: string;          // learner id ('' until registered)
  session_id: string;   // learner_sessions id ('' until registered)
  access: true;         // passed the access password gate
}

async function sign(payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

async function verify<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as T;
  } catch {
    return null;
  }
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

// ---------------- Admin ----------------

export async function issueAdminCookie(claims: AdminClaims): Promise<string> {
  const token = await sign({ ...claims }, ADMIN_TTL_S);
  return cookieHeader(ADMIN_COOKIE, token, ADMIN_TTL_S);
}

export function clearAdminCookie(): string {
  return cookieHeader(ADMIN_COOKIE, '', 0);
}

export async function requireAdmin(req: Request): Promise<AdminClaims | null> {
  const token = getCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const claims = await verify<AdminClaims>(token);
  if (!claims || claims.role !== 'admin') return null;
  return claims;
}

// ---------------- Learner ----------------

export async function issueLearnerCookie(claims: LearnerClaims): Promise<string> {
  const token = await sign({ ...claims }, LEARNER_TTL_S);
  return cookieHeader(LEARNER_COOKIE, token, LEARNER_TTL_S);
}

export function clearLearnerCookie(): string {
  return cookieHeader(LEARNER_COOKIE, '', 0);
}

export async function requireLearnerAccess(req: Request): Promise<LearnerClaims | null> {
  const token = getCookie(req, LEARNER_COOKIE);
  if (!token) return null;
  const claims = await verify<LearnerClaims>(token);
  if (!claims || claims.access !== true) return null;
  return claims;
}

/** Learner who has also completed registration (has a session). */
export async function requireLearnerSession(req: Request): Promise<LearnerClaims | null> {
  const claims = await requireLearnerAccess(req);
  if (!claims || !claims.session_id) return null;
  return claims;
}
