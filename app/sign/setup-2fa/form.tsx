'use client'

import { useActionState } from 'react'
import { confirmTotpSetup, finishEnrollment } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function SetupForm({ enrolled = false }: { enrolled?: boolean }) {
  const [state, action] = useActionState(confirmTotpSetup, undefined)

  if (state?.recoveryCodes) {
    return (
      <div className="stack">
        <h2>Save your recovery codes</h2>
        <p className="muted">
          Each code works once if you lose access to your authenticator. Store them somewhere safe — they won't be
          shown again.
        </p>
        <ul className="recovery-codes">
          {state.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(state.recoveryCodes!.join('\n'))}>
          Copy codes
        </button>
        <form action={finishEnrollment} className="stack">
          <SubmitButton>I've saved them — continue</SubmitButton>
        </form>
      </div>
    )
  }

  if (enrolled) {
    return (
      <form action={finishEnrollment} className="stack">
        <SubmitButton>Continue</SubmitButton>
      </form>
    )
  }

  return (
    <form action={action} className="stack">
      <label>
        3. Enter the 6-digit code shown in the app
        <input
          name="code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="123456"
          required
        />
      </label>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Verifying…">Activate</SubmitButton>
    </form>
  )
}
