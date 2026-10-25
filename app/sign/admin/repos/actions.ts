'use server'

import { del, head } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne, transaction } from '@/lib/db'
import { audit } from '@/lib/audit'
import { BLOB_PATH_RE } from '@/lib/files'
import { announceRelease, SLUG_RE, slugify } from '@/lib/repos'
import type { ActionResult } from '../actions'

function revalidateRepo(id: string, slug?: string) {
  revalidatePath('/sign/admin/repos')
  revalidatePath(`/sign/admin/repos/${id}`)
  if (slug) revalidatePath(`/sign/repos/${slug}`)
}

export async function createRepo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const name = String(fd.get('name') ?? '').trim().slice(0, 120)
  const slug = slugify(String(fd.get('slug') ?? '') || name)
  if (!name) return { error: 'Give the repository a name.' }
  if (!SLUG_RE.test(slug)) return { error: 'The URL name may use only letters, numbers and dashes.' }
  if (await queryOne('select 1 from repos where slug = $1', [slug])) return { error: `"${slug}" is already taken.` }

  const repo = await queryOne<{ id: string }>(
    `insert into repos (slug, name, description, created_by) values ($1, $2, $3, $4) returning id`,
    [slug, name, String(fd.get('description') ?? '').trim().slice(0, 300), admin.id],
  )
  await audit(null, admin, 'repo.created', slug)
  revalidatePath('/sign/admin/repos')
  redirect(`/sign/admin/repos/${repo!.id}`)
}

export async function updateRepo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = String(fd.get('repoId'))
  const name = String(fd.get('name') ?? '').trim().slice(0, 120)
  if (!name) return { error: 'Give the repository a name.' }
  const repo = await queryOne<{ slug: string }>(
    `update repos set name = $2, description = $3, readme = $4 where id = $1 returning slug`,
    [id, name, String(fd.get('description') ?? '').trim().slice(0, 300), String(fd.get('readme') ?? '').slice(0, 50_000)],
  )
  if (!repo) return { error: 'Repository not found.' }
  await audit(null, admin, 'repo.updated', repo.slug)
  revalidateRepo(id, repo.slug)
  return { ok: 'Saved.' }
}

export async function setRepoMembers(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = String(fd.get('repoId'))
  const ids = [...new Set(fd.getAll('userId').map(String))]
  const valid = await query<{ id: string; email: string }>(
    `select id, email from users where id = any($1::uuid[]) and status <> 'revoked'`,
    [ids],
  )
  if (valid.length !== ids.length) return { error: 'Some of those people are no longer on the access list.' }

  const repo = await queryOne<{ slug: string }>('select slug from repos where id = $1', [id])
  if (!repo) return { error: 'Repository not found.' }
  await transaction(async (tx) => {
    // Keep existing rows so "added" dates survive a save.
    await tx.query('delete from repo_members where repo_id = $1 and not (user_id = any($2::uuid[]))', [id, ids])
    for (const u of valid) {
      await tx.query('insert into repo_members (repo_id, user_id) values ($1, $2) on conflict do nothing', [id, u.id])
    }
  })
  await audit(null, admin, 'repo.members_set', `${repo.slug}: ${valid.map((u) => u.email).join(', ') || 'none'}`)
  revalidateRepo(id, repo.slug)
  return { ok: `Saved. ${valid.length} ${valid.length === 1 ? 'member' : 'members'}.` }
}

export async function setRepoDocuments(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = String(fd.get('repoId'))
  const ids = [...new Set(fd.getAll('documentId').map(String))]
  const valid = await query<{ id: string; title: string }>(
    `select id, title from documents where id = any($1::uuid[]) and status <> 'draft'`,
    [ids],
  )
  if (valid.length !== ids.length) return { error: 'Some of those documents are no longer available.' }

  const repo = await queryOne<{ slug: string }>('select slug from repos where id = $1', [id])
  if (!repo) return { error: 'Repository not found.' }
  await transaction(async (tx) => {
    await tx.query('delete from repo_documents where repo_id = $1', [id])
    for (const d of valid) {
      await tx.query('insert into repo_documents (repo_id, document_id) values ($1, $2)', [id, d.id])
    }
  })
  await audit(null, admin, 'repo.requirements_set', `${repo.slug}: ${valid.map((d) => d.title).join(', ') || 'none'}`)
  revalidateRepo(id, repo.slug)
  return { ok: `Saved. ${valid.length} required ${valid.length === 1 ? 'document' : 'documents'}.` }
}

