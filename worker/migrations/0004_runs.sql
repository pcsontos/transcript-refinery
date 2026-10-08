CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  recipes TEXT NOT NULL,
  lang TEXT,
  status TEXT NOT NULL,
  error TEXT,
  note_url TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER
);
CREATE INDEX runs_job ON runs(job_id);
INSERT INTO runs (run_id, job_id, recipes, lang, status, error, note_url, notified, accepted_at)
  SELECT job_id || ':summary', job_id, 'summary', NULL, status, error,
         replace(note_url, '_summary.md', '_transcript.md'), note_notified, accepted_at
  FROM jobs WHERE phase = 'summary';
UPDATE jobs SET status = 'ready', phase = 'subtitle' WHERE phase = 'summary';
