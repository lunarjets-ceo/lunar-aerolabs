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

  return (
    <AuthShell title={r.title} subtitle={`${r.file_name} · ${formatBytes(Number(r.size_bytes))}`}>
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
