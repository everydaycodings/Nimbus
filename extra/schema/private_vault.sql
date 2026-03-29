-- ============================================================
--  NIMBUS — Vault Schema (run in Supabase SQL Editor)
-- ============================================================

-- ── VAULTS ───────────────────────────────────────────────────
create table public.vaults (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  owner_id           uuid not null references public.users(id) on delete cascade,

  -- PBKDF2 salt stored as base64 — needed to re-derive the key on unlock
  -- The password itself is NEVER stored
  salt               text not null,

  -- AES-GCM encrypted token — used to verify the password on unlock
  -- If decryption succeeds → password is correct
  verification_token text not null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── VAULT FILES ───────────────────────────────────────────────
create table public.vault_files (
  id                  uuid primary key default gen_random_uuid(),
  vault_id            uuid not null references public.vaults(id) on delete cascade,

  -- Original filename (shown in UI)
  name                text not null,

  -- Original MIME type (needed for decryption — so we restore the right type)
  original_mime_type  text not null default 'application/octet-stream',

  -- Original file size in bytes (before encryption)
  size                bigint not null default 0,

  -- S3 key — encrypted file is stored at vault/{user_id}/{vault_id}/{uuid}.enc
  s3_key              text not null unique,
  s3_bucket           text not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── INDEXES ───────────────────────────────────────────────────
create index idx_vaults_owner       on public.vaults(owner_id);
create index idx_vault_files_vault  on public.vault_files(vault_id);

-- ── RLS ───────────────────────────────────────────────────────
alter table public.vaults       enable row level security;
alter table public.vault_files  enable row level security;

-- Only the owner can see/manage their vaults
create policy "vaults_owner_all" on public.vaults
  for all using (owner_id = public.current_user_id());

-- Vault files are accessible only through vault ownership
create policy "vault_files_owner_all" on public.vault_files
  for all using (
    exists (
      select 1 from public.vaults
      where id = vault_files.vault_id
        and owner_id = public.current_user_id()
    )
  );

-- ── TRIGGERS ──────────────────────────────────────────────────
-- Assumes public.set_updated_at() is defined in main schema
create trigger trg_vaults_updated_at
  before update on public.vaults
  for each row execute function public.set_updated_at();

create trigger trg_vault_files_updated_at
  before update on public.vault_files
  for each row execute function public.set_updated_at();