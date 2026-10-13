import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { query } from '@/lib/db'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { UploadForm } from './UploadForm'

export default async function AdminDocuments() {
  const user = await requireAdmin()
  const docs = await query<{ id: string; title: string; status: string; created_at: Date; signed: number; total: number }>(
    `select d.id, d.title, d.status, d.created_at,
            count(r.id) filter (where r.status = 'signed')::int as signed,
            count(r.id)::int as total
       from documents d left join recipients r on r.document_id = d.id
      group by d.id order by d.created_at desc`,
  )

  return (
    <>
      <Header user={user} />
      <main className="page">
        <h1>Documents</h1>
        <section className="panel">
          <h2>Upload a PDF</h2>
          <UploadForm />
        </section>
        <section className="panel">
          <h2>All documents</h2>
          {docs.length === 0 ? (
            <p className="muted">No documents yet.</p>
          ) : (
            <ul className="doc-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{d.title}</strong>
                    <small>
                      Created {fmtDate(d.created_at)}
                      {d.total > 0 && ` · ${d.signed}/${d.total} signed`}
                    </small>
                  </div>
                  <StatusBadge status={d.status} />
                  <Link className="btn" href={`/sign/admin/documents/${d.id}`}>
                    {d.status === 'draft' ? 'Edit' : 'View'}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
