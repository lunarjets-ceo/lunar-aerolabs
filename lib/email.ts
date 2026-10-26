import { Resend } from 'resend'
import type { Element, Root } from 'hast'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

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

/** Signers always see documents as coming from the company, never an individual admin. */
export const SENDER_NAME = 'Lunar AeroLabs'

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export interface EmailContent {
  /** Inbox preview line shown after the subject. */
  preheader: string
  /** Small uppercase label above the heading, e.g. "Signature requested". */
  eyebrow: string
  heading: string
  /** Plain text; blank lines separate paragraphs. */
  body: string
  /** Optional envelope summary card. */
  document?: {
    title: string
    from?: string
    message?: string
    /** Render `message` as Markdown (release notes) instead of a quoted note. */
    markdown?: boolean
    status?: string
    tone?: 'ok' | 'bad'
    kind?: string
  }
  ctaLabel: string
  ctaUrl: string
  /** Small print under the button, e.g. link expiry. */
  note?: string
  /** Replaces the default sign-in security notice in the footer. */
  security?: string
}

const DEFAULT_SECURITY =
  'Access requires your password and a code from your authenticator app. Lunar AeroLabs will never ask you for that code by email or phone.'

// Email clients ignore <style> unevenly, so everything is inline and table-based.
const FONT = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`
const C = {
  page: '#000000',
  card: '#0b0c0e',
  line: '#23262c',
  inset: '#121418',
  fg: '#f2f2ef',
  body: '#c9cbcf',
  dim: '#8a8c90',
  faint: '#5f636a',
  silver: '#edeef0',
}

function paragraphs(text: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Email clients drop <style>, so every Markdown element gets its styles inline.
const MD_STYLES: Record<string, string> = {
  p: 'margin:0 0 12px;',
  h1: `margin:16px 0 8px;font-size:18px;line-height:24px;font-weight:600;color:${C.fg};`,
  h2: `margin:16px 0 8px;font-size:16px;line-height:22px;font-weight:600;color:${C.fg};`,
  h3: `margin:14px 0 6px;font-size:14px;line-height:20px;font-weight:600;color:${C.fg};`,
  h4: `margin:14px 0 6px;font-size:14px;line-height:20px;font-weight:600;color:${C.fg};`,
  ul: 'margin:0 0 12px;padding-left:20px;',
  ol: 'margin:0 0 12px;padding-left:20px;',
  li: 'margin:0 0 4px;',
  a: `color:${C.fg};text-decoration:underline;`,
  strong: `color:${C.fg};font-weight:600;`,
  code: `font-family:Menlo,Consolas,monospace;font-size:12px;background:#1b1e24;border-radius:4px;padding:1px 5px;color:${C.fg};`,
  pre: `margin:0 0 12px;padding:12px;background:#1b1e24;border-radius:8px;overflow-x:auto;white-space:pre-wrap;`,
  blockquote: `margin:0 0 12px;padding:2px 0 2px 12px;border-left:2px solid #3a3e46;color:${C.dim};`,
  table: 'margin:0 0 12px;border-collapse:collapse;',
  th: `padding:6px 10px;border:1px solid ${C.line};text-align:left;color:${C.fg};`,
  td: `padding:6px 10px;border:1px solid ${C.line};text-align:left;`,
  hr: `border:0;border-top:1px solid ${C.line};margin:14px 0;`,
  img: 'max-width:100%;height:auto;',
}

function inlineEmailStyles() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      // Most clients strip form controls, so task-list boxes become characters.
      if (node.tagName === 'input' && parent && index !== undefined) {
        parent.children[index] = { type: 'text', value: node.properties.checked ? '\u2611' : '\u2610' }
        return
      }
      let style = MD_STYLES[node.tagName]
      // Code inside a block already sits on the <pre> background.
      if (node.tagName === 'code' && parent?.type === 'element' && parent.tagName === 'pre') style = 'font-family:Menlo,Consolas,monospace;font-size:12px;'
      if (style) node.properties.style = style
      if (node.tagName === 'a') node.properties.target = '_blank'
    })
  }
}

