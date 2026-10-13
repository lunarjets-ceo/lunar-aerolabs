'use client'

import { useActionState } from 'react'
import { logout, verifySecondFactor } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function VerifyForm() {
  const [state, action] = useActionState(verifySecondFactor, undefined)
  return (
    <>
      <form action={action} className="stack">
        <label>
          Authentication code
          <input
            name="code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={11}
            required
            autoFocus
          />
        </label>
        <p className="hint">Lost your phone? Enter one of your recovery codes instead.</p>
        <FormError error={state?.error} />
        <SubmitButton pendingText="Verifying…">Verify</SubmitButton>
      </form>
      <form action={logout}>
        <button className="link-button">Use a different account</button>
      </form>
    </>
  )
}
