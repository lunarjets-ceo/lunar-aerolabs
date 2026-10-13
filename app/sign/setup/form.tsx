'use client'

import { useActionState } from 'react'
import { setupFirstAdmin } from '../auth-actions'
import { FormError, SubmitButton } from '@/components/ui'

export function AdminSetupForm() {
  const [state, action] = useActionState(setupFirstAdmin, undefined)
  return (
    <form action={action} className="stack">
      <label>
        Setup token
        <input name="setupToken" type="password" autoComplete="off" required />
      </label>
      <label>
        Admin email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Full name
        <input name="name" autoComplete="name" required />
      </label>
      <label>
        Password <span className="hint">(12+ characters)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <FormError error={state?.error} />
      <SubmitButton pendingText="Creating…">Create admin & set up authenticator</SubmitButton>
    </form>
  )
}
