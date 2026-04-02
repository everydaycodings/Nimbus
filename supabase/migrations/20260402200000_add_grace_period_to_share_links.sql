BEGIN;

-- Add grace_period_ms to share_links
-- Default is 10 minutes (600,000 ms)
ALTER TABLE public.share_links 
  ADD COLUMN IF NOT EXISTS grace_period_ms INTEGER DEFAULT 600000;

COMMIT;
