'use client'

import { useActionState } from 'react'
import { resetPassword } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(resetPassword, undefined)
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <label>
        New password <span className="hint">(12+ characters)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
      </label>
      <label>
        Confirm new password
        <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Saving…">Set new password</SubmitButton>
    </form>
  )
}
