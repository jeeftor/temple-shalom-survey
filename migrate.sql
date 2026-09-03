-- Add new metadata columns to existing responses table
ALTER TABLE responses ADD COLUMN response_id      TEXT;
ALTER TABLE responses ADD COLUMN survey_version   TEXT;
ALTER TABLE responses ADD COLUMN ip_country       TEXT;
ALTER TABLE responses ADD COLUMN cf_ray           TEXT;
ALTER TABLE responses ADD COLUMN completion_seconds INTEGER;
ALTER TABLE responses ADD COLUMN sections_answered TEXT;

-- Re-submission linking metadata
ALTER TABLE responses ADD COLUMN submission_number   INTEGER DEFAULT 1;
ALTER TABLE responses ADD COLUMN previous_response_id TEXT;
ALTER TABLE responses ADD COLUMN referrer            TEXT;

-- Device/browser metadata (parsed client-side)
ALTER TABLE responses ADD COLUMN device_type         TEXT;
ALTER TABLE responses ADD COLUMN browser             TEXT;
ALTER TABLE responses ADD COLUMN os                  TEXT;
ALTER TABLE responses ADD COLUMN screen_size         TEXT;
ALTER TABLE responses ADD COLUMN viewport_size       TEXT;
ALTER TABLE responses ADD COLUMN started_at          TEXT;

-- Backfill response_id for any existing rows
UPDATE responses SET response_id = hex(randomblob(16)) WHERE response_id IS NULL;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_response_id ON responses(response_id);
CREATE        INDEX IF NOT EXISTS idx_responses_session     ON responses(session_id);
CREATE        INDEX IF NOT EXISTS idx_responses_timestamp   ON responses(timestamp);
