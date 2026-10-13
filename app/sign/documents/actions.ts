'use server'

import { revalidatePath } from 'next/cache'
import { clientInfo, requireUser, type User } from '@/lib/auth'
import { query, queryOne, transaction } from '@/lib/db'
import { sha256 } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { buildCompletedPdf, type FieldRow } from '@/lib/pdf'
import { appUrl, sendEmail, SENDER_NAME } from '@/lib/email'

export type SignResult = { error?: string; done?: boolean } | undefined

const MAX_SIGNATURE_CHARS = 300_000
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

async function myRecipient(documentId: string, userId: string) {
  return queryOne<{ id: string; status: string; doc_status: string; title: string }>(
    `select r.id, r.status, d.status as doc_status, d.title
       from recipients r join documents d on d.id = r.document_id
      where r.document_id = $1 and r.user_id = $2`,
    [documentId, userId],
  )
}

export async function submitSignature(
  documentId: string,
  values: Record<string, string>,
  consent: boolean,
): Promise<SignResult> {
  const user = await requireUser()
  const recipient = await myRecipient(documentId, user.id)
  if (!recipient || recipient.doc_status !== 'sent') return { error: 'This document is not available for signing.' }
  if (recipient.status === 'signed' || recipient.status === 'declined') return { error: 'You have already responded.' }
  if (!consent) return { error: 'You must agree to sign electronically.' }

  const fields = await query<{ id: string; type: FieldRow['type']; required: boolean }>(
    'select id, type, required from fields where document_id = $1',
    [documentId],
  )
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const resolved: [string, string | null][] = []
  for (const f of fields) {
    let v: string | null = values[f.id] ?? null
    if (f.type === 'date') v = today
    else if (f.type === 'name') v = user.name || user.email
    else if (f.type === 'signature' || f.type === 'initials') {
      if (v && (v.length > MAX_SIGNATURE_CHARS || !PNG_DATA_URL.test(v))) return { error: 'Invalid signature image.' }
    } else if (f.type === 'checkbox') v = v === 'true' ? 'true' : null
    else v = v?.trim().slice(0, 500) || null

    if (f.required && !v) return { error: 'Please complete all required fields.' }
    resolved.push([f.id, v])
  }

  const { ip } = await clientInfo()
  const claimed = await transaction(async (tx) => {
    // The status guard makes a double submit a no-op.
    const [row] = await tx.query(
      `update recipients set status = 'signed', signed_at = now(), signed_ip = $2
        where id = $1 and status in ('pending', 'viewed') returning id`,
      [recipient.id, ip],
    )
    if (!row) return false
    for (const [fieldId, v] of resolved) {
      await tx.query('insert into field_values (recipient_id, field_id, value) values ($1, $2, $3)', [
        recipient.id,
        fieldId,
        v,
      ])
    }
    await audit(documentId, user, 'document.signed', '', tx)
    return true
  })
  if (!claimed) return { error: 'You have already responded.' }

  await buildRecipientCopy(documentId, recipient.id, user)
  await notifySubmission(documentId, recipient.title, user)
  await completeIfAllResponded(documentId)
  revalidatePath(`/sign/documents/${documentId}`)
  return { done: true }
}

export async function declineDocument(documentId: string, reason: string): Promise<SignResult> {
  const user = await requireUser()
  const recipient = await myRecipient(documentId, user.id)
  if (!recipient || recipient.doc_status !== 'sent' || ['signed', 'declined'].includes(recipient.status)) {
    return { error: 'This document is not available.' }
  }
  await query(`update recipients set status = 'declined', decline_reason = $2 where id = $1`, [
    recipient.id,
    reason.slice(0, 1000),
  ])
  await audit(documentId, user, 'document.declined', reason.slice(0, 200))

  const owner = await documentOwner(documentId)
  if (owner) {
    await sendEmail({
      to: owner,
      subject: `Declined: ${recipient.title}`,
      preheader: `${user.name || user.email} declined to sign "${recipient.title}".`,
      eyebrow: 'Declined',
      heading: `${user.name || user.email} declined to sign`,
      body: "Their copy is closed. Everyone else's copies are unaffected.",
      document: {
        title: recipient.title,
        from: user.email,
        message: reason || 'No reason was given.',
        status: 'Declined',
        tone: 'bad',
      },
      ctaLabel: 'View submissions',
      ctaUrl: appUrl(`/sign/admin/documents/${documentId}`),
    })
  }
  await completeIfAllResponded(documentId)
  revalidatePath(`/sign/documents/${documentId}`)
  return { done: true }
}

