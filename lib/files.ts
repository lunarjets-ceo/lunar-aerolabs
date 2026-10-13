import { issueSignedToken, presignUrl } from '@vercel/blob'
import { query, queryOne } from './db'
import { randomToken, sha256 } from './crypto'
import { appUrl, sendEmail, SENDER_NAME } from './email'
import type { Delivery } from './invites'

export const MAX_FILE_BYTES = 10 * 1024 ** 3
/** Uploads land at shared-files/<uuid>/<name> so nothing is ever overwritten. */
export const BLOB_PATH_RE = /^shared-files\/[0-9a-f-]{36}\/[^/]{1,200}$/

// A redirect target, not something a tester keeps: long enough to start a
// slow download, short enough that a copied URL stops working soon after.
const DOWNLOAD_URL_MINUTES = 15

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Short-lived direct URL to the private blob, served with a download disposition. */
export async function presignedDownloadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + DOWNLOAD_URL_MINUTES * 60_000
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil })
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, validUntil, access: 'private' })
  const url = new URL(presignedUrl)
  url.searchParams.set('download', '1')
  return url.toString()
}

/** Issues each person their own link (replacing any earlier one) and emails it. */
export async function sendFileLinks(
  file: { id: string; title: string; message: string; file_name: string; size_bytes: number | string },
  people: { email: string; name: string }[],
): Promise<Delivery[]> {
  const deliveries: Delivery[] = []
  for (const p of people) {
    const token = randomToken()
    await query(
      `insert into file_recipients (file_id, email, name, token_hash) values ($1, $2, $3, $4)
       on conflict (file_id, email) do update
         set name = coalesce(nullif(excluded.name, ''), file_recipients.name),
             token_hash = excluded.token_hash, sent_at = now(), revoked_at = null`,
      [file.id, p.email, p.name, sha256(token)],
    )
    const link = appUrl(`/sign/download/${token}`)
    const emailed = await sendEmail({
      to: p.email,
      subject: `Your download: ${file.title}`,
      preheader: `${SENDER_NAME} shared "${file.title}" with you.`,
      eyebrow: 'Alpha access',
      heading: p.name ? `${p.name.split(' ')[0]}, your build is ready` : 'Your build is ready',
      body: `${SENDER_NAME} has shared a file with you. Your download link is personal to you, so please don't forward it.`,
      document: {
        title: file.title,
        from: `${file.file_name} · ${formatBytes(Number(file.size_bytes))}`,
        message: file.message || undefined,
        kind: 'FILE',
      },
      ctaLabel: 'Download',
      ctaUrl: link,
      note: 'Large file: use a stable connection. You can come back to this link any time.',
      security: 'This link is unique to you. Each download is logged with its time, IP address and approximate location.',
    })
    deliveries.push({ email: p.email, link, emailed })
  }
  return deliveries
}

export async function findRecipientByToken(token: string) {
  return queryOne<{
    recipient_id: string
    email: string
    name: string
    file_id: string
    title: string
    message: string
    file_name: string
    blob_pathname: string
    size_bytes: string
  }>(
    `select r.id as recipient_id, r.email, r.name, f.id as file_id, f.title, f.message, f.file_name,
            f.blob_pathname, f.size_bytes
       from file_recipients r join shared_files f on f.id = r.file_id
      where r.token_hash = $1 and r.revoked_at is null and f.disabled_at is null`,
    [sha256(token)],
  )
}
