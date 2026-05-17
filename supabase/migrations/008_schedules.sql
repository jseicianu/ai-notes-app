CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  command_id UUID REFERENCES commands(id) ON DELETE CASCADE NOT NULL,
  preset_id UUID REFERENCES input_presets(id) ON DELETE SET NULL,
  target_page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
  input_values JSONB DEFAULT '{}',
  source_refs JSONB DEFAULT '[]',
  output_mode TEXT NOT NULL DEFAULT 'append' CHECK (output_mode IN ('append', 'replace', 'version')),
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  last_error JSONB,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own schedules" ON schedules FOR ALL
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE INDEX idx_schedules_workspace ON schedules(workspace_id);
CREATE INDEX idx_schedules_next_run ON schedules(is_active, next_run_at);
