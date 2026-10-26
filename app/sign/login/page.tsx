import Link from 'next/link'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/ui'
import { LoginForm } from './form'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ declined?: string }> }) {
  if ((await getSession())?.stage === 'full') redirect('/sign')
  const { declined } = await searchParams
  return (
    <AuthShell title="Sign in" subtitle="Secure document signing for invited parties only.">
      {declined && (
        <p className="form-error" role="alert">
          You were signed out because you didn't agree to location recording. You must agree to it to use this site.
        </p>
      )}
      <LoginForm />
      <div className="auth-divider" />
      <p className="auth-footer">
        New here or never set a password? <Link href="/sign/activate">Activate your account</Link>
      </p>
    </AuthShell>
  )
}
