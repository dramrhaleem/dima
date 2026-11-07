-- B6 launch account operations: bounded owner export and fresh mailbox-confirmed deletion.
CREATE TABLE public.account_deletion_requests (
 id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 session_id text, secret_hash text NOT NULL, status text NOT NULL CHECK(status IN ('sending','codeSent','pending','failed','done')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 prepared_at timestamptz, completed_at timestamptz, error_code text
);
CREATE INDEX deletion_owner ON public.account_deletion_requests(owner_id,created_at DESC);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.account_deletion_requests TO service_role;

CREATE FUNCTION public.account_deletion_challenge(p_id uuid,p_actor uuid,p_session text,p_secret_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.account_deletion_requests%ROWTYPE;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF p_session IS NULL OR char_length(p_secret_hash)<>64 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE owner_id=p_actor AND created_at>now()-interval '60 seconds')
 OR (SELECT count(*) FROM public.account_deletion_requests WHERE owner_id=p_actor AND created_at>now()-interval '1 day')>=5 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429'; END IF;
 INSERT INTO public.account_deletion_requests(id,owner_id,session_id,secret_hash,status) VALUES(p_id,p_actor,p_session,p_secret_hash,'sending') RETURNING * INTO result;
 RETURN jsonb_build_object('requestId',result.id,'status',result.status,'expiresAt',result.expires_at);
END $$;
CREATE FUNCTION public.account_deletion_attempt(p_id uuid,p_actor uuid,p_session text,p_secret_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req public.account_deletion_requests%ROWTYPE;
BEGIN
 SELECT * INTO req FROM public.account_deletion_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR req.owner_id IS DISTINCT FROM p_actor OR req.session_id IS DISTINCT FROM p_session OR req.secret_hash IS DISTINCT FROM p_secret_hash THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF req.expires_at<=now() THEN RAISE EXCEPTION 'CODE_EXPIRED' USING ERRCODE='PT401'; END IF;
 IF req.prepared_at IS NOT NULL AND req.status IN ('pending','failed') THEN RETURN jsonb_build_object('status','pending','createdAt',req.created_at); END IF;
 IF req.status<>'codeSent' OR req.attempts>=5 THEN RAISE EXCEPTION 'CODE_RESTART_REQUIRED' USING ERRCODE='PT429'; END IF;
 UPDATE public.account_deletion_requests SET attempts=attempts+1 WHERE id=p_id;
 RETURN jsonb_build_object('status','codeSent','createdAt',req.created_at);
END $$;
CREATE FUNCTION public.account_deletion_prepare(p_id uuid,p_actor uuid,p_session text,p_secret_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req public.account_deletion_requests%ROWTYPE;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 SELECT * INTO req FROM public.account_deletion_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR req.owner_id IS DISTINCT FROM p_actor OR req.session_id IS DISTINCT FROM p_session OR req.secret_hash IS DISTINCT FROM p_secret_hash THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 IF req.expires_at<=now() OR req.status NOT IN ('codeSent','pending','failed') THEN RAISE EXCEPTION 'CODE_EXPIRED' USING ERRCODE='PT401'; END IF;
 INSERT INTO public.account_suspensions(user_id,actor_id,reason,effective_at) SELECT p_actor,p_actor,'Account deletion pending',now() WHERE EXISTS(SELECT 1 FROM public.account_profiles WHERE user_id=p_actor) ON CONFLICT(user_id) WHERE revoked_at IS NULL DO NOTHING;
 UPDATE public.account_deletion_requests SET status='pending',prepared_at=coalesce(prepared_at,now()),error_code=NULL WHERE id=p_id;
 RETURN jsonb_build_object('requestId',p_id,'status','pending');
END $$;
REVOKE ALL ON FUNCTION public.account_deletion_challenge(uuid,uuid,text,text),public.account_deletion_attempt(uuid,uuid,text,text),public.account_deletion_prepare(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_challenge(uuid,uuid,text,text),public.account_deletion_attempt(uuid,uuid,text,text),public.account_deletion_prepare(uuid,uuid,text,text) TO service_role;

-- GoTrue deletes Auth in its own transaction. Cleanup executes in that same transaction,
-- including historic host/report references, so a failed Auth delete rolls cleanup back.
CREATE FUNCTION public.account_delete_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 UPDATE public.account_deletion_requests SET status='done',completed_at=cutoff,session_id=NULL,error_code=NULL WHERE owner_id=OLD.id AND prepared_at IS NOT NULL;
 RETURN OLD;
END $$;
CREATE TRIGGER dima_account_delete_cleanup BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.account_delete_cleanup();

-- Fence commands at their existing account lock, without adding HTTP round trips.
CREATE FUNCTION public.account_assert_writable(p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_deletion_requests WHERE owner_id=p_actor AND prepared_at IS NOT NULL AND status IN ('pending','failed')) THEN RAISE EXCEPTION 'ACCOUNT_DELETING' USING ERRCODE='PT403'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.account_assert_writable(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.save_account_profile(jsonb) RENAME TO save_account_profile_before_deletion;
CREATE FUNCTION public.save_account_profile(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.account_assert_writable(auth.uid()); RETURN public.save_account_profile_before_deletion(p_command); END $$;
REVOKE ALL ON FUNCTION public.save_account_profile_before_deletion(jsonb),public.save_account_profile(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_account_profile(jsonb) TO authenticated;
ALTER FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) RENAME TO commit_learning_before_deletion;
CREATE FUNCTION public.commit_learning_command(p_actor uuid,p_expected integer,p_profile_revision integer,p_command jsonb,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.account_assert_writable(p_actor); RETURN public.commit_learning_before_deletion(p_actor,p_expected,p_profile_revision,p_command,p_result); END $$;
REVOKE ALL ON FUNCTION public.commit_learning_before_deletion(uuid,integer,integer,jsonb,jsonb),public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) TO service_role;
ALTER FUNCTION public.execute_time_command(uuid,jsonb) RENAME TO execute_time_before_deletion;
CREATE FUNCTION public.execute_time_command(p_actor uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.account_assert_writable(p_actor); RETURN public.execute_time_before_deletion(p_actor,p_command); END $$;
REVOKE ALL ON FUNCTION public.execute_time_before_deletion(uuid,jsonb),public.execute_time_command(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.execute_time_command(uuid,jsonb) TO service_role;
ALTER FUNCTION public.execute_room_command(uuid,jsonb) RENAME TO execute_room_before_deletion;
CREATE FUNCTION public.execute_room_command(p_actor uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.account_assert_writable(p_actor); RETURN public.execute_room_before_deletion(p_actor,p_command); END $$;
REVOKE ALL ON FUNCTION public.execute_room_before_deletion(uuid,jsonb),public.execute_room_command(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.execute_room_command(uuid,jsonb) TO service_role;

CREATE FUNCTION public.export_own_account() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb; part jsonb; entry record;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 result:=jsonb_build_object('format','dima-account-export-v1','exportedAt',now(),'accountId',actor,
 'profile',(SELECT to_jsonb(p)-'user_id' FROM public.account_profiles p WHERE user_id=actor),
 'learning',(SELECT state FROM public.learning_workspaces WHERE user_id=actor));
 -- Fixed allowlist only: never moderation audit, other members, secrets or operation payloads.
 FOR entry IN SELECT * FROM (VALUES
  ('sessions','time_sessions','user_id'),('intervals','time_intervals','user_id'),('corrections','time_corrections','user_id'),
  ('publicationRequests','publication_requests','owner_id'),('sharingSettings','social_settings','user_id'),
  ('peopleVisibility','people_visibility','user_id'),('rankingParticipation','ranking_participation','user_id'),
  ('notifications','social_notifications','user_id'),('firstCredits','first_credit_claims','user_id')
 ) AS entries(label,table_name,owner_column) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(row)-%L),''[]''::jsonb) FROM (SELECT * FROM public.%I WHERE %I=$1 LIMIT 5001) row',entry.owner_column,entry.table_name,entry.owner_column) INTO part USING actor;
  IF jsonb_array_length(part)>5000 THEN RAISE EXCEPTION 'EXPORT_TOO_LARGE' USING ERRCODE='PT413'; END IF;
  result:=result||jsonb_build_object(entry.label,part);
 END LOOP;
 IF octet_length(result::text)>20000000 THEN RAISE EXCEPTION 'EXPORT_TOO_LARGE' USING ERRCODE='PT413'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.export_own_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_own_account() TO authenticated;
NOTIFY pgrst,'reload schema';
