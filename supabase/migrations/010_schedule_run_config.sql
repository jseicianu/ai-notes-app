ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS input_values JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_refs JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS output_mode TEXT NOT NULL DEFAULT 'append',
  ADD COLUMN IF NOT EXISTS last_error JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schedules_output_mode_check'
  ) THEN
    ALTER TABLE schedules
      ADD CONSTRAINT schedules_output_mode_check
      CHECK (output_mode IN ('append', 'replace', 'version'));
  END IF;
END $$;
