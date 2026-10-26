import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { query, queryOne } from './db'
import { randomToken, sha256 } from './crypto'

export type Stage = 'mfa_setup' | 'mfa' | 'consent' | 'full'

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'signer'
  status: 'invited' | 'active' | 'revoked'
  totp_enabled: boolean
}

export interface Session {
  stage: Stage
  user: User
}

const isProd = process.env.NODE_ENV === 'production'
const COOKIE = isProd ? '__Host-la_session' : 'la_session'

// Partial sessions (password ok, authenticator not yet passed) are short-lived.
const LIFETIME_MIN: Record<Stage, number> = { mfa_setup: 15, mfa: 10, consent: 10, full: 12 * 60 }

export async function clientInfo() {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  return { ip, userAgent: (h.get('user-agent') ?? '').slice(0, 300) }
}

export async function startSession(userId: string, stage: Stage): Promise<void> {
  const store = await cookies()
  const previous = store.get(COOKIE)?.value
  if (previous) await query('delete from sessions where id_hash = $1', [sha256(previous)])

  const token = randomToken()
  const { ip, userAgent } = await clientInfo()
  const minutes = LIFETIME_MIN[stage]
  await query(
    `insert into sessions (id_hash, user_id, stage, expires_at, ip, user_agent)
     values ($1, $2, $3, now() + make_interval(mins => $4), $5, $6)`,
    [sha256(token), userId, stage, minutes, ip, userAgent],
  )
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: minutes * 60,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (token) await query('delete from sessions where id_hash = $1', [sha256(token)])
  store.delete(COOKIE)
}

/** Current session, or null. Revoked users never resolve to a session. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const row = await queryOne<User & { stage: Stage }>(
    `select s.stage, u.id, u.email, u.name, u.role, u.status, u.totp_enabled
       from sessions s join users u on u.id = s.user_id
      where s.id_hash = $1 and s.expires_at > now() and u.status = 'active'`,
    [sha256(token)],
  )
  if (!row) return null
  const { stage, ...user } = row
  return { stage, user }
}

function pathForStage(stage: Stage | undefined): string {
  if (stage === 'mfa_setup') return '/sign/setup-2fa'
  if (stage === 'mfa') return '/sign/verify'
  if (stage === 'consent') return '/sign/location-notice'
  return '/sign/login'
}

/** A fully authenticated user (password + authenticator). */
export async function requireUser(): Promise<User> {
  const session = await getSession()
  if (session?.stage !== 'full') redirect(pathForStage(session?.stage))
  return session.user
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/sign')
  return user
}

/** For the in-between login steps: only a session at exactly `stage` passes. */
export async function requireStage(stage: Stage): Promise<User> {
  const session = await getSession()
  if (!session) redirect('/sign/login')
  if (session.stage !== stage) redirect(session.stage === 'full' ? '/sign' : pathForStage(session.stage))
  return session.user
}

// ---------- Brute-force throttling ----------

const WINDOW_MIN = 15

export async function isThrottled(key: string, limit: number): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from auth_attempts
      where key = $1 and at > now() - make_interval(mins => $2)`,
    [key, WINDOW_MIN],
  )
  return (row?.n ?? 0) >= limit
}

export async function recordFailure(...keys: string[]): Promise<void> {
  for (const key of keys) await query('insert into auth_attempts (key) values ($1)', [key])
  await query(`delete from auth_attempts where at < now() - interval '1 day'`)
}

export async function clearFailures(key: string): Promise<void> {
  await query('delete from auth_attempts where key = $1', [key])
}

export const THROTTLED_MESSAGE = `Too many attempts. Try again in ${WINDOW_MIN} minutes.`
