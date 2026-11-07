-- B5: authoritative producer handoff; applied predecessors remain unchanged.
CREATE FUNCTION public.ack_room_hint_result(p_room uuid,p_claim uuid,p_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='2s' AS $$
DECLARE still_pending boolean;
BEGIN
 UPDATE public.room_outbox SET pending=version>p_version,claim_token=NULL,lease_until=NULL,attempts=0,last_error=NULL,
  next_run_at=CASE WHEN version>p_version THEN clock_timestamp() ELSE next_run_at END
 WHERE room_id=p_room AND claim_token=p_claim AND p_version>=0 AND p_version<=version
 RETURNING pending INTO still_pending;
 IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'pending',false); END IF;
 RETURN jsonb_build_object('accepted',true,'pending',still_pending);
END $$;
REVOKE ALL ON FUNCTION public.ack_room_hint_result(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ack_room_hint_result(uuid,uuid,bigint) TO service_role;

-- Keep the existing internal ABI, using the same fenced ACK implementation.
CREATE OR REPLACE FUNCTION public.ack_room_hint(p_room uuid,p_claim uuid,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='2s' AS $$
BEGIN
 PERFORM public.ack_room_hint_result(p_room,p_claim,p_version);
END $$;
-- PostgREST14 hoists these function settings into the request transaction before
-- executing the RPC. This is not an in-function SET that starts too late.
ALTER FUNCTION public.claim_room_hints(integer,uuid[]) SET statement_timeout='2s';
ALTER FUNCTION public.fail_room_hint(uuid,uuid) SET statement_timeout='2s';
REVOKE ALL ON FUNCTION public.ack_room_hint(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ack_room_hint(uuid,uuid,bigint) TO service_role;
