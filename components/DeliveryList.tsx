'use client'

import { useState } from 'react'
import type { Delivery } from '@/lib/invites'

export function DeliveryList({ deliveries }: { deliveries: Delivery[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <ul className="delivery-list">
      {deliveries.map((d) => (
        <li key={d.email}>
          <div>
            <strong>{d.email}</strong>
            <small>{d.emailed ? 'Email sent' : 'Email not configured — share this link with them securely:'}</small>
          </div>
          {!d.emailed && (
            <div className="copy-row">
              <input readOnly value={d.link} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  navigator.clipboard.writeText(d.link)
                  setCopied(d.email)
                }}
              >
                {copied === d.email ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
