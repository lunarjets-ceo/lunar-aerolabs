import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { deleteDocument, voidDocument, type FieldInput } from '../../actions'
import { FieldEditor, type Person } from './FieldEditor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AdminDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const doc = await queryOne<{
    id: string
    title: string
    message: string
    status: string
    original_sha256: string
    completed_sha256: string | null
    created_at: Date
    sent_at: Date | null
    completed_at: Date | null
  }>(
    `select id, title, message, status, original_sha256, completed_sha256, created_at, sent_at, completed_at
       from documents where id = $1`,
    [id],
  )
  if (!doc) notFound()

  if (doc.status === 'draft') {
    const people = await query<Person>(`select id, email, name, status from users where status <> 'revoked' order by email`)
    const recipients = await query<{ user_id: string }>(
      'select user_id from recipients where document_id = $1 order by sort_order',
      [id],
    )
    const fields = await query<FieldInput>(
      `select r.user_id as "recipientUserId", f.type, f.page, f.x, f.y, f.w, f.h, f.required, f.label
         from fields f join recipients r on r.id = f.recipient_id where f.document_id = $1`,
      [id],
    )
    return (
      <>
        <Header user={admin} />
        <div className="editor-header">
          <Link href="/sign/admin">← Documents</Link>
          <StatusBadge status="draft" />
          <form action={deleteDocument}>
            <input type="hidden" name="documentId" value={id} />
            <button className="link-button danger">Delete draft</button>
          </form>
        </div>
        <FieldEditor
          documentId={id}
          initialTitle={doc.title}
          initialMessage={doc.message}
          people={people}
          initialRecipients={recipients.map((r) => r.user_id)}
          initialFields={fields}
        />
      </>
    )
  }

  const recipients = await query<{
    email: string
    name: string
    status: string
    signed_at: Date | null
    signed_ip: string | null
    decline_reason: string | null
  }>(
    `select u.email, u.name, r.status, r.signed_at, r.signed_ip, r.decline_reason
       from recipients r join users u on u.id = r.user_id where r.document_id = $1 order by r.sort_order`,
    [id],
  )
  const events = await query<{ at: Date; email: string | null; action: string; detail: string; ip: string | null }>(
    'select at, email, action, detail, ip from audit_events where document_id = $1 order by at, id',
    [id],
  )

  return (
    <>
      <Header user={admin} />
      <main className="page">
        <Link href="/sign/admin">← Documents</Link>
        <div className="title-row">
          <h1>{doc.title}</h1>
          <StatusBadge status={doc.status} />
        </div>

        <div className="row">
          <a className="btn" href={`/sign/api/documents/${id}/pdf`} target="_blank">
            View original
          </a>
          {doc.status === 'completed' && (
            <a className="btn btn-primary" href={`/sign/api/documents/${id}/pdf?version=completed&download`}>
              Download signed PDF
            </a>
          )}
          {doc.status === 'sent' && (
            <form action={voidDocument}>
              <input type="hidden" name="documentId" value={id} />
              <button className="btn btn-danger">Void envelope</button>
            </form>
          )}
          {doc.status === 'voided' && (
            <form action={deleteDocument}>
              <input type="hidden" name="documentId" value={id} />
              <button className="btn btn-danger">Delete</button>
            </form>
          )}
        </div>

        <section className="panel">
          <h2>Recipients</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Signer</th>
                <th>Status</th>
                <th>Signed</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.email}>
                  <td>
                    <strong>{r.name || '—'}</strong>
                    <small>{r.email}</small>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.decline_reason && <small>“{r.decline_reason}”</small>}
                  </td>
                  <td>{fmtDate(r.signed_at)}</td>
                  <td>{r.signed_ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Audit trail</h2>
          <p className="hint mono">Original SHA-256: {doc.original_sha256}</p>
          {doc.completed_sha256 && <p className="hint mono">Signed SHA-256: {doc.completed_sha256}</p>}
          <table className="table compact">
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDate(e.at)}</td>
                  <td>{e.action}</td>
                  <td>{e.email ?? 'system'}</td>
                  <td className="mono">{e.ip}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  )
}
