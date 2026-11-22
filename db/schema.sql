-- urls: one row per shortened link
CREATE TABLE IF NOT EXISTS urls (
  id           BIGSERIAL PRIMARY KEY,          -- auto-increment; Base62(id + offset) = short code
  short_code   VARCHAR(16)  NOT NULL UNIQUE,   -- UNIQUE also creates the index used by redirects
  long_url     TEXT         NOT NULL,
  click_count  BIGINT       NOT NULL DEFAULT 0, -- denormalised counter, updated by the worker
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Optional expiry (NULL = never expires). Added with ALTER so older databases upgrade cleanly.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- clicks: one row per redirect, written asynchronously by the worker
CREATE TABLE IF NOT EXISTS clicks (
  id          BIGSERIAL PRIMARY KEY,
  url_id      BIGINT      NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ NOT NULL,
  ip          VARCHAR(64),
  user_agent  TEXT,
  referer     TEXT
);

-- Speeds up "clicks for this URL over time" queries in the stats endpoint
CREATE INDEX IF NOT EXISTS idx_clicks_url_time ON clicks (url_id, clicked_at);
