-- ============================================================
--  NIMBUS — Vault Folders Schema (add to existing vault schema)
-- ============================================================

-- ── VAULT FOLDERS ────────────────────────────────────────────
create table public.vault_folders (
  id               uuid primary key default gen_random_uuid(),
  vault_id         uuid not null references public.vaults(id) on delete cascade,
  name             text not null,
  parent_folder_id uuid references public.vault_folders(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Add folder support to vault_files
alter table public.vault_files
  add column parent_folder_id uuid references public.vault_folders(id) ON DELETE CASCADE;

-- ── INDEXES ───────────────────────────────────────────────────
create index idx_vault_folders_vault    on public.vault_folders(vault_id);
create index idx_vault_folders_parent   on public.vault_folders(parent_folder_id);
create index idx_vault_files_folder     on public.vault_files(parent_folder_id);

-- ── RLS ───────────────────────────────────────────────────────
alter table public.vault_folders enable row level security;

create policy "vault_folders_owner_all" on public.vault_folders
  for all using (
    exists (
      select 1 from public.vaults
      where id = vault_folders.vault_id
        and owner_id = public.current_user_id()
    )
  );

-- ── TRIGGERS ──────────────────────────────────────────────────
-- Assumes public.set_updated_at() is defined in main schema
create trigger trg_vault_folders_updated_at
  before update on public.vault_folders
  for each row execute function public.set_updated_at();