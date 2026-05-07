alter table pages
  add column if not exists is_starred boolean not null default false;

create index if not exists idx_pages_workspace_starred
  on pages(workspace_id, is_starred)
  where is_starred = true;
