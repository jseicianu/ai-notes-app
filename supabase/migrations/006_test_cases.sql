CREATE TABLE test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID REFERENCES commands(id) ON DELETE CASCADE NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  input_values JSONB NOT NULL DEFAULT '{}',
  source_refs JSONB DEFAULT '[]',
  expected_notes TEXT,
  last_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  last_run_output JSONB,
  last_run_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own test cases" ON test_cases FOR ALL
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE INDEX idx_test_cases_command ON test_cases(command_id);
CREATE INDEX idx_test_cases_workspace ON test_cases(workspace_id);
