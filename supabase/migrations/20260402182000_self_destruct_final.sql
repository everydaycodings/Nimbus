BEGIN;

-- Add new columns to share_links
ALTER TABLE public.share_links 
  ADD COLUMN IF NOT EXISTS max_views INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS self_destruct_target TEXT DEFAULT 'link' 
  CHECK (self_destruct_target IN ('link', 'resource'));

-- Table to track IP-based views for 10-minute windowing
CREATE TABLE IF NOT EXISTS public.share_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.share_links(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  last_view_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(link_id, ip_address)
);

-- Index for performance on IP tracking
CREATE INDEX IF NOT EXISTS idx_share_views_link_ip ON public.share_views(link_id, ip_address);

-- RPC to increment view count and return the updated row
CREATE OR REPLACE FUNCTION public.increment_link_views(p_link_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_link public.share_links;
BEGIN
  UPDATE public.share_links
  SET view_count = view_count + 1
  WHERE id = p_link_id
  RETURNING * INTO v_link;

  RETURN row_to_json(v_link);
END;
$$;

COMMIT;
