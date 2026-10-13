import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { query } from '@/lib/db'
import { formatBytes } from '@/lib/files'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { FileUploadForm } from './forms'

export default async function AdminFiles() {
  const user = await requireAdmin()
  const files = await query<{
    id: string
    title: string
    size_bytes: string
    created_at: Date
    disabled: boolean
    recipients: number
    downloaders: number
  }>(
    `select f.id, f.title, f.size_bytes, f.created_at, f.disabled_at is not null as disabled,
            count(distinct r.id)::int as recipients,
            count(distinct d.recipient_id)::int as downloaders
       from shared_files f
       left join file_recipients r on r.file_id = f.id
       left join file_downloads d on d.recipient_id = r.id
      group by f.id order by f.created_at desc`,
  )

  return (
    <>
      <Header user={user} />
      <main className="page">
        <h1>Shared files</h1>
        <p className="muted">
          Upload a large file once, then email each tester their own link. Every download is logged against the person
          whose link was used.
        </p>
        <section className="panel">
          <h2>Upload a file</h2>
          <FileUploadForm />
        </section>
        <section className="panel">
          <h2>All files</h2>
          {files.length === 0 ? (
            <p className="muted">No files yet.</p>
          ) : (
            <ul className="doc-list">
              {files.map((f) => (
                <li key={f.id}>
                  <div>
                    <strong>{f.title}</strong>
                    <small>
                      {formatBytes(Number(f.size_bytes))} · Uploaded {fmtDate(f.created_at)}
                      {f.recipients > 0 && ` · ${f.downloaders}/${f.recipients} downloaded`}
                    </small>
                  </div>
                  {f.disabled && <StatusBadge status="disabled" />}
                  <Link className="btn" href={`/sign/admin/files/${f.id}`}>
                    Open
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
