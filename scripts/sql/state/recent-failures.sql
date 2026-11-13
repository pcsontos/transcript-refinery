-- A legutóbbi elbukott műtermékek a tétel címével és a hibával.
SELECT a.created_at, a.kind, i.title, a.error
FROM artifacts AS a
JOIN items AS i USING (item_id)
WHERE a.status = 'failed'
ORDER BY a.created_at DESC
LIMIT 50;
