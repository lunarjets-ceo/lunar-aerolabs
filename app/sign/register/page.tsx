import { queryOne } from '@/lib/db'
import { sha256 } from '@/lib/crypto'
import { AuthShell } from '@/components/ui'
import { RegisterForm } from './form'

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const invite = token
    ? await queryOne<{ email: string; name: string }>(
        `select email, name from users
          where invite_token_hash = $1 and status = 'invited' and invite_expires_at > now()`,
        [sha256(token)],
      )
    : null

  if (!invite) {
    return (
      <AuthShell title="Invitation not valid">
        <p className="muted">This invitation link is invalid, already used, or expired. Ask a Lunar AeroLabs administrator to send a new one.</p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create your account" subtitle={<>You've been invited as <strong>{invite.email}</strong>.</>}>
      <RegisterForm token={token} defaultName={invite.name} email={invite.email} />
    </AuthShell>
  )
}
