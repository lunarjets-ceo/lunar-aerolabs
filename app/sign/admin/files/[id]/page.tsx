import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { formatBytes, HAS_SIGNED } from '@/lib/files'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { ExportLinks } from '@/components/ExportLinks'
import { revokeFileLink } from '../actions'
import { DeleteFileForm, RequiredDocumentsForm, SendFileForm, type DocumentOption } from '../forms'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function place(d: { city: string | null; region: string | null; country: string | null }) {
  return [d.city, d.region, d.country].filter(Boolean).join(', ') || '—'
}

export default async function AdminFilePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const file = await queryOne<{
    title: string
    message: string
    file_name: string
    size_bytes: string
    created_at: Date
    disabled_at: Date | null
  }>('select title, message, file_name, size_bytes, created_at, disabled_at from shared_files where id = $1', [id])
  if (!file) notFound()

  const recipients = await query<{
    id: string
    email: string
    name: string
    sent_at: Date
    revoked_at: Date | null
    signed: boolean
    downloads: number
    last_at: Date | null
  }>(
    `select r.id, r.email, r.name, r.sent_at, r.revoked_at, ${HAS_SIGNED} as signed,
            count(d.id)::int as downloads, max(d.at) as last_at
       from file_recipients r join shared_files f on f.id = r.file_id
       left join file_downloads d on d.recipient_id = r.id
      where r.file_id = $1 group by r.id, f.id order by r.sent_at, r.email`,
    [id],
  )
  const downloads = await query<{
    at: Date
    email: string
    name: string
    ip: string | null
    city: string | null
    region: string | null
    country: string | null
    latitude: string | null
    longitude: string | null
    user_agent: string | null
  }>(
    `select d.at, r.email, r.name, d.ip, d.city, d.region, d.country, d.latitude, d.longitude, d.user_agent
       from file_downloads d join file_recipients r on r.id = d.recipient_id
      where r.file_id = $1 order by d.at desc`,
    [id],
  )
  const documents = await query<DocumentOption>(
    `select d.id, d.title, (sd.file_id is not null) as required,
            coalesce(string_agg(u.email, ', ' order by u.email) filter (where r.status = 'signed'), '') as signers
       from documents d
       left join shared_file_documents sd on sd.document_id = d.id and sd.file_id = $1
       left join recipients r on r.document_id = d.id
       left join users u on u.id = r.user_id
      where d.status <> 'draft'
      group by d.id, sd.file_id order by (sd.file_id is not null) desc, d.created_at desc`,
    [id],
  )
  // Only people who can actually download: signed a required document, account still active.
  const everyone = file.disabled_at
    ? ''
    : (
        await query<{ email: string; name: string }>(
          `select distinct u.email, u.name
             from shared_file_documents sd
             join recipients r on r.document_id = sd.document_id and r.status = 'signed'
             join users u on u.id = r.user_id and u.status <> 'revoked'
            where sd.file_id = $1 order by u.email`,
          [id],
        )
      )
        .map((u) => (u.name ? `${u.name} <${u.email}>` : u.email))
        .join('\n')
  const requiredCount = documents.filter((d) => d.required).length

  return (
    <>
      <Header user={admin} />
      <main className="page">
        <Link href="/sign/admin/files">← Shared files</Link>
        <div className="title-row">
          <h1>{file.title}</h1>
          {file.disabled_at && <StatusBadge status="disabled" />}
        </div>
        <p className="muted">
          {file.file_name} · {formatBytes(Number(file.size_bytes))} · Uploaded {fmtDate(file.created_at)}
        </p>
        {file.message && <p className="message">{file.message}</p>}

        {file.disabled_at ? (
          <p className="form-error">
            Links were turned off {fmtDate(file.disabled_at)}, but the file is still in storage. Press Delete below to
            finish removing it.
          </p>
        ) : (
          <>
            <section className="panel">
              <h2>Required documents · {requiredCount} selected</h2>
              <p className="hint">
                A tester can download only after signing at least one of these, matched by the email their link was sent to.
                {requiredCount === 0 && ' Nothing is selected, so nobody can download yet.'}
              </p>
              <RequiredDocumentsForm fileId={id} documents={documents} />
            </section>
            <section className="panel">
              <h2>Send to testers</h2>
              <p className="hint">
                Each person gets their own link by email. Sending to someone again replaces their old link.
              </p>
              <SendFileForm fileId={id} everyone={everyone} />
            </section>
          </>
        )}

        <section className="panel">
          <h2>
            Recipients · {recipients.filter((r) => r.downloads > 0).length} of {recipients.length} downloaded
          </h2>
          {recipients.length === 0 ? (
            <p className="muted">Not sent to anyone yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Tester</th>
                  <th>Link sent</th>
                  <th>Signed</th>
                  <th>Downloads</th>
                  <th>Last download</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name || '—'}</strong>
                      <small>{r.email}</small>
                    </td>
                    <td>{fmtDate(r.sent_at)}</td>
                    <td>
                      <StatusBadge status={r.signed ? 'signed' : 'pending'} />
                    </td>
                    <td>{r.downloads}</td>
                    <td>{fmtDate(r.last_at)}</td>
                    <td className="actions">
                      {r.revoked_at ? (
                        <StatusBadge status="revoked" />
                      ) : (
                        !file.disabled_at && (
                          <form action={revokeFileLink}>
                            <input type="hidden" name="recipientId" value={r.id} />
                            <button className="btn btn-small btn-danger">Revoke link</button>
                          </form>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>Download log</h2>
            {downloads.length > 0 && <ExportLinks filter={`file=${id}`} />}
          </div>
          <p className="hint">Location is approximate, derived from the IP address. VPNs and mobile carriers can place it far from the tester.</p>
          {downloads.length === 0 ? (
            <p className="muted">No downloads yet.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Tester</th>
                  <th>IP</th>
                  <th>Location</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDate(d.at)}</td>
                    <td>
                      <strong>{d.name || d.email}</strong>
                      {d.name && <small>{d.email}</small>}
                    </td>
                    <td className="mono">{d.ip ?? '—'}</td>
                    <td>
                      {d.latitude && d.longitude ? (
                        <a href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`} target="_blank" rel="noreferrer">
                          {place(d)}
                        </a>
                      ) : (
                        place(d)
                      )}
                    </td>
                    <td className="mono">{d.user_agent || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Delete file</h2>
          <p className="hint">
            Removes the file from storage and deletes this page and every tester's link. Testers who open their link will
            see that it's no longer available. Its downloads stay in{' '}
            <Link href="/sign/admin/downloads">Download history</Link>.
          </p>
          <DeleteFileForm fileId={id} />
        </section>
      </main>
    </>
  )
}
