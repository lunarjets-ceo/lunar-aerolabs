import { requireStage } from '@/lib/auth'
import { AuthShell } from '@/components/ui'
import { VerifyForm } from './form'

export default async function VerifyPage() {
  const user = await requireStage('mfa')
  return (
    <AuthShell
      title="Two-step verification"
      subtitle={<>Enter the 6-digit code from your authenticator app for <strong>{user.email}</strong>.</>}
    >
      <VerifyForm />
    </AuthShell>
  )
}
