CREATE TABLE IF NOT EXISTS responses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id         TEXT    NOT NULL UNIQUE,   -- UUID per submission, for dedup
  timestamp           TEXT    NOT NULL,
  session_id          TEXT,                       -- browser localStorage UUID, links submissions from same browser
  submission_number   INTEGER DEFAULT 1,          -- 1st, 2nd, 3rd submission from this session_id
  previous_response_id TEXT,                      -- response_id of prior submission from same session_id (NULL if first)
  survey_version      TEXT,                       -- git SHA of survey.json served
  ip_country          TEXT,                       -- CF-provided country code
  cf_ray              TEXT,                       -- Cloudflare Ray ID
  completion_seconds  INTEGER,                    -- time from page load to submit
  sections_answered   TEXT,                       -- JSON array of section names
  user_agent          TEXT,
  referrer            TEXT,                       -- document.referrer — where the user came from
  payload             TEXT    NOT NULL            -- full JSON response blob
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_response_id ON responses(response_id);
CREATE        INDEX IF NOT EXISTS idx_responses_session     ON responses(session_id);
CREATE        INDEX IF NOT EXISTS idx_responses_timestamp   ON responses(timestamp);
