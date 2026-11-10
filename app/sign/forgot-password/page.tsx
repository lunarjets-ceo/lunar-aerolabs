import { AuthShell } from '@/components/ui'
import { ForgotPasswordForm } from './form'

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email address you sign in with, and we'll send you a link to choose a new password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
