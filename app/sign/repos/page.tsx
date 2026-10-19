import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { query } from '@/lib/db'
import { Header, StatusBadge, fmtDate } from '@/components/Header'

export default async function Repos() {
  const user = await requireUser()
  const repos = await query<{
    slug: string
    name: string
    description: string
    latest_tag: string | null
    latest_at: Date | null
    has_latest: boolean
  }>(
    `select p.slug, p.name, p.description, l.tag as latest_tag, l.created_at as latest_at,
            exists (select 1 from repo_downloads d where d.release_id = l.id and d.user_id = $1) as has_latest
       from repos p
       left join lateral (
         select id, tag, created_at from repo_releases r where r.repo_id = p.id order by created_at desc limit 1
       ) l on true
      where $2 or exists (select 1 from repo_members m where m.repo_id = p.id and m.user_id = $1)
      order by coalesce(l.created_at, p.created_at) desc`,
    [user.id, user.role === 'admin'],
  )

  return (
    <>
      <Header user={user} />
      <main className="page">
        <h1>Repositories</h1>
        <p className="muted">Private builds shared with you by Lunar AeroLabs. Always run the latest version.</p>
        <section className="panel">
          {repos.length === 0 ? (
            <p className="muted">You haven't been added to any repositories yet.</p>
          ) : (
            <ul className="doc-list">
              {repos.map((r) => (
                <li key={r.slug}>
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {r.description && `${r.description} · `}
                      {r.latest_tag ? `Latest ${r.latest_tag} · ${fmtDate(r.latest_at)}` : 'No releases yet'}
                    </small>
                  </div>
                  {r.latest_tag && !r.has_latest && <StatusBadge status="update-available" />}
                  <Link className="btn" href={`/sign/repos/${r.slug}`}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
