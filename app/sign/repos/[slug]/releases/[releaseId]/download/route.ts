import { geolocation, ipAddress } from '@vercel/functions'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { appUrl } from '@/lib/email'
import { presignedDownloadUrl } from '@/lib/files'
import { canDownload, findRepoForUser, SLUG_RE } from '@/lib/repos'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The repository page's "Download" buttons post here. The signed-in user is
 * checked again, the download logged, then they're redirected to a short-lived
 * private Blob URL.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; releaseId: string }> }) {
  const { slug, releaseId } = await params
  const session = await getSession()
  if (session?.stage !== 'full') return Response.redirect(appUrl('/sign/login'), 303)
  if (!SLUG_RE.test(slug) || !UUID.test(releaseId)) return new Response('Not found', { status: 404 })

  const page = appUrl(`/sign/repos/${slug}`)
  const repo = await findRepoForUser(slug, session.user)
  if (!repo || !canDownload(repo, session.user)) return Response.redirect(page, 303)
  const release = await queryOne<{ blob_pathname: string; tag: string; file_name: string }>(
    'select blob_pathname, tag, file_name from repo_releases where id = $1 and repo_id = $2',
    [releaseId, repo.id],
  )
  if (!release) return Response.redirect(page, 303)

  // Only a download that can actually start is logged, so failed clicks don't count.
  let url: string
  try {
    url = await presignedDownloadUrl(release.blob_pathname)
  } catch (err) {
    console.error('[repo download: storage]', err)
    return Response.redirect(`${page}?unavailable=1`, 303)
  }

  const geo = geolocation(request)
  const ip = ipAddress(request) ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  await query(
    `insert into repo_downloads
       (release_id, user_id, repo_id, repo_name, repo_slug, tag, file_name, ip, city, region, country, latitude, longitude, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      releaseId,
      session.user.id,
      repo.id,
      repo.name,
      repo.slug,
      release.tag,
      release.file_name,
      ip,
      geo.city ?? null,
      geo.countryRegion ?? null,
      geo.country ?? null,
      geo.latitude ?? null,
      geo.longitude ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 300),
    ],
  )
  return Response.redirect(url, 303)
}
