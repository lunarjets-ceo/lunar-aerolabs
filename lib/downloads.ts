import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { query } from './db'
import { winAnsi } from './pdf'

export interface DownloadRecord {
  at: Date
  source: 'File' | 'Repository'
  item: string
  version: string | null
  file_name: string | null
  email: string | null
  name: string | null
  ip: string | null
  city: string | null
  region: string | null
  country: string | null
  latitude: string | null
  longitude: string | null
  user_agent: string | null
  /** The file, release or repo has since been deleted; the record itself is kept. */
  deleted: boolean
}

export interface DownloadFilter {
  /** Only downloads of this shared file. */
  fileId?: string
  /** Only downloads from this repository. */
  repoId?: string
  limit?: number
}

/** Logged downloads, shared files and repository releases together, newest first. */
export async function allDownloads({ fileId, repoId, limit }: DownloadFilter = {}): Promise<DownloadRecord[]> {
  return query<DownloadRecord>(
    `select * from (
       select d.at, 'File' as source, coalesce(d.file_title, '') as item, null as version, d.file_name,
              d.email, d.name, d.ip, d.city, d.region, d.country, d.latitude, d.longitude, d.user_agent,
              (d.recipient_id is null) as deleted
         from file_downloads d left join file_recipients r on r.id = d.recipient_id
        where $2::uuid is null and ($1::uuid is null or r.file_id = $1)
       union all
       select d.at, 'Repository', coalesce(d.repo_name, ''), d.tag, d.file_name,
              u.email, u.name, d.ip, d.city, d.region, d.country, d.latitude, d.longitude, d.user_agent,
              (d.release_id is null)
         from repo_downloads d join users u on u.id = d.user_id
        where $1::uuid is null and ($2::uuid is null or d.repo_id = $2)
     ) all_downloads
     order by at desc ${limit ? `limit ${Math.floor(limit)}` : ''}`,
    [fileId ?? null, repoId ?? null],
  )
}

export function place(d: { city: string | null; region: string | null; country: string | null }) {
  return [d.city, d.region, d.country].filter(Boolean).join(', ') || '—'
}

export const CSV_COLUMNS = [
  'at', 'source', 'item', 'version', 'file_name', 'email', 'name', 'ip',
  'city', 'region', 'country', 'latitude', 'longitude', 'user_agent', 'deleted',
] as const

/** Quotes a cell, and defuses values a spreadsheet would run as a formula. */
function cell(value: unknown): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}` // negative coordinates are fine
  return `"${s.replace(/"/g, '""')}"`
}

export function downloadsCsv(rows: DownloadRecord[]): string {
  const lines = rows.map((d) => CSV_COLUMNS.map((c) => cell(d[c])).join(','))
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n'
}

const utc = (d: Date) => new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
const minute = (d: Date) => new Date(d).toISOString().replace('T', ' ').slice(0, 16)

/** Cuts text to fit a column, ending in "..." when shortened. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  let s = winAnsi(text)
  if (font.widthOfTextAtSize(s, size) <= width) return s
  while (s && font.widthOfTextAtSize(s + '...', size) > width) s = s.slice(0, -1)
  return s + '...'
}

/** Splits text across two lines of a column: as much as fits, then the rest. */
function wrap2(text: string, font: PDFFont, size: number, width: number): [string, string] {
  const s = winAnsi(text)
  let n = s.length
  while (n > 0 && font.widthOfTextAtSize(s.slice(0, n), size) > width) n--
  return [s.slice(0, n), s.slice(n).trimStart()]
}

/** A printable log: one row per download, landscape Letter, with page numbers. */
export async function downloadsPdf(rows: DownloadRecord[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setProducer('Lunar AeroLabs')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const [W, H, M] = [792, 612, 36]
  const size = 7.5
  const rowH = 22
  const dim = rgb(0.4, 0.42, 0.45)
  const line = rgb(0.85, 0.86, 0.88)

  // Two lines per row: the main value, then a detail line beneath it.
  const columns: { label: string; width: number; cell: (d: DownloadRecord) => [string, string] }[] = [
    { label: 'WHEN (UTC)', width: 82, cell: (d) => [minute(d.at), d.deleted ? 'Source deleted' : ''] },
    { label: 'WHAT', width: 150, cell: (d) => [[d.item || d.file_name || '-', d.version].filter(Boolean).join(' '), [d.source, d.file_name].filter(Boolean).join(' · ')] },
    { label: 'WHO', width: 130, cell: (d) => [d.name || d.email || '-', d.name ? (d.email ?? '') : ''] },
    { label: 'IP', width: 80, cell: (d) => [d.ip ?? '-', ''] },
    { label: 'LOCATION', width: 130, cell: (d) => [place(d).replace('—', '-'), d.latitude && d.longitude ? `${d.latitude}, ${d.longitude}` : ''] },
    { label: 'DEVICE', width: W - 2 * M - 572, cell: (d) => wrap2(d.user_agent || '-', font, size, W - 2 * M - 578) },
  ]

  const generated = utc(new Date())
  let page = doc.addPage([W, H])
  let y = H - M

  const header = (first: boolean) => {
    if (first) {
      page.drawText(winAnsi('LUNAR AEROLABS'), { x: M, y: y - 8, size: 8, font: bold, color: dim })
      page.drawText(fit(title, bold, 15, W - 2 * M), { x: M, y: y - 28, size: 15, font: bold })
      page.drawText(
        winAnsi(`${rows.length} ${rows.length === 1 ? 'download' : 'downloads'} · Generated ${generated} · Location is approximate, derived from the IP address.`),
        { x: M, y: y - 42, size: 8, font, color: dim },
      )
      y -= 62
    }
    let x = M
    for (const c of columns) {
      page.drawText(c.label, { x, y: y - 8, size: 7, font: bold, color: dim })
      x += c.width
    }
    y -= 13
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line })
  }

  header(true)
  if (rows.length === 0) page.drawText('No downloads yet.', { x: M, y: y - 16, size: 9, font, color: dim })
  for (const d of rows) {
    if (y - rowH < M + 14) {
      page = doc.addPage([W, H])
      y = H - M
      header(false)
    }
    let x = M
    for (const c of columns) {
      const [main, detail] = c.cell(d)
      page.drawText(fit(main, font, size, c.width - 6), { x, y: y - 9, size, font })
      if (detail) page.drawText(fit(detail, font, size - 1, c.width - 6), { x, y: y - 18, size: size - 1, font, color: dim })
      x += c.width
    }
    y -= rowH
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: line })
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 7), y: M - 18, size: 7, font, color: dim })
  })
  return doc.save()
}
