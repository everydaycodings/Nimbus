-- 20260401202000_realtime_files.sql
-- Enable Realtime for files table to power live storage updates

ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
