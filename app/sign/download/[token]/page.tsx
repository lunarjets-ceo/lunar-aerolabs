import Link from 'next/link'
import { AuthShell } from '@/components/ui'
import { findRecipientByToken, formatBytes } from '@/lib/files'

export default async function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await findRecipientByToken(token)

  if (!r) {
    return (
      <AuthShell title="Link unavailable" subtitle="This download link is no longer active. Contact Lunar AeroLabs if you still need access." />
    )
  }

  const subtitle = `${r.file_name} · ${formatBytes(Number(r.size_bytes))}`

  if (!r.signed) {
    return (
      <AuthShell title={r.title} subtitle={subtitle}>
        <div className="stack">
          <p>This download is available once you've signed your agreement with Lunar AeroLabs.</p>
          {r.pending_document_id ? (
            <>
              <Link className="btn btn-primary" href={`/sign/documents/${r.pending_document_id}`} style={{ textAlign: 'center' }}>
                Review & sign
              </Link>
              <p className="hint">
                You'll sign in as {r.email}. After signing, come back to this link to download.
              </p>
            </>
          ) : (
            <p className="hint">
              We couldn't find an agreement waiting for {r.email}. Contact hello@lunaraerolabs.com and we'll send it to you.
            </p>
          )}
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={r.title} subtitle={subtitle}>
      <div className="stack">
        {r.message && <p className="message">{r.message}</p>}
        <form method="post" action={`/sign/download/${encodeURIComponent(token)}/start`}>
          <button className="btn btn-primary" style={{ width: '100%' }}>
            Download
          </button>
        </form>
        <p className="hint">
          This link was issued to {r.email} and is personal to you. Each download is logged with its time, IP address and
          approximate location.
        </p>
      </div>
    </AuthShell>
  )
}
