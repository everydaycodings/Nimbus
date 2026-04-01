-- 20260401201000_storage_stats.sql
-- Optimization: Zero-Payload Statistics RPC

CREATE OR REPLACE FUNCTION get_storage_stats(p_owner_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT json_build_object(
    'image',   COALESCE(SUM(size) FILTER (WHERE mime_type ILIKE 'image/%'), 0),
    'video',   COALESCE(SUM(size) FILTER (WHERE mime_type ILIKE 'video/%'), 0),
    'document', COALESCE(SUM(size) FILTER (WHERE mime_type ILIKE '%pdf%' OR mime_type ILIKE '%doc%'), 0),
    'other',    COALESCE(SUM(size) FILTER (WHERE 
      mime_type NOT ILIKE 'image/%' AND 
      mime_type NOT ILIKE 'video/%' AND 
      mime_type NOT ILIKE '%pdf%' AND 
      mime_type NOT ILIKE '%doc%'
    ), 0)
  )
  INTO result
  FROM public.files
  WHERE owner_id = p_owner_id 
    AND is_trashed = false 
    AND upload_status = 'complete';

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
