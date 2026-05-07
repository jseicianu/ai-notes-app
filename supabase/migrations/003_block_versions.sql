create table block_versions (
  id              uuid primary key default gen_random_uuid(),
  block_id        uuid references blocks(id) on delete cascade not null,
  version         integer not null,
  content         jsonb not null,
  type            text not null,
  created_at      timestamptz default now(),
  unique(block_id, version)
);

create index idx_block_versions_block on block_versions(block_id);
create index idx_block_versions_block_version on block_versions(block_id, version desc);

alter table block_versions enable row level security;

create policy "Users can manage block versions in own workspaces" on block_versions
  for all using (
    block_id in (
      select id from blocks where workspace_id in (
        select id from workspaces where owner_id = auth.uid()
      )
    )
  )
  with check (
    block_id in (
      select id from blocks where workspace_id in (
        select id from workspaces where owner_id = auth.uid()
      )
    )
  );
