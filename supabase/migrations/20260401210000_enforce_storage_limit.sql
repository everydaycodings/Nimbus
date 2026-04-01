-- Add a check constraint to the users table to enforce the storage limit at the database level.
-- This ensures that users cannot exceed their storage limit, even if they bypass the frontend/API.
-- The value of storage_used is updated via the 'trg_storage_used' trigger when files are inserted/deleted.

ALTER TABLE "public"."users"
ADD CONSTRAINT "storage_limit_check" 
CHECK ("storage_used" <= "storage_limit");
