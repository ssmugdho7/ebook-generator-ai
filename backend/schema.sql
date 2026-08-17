-- Neon Postgres schema for the AI Ebook Generator.
--
-- The backend creates these tables automatically on boot (see db.py), so you
-- normally do NOT need to run this file. It is here for two cases:
--   1. You prefer to provision the schema yourself in the Neon SQL Editor.
--   2. You want to review exactly what the app stores.
--
-- Run in Neon: Dashboard -> your project -> SQL Editor -> paste -> Run.

CREATE TABLE IF NOT EXISTS ebooks (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text        NOT NULL,
    subtitle       text,
    template_id    text        NOT NULL,
    target_pages   integer     NOT NULL DEFAULT 10,
    page_count     integer,
    section_count  integer     NOT NULL DEFAULT 0,
    source_content text,
    book           jsonb       NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ebooks_created_at_idx ON ebooks (created_at DESC);

-- Compiled PDFs live in the database because Render's filesystem is ephemeral.
CREATE TABLE IF NOT EXISTS ebook_pdfs (
    ebook_id   uuid PRIMARY KEY REFERENCES ebooks (id) ON DELETE CASCADE,
    pdf        bytea       NOT NULL,
    byte_size  integer     NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Lightweight audit trail: which generations ran, how long they took, failures.
CREATE TABLE IF NOT EXISTS generation_events (
    id          bigserial PRIMARY KEY,
    kind        text        NOT NULL,
    status      text        NOT NULL,
    ebook_id    uuid REFERENCES ebooks (id) ON DELETE SET NULL,
    duration_ms integer,
    detail      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_events_created_at_idx
    ON generation_events (created_at DESC);

-- Optional housekeeping: keep the Neon free tier (0.5 GB) tidy by dropping
-- PDFs older than 30 days. Run manually or from a Render cron job.
-- DELETE FROM ebook_pdfs WHERE created_at < now() - interval '30 days';
