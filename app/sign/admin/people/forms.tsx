'use client'

import { useActionState } from 'react'
import { inviteUser, resendInvite } from '../actions'
import { FormError, SubmitButton } from '@/components/ui'
import { DeliveryList } from '@/components/DeliveryList'

export function InviteForm() {
  const [state, action] = useActionState(inviteUser, undefined)
  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="grow">
          Email
          <input name="email" type="email" required />
        </label>
        <label className="grow">
          Name <span className="hint">(optional)</span>
          <input name="name" />
        </label>
        <label>
          Role
          <select name="role" defaultValue="signer">
            <option value="signer">Signer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <p className="form-ok">{state.ok}</p>}
      {state?.deliveries && <DeliveryList deliveries={state.deliveries} />}
      <SubmitButton pendingText="Adding…">Add & send invitation</SubmitButton>
    </form>
  )
}

export function ResendInviteButton({ userId }: { userId: string }) {
  const [state, action] = useActionState(resendInvite, undefined)
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton className="btn btn-small" pendingText="Sending…">
        Resend invite
      </SubmitButton>
      <FormError error={state?.error} />
      {state?.deliveries && <DeliveryList deliveries={state.deliveries} />}
    </form>
  )
}
