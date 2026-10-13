import { query } from './db'
import { randomToken, sha256 } from './crypto'
import { appUrl, sendEmail } from './email'

const INVITE_DAYS = 7

/** Issues a fresh single-use registration link (invalidating any previous one). */
export async function issueInvite(userId: string): Promise<string> {
  const token = randomToken()
  await query(
    `update users set invite_token_hash = $2, invite_expires_at = now() + make_interval(days => $3)
      where id = $1 and status = 'invited'`,
    [userId, sha256(token), INVITE_DAYS],
  )
  return appUrl(`/sign/register?token=${token}`)
}

export interface Delivery {
  email: string
  link: string
  emailed: boolean
}

export async function sendAccountInvite(
  user: { id: string; email: string },
  context?: { documentTitle: string; from: string },
): Promise<Delivery> {
  const link = await issueInvite(user.id)
  const emailed = await sendEmail({
    to: user.email,
    subject: context
      ? `${context.from} invited you to sign "${context.documentTitle}"`
      : "You've been invited to Lunar AeroLabs Sign",
    heading: context ? `Please sign: ${context.documentTitle}` : 'Your secure signing account',
    body: `Create your account to access documents from Lunar AeroLabs. You'll set a password and connect an authenticator app such as Google Authenticator.\n\nThis link expires in ${INVITE_DAYS} days and can be used once.`,
    ctaLabel: 'Create account',
    ctaUrl: link,
  })
  return { email: user.email, link, emailed }
}
