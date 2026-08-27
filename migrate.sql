-- Add new metadata columns to existing responses table
ALTER TABLE responses ADD COLUMN response_id      TEXT;
ALTER TABLE responses ADD COLUMN survey_version   TEXT;
ALTER TABLE responses ADD COLUMN ip_country       TEXT;
ALTER TABLE responses ADD COLUMN cf_ray           TEXT;
ALTER TABLE responses ADD COLUMN completion_seconds INTEGER;
ALTER TABLE responses ADD COLUMN sections_answered TEXT;

-- Backfill response_id for any existing rows
UPDATE responses SET response_id = hex(randomblob(16)) WHERE response_id IS NULL;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_response_id ON responses(response_id);
CREATE        INDEX IF NOT EXISTS idx_responses_session     ON responses(session_id);
CREATE        INDEX IF NOT EXISTS idx_responses_timestamp   ON responses(timestamp);
