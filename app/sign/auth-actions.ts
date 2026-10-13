'use server'

import { redirect } from 'next/navigation'
import { query, queryOne, transaction } from '@/lib/db'
import {
  clearFailures,
  clientInfo,
  endSession,
  isThrottled,
  recordFailure,
  requireStage,
  startSession,
  THROTTLED_MESSAGE,
} from '@/lib/auth'
import {
  decrypt,
  generateRecoveryCodes,
  hashPassword,
  normalizeRecoveryCode,
  passwordProblem,
  safeEqual,
  sha256,
  verifyPassword,
  verifyTotp,
} from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { pendingTotpSecret } from '@/lib/mfa'
import { sendAccountInvite } from '@/lib/invites'

export type FormState = { error?: string; ok?: string; recoveryCodes?: string[] } | undefined

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim()
const normEmail = (s: string) => s.trim().toLowerCase()

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = normEmail(str(fd, 'email'))
  const password = String(fd.get('password') ?? '')
  const { ip } = await clientInfo()

  if ((await isThrottled(`login:${email}`, 5)) || (await isThrottled(`ip:${ip}`, 20))) {
    return { error: THROTTLED_MESSAGE }
  }

  // Only emails on the allowlist with an activated account can ever get past here.
  const user = await queryOne<{ id: string; email: string; password_hash: string | null; totp_enabled: boolean }>(
    `select id, email, password_hash, totp_enabled from users where email = $1 and status = 'active'`,
    [email],
  )
  const ok = await verifyPassword(password, user?.password_hash ?? null)
  if (!user || !ok) {
    await recordFailure(`login:${email}`, `ip:${ip}`)
    await audit(null, null, 'login.failed', email)
    return { error: 'Invalid email or password.' }
  }

  await clearFailures(`login:${email}`)
  await startSession(user.id, user.totp_enabled ? 'mfa' : 'mfa_setup')
  redirect(user.totp_enabled ? '/sign/verify' : '/sign/setup-2fa')
}

export async function verifySecondFactor(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireStage('mfa')
  const code = str(fd, 'code')
  const key = `mfa:${user.id}`
  if (await isThrottled(key, 5)) {
    await endSession()
    return { error: THROTTLED_MESSAGE }
  }

  const row = await queryOne<{ totp_secret_enc: string; totp_last_step: string }>(
    'select totp_secret_enc, totp_last_step from users where id = $1',
    [user.id],
  )
  const step = row ? verifyTotp(decrypt(row.totp_secret_enc), code, Number(row.totp_last_step)) : null

  let method = 'authenticator'
  if (step !== null) {
    await query('update users set totp_last_step = $2 where id = $1', [user.id, step])
  } else {
    const normalized = normalizeRecoveryCode(code)
    const used = normalized.length === 10
      ? await queryOne(
          `update recovery_codes set used_at = now()
            where user_id = $1 and code_hash = $2 and used_at is null returning id`,
          [user.id, sha256(normalized)],
        )
      : null
    if (!used) {
      await recordFailure(key)
      await audit(null, user, 'mfa.failed')
      return { error: 'That code is not valid. Check your authenticator app and try again.' }
    }
    method = 'recovery code'
  }

  await clearFailures(key)
  await startSession(user.id, 'full')
  await audit(null, user, 'login.success', method)
  redirect('/sign')
}

export async function confirmTotpSetup(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireStage('mfa_setup')
  if (user.totp_enabled) return { error: 'Authenticator is already set up. Continue to sign in.' }
  const key = `mfa:${user.id}`
  if (await isThrottled(key, 10)) return { error: THROTTLED_MESSAGE }

  const secret = await pendingTotpSecret(user.id)
  const step = verifyTotp(secret, str(fd, 'code'), 0)
  if (step === null) {
    await recordFailure(key)
    return { error: 'That code did not match. Make sure you scanned the latest QR code and try again.' }
  }

  const codes = generateRecoveryCodes()
  await transaction(async (tx) => {
    await tx.query('update users set totp_enabled = true, totp_last_step = $2 where id = $1', [user.id, step])
    await tx.query('delete from recovery_codes where user_id = $1', [user.id])
    for (const c of codes) {
      await tx.query('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [
        user.id,
        sha256(normalizeRecoveryCode(c)),
      ])
    }
  })
  await clearFailures(key)
  await audit(null, user, 'mfa.enrolled')
  // The session is upgraded in finishEnrollment, after the codes have been shown.
  return { recoveryCodes: codes }
}

