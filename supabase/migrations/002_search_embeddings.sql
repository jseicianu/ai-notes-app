create or replace function search_embeddings(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_count int default 10
)
returns table (
  id uuid,
  content text,
  source_type text,
  source_id uuid,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    e.id,
    e.content,
    e.source_type,
    e.source_id,
    1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where e.workspace_id = match_workspace_id
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;
