-- DELETE FROM jobs WHERE video_id = 't0qq9R__XiQ';

SELECT job_id, video_id, status, phase, error, title
FROM jobs
ORDER BY rowid DESC
LIMIT 5;