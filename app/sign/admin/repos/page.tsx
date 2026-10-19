import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { query } from '@/lib/db'
import { Header, fmtDate } from '@/components/Header'
import { CreateRepoForm } from './forms'

export default async function AdminRepos() {
  const user = await requireAdmin()
  const repos = await query<{
    id: string
    slug: string
    name: string
    description: string
    members: number
    latest_tag: string | null
    latest_at: Date | null
    up_to_date: number
  }>(
    `select p.id, p.slug, p.name, p.description,
            (select count(*)::int from repo_members m where m.repo_id = p.id) as members,
            l.tag as latest_tag, l.created_at as latest_at,
            (select count(distinct d.user_id)::int from repo_downloads d
               join repo_members m on m.user_id = d.user_id and m.repo_id = p.id
              where d.release_id = l.id) as up_to_date
       from repos p
       left join lateral (
         select id, tag, created_at from repo_releases r where r.repo_id = p.id order by created_at desc limit 1
       ) l on true
      order by coalesce(l.created_at, p.created_at) desc`,
  )

  return (
    <>
      <Header user={user} />
      <main className="page">
        <h1>Repositories</h1>
        <p className="muted">
          A private release page for each product. Choose who can see it and which signed document they need, then
          publish versioned builds. Every download is logged with its IP address and approximate location, and you can
          see which version each tester is on.
        </p>
        <section className="panel">
          <h2>New repository</h2>
          <CreateRepoForm />
        </section>
        <section className="panel">
          <h2>All repositories</h2>
          {repos.length === 0 ? (
            <p className="muted">No repositories yet.</p>
          ) : (
            <ul className="doc-list">
              {repos.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {r.latest_tag
                        ? `Latest ${r.latest_tag} · ${fmtDate(r.latest_at)} · ${r.up_to_date}/${r.members} members up to date`
                        : `No releases yet · ${r.members} ${r.members === 1 ? 'member' : 'members'}`}
                    </small>
                  </div>
                  <Link className="btn" href={`/sign/repos/${r.slug}`}>
                    View
                  </Link>
                  <Link className="btn" href={`/sign/admin/repos/${r.id}`}>
                    Manage
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
