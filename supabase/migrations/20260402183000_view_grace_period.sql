BEGIN;

-- Add view tracking columns to share_views
ALTER TABLE public.share_views 
  ADD COLUMN IF NOT EXISTS view_status TEXT DEFAULT 'pending' CHECK (view_status IN ('pending', 'active', 'consumed')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ DEFAULT NULL;

-- Update the incrementing logic if needed (it already handles count)

COMMIT;
