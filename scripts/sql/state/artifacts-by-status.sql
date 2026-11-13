-- Műtermékek száma fajta és állapot szerint.
SELECT kind, status, count(*) AS n
FROM artifacts
GROUP BY kind, status
ORDER BY kind, status;
