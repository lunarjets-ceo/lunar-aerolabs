import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (session?.stage !== 'full') return new Response('Unauthorized', { status: 401 })
  const { user } = session

  const url = new URL(request.url)
  const version = url.searchParams.get('version') === 'completed' ? 'completed' : 'original'

  // Admins see everything; signers only documents they were sent.
  const doc = await queryOne<{ title: string; status: string; original_pdf: Uint8Array; completed_pdf: Uint8Array | null }>(
    `select d.title, d.status, d.original_pdf, d.completed_pdf from documents d
      where d.id = $1::uuid and ($3 or (d.status in ('sent', 'completed') and exists (
        select 1 from recipients r where r.document_id = d.id and r.user_id = $2)))`,
    [/^[0-9a-f-]{36}$/i.test(id) ? id : '00000000-0000-0000-0000-000000000000', user.id, user.role === 'admin'],
  )
  if (!doc) return new Response('Not found', { status: 404 })

  const bytes = version === 'completed' ? doc.completed_pdf : doc.original_pdf
  if (!bytes) return new Response('Not found', { status: 404 })

  const filename = `${doc.title.replace(/[^\w .-]+/g, '_')}${version === 'completed' ? ' (signed)' : ''}.pdf`
  const disposition = url.searchParams.has('download') ? 'attachment' : 'inline'
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
