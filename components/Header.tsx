import Link from 'next/link'
import type { User } from '@/lib/auth'
import { logout } from '@/app/sign/auth-actions'

export function Header({ user }: { user: User }) {
  return (
    <header className="app-header">
      <Link href="/sign" className="brand">
        Lunar AeroLabs <span>Sign</span>
      </Link>
      <nav>
        <Link href="/sign">My documents</Link>
        {user.role === 'admin' && (
          <>
            <Link href="/sign/admin">Manage documents</Link>
            <Link href="/sign/admin/people">Access list</Link>
          </>
        )}
      </nav>
      <div className="header-user">
        <span>{user.email}</span>
        <form action={logout}>
          <button className="link-button">Sign out</button>
        </form>
      </div>
    </header>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

export function fmtDate(d: Date | string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
}
