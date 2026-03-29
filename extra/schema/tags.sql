-- ── 7. TAGS ──────────────────────────────────────────────────
-- User-defined tags for organizing files and folders.

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null, -- hex code or CSS color
  owner_id   uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, owner_id)
);

-- Many-to-many: Files <-> Tags
create table if not exists public.file_tags (
  file_id uuid not null references public.files(id) on delete cascade,
  tag_id  uuid not null references public.tags(id) on delete cascade,
  primary key (file_id, tag_id)
);

-- Many-to-many: Folders <-> Tags
create table if not exists public.folder_tags (
  folder_id uuid not null references public.folders(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  primary key (folder_id, tag_id)
);

-- Indexes
create index if not exists idx_tags_owner on public.tags(owner_id);
create index if not exists idx_file_tags_file on public.file_tags(file_id);
create index if not exists idx_file_tags_tag on public.file_tags(tag_id);
create index if not exists idx_folder_tags_folder on public.folder_tags(folder_id);
create index if not exists idx_folder_tags_tag on public.folder_tags(tag_id);

-- RLS
alter table public.tags enable row level security;
alter table public.file_tags enable row level security;
alter table public.folder_tags enable row level security;

-- Tag Policies: owner can do everything
create policy "tags_owner_all" on public.tags
  for all using (owner_id = public.current_user_id());

-- Association Policies: owner can do everything (based on item ownership)
create policy "file_tags_owner_all" on public.file_tags
  for all using (
    exists (
      select 1 from public.files
      where id = file_tags.file_id and owner_id = public.current_user_id()
    )
  );

create policy "folder_tags_owner_all" on public.folder_tags
  for all using (
    exists (
      select 1 from public.folders
      where id = folder_tags.folder_id and owner_id = public.current_user_id()
    )
  );

-- Trigger for tags updated_at
create trigger trg_tags_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();
