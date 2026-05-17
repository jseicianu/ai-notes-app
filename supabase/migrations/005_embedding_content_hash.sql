ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash
  ON embeddings(source_type, source_id, content_hash);
