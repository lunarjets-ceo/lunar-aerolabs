import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { audit } from '@/lib/audit'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { SignerView, type SignerField } from './SignerView'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SignDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const row = await queryOne<{
    recipient_id: string
    my_status: string
    signed_at: Date | null
    title: string
    message: string
    status: string
    sender: string
  }>(
    `select r.id as recipient_id, r.status as my_status, r.signed_at,
            d.title, d.message, d.status, coalesce(nullif(u.name, ''), u.email) as sender
       from recipients r
       join documents d on d.id = r.document_id
       left join users u on u.id = d.created_by
      where r.document_id = $1 and r.user_id = $2 and d.status in ('sent', 'completed', 'voided')`,
    [id, user.id],
  )
  if (!row) notFound()

  const canSign = row.status === 'sent' && ['pending', 'viewed'].includes(row.my_status)
  if (canSign && row.my_status === 'pending') {
    await query(`update recipients set status = 'viewed' where id = $1 and status = 'pending'`, [row.recipient_id])
    await audit(id, user, 'document.viewed')
  }

  const fields = canSign
    ? await query<SignerField>(
        'select id, type, page, x, y, w, h, required, label from fields where recipient_id = $1 order by page, y, x',
        [row.recipient_id],
      )
    : []

  return (
    <>
      <Header user={user} />
      <main className={canSign ? 'page wide' : 'page'}>
        <Link href="/sign">← My documents</Link>
        <div className="title-row">
          <h1>{row.title}</h1>
          <StatusBadge status={row.status === 'sent' ? row.my_status : row.status} />
        </div>
        <p className="muted">From {row.sender}</p>
        {row.message && <blockquote className="message">{row.message}</blockquote>}

        {canSign ? (
          <SignerView documentId={id} fields={fields} signerName={user.name || user.email} />
        ) : (
          <section className="panel">
            {row.status === 'completed' && (
              <>
                <p>All parties have signed. The signed copy includes a certificate of completion.</p>
                <a className="btn btn-primary" href={`/sign/api/documents/${id}/pdf?version=completed&download`}>
                  Download signed PDF
                </a>
              </>
            )}
            {row.status === 'sent' && row.my_status === 'signed' && (
              <p>You signed on {fmtDate(row.signed_at)}. We'll email you when everyone has signed.</p>
            )}
            {row.my_status === 'declined' && <p>You declined to sign this document.</p>}
            {row.status === 'voided' && <p>The sender voided this document. No further action is needed.</p>}
          </section>
        )}
      </main>
    </>
  )
}
