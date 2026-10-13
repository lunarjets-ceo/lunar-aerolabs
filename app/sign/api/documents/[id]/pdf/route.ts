import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET ?version=original              blank document (admins, or recipients once sent)
 * GET ?version=signed                the caller's own signed copy
 * GET ?version=signed&recipient=ID   any recipient's signed copy (admins only)
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (session?.stage !== 'full') return new Response('Unauthorized', { status: 401 })
  if (!UUID.test(id)) return new Response('Not found', { status: 404 })
  const { user } = session
  const isAdmin = user.role === 'admin'

  const url = new URL(request.url)
  const recipientParam = url.searchParams.get('recipient')
  let file: { title: string; bytes: Uint8Array | null; suffix: string } | null = null

  if (url.searchParams.get('version') === 'signed') {
    // Signers only ever get their own copy, whatever they pass as ?recipient.
    const byRecipient = isAdmin && recipientParam && UUID.test(recipientParam)
    const row = await queryOne<{ title: string; completed_pdf: Uint8Array | null; name: string; email: string }>(
      `select d.title, r.completed_pdf, u.name, u.email
         from recipients r join documents d on d.id = r.document_id join users u on u.id = r.user_id
        where r.document_id = $1 and ${byRecipient ? 'r.id = $2' : 'r.user_id = $2'}`,
      [id, byRecipient ? recipientParam : user.id],
    )
    if (row) file = { title: row.title, bytes: row.completed_pdf, suffix: ` - signed by ${row.name || row.email}` }
  } else {
    const row = await queryOne<{ title: string; original_pdf: Uint8Array }>(
      `select d.title, d.original_pdf from documents d
        where d.id = $1 and ($3 or (d.status in ('sent', 'completed') and exists (
          select 1 from recipients r where r.document_id = d.id and r.user_id = $2)))`,
      [id, user.id, isAdmin],
    )
    if (row) file = { title: row.title, bytes: row.original_pdf, suffix: '' }
  }
  if (!file?.bytes) return new Response('Not found', { status: 404 })

  const filename = `${file.title}${file.suffix}`.replace(/[^\w .@-]+/g, '_') + '.pdf'
  const disposition = url.searchParams.has('download') ? 'attachment' : 'inline'
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
