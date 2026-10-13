import { geolocation, ipAddress } from '@vercel/functions'
import { query } from '@/lib/db'
import { findRecipientByToken, presignedDownloadUrl } from '@/lib/files'
import { appUrl } from '@/lib/email'

/**
 * The tester's "Download" button posts here. Logging on POST rather than on
 * the link itself keeps email link scanners from recording fake downloads.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await findRecipientByToken(token)
  // The page explains a dead link; send the tester back to it.
  if (!r) return Response.redirect(appUrl(`/sign/download/${encodeURIComponent(token)}`), 303)

  const geo = geolocation(request)
  const ip = ipAddress(request) ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  await query(
    `insert into file_downloads (recipient_id, ip, city, region, country, latitude, longitude, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      r.recipient_id,
      ip,
      geo.city ?? null,
      geo.countryRegion ?? null,
      geo.country ?? null,
      geo.latitude ?? null,
      geo.longitude ?? null,
      (request.headers.get('user-agent') ?? '').slice(0, 300),
    ],
  )
  return Response.redirect(await presignedDownloadUrl(r.blob_pathname), 303)
}
