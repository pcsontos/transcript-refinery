CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  update_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  title TEXT,
  notified_ready INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER
);
CREATE INDEX jobs_update ON jobs(update_id);
CREATE INDEX jobs_video_status ON jobs(video_id, status);
