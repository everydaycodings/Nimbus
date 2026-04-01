-- 20260401203000_vault_performance.sql
-- Optimizing vault navigation and live updates

-- ── Composite Indices ───────────────────────────────────────────
-- Speed up queries that fetch items in a specific folder within a vault
CREATE INDEX IF NOT EXISTS idx_vault_files_navigation ON public.vault_files (vault_id, parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_vault_folders_navigation ON public.vault_folders (vault_id, parent_folder_id);

-- ── Realtime Publication ─────────────────────────────────────────
-- Enable live sync for all vault items
ALTER PUBLICATION supabase_realtime ADD TABLE public.vaults;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vault_files;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vault_folders;
