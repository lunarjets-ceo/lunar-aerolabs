'use server'

import { revalidatePath } from 'next/cache'
import { clientInfo, requireUser } from '@/lib/auth'
import { query, queryOne, transaction } from '@/lib/db'
import { sha256 } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { buildCompletedPdf, type FieldRow } from '@/lib/pdf'
import { appUrl, sendEmail } from '@/lib/email'

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
    'select id, type, required from fields where recipient_id = $1',
    [recipient.id],
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
  await transaction(async (tx) => {
    for (const [id, v] of resolved) await tx.query('update fields set value = $2 where id = $1', [id, v])
    await tx.query(`update recipients set status = 'signed', signed_at = now(), signed_ip = $2 where id = $1`, [
      recipient.id,
      ip,
    ])
    await audit(documentId, user, 'document.signed', '', tx)
  })

  await finalizeIfComplete(documentId)
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

  const owner = await queryOne<{ email: string }>(
    'select u.email from documents d join users u on u.id = d.created_by where d.id = $1',
    [documentId],
  )
  if (owner) {
    await sendEmail({
      to: owner.email,
      subject: `Declined: ${recipient.title}`,
      preheader: `${user.name || user.email} declined to sign "${recipient.title}".`,
      eyebrow: 'Declined',
      heading: `${user.name || user.email} declined to sign`,
      body: 'The envelope is on hold. Review the details, then void it and send a revised version if needed.',
      document: { title: recipient.title, from: user.email, message: reason || 'No reason was given.', status: 'Declined', tone: 'bad' },
      ctaLabel: 'View envelope',
      ctaUrl: appUrl(`/sign/admin/documents/${documentId}`),
    })
  }
  revalidatePath(`/sign/documents/${documentId}`)
  return { done: true }
}

async function finalizeIfComplete(documentId: string): Promise<void> {
  const pending = await queryOne(`select 1 from recipients where document_id = $1 and status <> 'signed'`, [documentId])
  if (pending) return

  // Claim the document so concurrent final signatures don't both build the PDF.
  const doc = await queryOne<{ title: string; original_pdf: Uint8Array; original_sha256: string }>(
    `update documents set status = 'completed', completed_at = now()
      where id = $1 and status = 'sent'
      returning title, original_pdf, original_sha256`,
    [documentId],
  )
  if (!doc) return

  const fields = await query<FieldRow>('select id, type, page, x, y, w, h, value from fields where document_id = $1', [documentId])
  const signers = await query<{ name: string; email: string; signed_at: Date; signed_ip: string | null }>(
    `select u.name, u.email, r.signed_at, r.signed_ip from recipients r join users u on u.id = r.user_id
      where r.document_id = $1 order by r.sort_order`,
    [documentId],
  )
  await audit(documentId, null, 'document.completed')
  const events = await query<{ at: Date; email: string | null; action: string; ip: string | null }>(
    'select at, email, action, ip from audit_events where document_id = $1 order by at, id',
    [documentId],
  )

  const pdf = await buildCompletedPdf({
    original: new Uint8Array(doc.original_pdf),
    documentId,
    title: doc.title,
    originalSha256: doc.original_sha256,
    fields,
    signers,
    events,
  })
  await query('update documents set completed_pdf = $2, completed_sha256 = $3 where id = $1', [
    documentId,
    Buffer.from(pdf),
    sha256(pdf),
  ])

  const owner = await queryOne<{ email: string }>(
    'select u.email from documents d join users u on u.id = d.created_by where d.id = $1',
    [documentId],
  )
  const notify = new Set([...signers.map((s) => s.email), ...(owner ? [owner.email] : [])])
  for (const email of notify) {
    await sendEmail({
      to: email,
      subject: `Completed: ${doc.title}`,
      preheader: `Everyone has signed "${doc.title}". Your signed copy is ready.`,
      eyebrow: 'Completed',
      heading: 'All parties have signed',
      body: 'The document is complete. Sign in to download the final signed PDF, which includes a certificate of completion with the full audit trail.',
      document: { title: doc.title, status: `Signed by ${signers.length} ${signers.length === 1 ? 'party' : 'parties'}`, tone: 'ok' },
      ctaLabel: 'Download signed copy',
      ctaUrl: appUrl(`/sign/documents/${documentId}`),
    })
  }
}
