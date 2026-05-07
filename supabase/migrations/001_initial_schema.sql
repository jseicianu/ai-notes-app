-- ============================================================
-- Enable extensions
-- ============================================================
create extension if not exists "vector" with schema "extensions";

-- ============================================================
-- PROFILES
-- ============================================================
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  avatar_url      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can read own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- WORKSPACES
-- ============================================================
create table workspaces (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references profiles(id) not null,
  name            text not null,
  settings        jsonb default '{}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table workspaces enable row level security;
create policy "Users can manage own workspaces" on workspaces
  for all using (auth.uid() = owner_id);

-- ============================================================
-- NOTEBOOKS
-- ============================================================
create table notebooks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  name            text not null,
  description     text,
  icon            text,
  sort_order      integer default 0,
  is_archived     boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table notebooks enable row level security;
create policy "Users can manage notebooks in own workspaces" on notebooks
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_notebooks_workspace on notebooks(workspace_id);

-- ============================================================
-- PAGES
-- ============================================================
create table pages (
  id              uuid primary key default gen_random_uuid(),
  notebook_id     uuid references notebooks(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  title           text not null default 'Untitled',
  sort_order      integer default 0,
  is_archived     boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table pages enable row level security;
create policy "Users can manage pages in own workspaces" on pages
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_pages_notebook on pages(notebook_id);

-- ============================================================
-- COMMANDS (defined before blocks so blocks can reference commands)
-- ============================================================
create table commands (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  name            text not null,
  slug            text not null,
  description     text,
  prompt_template text not null,
  inputs          jsonb not null default '[]',
  output_schema   jsonb not null default '{}',
  allowed_tools   text[] default '{}',
  context_config  jsonb default '{}',
  model_provider  text,
  model_name      text,
  is_callable     boolean default false,
  version         integer default 1,
  source_run_id   uuid,
  is_archived     boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(workspace_id, slug)
);

alter table commands enable row level security;
create policy "Users can manage commands in own workspaces" on commands
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_commands_workspace on commands(workspace_id);
create index idx_commands_slug on commands(workspace_id, slug);

-- ============================================================
-- BLOCKS
-- ============================================================
create table blocks (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid references pages(id) on delete cascade not null,
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  type            text not null,
  content         jsonb not null default '{}',
  sort_order      integer default 0,
  parent_block_id uuid references blocks(id) on delete set null,
  column_group    uuid default null,      -- blocks with same UUID render side-by-side (V1.5)
  column_index    integer default 0,       -- order within a column group
  version         integer default 1,
  is_collapsed    boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table blocks enable row level security;
create policy "Users can manage blocks in own workspaces" on blocks
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_blocks_page_id on blocks(page_id);
create index idx_blocks_page_sort on blocks(page_id, sort_order);
create index idx_blocks_parent on blocks(parent_block_id);
create index idx_blocks_workspace on blocks(workspace_id);

-- ============================================================
-- RUNS
-- ============================================================
create table runs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  page_id         uuid references pages(id) on delete set null,
  trigger_block_id uuid references blocks(id) on delete set null,
  command_id      uuid references commands(id) on delete set null,
  parent_run_id   uuid references runs(id) on delete set null,
  type            text not null,
  status          text not null default 'pending',
  input           jsonb default '{}',
  output          jsonb default '{}',
  output_block_ids uuid[] default '{}',
  model_provider  text,
  model_name      text,
  context_used    jsonb default '[]',
  tools_used      text[] default '{}',
  schema_validation text,
  error           jsonb,
  token_usage     jsonb,
  duration_ms     integer,
  created_at      timestamptz default now(),
  completed_at    timestamptz
);

alter table runs enable row level security;
create policy "Users can manage runs in own workspaces" on runs
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_runs_workspace on runs(workspace_id);
create index idx_runs_page on runs(page_id);
create index idx_runs_trigger_block on runs(trigger_block_id);
create index idx_runs_command on runs(command_id);
create index idx_runs_status on runs(status);
create index idx_runs_parent on runs(parent_run_id);

-- Add foreign key from commands.source_run_id now that runs table exists
alter table commands
  add constraint commands_source_run_id_fkey
  foreign key (source_run_id) references runs(id) on delete set null;

-- ============================================================
-- COMMAND VERSIONS
-- ============================================================
create table command_versions (
  id              uuid primary key default gen_random_uuid(),
  command_id      uuid references commands(id) on delete cascade not null,
  version         integer not null,
  prompt_template text not null,
  inputs          jsonb not null,
  output_schema   jsonb not null,
  allowed_tools   text[],
  created_at      timestamptz default now(),
  unique(command_id, version)
);

alter table command_versions enable row level security;
create policy "Users can manage command versions in own workspaces" on command_versions
  for all using (
    command_id in (
      select id from commands where workspace_id in (
        select id from workspaces where owner_id = auth.uid()
      )
    )
  );

-- ============================================================
-- FILES
-- ============================================================
create table files (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  filename        text not null,
  mime_type       text not null,
  size_bytes      bigint not null,
  storage_path    text not null,
  extracted_text  text,
  metadata        jsonb default '{}',
  created_at      timestamptz default now()
);

alter table files enable row level security;
create policy "Users can manage files in own workspaces" on files
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_files_workspace on files(workspace_id);

-- ============================================================
-- EMBEDDINGS
-- ============================================================
create table embeddings (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade not null,
  source_type     text not null,
  source_id       uuid not null,
  chunk_index     integer default 0,
  content         text not null,
  embedding       vector(1536),
  metadata        jsonb default '{}',
  created_at      timestamptz default now()
);

alter table embeddings enable row level security;
create policy "Users can manage embeddings in own workspaces" on embeddings
  for all using (
    workspace_id in (select id from workspaces where owner_id = auth.uid())
  );

create index idx_embeddings_source on embeddings(source_type, source_id);
create index idx_embeddings_vector on embeddings
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
