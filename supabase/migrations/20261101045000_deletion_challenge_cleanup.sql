-- Remove abandoned verification challenges with their account, preserving only minimal completed receipts.
CREATE OR REPLACE FUNCTION public.account_delete_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE affected uuid[]; room_id_value uuid; cutoff timestamptz:=clock_timestamp();
BEGIN
 SELECT array_agg(id ORDER BY id) INTO affected FROM (
  SELECT id FROM public.rooms WHERE owner_id=OLD.id
  UNION SELECT room_id FROM public.room_memberships WHERE user_id=OLD.id
  UNION SELECT room_id FROM public.time_sessions WHERE user_id=OLD.id AND room_id IS NOT NULL
 ) r;
 PERFORM 1 FROM public.rooms WHERE id=ANY(coalesce(affected,ARRAY[]::uuid[])) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.room_runs WHERE room_id=ANY(coalesce(affected,ARRAY[]::uuid[])) ORDER BY id FOR UPDATE;
 -- Existing participants of an owned room receive an authoritative run cancellation cutoff.
 UPDATE public.room_runs rr SET status='cancelled',cancelled_at=cutoff,version=version+1 FROM public.rooms r WHERE rr.room_id=r.id AND r.owner_id=OLD.id AND rr.status='active';
 UPDATE public.rooms SET status='closed',closed_at=cutoff,version=version+1,access_epoch=access_epoch+1 WHERE owner_id=OLD.id AND status IN ('open','closed');
 UPDATE public.room_memberships SET status='left',ended_at=cutoff,version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE user_id=OLD.id AND status='active';
 UPDATE public.room_memberships SET status='left',ended_at=cutoff,version=version+1,control_version=control_version+1,last_renew_command=NULL,last_renew_receipt=NULL WHERE status='active' AND room_id IN (SELECT id FROM public.rooms WHERE owner_id=OLD.id);
 UPDATE public.rooms SET current_host_membership_id=NULL,host_last_seen_at=cutoff-interval '121 seconds' WHERE current_host_membership_id IN (SELECT id FROM public.room_memberships WHERE user_id=OLD.id);
 UPDATE public.room_runs SET current_host_membership_id=NULL WHERE current_host_membership_id IN (SELECT id FROM public.room_memberships WHERE user_id=OLD.id);
 UPDATE public.room_reports SET target_membership_id=NULL WHERE target_membership_id IN (SELECT id FROM public.room_memberships WHERE user_id=OLD.id);
 -- Free text reports from this account are not left behind as private authored content.
 UPDATE public.room_reports SET details='' WHERE reporter_id=OLD.id;
 UPDATE public.time_sessions SET previous_session_id=NULL WHERE user_id=OLD.id;
 FOREACH room_id_value IN ARRAY coalesce(affected,ARRAY[]::uuid[]) LOOP
  PERFORM public.rooms_settle_locked(room_id_value,cutoff);
  PERFORM public.rooms_emit_locked(room_id_value,cutoff,true);
 END LOOP;
 DELETE FROM public.account_deletion_requests WHERE owner_id=OLD.id AND prepared_at IS NULL;
 UPDATE public.account_deletion_requests SET status='done',completed_at=cutoff,session_id=NULL,error_code=NULL WHERE owner_id=OLD.id AND prepared_at IS NOT NULL;
 RETURN OLD;
END $$;
NOTIFY pgrst,'reload schema';
