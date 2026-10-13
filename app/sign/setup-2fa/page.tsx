import QRCode from 'qrcode'
import { requireStage } from '@/lib/auth'
import { totpUri } from '@/lib/crypto'
import { pendingTotpSecret } from '@/lib/mfa'
import { AuthShell } from '@/components/ui'
import { SetupForm } from './form'

export default async function SetupTwoFactorPage() {
  const user = await requireStage('mfa_setup')
  if (user.totp_enabled) {
    return (
      <AuthShell title="Authenticator connected">
        <SetupForm enrolled />
      </AuthShell>
    )
  }
  const secret = await pendingTotpSecret(user.id)
  const qr = await QRCode.toDataURL(totpUri(secret, user.email), { margin: 1, width: 220 })

  return (
    <AuthShell
      title="Set up your authenticator"
      subtitle="An authenticator app is required for every account. You can't continue without it."
    >
      <ol className="steps">
        <li>Install Google Authenticator, Microsoft Authenticator, 1Password, or Authy.</li>
        <li>Scan this QR code in the app.</li>
      </ol>
      <div className="qr">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Authenticator QR code" width={220} height={220} />
      </div>
      <details className="manual-key">
        <summary>Can't scan? Enter the key manually</summary>
        <code>{secret.match(/.{1,4}/g)?.join(' ')}</code>
      </details>
      <SetupForm />
    </AuthShell>
  )
}
