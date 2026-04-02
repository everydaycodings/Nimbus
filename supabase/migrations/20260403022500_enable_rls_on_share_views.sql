-- Enable RLS on share_views table
ALTER TABLE public.share_views ENABLE ROW LEVEL SECURITY;

-- Allow the owner of the share link to view the view history
CREATE POLICY "share_views_owner_select" ON public.share_views
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.share_links
            WHERE public.share_links.id = public.share_views.link_id
            AND public.share_links.owner_id = public.current_user_id()
        )
    );

-- Since management is done via service_role/RPC with security definer,
-- no other public policies are needed for insert/update/delete.
