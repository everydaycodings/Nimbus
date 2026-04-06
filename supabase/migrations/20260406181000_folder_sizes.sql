-- 20260406181000_folder_sizes.sql
-- Function to calculate recursive folder size and exposing it as a computed column for PostgREST

CREATE OR REPLACE FUNCTION get_recursive_folder_size(p_folder_id UUID)
RETURNS BIGINT AS $$
DECLARE
    total_size BIGINT;
BEGIN
    WITH RECURSIVE subfolders AS (
        -- Start with the given folder
        SELECT id FROM folders WHERE id = p_folder_id
        UNION ALL
        -- Add subfolders recursively
        SELECT f.id FROM folders f JOIN subfolders s ON f.parent_folder_id = s.id
        WHERE f.is_trashed = false
    )
    SELECT COALESCE(SUM(size), 0) INTO total_size
    FROM files
    WHERE parent_folder_id IN (SELECT id FROM subfolders)
    AND is_trashed = false 
    AND upload_status = 'complete';

    RETURN total_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Computed column for PostgREST
-- Allows selecting 'size' directly on 'public.folders' table
-- PostgREST automatically picks up functions with a single table argument as a column
CREATE OR REPLACE FUNCTION size(f public.folders)
RETURNS BIGINT AS $$
    SELECT get_recursive_folder_size(f.id);
$$ LANGUAGE sql STABLE;
