import { requireAdmin } from '@/lib/auth'
import { query } from '@/lib/db'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { resetAuthenticator, restoreUser, revokeUser } from '../actions'
import { InviteForm, ResendInviteButton } from './forms'

export default async function PeoplePage() {
  const admin = await requireAdmin()
  const people = await query<{
    id: string
    email: string
    name: string
    role: string
    status: string
    totp_enabled: boolean
    created_at: Date
  }>('select id, email, name, role, status, totp_enabled, created_at from users order by status, email')

  return (
    <>
      <Header user={admin} />
      <main className="page">
        <h1>Access list</h1>
        <p className="muted">
          Only the email addresses on this list can ever sign in. Every account must use a password and an authenticator
          app. Revoking someone ends their sessions immediately.
        </p>

        <section className="panel">
          <h2>Add a person</h2>
          <InviteForm />
        </section>

        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Status</th>
                <th>Authenticator</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className={p.status === 'revoked' ? 'dim' : ''}>
                  <td>
                    <strong>{p.name || '—'}</strong>
                    <small>{p.email}</small>
                  </td>
                  <td>{p.role}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>{p.totp_enabled ? 'Enrolled' : p.status === 'active' ? 'Required at next sign-in' : '—'}</td>
                  <td>{fmtDate(p.created_at)}</td>
                  <td className="actions">
                    {p.id !== admin.id && p.status === 'invited' && <ResendInviteButton userId={p.id} />}
                    {p.id !== admin.id && p.status === 'active' && p.totp_enabled && (
                      <form action={resetAuthenticator}>
                        <input type="hidden" name="userId" value={p.id} />
                        <button className="btn btn-small">Reset authenticator</button>
                      </form>
                    )}
                    {p.id !== admin.id && p.status !== 'revoked' && (
                      <form action={revokeUser}>
                        <input type="hidden" name="userId" value={p.id} />
                        <button className="btn btn-small btn-danger">Revoke</button>
                      </form>
                    )}
                    {p.status === 'revoked' && (
                      <form action={restoreUser}>
                        <input type="hidden" name="userId" value={p.id} />
                        <button className="btn btn-small">Restore</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  )
}
