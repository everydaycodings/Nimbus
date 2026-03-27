-- ============================================================
--  NIMBUS — Supabase Schema
-- ============================================================

-- ── 1. USERS ─────────────────────────────────────────────────
-- Mirrors Clerk users. Synced via Clerk webhook on user.created
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  clerk_id      text not null unique,       -- Clerk's user ID (user_xxx)
  email         text not null unique,
  full_name     text,
  avatar_url    text,
  storage_used  bigint not null default 0,  -- bytes used
  storage_limit bigint not null default 1073741824, -- 1 GB in bytes
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 2. FOLDERS ───────────────────────────────────────────────
create table public.folders (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  owner_id         uuid not null references public.users(id) on delete cascade,
  parent_folder_id uuid references public.folders(id) on delete cascade, -- null = root
  is_starred       boolean not null default false,
  is_trashed       boolean not null default false,
  trashed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 3. FILES ─────────────────────────────────────────────────
create table public.files (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  mime_type        text not null,
  size             bigint not null,          -- bytes
  s3_key           text not null unique,     -- e.g. "uploads/user_id/uuid.pdf"
  s3_bucket        text not null,
  owner_id         uuid not null references public.users(id) on delete cascade,
  parent_folder_id uuid references public.folders(id) on delete set null, -- null = root
  is_starred       boolean not null default false,
  is_trashed       boolean not null default false,
  trashed_at       timestamptz,
  upload_status    text not null default 'pending' check (
                     upload_status in ('pending', 'uploading', 'complete', 'cancelled', 'failed'))
                   ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 4. PERMISSIONS ───────────────────────────────────────────
-- Covers both files and folders
create table public.permissions (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null,              -- file or folder id
  resource_type text not null check (resource_type in ('file', 'folder')),
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null check (role in ('viewer', 'editor', 'owner')),
  created_at    timestamptz not null default now(),
  unique (resource_id, resource_type, user_id)
);

-- ── 5. SHARE LINKS ───────────────────────────────────────────
-- Public/unlisted links (no account required to access)
create table public.share_links (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null,
  resource_type text not null check (resource_type in ('file', 'folder')),
  owner_id      uuid not null references public.users(id) on delete cascade,
  token         text not null unique default encode(gen_random_bytes(32), 'hex'),
  role          text not null default 'viewer' check (role in ('viewer', 'editor')),
  expires_at    timestamptz,               -- null = never expires
  created_at    timestamptz not null default now()
);

-- ── 6. ACTIVITY LOG ──────────────────────────────────────────
-- Optional but useful: audit trail of actions
create table public.activity_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  resource_id   uuid,
  resource_type text check (resource_type in ('file', 'folder')),
  action        text not null check (action in (
                  'upload', 'download', 'delete', 'restore',
                  'rename', 'move', 'share', 'unshare', 'star', 'unstar'
                )),
  metadata      jsonb,                     -- e.g. { "old_name": "foo.pdf" }
  created_at    timestamptz not null default now()
);


-- ============================================================
--  INDEXES
-- ============================================================

-- Files: fast lookup by owner and folder
create index idx_files_owner       on public.files(owner_id);
create index idx_files_folder      on public.files(parent_folder_id);
create index idx_files_trashed     on public.files(owner_id) where is_trashed = true;
create index idx_files_starred     on public.files(owner_id) where is_starred = true;
create index idx_files_status      on public.files(upload_status);

-- Folders: fast lookup by owner and parent
create index idx_folders_owner     on public.folders(owner_id);
create index idx_folders_parent    on public.folders(parent_folder_id);
create index idx_folders_trashed   on public.folders(owner_id) where is_trashed = true;
create index idx_folders_starred   on public.folders(owner_id) where is_starred = true;

-- Permissions: fast lookup by resource or user
create index idx_permissions_resource on public.permissions(resource_id, resource_type);
create index idx_permissions_user     on public.permissions(user_id);

-- Share links: fast lookup by token
create index idx_share_links_token    on public.share_links(token);

-- Activity log: fast lookup by resource
create index idx_activity_resource    on public.activity_log(resource_id);
create index idx_activity_user        on public.activity_log(user_id);

-- Full text search on file/folder names
create index idx_files_name_search   on public.files using gin(to_tsvector('english', name));
create index idx_folders_name_search on public.folders using gin(to_tsvector('english', name));


-- ============================================================
--  FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at on any row change
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger trg_files_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

create trigger trg_folders_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

-- Auto-update storage_used on users when a file is added/deleted/updated
create or replace function public.update_storage_used()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.users
    set storage_used = storage_used + new.size
    where id = new.owner_id;

  elsif (TG_OP = 'DELETE') then
    update public.users
    set storage_used = greatest(0, storage_used - old.size)
    where id = old.owner_id;

  elsif (TG_OP = 'UPDATE') then
    -- handles re-upload / size change edge case
    update public.users
    set storage_used = greatest(0, storage_used - old.size + new.size)
    where id = new.owner_id;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger trg_storage_used
  after insert or update of size or delete on public.files
  for each row execute function public.update_storage_used();

-- Auto-set trashed_at timestamp when file/folder is trashed
create or replace function public.set_trashed_at()
returns trigger as $$
begin
  if new.is_trashed = true and old.is_trashed = false then
    new.trashed_at = now();
  elsif new.is_trashed = false then
    new.trashed_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_files_trashed_at
  before update of is_trashed on public.files
  for each row execute function public.set_trashed_at();

create trigger trg_folders_trashed_at
  before update of is_trashed on public.folders
  for each row execute function public.set_trashed_at();


-- ============================================================
--  ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.users       enable row level security;
alter table public.files       enable row level security;
alter table public.folders     enable row level security;
alter table public.permissions enable row level security;
alter table public.share_links enable row level security;
alter table public.activity_log enable row level security;

-- Helper: get the internal user id from Clerk JWT
-- Call this in RLS policies instead of auth.uid() directly
create or replace function public.current_user_id()
returns uuid as $$
  select id from public.users
  where clerk_id = auth.jwt()->>'sub'
  limit 1;
$$ language sql stable security definer;

-- USERS: can only read/update your own row
create policy "users_select_own" on public.users
  for select using (id = public.current_user_id());

create policy "users_update_own" on public.users
  for update using (id = public.current_user_id());

-- FILES: owner can do everything
create policy "files_owner_all" on public.files
  for all using (owner_id = public.current_user_id());

-- FILES: shared users can select
create policy "files_shared_select" on public.files
  for select using (
    exists (
      select 1 from public.permissions
      where resource_id = files.id
        and resource_type = 'file'
        and user_id = public.current_user_id()
    )
  );

-- FOLDERS: owner can do everything
create policy "folders_owner_all" on public.folders
  for all using (owner_id = public.current_user_id());

-- FOLDERS: shared users can select
create policy "folders_shared_select" on public.folders
  for select using (
    exists (
      select 1 from public.permissions
      where resource_id = folders.id
        and resource_type = 'folder'
        and user_id = public.current_user_id()
    )
  );

-- PERMISSIONS: owners can manage permissions on their resources
create policy "permissions_owner_manage" on public.permissions
  for all using (
    exists (
      select 1 from public.files
      where id = permissions.resource_id and owner_id = public.current_user_id()
      union
      select 1 from public.folders
      where id = permissions.resource_id and owner_id = public.current_user_id()
    )
  );

-- SHARE LINKS: owners can manage their own links
create policy "share_links_owner_all" on public.share_links
  for all using (owner_id = public.current_user_id());

-- ACTIVITY LOG: users can see their own activity
create policy "activity_log_select_own" on public.activity_log
  for select using (user_id = public.current_user_id());