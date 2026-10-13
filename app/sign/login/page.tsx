import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/ui'
import { LoginForm } from './form'

export default async function LoginPage() {
  if ((await getSession())?.stage === 'full') redirect('/sign')
  return (
    <AuthShell title="Sign in" subtitle="Secure document signing for invited parties only.">
      <LoginForm />
    </AuthShell>
  )
}
