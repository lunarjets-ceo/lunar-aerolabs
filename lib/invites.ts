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
  const setup =
    "First, create your secure account. You'll choose a password and connect an authenticator app such as Google Authenticator. It takes about two minutes."
  const emailed = await sendEmail({
    to: user.email,
    subject: context
      ? `${context.from} invited you to sign "${context.documentTitle}"`
      : "You're invited to Lunar AeroLabs Sign",
    preheader: context
      ? `${context.from} sent you a document to sign. Create your secure account to get started.`
      : 'Create your secure account to review and sign documents from Lunar AeroLabs.',
    eyebrow: context ? 'Signature requested' : 'Invitation',
    heading: context ? 'You have a document to sign' : 'Welcome to Lunar AeroLabs Sign',
    body: context
      ? `${context.from} has invited you to review and sign a document.\n\n${setup}`
      : `You've been given access to Lunar AeroLabs' secure document signing portal.\n\n${setup}`,
    document: context ? { title: context.documentTitle, from: context.from } : undefined,
    ctaLabel: 'Create your account',
    ctaUrl: link,
    note: `This personal link expires in ${INVITE_DAYS} days and works only once.`,
  })
  return { email: user.email, link, emailed }
}