/** Called by the browser once its direct-to-Blob upload has finished. */
export async function createRelease(input: {
  repoId: string
  pathname: string
  fileName: string
  tag: string
  title: string
  notes: string
  notify: boolean
}): Promise<NonNullable<ActionResult>> {
  const admin = await requireAdmin()
  if (!BLOB_PATH_RE.test(input.pathname)) return { error: 'Invalid upload.' }
  const repo = await queryOne<{ id: string; slug: string; name: string }>('select id, slug, name from repos where id = $1', [
    input.repoId,
  ])
  if (!repo) return { error: 'Repository not found.' }
  const tag = input.tag.trim().slice(0, 60)
  if (!tag) return { error: 'Enter a version, e.g. v0.3.0.' }
  if (await queryOne('select 1 from repo_releases where repo_id = $1 and tag = $2', [repo.id, tag])) {
    return { error: `${tag} already exists. Use a new version number.` }
  }
  let size: number
  try {
    ;({ size } = await head(input.pathname))
  } catch {
    return { error: 'The upload could not be found in storage. Try again.' }
  }

  const release = {
    tag,
    title: input.title.trim().slice(0, 200),
    notes: input.notes.slice(0, 20_000),
    file_name: input.fileName.slice(0, 200),
    size_bytes: size,
  }
  await query(
    `insert into repo_releases (repo_id, tag, title, notes, file_name, blob_pathname, size_bytes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [repo.id, release.tag, release.title, release.notes, release.file_name, input.pathname, size, admin.id],
  )
  await audit(null, admin, 'repo.release_published', `${repo.slug} ${tag} (${size} bytes)`)
  const deliveries = input.notify ? await announceRelease(repo, release) : undefined
  revalidateRepo(repo.id, repo.slug)
  const notified = deliveries ? ` Notified ${deliveries.length} ${deliveries.length === 1 ? 'member' : 'members'}.` : ''
  return { ok: `Published ${tag}.${notified}`, deliveries }
}

export async function deleteRelease(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const release = await queryOne<{ repo_id: string; slug: string; tag: string; blob_pathname: string }>(
    `select r.repo_id, p.slug, r.tag, r.blob_pathname from repo_releases r join repos p on p.id = r.repo_id where r.id = $1`,
    [String(fd.get('releaseId'))],
  )
  if (!release) return { error: 'Release not found.' }
  try {
    await del(release.blob_pathname)
  } catch (err) {
    console.error('[release delete: storage]', err)
    return { error: `The file couldn't be removed from storage (${(err as Error).message}). Try again later.` }
  }
  await query('delete from repo_releases where id = $1', [String(fd.get('releaseId'))])
  await audit(null, admin, 'repo.release_deleted', `${release.slug} ${release.tag}`)
  revalidateRepo(release.repo_id, release.slug)
  return { ok: `Deleted ${release.tag}.` }
}

/** Removes every release file from storage, then the repo and its members. Download records are kept. */
export async function deleteRepo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin()
  const id = String(fd.get('repoId'))
  const repo = await queryOne<{ slug: string }>('select slug from repos where id = $1', [id])
  if (!repo) return { error: 'Repository not found.' }
  const blobs = await query<{ blob_pathname: string }>('select blob_pathname from repo_releases where repo_id = $1', [id])
  if (blobs.length) {
    try {
      await del(blobs.map((b) => b.blob_pathname))
    } catch (err) {
      console.error('[repo delete: storage]', err)
      return { error: `Release files couldn't be removed from storage (${(err as Error).message}). The repository was kept, so press Delete again later to finish.` }
    }
  }
  await query('delete from repos where id = $1', [id])
  await audit(null, admin, 'repo.deleted', repo.slug)
  revalidatePath('/sign/admin/repos')
  redirect('/sign/admin/repos')
}
