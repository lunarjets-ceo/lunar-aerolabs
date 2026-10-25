'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne, transaction } from '@/lib/db'
import { sha256 } from '@/lib/crypto'
import { audit } from '@/lib/audit'
import { inspectPdf } from '@/lib/pdf'
import { appUrl, sendEmail, SENDER_NAME } from '@/lib/email'
import { sendAccountInvite, type Delivery } from '@/lib/invites'

export type ActionResult = { error?: string; ok?: string; deliveries?: Delivery[] } | undefined

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PDF_BYTES = 4 * 1024 * 1024

// ---------- People / allowlist ----------

export async function inviteUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const name = String(fd.get('name') ?? '').trim().slice(0, 120)
  const role = fd.get('role') === 'admin' ? 'admin' : 'signer'
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' }

  const existing = await queryOne<{ status: string }>('select status from users where email = $1', [email])
  if (existing?.status === 'active') return { error: `${email} already has an active account.` }
  if (existing?.status === 'revoked') return { error: `${email} was revoked. Use "Restore" on their row instead.` }

  const user = await queryOne<{ id: string; email: string }>(
    `insert into users (email, name, role) values ($1, $2, $3)
     on conflict (email) do update set name = excluded.name, role = excluded.role
     returning id, email`,
    [email, name, role],
  )
  const delivery = await sendAccountInvite(user!)
  await audit(null, admin, 'user.invited', `${email} (${role})`)
  revalidatePath('/sign/admin/people')
  return { ok: `Added ${email} to the access list.`, deliveries: [delivery] }
}

export async function resendInvite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const user = await queryOne<{ id: string; email: string }>(
    `select id, email from users where id = $1 and status = 'invited'`,
    [String(fd.get('userId'))],
  )
  if (!user) return { error: 'User is not awaiting an invitation.' }
  const delivery = await sendAccountInvite(user)
  await audit(null, admin, 'user.invite_resent', user.email)
  return { deliveries: [delivery] }
}

/**
 * Corrects a person's name or email in place. Signatures and repo access hang
 * off the user id, so nothing needs re-signing; shared-file links are matched
 * by email and move with it.
 */
export async function updateUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const userId = String(fd.get('userId'))
  const email = String(fd.get('email') ?? '').trim().toLowerCase()
  const name = String(fd.get('name') ?? '').trim().slice(0, 120)
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' }

  const user = await queryOne<{ email: string }>('select email from users where id = $1', [userId])
  if (!user) return { error: 'That person is no longer on the access list.' }
  if (email !== user.email) {
    const taken = await queryOne('select 1 from users where email = $1 and id <> $2', [email, userId])
    if (taken) return { error: `${email} is already on the access list.` }
  }

  await transaction(async (tx) => {
    await tx.query('update users set email = $2, name = $3 where id = $1', [userId, email, name])
    if (email !== user.email) {
      await tx.query(
        `update file_recipients r set email = $2
          where r.email = $1
            and not exists (select 1 from file_recipients o where o.file_id = r.file_id and o.email = $2)`,
        [user.email, email],
      )
    }
  })
  await audit(null, admin, 'user.updated', email === user.email ? email : `${user.email} → ${email}`)
  revalidatePath('/sign/admin/people')
  return { ok: 'Saved.' }
}

export async function revokeUser(fd: FormData): Promise<void> {
  const admin = await requireAdmin()
  const userId = String(fd.get('userId'))
  if (userId === admin.id) return
  const user = await queryOne<{ email: string }>(
    `update users set status = 'revoked', invite_token_hash = null where id = $1 returning email`,
    [userId],
  )
  await query('delete from sessions where user_id = $1', [userId])
  if (user) await audit(null, admin, 'user.revoked', user.email)
  revalidatePath('/sign/admin/people')
}

export async function restoreUser(fd: FormData): Promise<void> {
  const admin = await requireAdmin()
  const user = await queryOne<{ email: string }>(
    `update users set status = case when password_hash is null then 'invited' else 'active' end
      where id = $1 and status = 'revoked' returning email`,
    [String(fd.get('userId'))],
  )
  if (user) await audit(null, admin, 'user.restored', user.email)
  revalidatePath('/sign/admin/people')
}

/** For a lost phone: forces the user to enroll a new authenticator at next sign-in. */
export async function resetAuthenticator(fd: FormData): Promise<void> {
  const admin = await requireAdmin()
  const userId = String(fd.get('userId'))
  const user = await queryOne<{ email: string }>(
    `update users set totp_enabled = false, totp_secret_enc = null, totp_last_step = 0
      where id = $1 returning email`,
    [userId],
  )
  await query('delete from recovery_codes where user_id = $1', [userId])
  await query('delete from sessions where user_id = $1', [userId])
  if (user) await audit(null, admin, 'user.mfa_reset', user.email)
  revalidatePath('/sign/admin/people')
}

// ---------- Documents ----------

