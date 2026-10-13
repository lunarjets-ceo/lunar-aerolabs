import { clientInfo } from './auth'
import { query, type Queryable } from './db'

export async function audit(
  documentId: string | null,
  actor: { id: string; email: string } | null,
  action: string,
  detail = '',
  db: Queryable = { query },
): Promise<void> {
  const { ip, userAgent } = await clientInfo()
  await db.query(
    `insert into audit_events (document_id, user_id, email, action, detail, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [documentId, actor?.id ?? null, actor?.email ?? null, action, detail, ip, userAgent],
  )
}