export async function finishEnrollment(): Promise<void> {
  const user = await requireStage('mfa_setup')
  if (!user.totp_enabled) redirect('/sign/setup-2fa')
  await startSession(user.id, 'full')
  await audit(null, user, 'login.success', 'authenticator enrollment')
  redirect('/sign')
}

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = str(fd, 'token')
  const name = str(fd, 'name').slice(0, 120)
  const password = String(fd.get('password') ?? '')
  const { ip } = await clientInfo()

  if (await isThrottled(`ip:${ip}`, 20)) return { error: THROTTLED_MESSAGE }
  if (!name) return { error: 'Please enter your full legal name.' }
  const problem = passwordProblem(password)
  if (problem) return { error: problem }
  if (password !== String(fd.get('confirm') ?? '')) return { error: 'Passwords do not match.' }

  const user = await queryOne<{ id: string; email: string }>(
    `update users
        set name = $2, password_hash = $3, status = 'active',
            invite_token_hash = null, invite_expires_at = null,
            totp_enabled = false, totp_secret_enc = null
      where invite_token_hash = $1 and status = 'invited' and invite_expires_at > now()
      returning id, email`,
    [sha256(token), name, await hashPassword(password)],
  )
  if (!user) {
    await recordFailure(`ip:${ip}`)
    return { error: 'This invitation link is invalid or has expired. Ask an administrator for a new one.' }
  }

  await audit(null, user, 'account.activated')
  await startSession(user.id, 'mfa_setup')
  redirect('/sign/setup-2fa')
}

/**
 * Self-serve replacement for a lost or expired invitation. Only emails already on
 * the access list and not yet activated get a link, and the response is the same
 * either way so the list can't be probed.
 */
export async function requestActivation(_: FormState, fd: FormData): Promise<FormState> {
  const email = normEmail(str(fd, 'email'))
  const { ip } = await clientInfo()
  const done = {
    ok: "If that email is on the Lunar AeroLabs access list and hasn't been activated yet, we've sent it a new sign-up link. Check your inbox (and spam folder).",
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' }
  if ((await isThrottled(`activate:${email}`, 3)) || (await isThrottled(`ip:${ip}`, 20))) {
    return { error: THROTTLED_MESSAGE }
  }
  await recordFailure(`activate:${email}`)

  const user = await queryOne<{ id: string; email: string }>(
    `select id, email from users where email = $1 and status = 'invited'`,
    [email],
  )
  if (user) {
    await sendAccountInvite(user)
    await audit(null, user, 'user.invite_self_requested')
  }
  return done
}

export async function setupFirstAdmin(_: FormState, fd: FormData): Promise<FormState> {
  const adminEmail = normEmail(process.env.ADMIN_EMAIL ?? '')
  const setupToken = process.env.SETUP_TOKEN ?? ''
  const { ip } = await clientInfo()
  if (!adminEmail || setupToken.length < 16) {
    return { error: 'Set ADMIN_EMAIL and SETUP_TOKEN (16+ characters) in the environment first.' }
  }
  if (await isThrottled(`ip:${ip}`, 20)) return { error: THROTTLED_MESSAGE }

  const existing = await queryOne(`select 1 from users where role = 'admin' and status = 'active'`)
  if (existing) return { error: 'Setup is already complete. Sign in instead.' }

  const email = normEmail(str(fd, 'email'))
  if (!safeEqual(str(fd, 'setupToken'), setupToken) || email !== adminEmail) {
    await recordFailure(`ip:${ip}`)
    return { error: 'Setup token or email is incorrect.' }
  }
  const name = str(fd, 'name').slice(0, 120)
  const password = String(fd.get('password') ?? '')
  if (!name) return { error: 'Please enter your full name.' }
  const problem = passwordProblem(password)
  if (problem) return { error: problem }
  if (password !== String(fd.get('confirm') ?? '')) return { error: 'Passwords do not match.' }

  const user = await queryOne<{ id: string; email: string }>(
    `insert into users (email, name, role, status, password_hash)
     values ($1, $2, 'admin', 'active', $3)
     on conflict (email) do update
       set name = excluded.name, role = 'admin', status = 'active', password_hash = excluded.password_hash,
           totp_enabled = false, totp_secret_enc = null
     returning id, email`,
    [email, name, await hashPassword(password)],
  )
  await audit(null, user, 'admin.bootstrapped')
  await startSession(user!.id, 'mfa_setup')
  redirect('/sign/setup-2fa')
}

export async function logout(): Promise<void> {
  await endSession()
  redirect('/sign/login')
}
