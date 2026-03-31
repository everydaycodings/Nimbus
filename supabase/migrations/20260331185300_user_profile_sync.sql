-- Migration to rename full_name to name and sync auth.users updates
ALTER TABLE public.users RENAME COLUMN full_name TO "name";

-- Update handle_new_user to use 'name' from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, "name", avatar_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$;

-- Update log_profile_activity to use 'name'
CREATE OR REPLACE FUNCTION public.log_profile_activity() RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(old."name", '') <> COALESCE(new."name", '') OR COALESCE(old.avatar_url, '') <> COALESCE(new.avatar_url, '') THEN
        INSERT INTO public.activity_log (user_id, resource_id, resource_type, action, metadata)
        VALUES (new.id, new.id, 'account', 'profile_update', jsonb_build_object('name', new."name"));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create sync trigger from auth.users to public.users using 'name'
CREATE OR REPLACE FUNCTION public.handle_user_update() RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.users
    SET 
        "name" = COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', "name"),
        avatar_url = COALESCE(new.raw_user_meta_data->>'avatar_url', avatar_url),
        email = COALESCE(new.email, email),
        updated_at = now()
    WHERE id = new.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_handle_user_update ON auth.users;
CREATE TRIGGER trg_handle_user_update
AFTER UPDATE ON auth.users
FOR EACH ROW
WHEN (old.raw_user_meta_data <> new.raw_user_meta_data OR old.email <> new.email)
EXECUTE FUNCTION public.handle_user_update();
