import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { formatBytes } from '@/lib/files'
import { HAS_SIGNED_REPO } from '@/lib/repos'
import { Header, StatusBadge, fmtDate } from '@/components/Header'
import { ExportLinks } from '@/components/ExportLinks'
import {
  DeleteReleaseForm,
  DeleteRepoForm,
  EditRepoForm,
  MembersForm,
  PublishReleaseForm,
  RepoDocumentsForm,
  type CheckOption,
} from '../forms'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function place(d: { city: string | null; region: string | null; country: string | null }) {
  return [d.city, d.region, d.country].filter(Boolean).join(', ') || '—'
}

/** v0.3.1 → v0.3.2, so the usual case is one keystroke. */
function nextTag(tag: string | undefined): string {
  if (!tag) return 'v0.1.0'
  const m = tag.match(/^(.*?)(\d+)$/)
  return m ? `${m[1]}${Number(m[2]) + 1}` : tag
}

export default async function AdminRepoPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const repo = await queryOne<{ id: string; slug: string; name: string; description: string; readme: string }>(
    'select id, slug, name, description, readme from repos where id = $1',
    [id],
  )
  if (!repo) notFound()

  const releases = await query<{
    id: string
    tag: string
    title: string
    file_name: string
    size_bytes: string
    created_at: Date
    downloads: number
    downloaders: number
  }>(
    `select r.id, r.tag, r.title, r.file_name, r.size_bytes, r.created_at,
            count(d.id)::int as downloads, count(distinct d.user_id)::int as downloaders
       from repo_releases r left join repo_downloads d on d.release_id = r.id
      where r.repo_id = $1 group by r.id order by r.created_at desc`,
    [id],
  )
  const latest = releases[0]

  // Each member's "current" version is the newest release they have downloaded.
  const members = await query<{
    id: string
    email: string
    name: string
    status: string
    signed: boolean
    current_id: string | null
    current_tag: string | null
    last_at: Date | null
  }>(
    `select u.id, u.email, u.name, u.status, ${HAS_SIGNED_REPO} as signed,
            cur.release_id as current_id, cur.tag as current_tag,
            (select max(d.at) from repo_downloads d where d.repo_id = p.id and d.user_id = u.id) as last_at
       from repo_members m
       join users u on u.id = m.user_id
       join repos p on p.id = m.repo_id
       left join lateral (
         select r.id as release_id, r.tag from repo_downloads d join repo_releases r on r.id = d.release_id
          where r.repo_id = p.id and d.user_id = u.id order by r.created_at desc limit 1
       ) cur on true
      where m.repo_id = $1 order by u.email`,
    [id],
  )

  const people = await query<{ id: string; email: string; name: string; status: string; member: boolean }>(
    `select u.id, u.email, u.name, u.status, (m.user_id is not null) as member
       from users u left join repo_members m on m.user_id = u.id and m.repo_id = $1
      where u.status <> 'revoked' and u.role = 'signer'
      order by (m.user_id is not null) desc, u.email`,
    [id],
  )
  const documents = await query<{ id: string; title: string; required: boolean; signers: string }>(
    `select d.id, d.title, (rd.repo_id is not null) as required,
            coalesce(string_agg(u.email, ', ' order by u.email) filter (where r.status = 'signed'), '') as signers
       from documents d
       left join repo_documents rd on rd.document_id = d.id and rd.repo_id = $1
       left join recipients r on r.document_id = d.id
       left join users u on u.id = r.user_id
      where d.status <> 'draft'
      group by d.id, rd.repo_id order by (rd.repo_id is not null) desc, d.created_at desc`,
    [id],
  )
  const downloads = await query<{
    at: Date
    tag: string
    email: string
    name: string
    ip: string | null
    city: string | null
    region: string | null
    country: string | null
    latitude: string | null
    longitude: string | null
    user_agent: string | null
  }>(
    `select d.at, d.tag, u.email, u.name, d.ip, d.city, d.region, d.country, d.latitude, d.longitude, d.user_agent
       from repo_downloads d join users u on u.id = d.user_id
      where d.repo_id = $1 order by d.at desc limit 500`,
    [id],
  )

  const memberOptions: CheckOption[] = people.map((p) => ({
    id: p.id,
    label: p.name ? `${p.name} <${p.email}>` : p.email,
    detail: p.status === 'invited' ? "hasn't activated their account" : '',
    checked: p.member,
  }))
  const documentOptions: CheckOption[] = documents.map((d) => ({
    id: d.id,
    label: d.title,
    detail: d.signers && `signed by ${d.signers}`,
    checked: d.required,
  }))
  const requiredCount = documents.filter((d) => d.required).length
  const upToDate = members.filter((m) => latest && m.current_id === latest.id).length

  return (
    <>
      <Header user={admin} />
      <main className="page wide">
        <Link href="/sign/admin/repos">← Repositories</Link>
        <div className="title-row">
          <h1>{repo.name}</h1>
          <Link className="btn btn-small" href={`/sign/repos/${repo.slug}`}>
            View as tester
          </Link>
        </div>
        <p className="muted mono">/sign/repos/{repo.slug}</p>

        <section className="panel">
          <h2>
            Version status
            {latest && ` · ${upToDate} of ${members.length} on ${latest.tag}`}
          </h2>
          {members.length === 0 ? (
            <p className="muted">No members yet. Choose who can see this repository below.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Agreement</th>
                  <th>Current version</th>
                  <th>Status</th>
                  <th>Last download</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const status = !latest
                    ? 'no-release'
                    : m.current_id === latest.id
                      ? 'up-to-date'
                      : m.current_id
                        ? 'outdated'
                        : 'not-downloaded'
                  return (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.name || '—'}</strong>
                        <small>{m.email}</small>
                      </td>
                      <td>
                        <StatusBadge status={m.signed ? 'signed' : 'pending'} />
                      </td>
                      <td className="mono">{m.current_tag ?? '—'}</td>
                      <td>{status !== 'no-release' && <StatusBadge status={status} />}</td>
                      <td>{fmtDate(m.last_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Publish a release</h2>
          <p className="hint">
            The newest release is marked Latest. Members who can download get an email with a link to this repository.
          </p>
          <PublishReleaseForm repoId={id} suggestedTag={nextTag(latest?.tag)} />
        </section>

        <section className="panel">
          <h2>Releases</h2>
          {releases.length === 0 ? (
            <p className="muted">Nothing published yet.</p>
          ) : (
            <ul className="doc-list">
              {releases.map((r, i) => (
                <li key={r.id}>
                  <div>
                    <strong>
                      <span className="mono tag">{r.tag}</span> {r.title}
                    </strong>
                    <small>
                      {r.file_name} · {formatBytes(Number(r.size_bytes))} · {fmtDate(r.created_at)} · {r.downloads}{' '}
                      {r.downloads === 1 ? 'download' : 'downloads'} by {r.downloaders}{' '}
                      {r.downloaders === 1 ? 'person' : 'people'}
                    </small>
                  </div>
                  {i === 0 && <StatusBadge status="latest" />}
                  <DeleteReleaseForm releaseId={r.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Who can see this · {members.length} selected</h2>
          <p className="hint">Only people selected here see the repository. Admins always can.</p>
          <MembersForm repoId={id} people={memberOptions} />
        </section>

        <section className="panel">
          <h2>Required documents · {requiredCount} selected</h2>
          <p className="hint">
            Members can download only after signing at least one of these.
            {requiredCount === 0 && ' Nothing is selected, so members can see the repository but not download.'}
          </p>
          <RepoDocumentsForm repoId={id} documents={documentOptions} />
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>Download log</h2>
            {downloads.length > 0 && <ExportLinks filter={`repo=${id}`} />}
          </div>
          <p className="hint">
            Includes deleted releases. Location is approximate, derived from the IP address. VPNs and mobile carriers can place it far from the
            tester.
          </p>
          {downloads.length === 0 ? (
            <p className="muted">No downloads yet.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Version</th>
                  <th>Who</th>
                  <th>IP</th>
                  <th>Location</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDate(d.at)}</td>
                    <td className="mono">{d.tag}</td>
                    <td>
                      <strong>{d.name || d.email}</strong>
                      {d.name && <small>{d.email}</small>}
                    </td>
                    <td className="mono">{d.ip ?? '—'}</td>
                    <td>
                      {d.latitude && d.longitude ? (
                        <a href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`} target="_blank" rel="noreferrer">
                          {place(d)}
                        </a>
                      ) : (
                        place(d)
                      )}
                    </td>
                    <td className="mono">{d.user_agent || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Details & README</h2>
          <EditRepoForm repo={repo} />
        </section>

        <section className="panel">
          <h2>Delete repository</h2>
          <p className="hint">
            Removes every release file from storage and deletes this repository and its member list. Its downloads stay
            in <Link href="/sign/admin/downloads">Download history</Link>.
          </p>
          <DeleteRepoForm repoId={id} />
        </section>
      </main>
    </>
  )
}
