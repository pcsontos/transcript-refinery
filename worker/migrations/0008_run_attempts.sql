-- Próbálkozás-számláló (pcsontos/issue-tracker#103): minden `→ queued` átmenetnél nő; a kopogtatás
-- azonosítója `<runId>~<n>`, így a megszakított futás késői visszahívása nem nyeli el az újraindítást.
ALTER TABLE runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
-- Újragenerálás (pcsontos/issue-tracker#104): a cron a queued futást a D1-sorból építi újra, a force így nem vész el.
ALTER TABLE runs ADD COLUMN force INTEGER NOT NULL DEFAULT 0;
