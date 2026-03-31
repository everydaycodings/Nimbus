-- Migration to add triggers for activity logging
CREATE OR REPLACE FUNCTION public.log_activity() RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_action TEXT;
    v_resource_type TEXT;
    v_resource_id UUID;
    v_metadata JSONB;
BEGIN
    v_user_id := COALESCE(new.owner_id, old.owner_id);
    v_resource_id := COALESCE(new.id, old.id);
    
    -- Determine resource type
    IF TG_TABLE_NAME = 'files' THEN
        v_resource_id := COALESCE(new.id, old.id);
        v_resource_type := 'file';
    ELSIF TG_TABLE_NAME = 'folders' THEN
        v_resource_id := COALESCE(new.id, old.id);
        v_resource_type := 'folder';
    END IF;

    -- Determine action and metadata
    IF TG_OP = 'INSERT' THEN
        v_action := 'upload';
        v_metadata := jsonb_build_object('name', new.name);
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_metadata := jsonb_build_object('name', old.name);
    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle Trash/Restore
        IF old.is_trashed = false AND new.is_trashed = true THEN
            v_action := 'delete';
            v_metadata := jsonb_build_object('name', new.name);
        ELSIF old.is_trashed = true AND new.is_trashed = false THEN
            v_action := 'restore';
            v_metadata := jsonb_build_object('name', new.name);
        -- Handle Star/Unstar
        ELSIF old.is_starred = false AND new.is_starred = true THEN
            v_action := 'star';
            v_metadata := jsonb_build_object('name', new.name);
        ELSIF old.is_starred = true AND new.is_starred = false THEN
            v_action := 'unstar';
            v_metadata := jsonb_build_object('name', new.name);
        -- Handle Rename
        ELSIF old.name <> new.name THEN
            v_action := 'rename';
            v_metadata := jsonb_build_object('old_name', old.name, 'new_name', new.name);
        -- Handle Move
        ELSIF COALESCE(old.parent_folder_id::text, 'root') <> COALESCE(new.parent_folder_id::text, 'root') THEN
            v_action := 'move';
            v_metadata := jsonb_build_object('name', new.name);
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    IF v_action IS NOT NULL THEN
        INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
        VALUES (v_user_id, v_resource_id, v_resource_type, v_action, v_metadata);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add triggers
DROP TRIGGER IF EXISTS trg_log_files_activity ON public.files;
CREATE TRIGGER trg_log_files_activity
AFTER INSERT OR UPDATE OR DELETE ON public.files
FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS trg_log_folders_activity ON public.folders;
CREATE TRIGGER trg_log_folders_activity
AFTER INSERT OR UPDATE OR DELETE ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- Log sharing activity from share_links
CREATE OR REPLACE FUNCTION public.log_share_activity() RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_action TEXT;
    v_resource_type TEXT;
    v_resource_id UUID;
    v_name TEXT;
BEGIN
    v_user_id := COALESCE(new.owner_id, old.owner_id);
    v_resource_id := COALESCE(new.resource_id, old.resource_id);
    v_resource_type := COALESCE(new.resource_type, old.resource_type);
    
    -- Get name
    IF v_resource_type = 'file' THEN
        SELECT name INTO v_name FROM public.files WHERE id = v_resource_id;
    ELSE
        SELECT name INTO v_name FROM public.folders WHERE id = v_resource_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_action := 'share';
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'unshare';
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
    VALUES (v_user_id, v_resource_id, v_resource_type, v_action, jsonb_build_object('name', v_name));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_share_links_activity ON public.share_links;
CREATE TRIGGER trg_log_share_links_activity
AFTER INSERT OR DELETE ON public.share_links
FOR EACH ROW EXECUTE FUNCTION public.log_share_activity();

-- Enable Realtime for activity_log if not already
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'activity_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
  END IF;
END $$;
