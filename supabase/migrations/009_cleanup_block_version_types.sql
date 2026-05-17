-- Remove stale version rows whose saved type no longer matches the current block.
-- Then compact version numbers so UI tabs never point at deleted history rows.

delete from block_versions bv
using blocks b
where bv.block_id = b.id
  and bv.type <> b.type;

delete from block_versions bv
where not exists (
  select 1
  from blocks b
  where b.id = bv.block_id
);

with ordered as (
  select
    id,
    row_number() over (
      partition by block_id
      order by version asc, created_at asc, id asc
    ) as new_version
  from block_versions
)
update block_versions bv
set version = -ordered.new_version
from ordered
where bv.id = ordered.id;

update block_versions
set version = -version
where version < 0;

with version_counts as (
  select block_id, max(version) as max_version
  from block_versions
  group by block_id
)
update blocks b
set version = coalesce(version_counts.max_version, 0) + 1
from version_counts
where b.id = version_counts.block_id;

update blocks b
set version = 1
where not exists (
  select 1
  from block_versions bv
  where bv.block_id = b.id
);
