CREATE TABLE model_overrides (
  sub TEXT NOT NULL,
  recipe TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  PRIMARY KEY (sub, recipe, mode)
);
ALTER TABLE runs ADD COLUMN model TEXT;
