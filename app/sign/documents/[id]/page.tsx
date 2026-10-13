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
  }>(
    `select r.id as recipient_id, r.status as my_status, r.signed_at,
            d.title, d.message, d.status
       from recipients r
       join documents d on d.id = r.document_id
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
        'select id, type, page, x, y, w, h, required, label from fields where document_id = $1 order by page, y, x',
        [id],
      )
    : []

  return (
    <>
      <Header user={user} />
      <main className={canSign ? 'page wide' : 'page'}>
        <Link href="/sign">← My documents</Link>
        <div className="title-row">
          <h1>{row.title}</h1>
          <StatusBadge status={row.status === 'voided' && !['signed', 'declined'].includes(row.my_status) ? 'voided' : row.my_status} />
        </div>
        <p className="muted">From Lunar AeroLabs</p>
        {row.message && <blockquote className="message">{row.message}</blockquote>}

        {canSign ? (
          <SignerView documentId={id} fields={fields} signerName={user.name || user.email} />
        ) : (
          <section className="panel">
            {row.my_status === 'signed' && (
              <>
                <p>
                  You signed on {fmtDate(row.signed_at)}. Your signed copy includes a certificate of completion with
                  your signing record.
                </p>
                <div className="row">
                  <a className="btn btn-primary" href={`/sign/api/documents/${id}/pdf?version=signed&download`}>
                    Download your signed copy
                  </a>
                  <a className="btn" href={`/sign/api/documents/${id}/pdf?version=signed`} target="_blank">
                    View
                  </a>
                </div>
              </>
            )}
            {row.my_status === 'declined' && <p>You declined to sign this document.</p>}
            {row.status === 'voided' && !['signed', 'declined'].includes(row.my_status) && (
              <p>Lunar AeroLabs voided this document. No further action is needed.</p>
            )}
          </section>
        )}
      </main>
    </>
  )
}
