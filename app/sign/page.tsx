import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { query } from '@/lib/db'
import { Header, StatusBadge, fmtDate } from '@/components/Header'

export default async function Dashboard() {
  const user = await requireUser()
  const docs = await query<{ id: string; title: string; status: string; my_status: string; sent_at: Date; sender: string }>(
    `select d.id, d.title, d.status, r.status as my_status, d.sent_at, coalesce(nullif(u.name, ''), u.email) as sender
       from recipients r
       join documents d on d.id = r.document_id
       left join users u on u.id = d.created_by
      where r.user_id = $1 and d.status in ('sent', 'completed', 'voided')
      order by d.sent_at desc`,
    [user.id],
  )
  const action = docs.filter((d) => d.status === 'sent' && ['pending', 'viewed'].includes(d.my_status))
  const rest = docs.filter((d) => !action.includes(d))

  return (
    <>
      <Header user={user} />
      <main className="page">
        <h1>Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>

        <section className="panel">
          <h2>Needs your signature</h2>
          {action.length === 0 ? (
            <p className="muted">Nothing waiting on you.</p>
          ) : (
            <ul className="doc-list">
              {action.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{d.title}</strong>
                    <small>From {d.sender} · {fmtDate(d.sent_at)}</small>
                  </div>
                  <Link className="btn btn-primary" href={`/sign/documents/${d.id}`}>
                    Review & sign
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {rest.length > 0 && (
          <section className="panel">
            <h2>History</h2>
            <ul className="doc-list">
              {rest.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{d.title}</strong>
                    <small>From {d.sender} · {fmtDate(d.sent_at)}</small>
                  </div>
                  <StatusBadge status={d.status === 'sent' ? d.my_status : d.status} />
                  <Link className="btn" href={`/sign/documents/${d.id}`}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  )
}
