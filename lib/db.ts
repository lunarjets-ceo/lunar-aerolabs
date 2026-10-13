// Thin Postgres layer. Production uses DATABASE_URL; local dev without it
// falls back to an embedded PGlite database in .data/pglite.

type Row = Record<string, any>

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>
}

interface Client extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  exec(text: string): Promise<void>
}

const SCHEMA = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  role text not null default 'signer' check (role in ('admin', 'signer')),
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  password_hash text,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  totp_last_step bigint not null default 0,
  invite_token_hash text,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz
);

create table if not exists sessions (
  id_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  stage text not null check (stage in ('mfa_setup', 'mfa', 'full')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ip text,
  user_agent text
);

create table if not exists auth_attempts (
  id bigserial primary key,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists auth_attempts_key_at on auth_attempts (key, at);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null default '',
  created_by uuid references users(id),
  status text not null default 'draft' check (status in ('draft', 'sent', 'completed', 'voided')),
  original_pdf bytea not null,
  original_sha256 text not null,
  page_count int not null,
  completed_pdf bytea,
  completed_sha256 text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);

create table if not exists recipients (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references users(id),
  sort_order int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'viewed', 'signed', 'declined')),
  signed_at timestamptz,
  signed_ip text,
  decline_reason text,
  unique (document_id, user_id)
);

create table if not exists fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  recipient_id uuid not null references recipients(id) on delete cascade,
  type text not null check (type in ('signature', 'initials', 'text', 'date', 'name', 'checkbox')),
  page int not null,
  x real not null,
  y real not null,
  w real not null,
  h real not null,
  required boolean not null default true,
  label text not null default '',
  value text
);

create table if not exists audit_events (
  id bigserial primary key,
  document_id uuid references documents(id) on delete cascade,
  user_id uuid,
  email text,
  action text not null,
  detail text not null default '',
  ip text,
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists audit_events_document on audit_events (document_id, at);

-- Each recipient signs their own private copy: fields are shared by the
-- document, answers and the signed PDF belong to the recipient.
alter table fields alter column recipient_id drop not null;
alter table recipients add column if not exists completed_pdf bytea;
alter table recipients add column if not exists completed_sha256 text;
create table if not exists field_values (
  recipient_id uuid not null references recipients(id) on delete cascade,
  field_id uuid not null references fields(id) on delete cascade,
  value text,
  primary key (recipient_id, field_id)
);

-- Large file sharing: the file lives once in private Blob storage, every
-- recipient gets their own link so each download is attributable.
create table if not exists shared_files (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null default '',
  file_name text not null,
  blob_pathname text not null,
  size_bytes bigint not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists file_recipients (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references shared_files(id) on delete cascade,
  email text not null,
  name text not null default '',
  token_hash text not null unique,
  sent_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (file_id, email)
);

create table if not exists file_downloads (
  id bigserial primary key,
  recipient_id uuid not null references file_recipients(id) on delete cascade,
  at timestamptz not null default now(),
  ip text,
  city text,
  region text,
  country text,
  latitude text,
  longitude text,
  user_agent text
);
create index if not exists file_downloads_recipient on file_downloads (recipient_id, at);
`

async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL
  if (url) {
    const postgres = (await import('postgres')).default
    // prepare: false keeps this compatible with poolers in transaction mode (Neon's pooled URL).
    const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} })
    const wrap = (s: typeof sql | any): Queryable => ({
      query: (text, params = []) => s.unsafe(text, params as any[]) as any,
    })
    return {
      ...wrap(sql),
      transaction: (fn) => sql.begin((tx) => fn(wrap(tx))) as any,
      exec: async (text) => {
        await sql.unsafe(text)
      },
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be set in production')
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { mkdirSync } = await import('node:fs')
  mkdirSync('.data', { recursive: true })
  const db = new PGlite('.data/pglite')
  const wrap = (d: { query: typeof db.query }): Queryable => ({
    query: async (text, params = []) => (await d.query(text, params)).rows as any,
  })
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    exec: async (text) => {
      await db.exec(text)
    },
  }
}

const globalForDb = globalThis as unknown as { __laDb?: Promise<Client> }

function client(): Promise<Client> {
  globalForDb.__laDb ??= connect()
    .then(async (c) => {
      await c.exec(SCHEMA)
      return c
    })
    .catch((err) => {
      globalForDb.__laDb = undefined // retry on the next request
      throw err
    })
  return globalForDb.__laDb
}

export async function query<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  return (await client()).query<T>(text, params)
}

export async function queryOne<T = Row>(text: string, params?: unknown[]): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return (await client()).transaction(fn)
}