export async function uploadDocument(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a PDF to upload.' }
  if (file.size > MAX_PDF_BYTES) return { error: 'PDF must be 4 MB or smaller.' }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let pageCount: number
  try {
    ;({ pageCount } = await inspectPdf(bytes))
  } catch {
    return { error: 'That file could not be read as a PDF. Password-protected PDFs are not supported.' }
  }

  const title = (String(fd.get('title') ?? '').trim() || file.name.replace(/\.pdf$/i, '')).slice(0, 200)
  const doc = await queryOne<{ id: string }>(
    `insert into documents (title, message, created_by, original_pdf, original_sha256, page_count)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [title, String(fd.get('message') ?? '').slice(0, 2000), admin.id, Buffer.from(bytes), sha256(bytes), pageCount],
  )
  await audit(doc!.id, admin, 'document.uploaded', `${file.name} sha256:${sha256(bytes)}`)
  redirect(`/sign/admin/documents/${doc!.id}`)
}

export interface FieldInput {
  type: 'signature' | 'initials' | 'text' | 'date' | 'name' | 'checkbox'
  page: number
  x: number
  y: number
  w: number
  h: number
  required: boolean
  label: string
}

export interface DraftInput {
  title: string
  message: string
  recipientUserIds: string[]
  fields: FieldInput[]
}

const FIELD_TYPES = new Set(['signature', 'initials', 'text', 'date', 'name', 'checkbox'])
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number(n) || 0))

export async function saveDraft(documentId: string, input: DraftInput): Promise<ActionResult> {
  const admin = await requireAdmin()
  const doc = await queryOne<{ status: string; page_count: number }>(
    'select status, page_count from documents where id = $1',
    [documentId],
  )
  if (!doc) return { error: 'Document not found.' }
  if (doc.status !== 'draft') return { error: 'Only drafts can be edited.' }

  const recipientIds = [...new Set(input.recipientUserIds)]
  const allowed = await query<{ id: string }>(
    `select id from users where id = any($1::uuid[]) and status <> 'revoked'`,
    [recipientIds],
  )
  if (allowed.length !== recipientIds.length) return { error: 'Every recipient must be on the access list.' }

  for (const f of input.fields) {
    if (!FIELD_TYPES.has(f.type)) return { error: 'Invalid field.' }
    if (!Number.isInteger(f.page) || f.page < 1 || f.page > doc.page_count) return { error: 'Invalid field page.' }
  }

  await transaction(async (tx) => {
    await tx.query('update documents set title = $2, message = $3 where id = $1', [
      documentId,
      input.title.trim().slice(0, 200) || 'Untitled document',
      input.message.slice(0, 2000),
    ])
    await tx.query('delete from recipients where document_id = $1', [documentId])
    await tx.query('delete from fields where document_id = $1', [documentId])
    for (const [i, userId] of recipientIds.entries()) {
      await tx.query('insert into recipients (document_id, user_id, sort_order) values ($1, $2, $3)', [
        documentId,
        userId,
        i,
      ])
    }
    // Fields are shared: every recipient fills in the same fields on their own copy.
    for (const f of input.fields) {
      await tx.query(
        `insert into fields (document_id, type, page, x, y, w, h, required, label)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          documentId,
          f.type,
          f.page,
          clamp01(f.x),
          clamp01(f.y),
          clamp01(f.w),
          clamp01(f.h),
          f.type === 'date' || f.type === 'name' ? true : Boolean(f.required),
          String(f.label ?? '').slice(0, 100),
        ],
      )
    }
  })
  await audit(documentId, admin, 'document.saved', `${recipientIds.length} recipients, ${input.fields.length} fields`)
  return { ok: 'Saved.' }
}

export async function sendDocument(documentId: string, input: DraftInput): Promise<ActionResult> {
  const admin = await requireAdmin()
  const saved = await saveDraft(documentId, input)
  if (saved?.error) return saved

  if (input.recipientUserIds.length === 0) return { error: 'Add at least one recipient.' }
  if (!input.fields.some((f) => f.type === 'signature')) return { error: 'Add at least one signature field.' }

  const doc = await queryOne<{ title: string; message: string }>(
    `update documents set status = 'sent', sent_at = now() where id = $1 and status = 'draft' returning title, message`,
    [documentId],
  )
  if (!doc) return { error: 'Document was already sent.' }

  const recipients = await query<{ id: string; email: string; status: string }>(
    `select u.id, u.email, u.status from recipients r join users u on u.id = r.user_id
      where r.document_id = $1 order by r.sort_order`,
    [documentId],
  )
  const deliveries: Delivery[] = []
  for (const r of recipients) {
    if (r.status === 'invited') {
      deliveries.push(await sendAccountInvite(r, { documentTitle: doc.title }))
    } else {
      const link = appUrl(`/sign/documents/${documentId}`)
      const from = SENDER_NAME
      const emailed = await sendEmail({
        to: r.email,
        subject: `Please sign: ${doc.title}`,
        preheader: `${from} sent you "${doc.title}" to review and sign.`,
        eyebrow: 'Signature requested',
        heading: 'You have a document to sign',
        body: `${from} has sent you a document to review and sign electronically.`,
        document: { title: doc.title, from, message: doc.message || undefined },
        ctaLabel: 'Review & sign',
        ctaUrl: link,
        note: "You'll sign in with your password and authenticator code.",
      })
      deliveries.push({ email: r.email, link, emailed })
    }
  }
  await audit(documentId, admin, 'document.sent', recipients.map((r) => r.email).join(', '))
  revalidatePath('/sign/admin')
  return { ok: 'Sent for signature.', deliveries }
}

export async function voidDocument(fd: FormData): Promise<void> {
  const admin = await requireAdmin()
  const id = String(fd.get('documentId'))
  const doc = await queryOne(`update documents set status = 'voided' where id = $1 and status = 'sent' returning id`, [id])
  if (doc) await audit(id, admin, 'document.voided')
  revalidatePath(`/sign/admin/documents/${id}`)
}

export async function deleteDocument(fd: FormData): Promise<void> {
  await requireAdmin()
  const id = String(fd.get('documentId'))
  await query(`delete from documents where id = $1 and status in ('draft', 'voided')`, [id])
  redirect('/sign/admin')
}
