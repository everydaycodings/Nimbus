-- Migration to add tag activity logging
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_action_check 
  CHECK (action = ANY (ARRAY[
    'upload', 'download', 'delete', 'restore', 'rename', 'move', 'share', 'unshare', 'star', 'unstar',
    'profile_update', 'security_update', 'mfa_enroll', 'mfa_unenroll',
    'tag', 'untag'
  ]));

-- Tagging Activity Trigger function
CREATE OR REPLACE FUNCTION public.log_tag_activity() RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_action TEXT;
    v_resource_type TEXT;
    v_resource_id UUID;
    v_resource_name TEXT;
    v_tag_name TEXT;
BEGIN
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'tag' ELSE 'untag' END;
    
    IF TG_TABLE_NAME = 'file_tags' THEN
        v_resource_id := COALESCE(new.file_id, old.file_id);
        v_resource_type := 'file';
        SELECT name, owner_id INTO v_resource_name, v_user_id FROM public.files WHERE id = v_resource_id;
    ELSE
        v_resource_id := COALESCE(new.folder_id, old.folder_id);
        v_resource_type := 'folder';
        SELECT name, owner_id INTO v_resource_name, v_user_id FROM public.folders WHERE id = v_resource_id;
    END IF;

    SELECT name INTO v_tag_name FROM public.tags WHERE id = COALESCE(new.tag_id, old.tag_id);

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
        VALUES (v_user_id, v_resource_id, v_resource_type, v_action, 
                jsonb_build_object('name', v_resource_name, 'tag_name', v_tag_name));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add triggers for tagging
DROP TRIGGER IF EXISTS trg_log_file_tag_activity ON public.file_tags;
CREATE TRIGGER trg_log_file_tag_activity
AFTER INSERT OR DELETE ON public.file_tags
FOR EACH ROW EXECUTE FUNCTION public.log_tag_activity();

DROP TRIGGER IF EXISTS trg_log_folder_tag_activity ON public.folder_tags;
CREATE TRIGGER trg_log_folder_tag_activity
AFTER INSERT OR DELETE ON public.folder_tags
FOR EACH ROW EXECUTE FUNCTION public.log_tag_activity();
