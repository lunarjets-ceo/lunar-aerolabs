import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/ui'
import { LoginForm } from './form'

export default async function LoginPage() {
  if ((await getSession())?.stage === 'full') redirect('/sign')
  return (
    <AuthShell title="Sign in" subtitle="Secure document signing for invited parties only.">
      <LoginForm />
      <div className="auth-divider" />
      <p className="auth-footer">
        New here or never set a password? <Link href="/sign/activate">Activate your account</Link>
      </p>
    </AuthShell>
  )
}
