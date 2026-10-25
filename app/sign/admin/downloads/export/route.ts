import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { allDownloads, downloadsCsv, downloadsPdf } from '@/lib/downloads'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** "Build 7 (final)" → "build-7-final", for the downloaded file's name. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'downloads'
}

/**
 * The download log as CSV (default) or PDF: everything, or one shared file
 * (?file=<id>) or one repository (?repo=<id>).
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (session?.stage !== 'full' || session.user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const fileId = params.get('file') ?? undefined
  const repoId = params.get('repo') ?? undefined
  if ((fileId && !UUID.test(fileId)) || (repoId && !UUID.test(repoId))) {
    return new Response('Not found', { status: 404 })
  }

  let title = 'Download history'
  if (fileId) {
    const file = await queryOne<{ title: string }>('select title from shared_files where id = $1', [fileId])
    if (!file) return new Response('Not found', { status: 404 })
    title = `Download log: ${file.title}`
  } else if (repoId) {
    const repo = await queryOne<{ name: string }>('select name from repos where id = $1', [repoId])
    if (!repo) return new Response('Not found', { status: 404 })
    title = `Download log: ${repo.name}`
  }

  const rows = await allDownloads({ fileId, repoId })
  const name = `lunar-aerolabs-${slug(title.replace(/^Download log: /, ''))}-${new Date().toISOString().slice(0, 10)}`
  const pdf = params.get('format') === 'pdf'
  const body = pdf ? await downloadsPdf(rows, title) : downloadsCsv(rows)
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': pdf ? 'application/pdf' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.${pdf ? 'pdf' : 'csv'}"`,
      'Cache-Control': 'no-store',
    },
  })
}
