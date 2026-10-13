import { redirect } from 'next/navigation'
import { queryOne } from '@/lib/db'
import { AuthShell } from '@/components/ui'
import { AdminSetupForm } from './form'

export default async function FirstAdminSetupPage() {
  const admin = await queryOne(`select 1 from users where role = 'admin' and status = 'active'`)
  if (admin) redirect('/sign/login')
  return (
    <AuthShell
      title="Initial administrator setup"
      subtitle="One-time setup. Requires the SETUP_TOKEN and ADMIN_EMAIL configured on the server."
    >
      <AdminSetupForm />
    </AuthShell>
  )
}
