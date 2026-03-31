
-- Function to get all sessions for the current authenticated user
CREATE OR REPLACE FUNCTION public.get_user_sessions()
RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    ip inet,
    user_agent text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.created_at, s.ip, s.user_agent
    FROM auth.sessions s
    WHERE s.user_id = auth.uid()
    ORDER BY s.created_at DESC;
END;
$$;

-- Function to revoke a session for the current authenticated user
CREATE OR REPLACE FUNCTION public.revoke_user_session(session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    DELETE FROM auth.sessions
    WHERE id = session_id AND user_id = auth.uid();
END;
$$;

-- Function to revoke all other sessions for the current authenticated user
CREATE OR REPLACE FUNCTION public.revoke_other_sessions(current_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    DELETE FROM auth.sessions
    WHERE user_id = auth.uid() AND id != current_session_id;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_other_sessions(uuid) TO authenticated;