/** GitHub-flavored Markdown to email-safe HTML. Raw HTML in the source is dropped, not rendered. */
export function markdownToEmailHtml(markdown: string): string {
  return String(
    unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(inlineEmailStyles).use(rehypeStringify).processSync(markdown),
  )
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const e = escapeHtml
  const pStyle = `margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};`

  const documentCard = c.document
    ? `
          <tr>
            <td style="padding:8px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.inset};border:1px solid ${C.line};border-radius:10px;">
                <tr>
                  <td style="padding:20px 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" valign="top" style="padding-right:14px;">
                          <div style="width:34px;height:42px;border:1px solid #3a3e46;border-radius:4px;background:#181a1f;text-align:center;line-height:42px;font-family:${FONT};font-size:10px;letter-spacing:1px;color:${C.dim};">${e(c.document.kind ?? 'PDF')}</div>
                        </td>
                        <td valign="top">
                          <div style="font-family:${FONT};font-size:16px;line-height:22px;color:${C.fg};font-weight:500;">${e(c.document.title)}</div>
                          ${c.document.from ? `<div style="font-family:${FONT};font-size:13px;line-height:20px;color:${C.dim};padding-top:2px;">From ${e(c.document.from)}</div>` : ''}
                          ${c.document.status ? `<div style="font-family:${FONT};font-size:11px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${c.document.tone === 'bad' ? '#ff8b8f' : '#4cc38a'};padding-top:8px;">${e(c.document.status)}</div>` : ''}
                        </td>
                      </tr>
                      ${
                        c.document.message
                          ? `<tr><td colspan="2" style="padding-top:16px;">
                          ${
                            c.document.markdown
                              ? `<div style="font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};">${markdownToEmailHtml(c.document.message)}</div>`
                              : `<div style="border-left:2px solid #3a3e46;padding:2px 0 2px 14px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body};font-style:italic;">${e(c.document.message).replace(/\n/g, '<br>')}</div>`
                          }
                        </td></tr>`
                          : ''
                      }
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${e(c.heading)}</title>
  <!--[if mso]><style>table,td,div,p,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${e(c.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">

          <tr>
            <td align="center" style="padding:0 0 24px;font-family:${FONT};font-size:11px;letter-spacing:5px;text-transform:uppercase;color:#9aa0a8;">
              Lunar&nbsp;AeroLabs
            </td>
          </tr>

          <tr>
            <td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:28px 40px 0;">
                    <img src="${appUrl('/email/jet.jpg')}" width="420" alt="" style="display:block;width:100%;max-width:420px;height:auto;border:0;">
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 40px 0;">
                    <div style="font-family:${FONT};font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#9aa0a8;padding-bottom:12px;">${e(c.eyebrow)}</div>
                    <h1 style="margin:0 0 18px;font-family:${FONT};font-size:26px;line-height:34px;font-weight:300;color:${C.fg};">${e(c.heading)}</h1>
                    ${paragraphs(c.body, pStyle)}
                  </td>
                </tr>
                ${documentCard}
                <tr>
                  <td style="padding:20px 40px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="${C.silver}" style="border-radius:8px;">
                          <a href="${e(c.ctaUrl)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:600;color:#000000;text-decoration:none;border-radius:8px;">${e(c.ctaLabel)}&nbsp;&rarr;</a>
                        </td>
                      </tr>
                    </table>
                    ${c.note ? `<p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.dim};">${e(c.note)}</p>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 40px 0;">
                    <div style="border-top:1px solid ${C.line};"></div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px 40px 32px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="22" valign="top" style="font-family:${FONT};font-size:14px;line-height:20px;color:#9aa0a8;">&#128274;</td>
                        <td style="font-family:${FONT};font-size:12px;line-height:19px;color:${C.dim};">
                          ${e(c.security ?? DEFAULT_SECURITY)}
                        </td>
                      </tr>
                    </table>
                    <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:19px;color:${C.faint};">
                      Button not working? Paste this link into your browser:<br>
                      <a href="${e(c.ctaUrl)}" style="color:${C.dim};word-break:break-all;">${e(c.ctaUrl)}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:28px 20px 0;font-family:${FONT};font-size:12px;line-height:20px;color:${C.faint};">
              Lunar AeroLabs &middot; Home of the LAGF800<br>
              <a href="https://www.lunaraerolabs.com" style="color:${C.dim};text-decoration:none;">lunaraerolabs.com</a>
              &nbsp;&middot;&nbsp;
              <a href="mailto:hello@lunaraerolabs.com" style="color:${C.dim};text-decoration:none;">hello@lunaraerolabs.com</a>
              <div style="padding-top:12px;">You're receiving this because you're a participant in a Lunar AeroLabs document. If you weren't expecting it, you can safely ignore it.</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = [
    'LUNAR AEROLABS',
    '',
    c.heading,
    '',
    c.body,
    ...(c.document
      ? ['', `Document: ${c.document.title}`, ...(c.document.from ? [`From: ${c.document.from}`] : []), ...(c.document.message ? ['', c.document.message] : [])]
      : []),
    '',
    `${c.ctaLabel}: ${c.ctaUrl}`,
    ...(c.note ? ['', c.note] : []),
    '',
    c.security ?? DEFAULT_SECURITY,
  ].join('\n')

  return { html, text }
}

/** Returns true when the email was handed to the provider. */
export async function sendEmail(opts: EmailContent & { to: string; subject: string }): Promise<boolean> {
  if (!emailConfigured()) {
    console.info(`[email skipped: not configured] to=${opts.to} subject="${opts.subject}"`)
    return false
  }
  const { html, text } = renderEmail(opts)
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: opts.to,
    subject: opts.subject,
    html,
    text,
  })
  if (error) {
    console.error('[email failed]', error)
    return false
  }
  return true
}
