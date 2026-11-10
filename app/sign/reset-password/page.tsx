import Link from 'next/link'
import { queryOne } from '@/lib/db'
import { sha256 } from '@/lib/crypto'
import { AuthShell } from '@/components/ui'
import { ResetPasswordForm } from './form'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const user = token
    ? await queryOne<{ email: string }>(
        `select email from users
          where reset_token_hash = $1 and status = 'active' and reset_expires_at > now()`,
        [sha256(token)],
      )
    : null

  if (!user) {
    return (
      <AuthShell title="Reset link not valid">
        <p className="muted">This reset link is invalid, already used, or expired.</p>
        <p className="auth-footer">
          <Link href="/sign/forgot-password">Request a new reset link</Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Choose a new password" subtitle={<>Resetting the password for <strong>{user.email}</strong>.</>}>
      <ResetPasswordForm token={token} email={user.email} />
    </AuthShell>
  )
}
