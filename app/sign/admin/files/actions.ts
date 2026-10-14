'use server'

import { del, head } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne, transaction } from '@/lib/db'
import { audit } from '@/lib/audit'
import { BLOB_PATH_RE, sendFileLinks } from '@/lib/files'
import type { ActionResult } from '../actions'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Called by the browser once its direct-to-Blob upload has finished. */
export async function createSharedFile(input: {
  pathname: string
  fileName: string
  title: string
  message: string
}): Promise<{ error?: string; id?: string }> {
  const admin = await requireAdmin()
  if (!BLOB_PATH_RE.test(input.pathname)) return { error: 'Invalid upload.' }
  let size: number
  try {
    ;({ size } = await head(input.pathname))
  } catch {
    return { error: 'The upload could not be found in storage. Try again.' }
  }

  const fileName = input.fileName.slice(0, 200)
  const file = await queryOne<{ id: string }>(
    `insert into shared_files (title, message, file_name, blob_pathname, size_bytes, created_by)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.title.trim().slice(0, 200) || fileName, input.message.slice(0, 2000), fileName, input.pathname, size, admin.id],
  )
  await audit(null, admin, 'file.uploaded', `${fileName} (${size} bytes)`)
  revalidatePath('/sign/admin/files')
  return { id: file!.id }
}

/** Accepts one person per line (or comma separated): "email" or "Name <email>". */
function parseRecipients(raw: string): { people: { email: string; name: string }[]; invalid: string[] } {
  const seen = new Map<string, { email: string; name: string }>()
  const invalid: string[] = []
  for (const entry of raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(/^(.*?)\s*<([^>]+)>$/)
    const email = (m ? m[2] : entry).trim().toLowerCase()
    const name = (m ? m[1] : '').replace(/^["']|["']$/g, '').trim().slice(0, 120)
    if (EMAIL_RE.test(email)) seen.set(email, { email, name })
    else invalid.push(entry)
  }
  return { people: [...seen.values()], invalid }
}

export async function sendFile(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const file = await queryOne<{ id: string; title: string; message: string; file_name: string; size_bytes: string }>(
    `select id, title, message, file_name, size_bytes from shared_files where id = $1 and disabled_at is null`,
    [String(fd.get('fileId'))],
  )
  if (!file) return { error: 'This file is no longer available.' }
  const required = await queryOne('select 1 from shared_file_documents where file_id = $1 limit 1', [file.id])
  if (!required) return { error: 'Choose at least one required document first. Without one, nobody can download.' }

  const { people, invalid } = parseRecipients(String(fd.get('recipients') ?? ''))
  if (invalid.length) return { error: `Not a valid email: ${invalid.join(', ')}` }
  if (people.length === 0) return { error: 'Add at least one email address.' }

  const deliveries = await sendFileLinks(file, people)
  await audit(null, admin, 'file.sent', `${file.title} → ${people.map((p) => p.email).join(', ')}`)
  revalidatePath(`/sign/admin/files/${file.id}`)
  return { ok: `Sent ${people.length} personal ${people.length === 1 ? 'link' : 'links'}.`, deliveries }
}

export async function setRequiredDocuments(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const fileId = String(fd.get('fileId'))
  const ids = [...new Set(fd.getAll('documentId').map(String))]
  const valid = await query<{ id: string; title: string }>(
    `select id, title from documents where id = any($1::uuid[]) and status <> 'draft'`,
    [ids],
  )
  if (valid.length !== ids.length) return { error: 'Some of those documents are no longer available.' }

  const file = await queryOne<{ title: string }>('select title from shared_files where id = $1', [fileId])
  if (!file) return { error: 'File not found.' }
  await transaction(async (tx) => {
    await tx.query('delete from shared_file_documents where file_id = $1', [fileId])
    for (const d of valid) {
      await tx.query('insert into shared_file_documents (file_id, document_id) values ($1, $2)', [fileId, d.id])
    }
  })
  await audit(null, admin, 'file.requirements_set', `${file.title}: ${valid.map((d) => d.title).join(', ') || 'none'}`)
  revalidatePath(`/sign/admin/files/${fileId}`)
  return { ok: `Saved. ${valid.length} required ${valid.length === 1 ? 'document' : 'documents'}.` }
}

export async function revokeFileLink(fd: FormData): Promise<void> {
  const admin = await requireAdmin()
  const row = await queryOne<{ file_id: string; email: string }>(
    `update file_recipients set revoked_at = now() where id = $1 returning file_id, email`,
    [String(fd.get('recipientId'))],
  )
  if (!row) return
  await audit(null, admin, 'file.link_revoked', row.email)
  revalidatePath(`/sign/admin/files/${row.file_id}`)
}

/**
 * Stops every link straight away, removes the file from storage, then drops the
 * record and its download history. If storage can't be reached the record is
 * kept (links stay off) so pressing Delete again can finish the job.
 */
export async function deleteFile(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = String(fd.get('fileId'))
  const file = await queryOne<{ title: string; blob_pathname: string }>(
    `update shared_files set disabled_at = coalesce(disabled_at, now()) where id = $1 returning title, blob_pathname`,
    [id],
  )
  if (!file) return { error: 'File not found.' }
  try {
    await del(file.blob_pathname)
  } catch (err) {
    console.error('[file delete: storage]', err)
    revalidatePath('/sign/admin/files')
    revalidatePath(`/sign/admin/files/${id}`)
    return {
      error: `All links are now off, but the file couldn't be removed from storage (${(err as Error).message}). Press Delete again later to finish.`,
    }
  }
  await query('delete from shared_files where id = $1', [id])
  await audit(null, admin, 'file.deleted', file.title)
  revalidatePath('/sign/admin/files')
  redirect('/sign/admin/files')
}
