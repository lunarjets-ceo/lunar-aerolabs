import { requireAdmin } from '@/lib/auth'
import { allDownloads, place } from '@/lib/downloads'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { ExportLinks } from '@/components/ExportLinks'

const SHOWN = 1000

export default async function DownloadHistory() {
  const admin = await requireAdmin()
  const downloads = await allDownloads({ limit: SHOWN + 1 })
  const more = downloads.length > SHOWN

  return (
    <>
      <Header user={admin} />
      <main className="page wide">
        <div className="title-row">
          <h1>Download history</h1>
          <ExportLinks />
        </div>
        <p className="muted">
          Every download of a shared file or repository release. Records are kept after the file, release or repository
          is deleted. Location is approximate, derived from the IP address.
        </p>
        <section className="panel">
          {downloads.length === 0 ? (
            <p className="muted">No downloads yet.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>IP</th>
                  <th>Location</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {downloads.slice(0, SHOWN).map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDate(d.at)}</td>
                    <td>
                      <strong>
                        {d.item || d.file_name || '—'}
                        {d.version && <span className="mono"> {d.version}</span>}
                      </strong>
                      <small>
                        {d.source}
                        {d.file_name && d.file_name !== d.item && ` · ${d.file_name}`}
                      </small>
                      {d.deleted && <StatusBadge status="deleted" />}
                    </td>
                    <td>
                      <strong>{d.name || d.email || '—'}</strong>
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
          {more && <p className="hint">Showing the latest {SHOWN}. Download the CSV or PDF for the full history.</p>}
        </section>
      </main>
    </>
  )
}
