import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { formatBytes } from '@/lib/files'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { deleteFile, disableFile, revokeFileLink } from '../actions'
import { SendFileForm } from '../forms'

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
    downloads: number
    last_at: Date | null
  }>(
    `select r.id, r.email, r.name, r.sent_at, r.revoked_at,
            count(d.id)::int as downloads, max(d.at) as last_at
       from file_recipients r left join file_downloads d on d.recipient_id = r.id
      where r.file_id = $1 group by r.id order by r.sent_at, r.email`,
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
  const everyone = file.disabled_at
    ? ''
    : (await query<{ email: string; name: string }>(`select email, name from users where status <> 'revoked' order by email`))
        .map((u) => (u.name ? `${u.name} <${u.email}>` : u.email))
        .join('\n')

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
          <div className="row">
            <p className="muted">Disabled {fmtDate(file.disabled_at)}. The file was removed from storage and all links stopped working.</p>
            <form action={deleteFile}>
              <input type="hidden" name="fileId" value={id} />
              <button className="btn btn-danger">Delete record and history</button>
            </form>
          </div>
        ) : (
          <section className="panel">
            <h2>Send to testers</h2>
            <p className="hint">
              Each person gets their own link by email. Sending to someone again replaces their old link.
            </p>
            <SendFileForm fileId={id} everyone={everyone} />
          </section>
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
          <h2>Download log</h2>
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

        {!file.disabled_at && (
          <form action={disableFile}>
            <input type="hidden" name="fileId" value={id} />
            <button className="btn btn-danger">Disable all links and remove file from storage</button>
          </form>
        )}
      </main>
    </>
  )
}
