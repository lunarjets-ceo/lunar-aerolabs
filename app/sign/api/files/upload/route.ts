import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getSession } from '@/lib/auth'
import { BLOB_PATH_RE, MAX_FILE_BYTES } from '@/lib/files'

// A multi-GB multipart upload can outlast the default one-hour token.
const UPLOAD_WINDOW_MS = 6 * 60 * 60_000

/**
 * The browser uploads straight to private Blob storage (function bodies are
 * capped at 4.5 MB); this route only hands admins a token scoped to one pathname.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (session?.stage !== 'full' || session.user.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!BLOB_PATH_RE.test(pathname)) throw new Error('Invalid upload path')
        return {
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil: Date.now() + UPLOAD_WINDOW_MS,
          addRandomSuffix: false,
          allowOverwrite: false,
        }
      },
    })
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
