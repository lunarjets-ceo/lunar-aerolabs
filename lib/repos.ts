import type { User } from './auth'
import { query, queryOne } from './db'
import { appUrl, sendEmail, SENDER_NAME } from './email'
import { formatBytes } from './files'
import type { Delivery } from './invites'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

/** SQL boolean: user `u` has signed at least one of repo `p`'s required documents. */
export const HAS_SIGNED_REPO = `exists (
  select 1 from repo_documents rd join recipients rr on rr.document_id = rd.document_id
   where rd.repo_id = p.id and rr.user_id = u.id and rr.status = 'signed')`

export interface RepoView {
  id: string
  slug: string
  name: string
  description: string
  readme: string
  created_at: Date
  member: boolean
  signed: boolean
  /** A required document still waiting on this user's signature, if any. */
  pending_document_id: string | null
}

export async function findRepoForUser(slug: string, user: User): Promise<RepoView | null> {
  return queryOne<RepoView>(
    `select p.id, p.slug, p.name, p.description, p.readme, p.created_at,
            exists (select 1 from repo_members m where m.repo_id = p.id and m.user_id = u.id) as member,
            ${HAS_SIGNED_REPO} as signed,
            (select rd.document_id from repo_documents rd
               join recipients rr on rr.document_id = rd.document_id
               join documents d on d.id = rd.document_id
              where rd.repo_id = p.id and rr.user_id = u.id
                and rr.status in ('pending', 'viewed') and d.status = 'sent' limit 1) as pending_document_id
       from repos p cross join users u
      where p.slug = $1 and u.id = $2`,
    [slug, user.id],
  )
}

/** Admins see every repo; testers only the ones they were added to. */
export function canView(repo: RepoView, user: User): boolean {
  return user.role === 'admin' || repo.member
}

/** Downloading also needs a signed required document (admins are exempt). */
export function canDownload(repo: RepoView, user: User): boolean {
  return user.role === 'admin' || (repo.member && repo.signed)
}

/** Emails every member who can download that a new version is out. */
export async function announceRelease(
  repo: { id: string; slug: string; name: string },
  release: { tag: string; title: string; notes: string; file_name: string; size_bytes: number | string },
): Promise<Delivery[]> {
  const people = await query<{ email: string; name: string }>(
    `select u.email, u.name from repo_members m
       join users u on u.id = m.user_id and u.status = 'active'
       join repos p on p.id = m.repo_id
      where m.repo_id = $1 and ${HAS_SIGNED_REPO} order by u.email`,
    [repo.id],
  )
  const link = appUrl(`/sign/repos/${repo.slug}`)
  const deliveries: Delivery[] = []
  for (const p of people) {
    const emailed = await sendEmail({
      to: p.email,
      subject: `${repo.name} ${release.tag} is available`,
      preheader: `A new version of ${repo.name} is ready. Please update.`,
      eyebrow: 'New release',
      heading: `${repo.name} ${release.tag}`,
      body: `${SENDER_NAME} published a new version of ${repo.name}. Please download it and replace your current build so everyone on the alpha team stays on the same version.`,
      document: {
        title: release.title || release.tag,
        from: `${release.file_name} · ${formatBytes(Number(release.size_bytes))}`,
        message: release.notes || undefined,
        markdown: true,
        kind: 'FILE',
      },
      ctaLabel: 'Open repository',
      ctaUrl: link,
      security: 'Sign-in requires your password and authenticator. Each download is logged with its time, IP address and approximate location.',
    })
    deliveries.push({ email: p.email, link, emailed })
  }
  return deliveries
}
