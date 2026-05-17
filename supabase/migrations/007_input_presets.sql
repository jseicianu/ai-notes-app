CREATE TABLE input_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID REFERENCES commands(id) ON DELETE CASCADE NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  input_values JSONB NOT NULL DEFAULT '{}',
  source_refs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE input_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own presets" ON input_presets FOR ALL
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE INDEX idx_input_presets_command ON input_presets(command_id);
CREATE INDEX idx_input_presets_workspace ON input_presets(workspace_id);
