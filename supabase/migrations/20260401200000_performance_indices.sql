-- 20260401200000_performance_indices.sql
-- Optimization: Composite Indices for common dashboard view filters

-- 1. Composite Index for basic file listing (owner, trash, status, parent)
-- This allows Postgres to find all files in a folder for a specific owner in a single B-Tree traversal.
CREATE INDEX IF NOT EXISTS idx_files_active_composite 
ON public.files (owner_id, is_trashed, upload_status, parent_folder_id, created_at DESC);

-- 2. Composite Index for folder listing
CREATE INDEX IF NOT EXISTS idx_folders_active_composite 
ON public.folders (owner_id, is_trashed, parent_folder_id, created_at DESC);

-- 3. Optimization for Starred items
-- Filtered index: only indexes starred items to keep the index size small and searches extremely fast.
CREATE INDEX IF NOT EXISTS idx_files_starred_composite 
ON public.files (owner_id, is_starred, is_trashed, created_at DESC)
WHERE (is_starred = true AND is_trashed = false);

CREATE INDEX IF NOT EXISTS idx_folders_starred_composite 
ON public.folders (owner_id, is_starred, is_trashed, created_at DESC)
WHERE (is_starred = true AND is_trashed = false);

-- 4. Recent Files Index
-- Covers: owner_id, is_trashed, upload_status, and sorts by created_at.
CREATE INDEX IF NOT EXISTS idx_files_recent_composite 
ON public.files (owner_id, is_trashed, upload_status, created_at DESC);

-- 5. Trashed Items Index
CREATE INDEX IF NOT EXISTS idx_files_trashed_composite 
ON public.files (owner_id, is_trashed, trashed_at DESC)
WHERE (is_trashed = true);

CREATE INDEX IF NOT EXISTS idx_folders_trashed_composite 
ON public.folders (owner_id, is_trashed, trashed_at DESC)
WHERE (is_trashed = true);
