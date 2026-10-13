import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface FieldRow {
  id: string
  type: 'signature' | 'initials' | 'text' | 'date' | 'name' | 'checkbox'
  page: number
  x: number
  y: number
  w: number
  h: number
  value: string | null
}

export interface CertificateSigner {
  name: string
  email: string
  signed_at: Date | string
  signed_ip: string | null
}

export interface CertificateEvent {
  at: Date | string
  email: string | null
  action: string
  ip: string | null
}

/** Throws if the bytes aren't a PDF we can work with. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  const header = Buffer.from(bytes.slice(0, 5)).toString('latin1')
  if (header !== '%PDF-') throw new Error('File is not a PDF.')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return { pageCount: doc.getPageCount() }
}

// Standard fonts only cover WinAnsi; anything else would throw during drawText.
function winAnsi(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function fitText(page: PDFPage, font: PDFFont, text: string, box: Box) {
  let size = Math.min(box.h * 0.7, 14)
  while (size > 5 && font.widthOfTextAtSize(text, size) > box.w) size -= 0.5
  page.drawText(text, {
    x: box.x + 1,
    y: box.y + (box.h - size) / 2 + size * 0.2,
    size,
    font,
    color: rgb(0.05, 0.05, 0.1),
  })
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Field coords are stored as fractions of the visible page, origin top-left. */
function toPdfBox(page: PDFPage, f: FieldRow): Box {
  const crop = page.getCropBox()
  return {
    x: crop.x + f.x * crop.width,
    y: crop.y + crop.height - (f.y + f.h) * crop.height,
    w: f.w * crop.width,
    h: f.h * crop.height,
  }
}

export async function buildCompletedPdf(opts: {
  original: Uint8Array
  /** Identifies this signer's individual copy. */
  copyId: string
  title: string
  originalSha256: string
  fields: FieldRow[]
  signers: CertificateSigner[]
  events: CertificateEvent[]
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(opts.original)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  for (const f of opts.fields) {
    if (!f.value) continue
    const page = pdf.getPage(f.page - 1)
    const box = toPdfBox(page, f)

    if (f.type === 'signature' || f.type === 'initials') {
      const png = await pdf.embedPng(Buffer.from(f.value.split(',')[1], 'base64'))
      const scale = Math.min(box.w / png.width, box.h / png.height)
      const w = png.width * scale
      const h = png.height * scale
      page.drawImage(png, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h })
    } else if (f.type === 'checkbox') {
      if (f.value !== 'true') continue
      const pad = Math.min(box.w, box.h) * 0.2
      const line = { thickness: 1.5, color: rgb(0.05, 0.05, 0.1) }
      page.drawLine({ start: { x: box.x + pad, y: box.y + pad }, end: { x: box.x + box.w - pad, y: box.y + box.h - pad }, ...line })
      page.drawLine({ start: { x: box.x + pad, y: box.y + box.h - pad }, end: { x: box.x + box.w - pad, y: box.y + pad }, ...line })
    } else {
      fitText(page, font, winAnsi(f.value), box)
    }
  }

  // Certificate of completion
  let page = pdf.addPage([612, 792])
  let y = 740
  const line = (text: string, opts: { size?: number; f?: PDFFont; gap?: number; color?: number } = {}) => {
    const size = opts.size ?? 9
    if (y < 60) {
      page = pdf.addPage([612, 792])
      y = 740
    }
    const c = opts.color ?? 0.1
    page.drawText(winAnsi(text).slice(0, 120), { x: 50, y, size, font: opts.f ?? font, color: rgb(c, c, c) })
    y -= opts.gap ?? size + 6
  }
  const fmt = (d: Date | string) => new Date(d).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')

  line('LUNAR AEROLABS', { size: 10, f: bold, gap: 26, color: 0.4 })
  line('Certificate of Completion', { size: 20, f: bold, gap: 30 })
  line(`Document: ${opts.title}`)
  line(`Copy ID: ${opts.copyId}`)
  line(`Original document SHA-256: ${opts.originalSha256}`, { gap: 26 })

  line('Signer', { size: 12, f: bold, gap: 20 })
  for (const s of opts.signers) {
    line(`${s.name || s.email} <${s.email}>`, { f: bold })
    line(`Signed ${fmt(s.signed_at)} from IP ${s.signed_ip ?? 'unknown'}`, { gap: 10 })
    line('Authentication: password + authenticator app (TOTP)', { gap: 20, color: 0.4 })
  }

  line('Audit trail', { size: 12, f: bold, gap: 20 })
  for (const e of opts.events) {
    line(`${fmt(e.at)}   ${e.action}   ${e.email ?? ''}   ${e.ip ?? ''}`, { size: 8 })
  }

  pdf.setTitle(opts.title)
  pdf.setProducer('Lunar AeroLabs Sign')
  return pdf.save()
}
