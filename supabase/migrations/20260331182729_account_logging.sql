-- Migration to add account activity logging
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_action_check 
  CHECK (action = ANY (ARRAY[
    'upload', 'download', 'delete', 'restore', 'rename', 'move', 'share', 'unshare', 'star', 'unstar',
    'profile_update', 'security_update', 'mfa_enroll', 'mfa_unenroll'
  ]));

ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_resource_type_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_resource_type_check 
  CHECK (resource_type = ANY (ARRAY['file', 'folder', 'account']));

-- Profile Update Trigger
CREATE OR REPLACE FUNCTION public.log_profile_activity() RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(old.full_name, '') <> COALESCE(new.full_name, '') OR COALESCE(old.avatar_url, '') <> COALESCE(new.avatar_url, '') THEN
        INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
        VALUES (new.id, new.id, 'account', 'profile_update', jsonb_build_object('name', new.full_name));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_profile_activity ON public.users;
CREATE TRIGGER trg_log_profile_activity
AFTER UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.log_profile_activity();

-- Security Update Trigger on auth.users
CREATE OR REPLACE FUNCTION public.log_auth_activity() RETURNS TRIGGER AS $$
DECLARE
    v_action TEXT;
BEGIN
    IF old.encrypted_password <> new.encrypted_password THEN
        v_action := 'security_update';
    ELSIF old.email <> new.email THEN
        v_action := 'security_update';
    END IF;

    IF v_action IS NOT NULL THEN
        INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
        VALUES (new.id, new.id, 'account', v_action, jsonb_build_object('name', 'Security Settings Changed'));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_auth_activity ON auth.users;
CREATE TRIGGER trg_log_auth_activity
AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.log_auth_activity();

-- Note: In Supabase, standard migrations can target auth schema if running as postgres/service_role
-- MFA Trigger
CREATE OR REPLACE FUNCTION public.log_mfa_activity() RETURNS TRIGGER AS $$
DECLARE
    v_action TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'mfa_enroll';
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'mfa_unenroll';
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
    VALUES (COALESCE(new.user_id, old.user_id), COALESCE(new.user_id, old.user_id), 'account', v_action, jsonb_build_object('name', 'Two-Factor Auth'));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_mfa_activity ON auth.mfa_factors;
CREATE TRIGGER trg_log_mfa_activity
AFTER INSERT OR DELETE ON auth.mfa_factors
FOR EACH ROW EXECUTE FUNCTION public.log_mfa_activity();
