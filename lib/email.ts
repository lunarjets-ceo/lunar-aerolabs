import { Resend } from 'resend'

export function appUrl(path = ''): string {
  const base =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  return base.replace(/\/$/, '') + path
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

/** Returns true when the email was handed to the provider. */
export async function sendEmail(opts: {
  to: string
  subject: string
  heading: string
  body: string
  ctaLabel: string
  ctaUrl: string
}): Promise<boolean> {
  if (!emailConfigured()) {
    console.info(`[email skipped: not configured] to=${opts.to} subject="${opts.subject}"`)
    return false
  }
  const html = `
  <div style="background:#000;padding:40px 0;font-family:Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#0b0c0e;border:1px solid #23262c;border-radius:12px;padding:36px;color:#F2F2EF">
      <div style="letter-spacing:.3em;font-size:11px;color:#9AA0A8;text-transform:uppercase">Lunar AeroLabs</div>
      <h1 style="font-weight:300;font-size:22px;margin:18px 0 12px">${escapeHtml(opts.heading)}</h1>
      <p style="color:#c9cbcf;line-height:1.6;font-size:14px;white-space:pre-line">${escapeHtml(opts.body)}</p>
      <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;margin-top:20px;background:#EDEEF0;color:#000;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px">${escapeHtml(opts.ctaLabel)}</a>
      <p style="color:#6b6f76;font-size:12px;margin-top:28px">Access requires your password and authenticator app. If you weren't expecting this, you can ignore it.</p>
    </div>
  </div>`
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: opts.to,
    subject: opts.subject,
    html,
    text: `${opts.heading}\n\n${opts.body}\n\n${opts.ctaLabel}: ${opts.ctaUrl}`,
  })
  if (error) {
    console.error('[email failed]', error)
    return false
  }
  return true
}
