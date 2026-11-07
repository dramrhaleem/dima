-- Hosted-only replacement for the installer in migration 20261101024000.
-- Supabase owns realtime.messages; postgres can manage policies via supautils,
-- but cannot ALTER TABLE or revoke privileges originally granted by its owner.
-- https://supabase.com/kb/troubleshooting/realtime-must-be-owner-of-table-messages
CREATE FUNCTION public.install_room_realtime_policy() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF to_regclass('realtime.messages') IS NULL THEN RAISE EXCEPTION 'Hosted Realtime messages table missing'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass) THEN
  RAISE EXCEPTION 'Hosted Realtime requires RLS already enabled';
 END IF;
 IF NOT has_schema_privilege('anon','realtime','USAGE') OR NOT has_schema_privilege('authenticated','realtime','USAGE')
  OR NOT has_table_privilege('anon','realtime.messages','SELECT') THEN
  RAISE EXCEPTION 'Hosted Realtime platform grants are incomplete';
 END IF;
 EXECUTE 'DROP POLICY IF EXISTS dima_room_broadcast_read ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_broadcast_read ON realtime.messages FOR SELECT TO anon USING (extension=''broadcast'' AND public.rooms_realtime_allowed(realtime.topic()))';
 -- Restrictive policies retain capability-only reads even if another policy is added.
 EXECUTE 'DROP POLICY IF EXISTS dima_room_capability_only ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_capability_only ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon USING (extension=''broadcast'' AND public.rooms_realtime_allowed(realtime.topic()))';
 EXECUTE 'DROP POLICY IF EXISTS dima_room_no_user_read ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_no_user_read ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated USING (false)';
 -- Clients may receive authorized broadcasts only. The server publishes them.
 EXECUTE 'DROP POLICY IF EXISTS dima_room_no_client_insert ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_no_client_insert ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK (false)';
 EXECUTE 'DROP POLICY IF EXISTS dima_room_no_client_update ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_no_client_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING (false) WITH CHECK (false)';
 EXECUTE 'DROP POLICY IF EXISTS dima_room_no_client_delete ON realtime.messages';
 EXECUTE 'CREATE POLICY dima_room_no_client_delete ON realtime.messages AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (false)';
 RETURN true;
END $$;
