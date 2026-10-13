import { AuthShell } from '@/components/ui'
import { ActivateForm } from './form'

export default function ActivatePage() {
  return (
    <AuthShell
      title="Activate your account"
      subtitle="New to Lunar AeroLabs Sign? Enter the email address Lunar AeroLabs invited, and we'll send you a link to set your password and connect your authenticator app."
    >
      <ActivateForm />
    </AuthShell>
  )
}
