-- Add can_download to share_links
ALTER TABLE share_links ADD COLUMN can_download BOOLEAN DEFAULT FALSE;
