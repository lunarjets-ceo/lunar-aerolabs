import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { query } from '@/lib/db'
import { formatBytes } from '@/lib/files'
import { canDownload, canView, findRepoForUser, SLUG_RE } from '@/lib/repos'
import { Header, StatusBadge, fmtDate } from '@/components/Header'

export default async function RepoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ unavailable?: string }>
}) {
  const user = await requireUser()
  const { slug } = await params
  const { unavailable } = await searchParams
  if (!SLUG_RE.test(slug)) notFound()
  const repo = await findRepoForUser(slug, user)
  // Non-members get the same 404 as a repo that doesn't exist.
  if (!repo || !canView(repo, user)) notFound()

  const releases = await query<{
    id: string
    tag: string
    title: string
    notes: string
    file_name: string
    size_bytes: string
    created_at: Date
    downloaded: boolean
  }>(
    `select r.id, r.tag, r.title, r.notes, r.file_name, r.size_bytes, r.created_at,
            exists (select 1 from repo_downloads d where d.release_id = r.id and d.user_id = $2) as downloaded
       from repo_releases r where r.repo_id = $1 order by r.created_at desc`,
    [repo.id, user.id],
  )
  const latest = releases[0]
  const current = releases.find((r) => r.downloaded)
  const allowed = canDownload(repo, user)

  return (
    <>
      <Header user={user} />
      <main className="page wide">
        <Link href="/sign/repos">← Repositories</Link>
        <div className="repo-title">
          <h1>
            <span className="muted">lunar-aerolabs /</span> {repo.slug}
          </h1>
          <span className="badge">Private</span>
        </div>
        {repo.description && <p className="muted">{repo.description}</p>}

        {latest && allowed && (
          <div className={`version-banner ${current?.id === latest.id ? 'ok' : 'warn'}`}>
            {current?.id === latest.id ? (
              <>
                You're on the latest version, <span className="mono tag">{latest.tag}</span>.
              </>
            ) : current ? (
              <>
                You're on <span className="mono tag">{current.tag}</span>. Please update to{' '}
                <span className="mono tag">{latest.tag}</span>.
              </>
            ) : (
              <>
                You haven't downloaded a build yet. The latest is <span className="mono tag">{latest.tag}</span>.
              </>
            )}
          </div>
        )}

        {!allowed && (
          <section className="panel">
            <h2>Agreement required</h2>
            <p>Downloads are available once you've signed your agreement with Lunar AeroLabs.</p>
            {repo.pending_document_id ? (
              <Link className="btn btn-primary" href={`/sign/documents/${repo.pending_document_id}`}>
                Review & sign
              </Link>
            ) : (
              <p className="hint">
                We couldn't find an agreement waiting for {user.email}. Contact hello@lunaraerolabs.com and we'll send it
                to you.
              </p>
            )}
          </section>
        )}

        {unavailable && (
          <p className="form-error" role="alert">
            Downloads are temporarily unavailable. Please try again later.
          </p>
        )}

        <div className="repo-layout">
          <div>
            <section className="panel">
              <h2>Releases · {releases.length}</h2>
              {releases.length === 0 ? (
                <p className="muted">Nothing has been published yet.</p>
              ) : (
                <ol className="release-list">
                  {releases.map((r) => (
                    <li key={r.id} id={r.tag}>
                      <div className="release-head">
                        <span className="mono tag">{r.tag}</span>
                        {r === latest && <StatusBadge status="latest" />}
                        {r === current && r !== latest && <StatusBadge status="your-version" />}
                        <small className="muted">{fmtDate(r.created_at)}</small>
                      </div>
                      {r.title && <h3>{r.title}</h3>}
                      {r.notes && <p className="release-notes">{r.notes}</p>}
                      <div className="release-asset">
                        <span>
                          {r.file_name} <small className="muted">· {formatBytes(Number(r.size_bytes))}</small>
                        </span>
                        {allowed && (
                          <form method="post" action={`/sign/repos/${repo.slug}/releases/${r.id}/download`}>
                            <button className={`btn btn-small${r === latest ? ' btn-primary' : ''}`}>Download</button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <aside>
            <section className="panel">
              <h2>About</h2>
              {repo.readme ? <p className="release-notes">{repo.readme}</p> : <p className="muted">No README yet.</p>}
              <p className="hint">
                This repository is private to you. Each download is logged with its time, IP address and approximate
                location.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  )
}
