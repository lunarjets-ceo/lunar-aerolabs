import { requireStage } from '@/lib/auth'
import { AuthShell } from '@/components/ui'
import { acceptLocationNotice, declineLocationNotice } from '../auth-actions'

export default async function LocationNoticePage() {
  const user = await requireStage('consent')
  return (
    <AuthShell
      title="Location notice"
      subtitle={<>Signing in as <strong>{user.email}</strong>.</>}
    >
      <p className="location-notice">
        While you're signed in, your location is being recorded for security purposes. Location is approximate,
        derived from your IP address.
      </p>
      <p className="hint">If you don't agree, you'll be signed out and won't be able to use this site.</p>
      <div className="row end">
        <form action={declineLocationNotice}>
          <button className="btn btn-danger">I don't agree</button>
        </form>
        <form action={acceptLocationNotice}>
          <button className="btn btn-primary" autoFocus>
            I agree
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