async function documentOwner(documentId: string): Promise<string | null> {
  const row = await queryOne<{ email: string }>(
    'select u.email from documents d join users u on u.id = d.created_by where d.id = $1',
    [documentId],
  )
  return row?.email ?? null
}

/** Builds the signer's private signed PDF: only their answers and only their audit trail. */
async function buildRecipientCopy(documentId: string, recipientId: string, user: User): Promise<void> {
  const doc = await queryOne<{ title: string; original_pdf: Uint8Array; original_sha256: string }>(
    'select title, original_pdf, original_sha256 from documents where id = $1',
    [documentId],
  )
  const signer = await queryOne<{ signed_at: Date; signed_ip: string | null }>(
    'select signed_at, signed_ip from recipients where id = $1',
    [recipientId],
  )
  if (!doc || !signer) return

  const fields = await query<FieldRow>(
    `select f.id, f.type, f.page, f.x, f.y, f.w, f.h, v.value
       from fields f left join field_values v on v.field_id = f.id and v.recipient_id = $2
      where f.document_id = $1`,
    [documentId, recipientId],
  )
  // Admin actions appear as the company; other signers' events are left out entirely.
  const events = await query<{ at: Date; email: string | null; action: string; ip: string | null }>(
    `select at,
            case when user_id = $2 then email else $3 end as email,
            action,
            case when user_id = $2 then ip end as ip
       from audit_events
      where document_id = $1 and (user_id = $2 or action in ('document.uploaded', 'document.sent'))
      order by at, id`,
    [documentId, user.id, SENDER_NAME],
  )

  const pdf = await buildCompletedPdf({
    original: new Uint8Array(doc.original_pdf),
    copyId: recipientId,
    title: doc.title,
    originalSha256: doc.original_sha256,
    fields,
    signers: [{ name: user.name, email: user.email, signed_at: signer.signed_at, signed_ip: signer.signed_ip }],
    events,
  })
  await query('update recipients set completed_pdf = $2, completed_sha256 = $3 where id = $1', [
    recipientId,
    Buffer.from(pdf),
    sha256(pdf),
  ])
}

async function notifySubmission(documentId: string, title: string, user: User): Promise<void> {
  const counts = await queryOne<{ signed: number; total: number }>(
    `select count(*) filter (where status = 'signed')::int as signed, count(*)::int as total
       from recipients where document_id = $1`,
    [documentId],
  )
  const progress = counts ? `${counts.signed} of ${counts.total} signed` : undefined

  await sendEmail({
    to: user.email,
    subject: `Signed: ${title}`,
    preheader: `Your signed copy of "${title}" is ready.`,
    eyebrow: 'Completed',
    heading: 'Thank you for signing',
    body: 'Your signature has been recorded. Your signed copy, with its certificate of completion, is ready to download.',
    document: { title, from: SENDER_NAME, status: 'Signed', tone: 'ok' },
    ctaLabel: 'Download your signed copy',
    ctaUrl: appUrl(`/sign/documents/${documentId}`),
  })

  const owner = await documentOwner(documentId)
  if (owner) {
    await sendEmail({
      to: owner,
      subject: `${user.name || user.email} signed: ${title}`,
      preheader: `New submission from ${user.name || user.email}${progress ? ` · ${progress}` : ''}.`,
      eyebrow: 'New submission',
      heading: `${user.name || user.email} signed`,
      body: 'Their individual signed copy is ready to review and download.',
      document: { title, from: user.email, status: progress, tone: 'ok' },
      ctaLabel: 'View submission',
      ctaUrl: appUrl(`/sign/admin/documents/${documentId}`),
    })
  }
}

/** The document is complete once every recipient has signed or declined. */
async function completeIfAllResponded(documentId: string): Promise<void> {
  const waiting = await queryOne(
    `select 1 from recipients where document_id = $1 and status in ('pending', 'viewed')`,
    [documentId],
  )
  if (waiting) return
  const done = await queryOne(
    `update documents set status = 'completed', completed_at = now() where id = $1 and status = 'sent' returning id`,
    [documentId],
  )
  if (done) await audit(documentId, null, 'document.completed')
}
