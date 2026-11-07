-- B5: normalized public room metadata, private membership and immutable timed runs.
-- Owner/control commands serialize Account -> sorted Rooms -> sorted Runs -> entities.
CREATE TABLE public.room_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE public.room_public_offerings (
  id text PRIMARY KEY, title text NOT NULL, provider text NOT NULL, approved boolean NOT NULL DEFAULT true
);
INSERT INTO public.room_public_offerings(id,title,provider) VALUES
 ('google-project-management','Google Project Management','Google · Coursera'),
 ('cs50-business','CS50 Business','Harvard University');
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 60),
  description text NOT NULL DEFAULT '' CHECK (char_length(description)<=240),
  language text NOT NULL CHECK (language IN ('en','ar','fr','es','de','other')),
  topic text CHECK (char_length(topic) BETWEEN 2 AND 80),
  offering_id text REFERENCES public.room_public_offerings(id),
  CHECK ((topic IS NULL)<>(offering_id IS NULL)),
  configured_preset text NOT NULL CHECK (configured_preset IN ('classic','deep')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','suspended','archived')),
  version bigint NOT NULL DEFAULT 1, hint_version bigint NOT NULL DEFAULT 1,
  access_epoch integer NOT NULL DEFAULT 1,
  current_host_membership_id uuid, host_last_seen_at timestamptz NOT NULL,
  current_run_id uuid,
  closed_at timestamptz, suspended_at timestamptz, archived_at timestamptz,
  last_activity_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  hint_phase text NOT NULL DEFAULT 'lobby', hint_reserved integer NOT NULL DEFAULT 0, hint_connected integer NOT NULL DEFAULT 0
);
CREATE INDEX rooms_directory ON public.rooms(status,created_at DESC,id DESC);
CREATE INDEX rooms_owner_created ON public.rooms(owner_id,created_at);
CREATE TABLE public.room_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
  preset_id text NOT NULL CHECK (preset_id IN ('classic','deep')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  started_at timestamptz NOT NULL, planned_end_at timestamptz NOT NULL,
  completed_at timestamptz, cancelled_at timestamptz,
  current_host_membership_id uuid, version bigint NOT NULL DEFAULT 1,
  UNIQUE(id,room_id), CHECK(planned_end_at>started_at)
);
CREATE UNIQUE INDEX room_one_active_run ON public.room_runs(room_id) WHERE status='active';
CREATE TABLE public.room_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('active','expired','left','removed')),
  version bigint NOT NULL DEFAULT 1,
  device_id uuid NOT NULL, control_version integer NOT NULL DEFAULT 1,
  visibility_version integer NOT NULL CHECK(visibility_version=1),
  intent text CHECK(intent IN ('reading','practice','project','work')),
  joined_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
  ended_at timestamptz, removed_run_id uuid REFERENCES public.room_runs(id), removed_epoch integer,
  last_reaction_at timestamptz,
  last_renew_command jsonb, last_renew_receipt jsonb,
  UNIQUE(room_id,user_id), UNIQUE(id,room_id), UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX room_one_active_membership ON public.room_memberships(user_id) WHERE status='active';
CREATE INDEX room_members_seats ON public.room_memberships(room_id,status,last_seen_at);
ALTER TABLE public.rooms ADD FOREIGN KEY(current_host_membership_id,id) REFERENCES public.room_memberships(id,room_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.rooms ADD FOREIGN KEY(current_run_id,id) REFERENCES public.room_runs(id,room_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.room_runs ADD FOREIGN KEY(current_host_membership_id,room_id) REFERENCES public.room_memberships(id,room_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.round_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id), run_id uuid NOT NULL,
  round_index integer NOT NULL CHECK(round_index BETWEEN 1 AND 4),
  accepted_at timestamptz NOT NULL, boundary_at timestamptz NOT NULL,
  UNIQUE(user_id,run_id,round_index), UNIQUE(id,user_id,room_id,boundary_at),
  FOREIGN KEY(run_id,room_id) REFERENCES public.room_runs(id,room_id)
);
ALTER TABLE public.time_sessions ADD COLUMN room_deadline_at timestamptz;
ALTER TABLE public.time_sessions ADD FOREIGN KEY(room_id) REFERENCES public.rooms(id);
ALTER TABLE public.time_sessions ADD FOREIGN KEY(participation_id,user_id,room_id,room_deadline_at) REFERENCES public.round_participations(id,user_id,room_id,boundary_at) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.time_sessions ADD CHECK ((mode='room' AND room_id IS NOT NULL AND participation_id IS NOT NULL AND room_deadline_at IS NOT NULL AND room_deadline_at>created_at) OR (mode<>'room' AND room_id IS NULL AND participation_id IS NULL AND room_deadline_at IS NULL));

-- Target references deliberately avoid auth.users row locks while an actor holds a Room.
-- Membership mutations are Room-serialized; profile PK checks do not conflict with Account locks.
CREATE TABLE public.room_access_cutoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
  membership_id uuid NOT NULL, run_id uuid,
  FOREIGN KEY(run_id,room_id) REFERENCES public.room_runs(id,room_id),
  effective_at timestamptz NOT NULL, reason text NOT NULL, access_epoch integer NOT NULL DEFAULT 1,
  FOREIGN KEY(membership_id,room_id) REFERENCES public.room_memberships(id,room_id) ON DELETE CASCADE
);
CREATE INDEX room_cutoffs_member ON public.room_access_cutoffs(membership_id,effective_at);
CREATE TABLE public.room_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
  membership_id uuid NOT NULL, actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY(membership_id,room_id) REFERENCES public.room_memberships(id,room_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX room_active_ban ON public.room_bans(room_id,membership_id) WHERE revoked_at IS NULL;
CREATE TABLE public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
  context_membership_id uuid REFERENCES public.room_memberships(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK(blocker_id<>blocked_id)
);
CREATE UNIQUE INDEX user_active_block ON public.user_blocks(blocker_id,blocked_id) WHERE revoked_at IS NULL;
CREATE INDEX user_block_reverse ON public.user_blocks(blocked_id,blocker_id) WHERE revoked_at IS NULL;
CREATE TABLE public.account_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL, effective_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE UNIQUE INDEX account_active_suspension ON public.account_suspensions(user_id) WHERE revoked_at IS NULL;
CREATE TABLE public.room_transfer_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
  from_membership_id uuid NOT NULL, target_membership_id uuid NOT NULL,
  run_id uuid REFERENCES public.room_runs(id),
  status text NOT NULL CHECK(status IN ('offered','accepted','expired','cancelled')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(from_membership_id,room_id) REFERENCES public.room_memberships(id,room_id) ON DELETE CASCADE,
  FOREIGN KEY(target_membership_id,room_id) REFERENCES public.room_memberships(id,room_id) ON DELETE CASCADE,
  CHECK(from_membership_id<>target_membership_id)
);
CREATE UNIQUE INDEX room_one_host_offer ON public.room_transfer_offers(room_id) WHERE status='offered';
CREATE TABLE public.room_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id), target_membership_id uuid,
  reason text NOT NULL CHECK(reason IN ('spam','harassment','inappropriate-content','privacy','other')),
  details text NOT NULL DEFAULT '' CHECK(char_length(details)<=500),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed')),
  created_at timestamptz NOT NULL, reviewed_at timestamptz, reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  FOREIGN KEY(target_membership_id,room_id) REFERENCES public.room_memberships(id,room_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX room_reports_review ON public.room_reports(status,created_at,id);
CREATE TABLE public.room_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
  membership_id uuid NOT NULL, run_id uuid NOT NULL REFERENCES public.room_runs(id),
  kind text NOT NULL CHECK(kind IN ('wave','wellDone')), created_at timestamptz NOT NULL,
  FOREIGN KEY(membership_id,room_id) REFERENCES public.room_memberships(id,room_id) ON DELETE CASCADE
);
CREATE INDEX room_reactions_recent ON public.room_reactions(room_id,created_at DESC);
CREATE TABLE public.room_operations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, operation_id uuid NOT NULL,
  command jsonb NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE public.room_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid REFERENCES public.rooms(id),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, target_membership_id uuid REFERENCES public.room_memberships(id) ON DELETE SET NULL,
  action text NOT NULL, reason text, created_at timestamptz NOT NULL
);
CREATE TABLE public.room_outbox (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id), version bigint NOT NULL,
  pending boolean NOT NULL DEFAULT true, attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL, claim_token uuid, lease_until timestamptz, last_error text
);
CREATE TABLE public.room_jobs (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed','idle')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  next_run_at timestamptz NOT NULL, claim_token uuid, lease_until timestamptz, last_error text
);
CREATE INDEX room_jobs_due ON public.room_jobs(status,next_run_at,lease_until);
CREATE TABLE public.room_rate_buckets (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL, bucket_at timestamptz NOT NULL, count integer NOT NULL,
  PRIMARY KEY(user_id,kind,bucket_at)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['room_accounts','room_public_offerings','rooms','room_runs','room_memberships',
 'round_participations','room_access_cutoffs','room_bans','user_blocks','account_suspensions','room_transfer_offers',
 'room_reports','room_reactions','room_operations','room_audit','room_outbox','room_jobs','room_rate_buckets'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
-- Raw roster/profile joins never become a public or authenticated table projection.
-- All member reads are fixed SECURITY DEFINER functions deriving actor from auth.uid().

CREATE FUNCTION public.rooms_is_suspended(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_suspensions WHERE user_id=p_actor AND revoked_at IS NULL)
$$;
CREATE FUNCTION public.rooms_is_moderator(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_roles WHERE user_id=p_actor AND role IN ('moderator','admin'))
$$;
CREATE FUNCTION public.rooms_is_blocked(p_a uuid,p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_blocks WHERE revoked_at IS NULL
 AND ((blocker_id=p_a AND blocked_id=p_b) OR (blocker_id=p_b AND blocked_id=p_a)))
$$;
CREATE FUNCTION public.rooms_phase(p_run public.room_runs,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE focus_seconds integer; short_seconds integer; long_seconds integer; cursor_at timestamptz; finish_at timestamptz; round_number integer;
BEGIN
 IF p_run.id IS NULL THEN RETURN jsonb_build_object('kind','lobby','roundIndex',NULL,'startsAt',NULL,'endsAt',NULL,'secondsRemaining',0); END IF;
 IF p_run.status='cancelled' THEN RETURN jsonb_build_object('kind','cancelled','roundIndex',NULL,'startsAt',p_run.started_at,'endsAt',p_run.cancelled_at,'secondsRemaining',0); END IF;
 IF p_run.status='completed' OR p_now>=p_run.planned_end_at THEN RETURN jsonb_build_object('kind','completed','roundIndex',NULL,'startsAt',p_run.started_at,'endsAt',p_run.planned_end_at,'secondsRemaining',0); END IF;
 focus_seconds=CASE WHEN p_run.preset_id='classic' THEN 1500 ELSE 3000 END;
 short_seconds=CASE WHEN p_run.preset_id='classic' THEN 300 ELSE 600 END;
 long_seconds=CASE WHEN p_run.preset_id='classic' THEN 900 ELSE 1200 END;
 cursor_at=p_run.started_at;
 FOR round_number IN 1..4 LOOP
  finish_at=cursor_at+make_interval(secs=>focus_seconds);
  IF p_now<finish_at THEN RETURN jsonb_build_object('kind','focus','roundIndex',round_number,'startsAt',cursor_at,'endsAt',finish_at,'secondsRemaining',greatest(0,extract(epoch FROM finish_at-p_now))); END IF;
  cursor_at=finish_at;
  finish_at=cursor_at+make_interval(secs=>CASE WHEN round_number=4 THEN long_seconds ELSE short_seconds END);
  IF p_now<finish_at THEN RETURN jsonb_build_object('kind',CASE WHEN round_number=4 THEN 'longBreak' ELSE 'shortBreak' END,'roundIndex',round_number,'startsAt',cursor_at,'endsAt',finish_at,'secondsRemaining',extract(epoch FROM finish_at-p_now)); END IF;
  cursor_at=finish_at;
 END LOOP;
 RETURN jsonb_build_object('kind','completed','roundIndex',NULL,'startsAt',p_run.started_at,'endsAt',p_run.planned_end_at,'secondsRemaining',0);
END $$;
CREATE FUNCTION public.rooms_run_json(r public.room_runs,p_now timestamptz) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,
 'status',CASE WHEN r.status='active' AND p_now>=r.planned_end_at THEN 'completed' ELSE r.status END,
 'presetId',r.preset_id,'startedAt',r.started_at,'plannedEndAt',r.planned_end_at,
 'completedAt',CASE WHEN r.status<>'cancelled' AND p_now>=r.planned_end_at THEN r.planned_end_at ELSE r.completed_at END,'cancelledAt',r.cancelled_at) END
$$;
CREATE FUNCTION public.rooms_member_live(m public.room_memberships,p_now timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.id IS NOT NULL AND m.status='active' AND m.visibility_version=1
 AND m.last_seen_at>p_now-interval '180 seconds' AND NOT public.rooms_is_suspended(m.user_id)
 AND NOT EXISTS(SELECT 1 FROM public.room_bans WHERE membership_id=m.id AND revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.rooms r LEFT JOIN public.room_runs rr ON rr.id=r.current_run_id
 WHERE r.id=m.room_id AND (r.status='open' OR (r.status='closed' AND rr.status='active' AND rr.planned_end_at>p_now)))
$$;
CREATE FUNCTION public.rooms_effective_status(r public.rooms,p_now timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN r.status='open' AND greatest(r.last_activity_at,(SELECT max(planned_end_at) FROM public.room_runs WHERE room_id=r.id AND status<>'cancelled' AND planned_end_at<=p_now))<=p_now-interval '7 days'
 AND NOT EXISTS(SELECT 1 FROM public.room_runs WHERE room_id=r.id AND status='active' AND planned_end_at>p_now)
 AND NOT EXISTS(SELECT 1 FROM public.room_memberships m WHERE m.room_id=r.id AND public.rooms_member_live(m,p_now))
 THEN 'archived' ELSE r.status END
$$;
CREATE FUNCTION public.rooms_public_json(p_room uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; rr public.room_runs%ROWTYPE; reserved_count integer; connected_count integer; phase jsonb; effective_status text;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
 effective_status=public.rooms_effective_status(r,p_now);
 SELECT count(*),count(*) FILTER(WHERE last_seen_at>p_now-interval '90 seconds') INTO reserved_count,connected_count
 FROM public.room_memberships m WHERE room_id=p_room AND public.rooms_member_live(m,p_now);
 phase=public.rooms_phase(rr,p_now);
 IF effective_status='open' AND phase->>'kind'='completed' THEN phase=public.rooms_phase(NULL::public.room_runs,p_now); rr=NULL; END IF;
 RETURN jsonb_build_object('id',r.id,'title',CASE WHEN effective_status='suspended' THEN 'Room unavailable' ELSE r.title END,
 'description',CASE WHEN effective_status='suspended' THEN '' ELSE r.description END,'language',r.language,
 'topic',CASE WHEN effective_status='suspended' THEN NULL ELSE r.topic END,
 'offering',(SELECT jsonb_build_object('id',o.id,'title',o.title,'provider',o.provider) FROM public.room_public_offerings o WHERE o.id=r.offering_id),
 'status',effective_status,'configuredPreset',r.configured_preset,'version',r.version,'hintVersion',r.hint_version,
 'capacity',20,'reservedCount',reserved_count,'connectedCount',connected_count,'run',public.rooms_run_json(rr,p_now),
 'phase',phase,'createdAt',r.created_at);
END $$;

CREATE TABLE public.room_account_jobs (
 user_id uuid PRIMARY KEY REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed','idle')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 next_run_at timestamptz NOT NULL, claim_token uuid, lease_until timestamptz, last_error text
);
ALTER TABLE public.room_account_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_account_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.room_account_jobs TO service_role;
CREATE INDEX room_account_jobs_due ON public.room_account_jobs(status,next_run_at,lease_until);
CREATE FUNCTION public.rooms_raise(p_code text,p_status integer) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='PT'||p_status::text,MESSAGE=p_code; END $$;
CREATE FUNCTION public.rooms_lock_for_actor(p_actor uuid,p_targets uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE locked_rooms uuid[];
BEGIN
 SELECT array_agg(id ORDER BY id) INTO locked_rooms FROM (
  SELECT unnest(p_targets) AS id UNION
  SELECT room_id FROM public.room_memberships WHERE user_id=p_actor AND status='active' UNION
  SELECT room_id FROM public.time_sessions WHERE user_id=p_actor AND status IN ('running','paused','needsReview') AND room_id IS NOT NULL
 ) ids WHERE id IS NOT NULL;
 PERFORM 1 FROM public.rooms WHERE id=ANY(coalesce(locked_rooms,ARRAY[]::uuid[])) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.room_runs WHERE room_id=ANY(coalesce(locked_rooms,ARRAY[]::uuid[])) AND status='active' ORDER BY id FOR UPDATE;
END $$;
CREATE FUNCTION public.rooms_bump(p_actor uuid) RETURNS bigint
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE rev bigint;
BEGIN
 INSERT INTO public.room_accounts(user_id,revision) VALUES(p_actor,1)
 ON CONFLICT(user_id) DO UPDATE SET revision=public.room_accounts.revision+1 RETURNING revision INTO rev;
 RETURN rev;
END $$;
CREATE FUNCTION public.rooms_emit_locked(p_room uuid,p_now timestamptz,p_force boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE dto jsonb; phase_key text; r public.rooms%ROWTYPE; new_version bigint;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 dto=public.rooms_public_json(p_room,p_now);
 phase_key=concat(dto->'phase'->>'kind',':',dto->'phase'->>'roundIndex',':',dto->'run'->>'id');
 IF NOT p_force AND r.hint_phase=phase_key AND r.hint_reserved=(dto->>'reservedCount')::integer AND r.hint_connected=(dto->>'connectedCount')::integer THEN RETURN; END IF;
 UPDATE public.rooms SET hint_version=hint_version+1,hint_phase=phase_key,
 hint_reserved=(dto->>'reservedCount')::integer,hint_connected=(dto->>'connectedCount')::integer
 WHERE id=p_room RETURNING hint_version INTO new_version;
 INSERT INTO public.room_outbox(room_id,version,next_run_at) VALUES(p_room,new_version,p_now)
 ON CONFLICT(room_id) DO UPDATE SET version=excluded.version,pending=true,next_run_at=excluded.next_run_at,attempts=0;
END $$;
CREATE FUNCTION public.rooms_schedule_locked(p_room uuid,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE next_at timestamptz; phase jsonb; r public.rooms%ROWTYPE; rr public.room_runs%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
 phase=public.rooms_phase(rr,p_now);
 SELECT min(value) INTO next_at FROM (
  SELECT (phase->>'endsAt')::timestamptz AS value WHERE phase->>'kind' IN ('focus','shortBreak','longBreak')
  UNION ALL SELECT last_seen_at+interval '90 seconds' FROM public.room_memberships WHERE room_id=p_room AND status='active' AND last_seen_at+interval '90 seconds'>p_now
  UNION ALL SELECT last_seen_at+interval '180 seconds' FROM public.room_memberships WHERE room_id=p_room AND status='active' AND last_seen_at+interval '180 seconds'>p_now
  UNION ALL SELECT r.last_activity_at+interval '7 days' WHERE r.status='open' AND r.last_activity_at+interval '7 days'>p_now
 ) candidates;
 IF next_at IS NULL THEN
  UPDATE public.room_jobs SET status='idle',claim_token=NULL,lease_until=NULL WHERE room_id=p_room AND status<>'running';
  RETURN;
 END IF;
 INSERT INTO public.room_jobs(room_id,next_run_at) VALUES(p_room,next_at)
 ON CONFLICT(room_id) DO UPDATE SET next_run_at=CASE WHEN public.room_jobs.status='pending' THEN least(public.room_jobs.next_run_at,excluded.next_run_at) ELSE excluded.next_run_at END,
 status=CASE WHEN public.room_jobs.status IN ('running','failed') THEN public.room_jobs.status ELSE 'pending' END;
END $$;
CREATE FUNCTION public.rooms_queue_account(p_actor uuid,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- The profile FK avoids an implicit auth.users KEY SHARE lock inside Room moderation.
 INSERT INTO public.room_account_jobs(user_id,next_run_at) VALUES(p_actor,p_now)
 ON CONFLICT(user_id) DO UPDATE SET next_run_at=excluded.next_run_at,attempts=0,last_error=NULL,
 status=CASE WHEN public.room_account_jobs.status='running' THEN 'running' ELSE 'pending' END;
END $$;
CREATE FUNCTION public.rooms_settle_locked(p_room uuid,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; rr public.room_runs%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO rr FROM public.room_runs WHERE id=r.current_run_id;
 UPDATE public.room_memberships SET status='expired',ended_at=last_seen_at+interval '180 seconds',version=version+1,control_version=control_version+1,
 last_renew_command=NULL,last_renew_receipt=NULL WHERE room_id=p_room AND status='active' AND last_seen_at<=p_now-interval '180 seconds';
 UPDATE public.room_transfer_offers SET status='expired' WHERE room_id=p_room AND status='offered' AND expires_at<=p_now;
 IF rr.status='active' AND rr.planned_end_at<=p_now THEN
  UPDATE public.room_runs SET status='completed',completed_at=planned_end_at,version=version+1 WHERE id=rr.id;
  UPDATE public.rooms SET last_activity_at=greatest(last_activity_at,rr.planned_end_at),
    current_run_id=CASE WHEN status='open' THEN NULL ELSE current_run_id END,version=version+1,access_epoch=access_epoch+1 WHERE id=p_room;
  UPDATE public.room_transfer_offers SET status='cancelled' WHERE room_id=p_room AND status='offered';
 END IF;
 IF r.status='closed' AND (rr.id IS NULL OR rr.status<>'active' OR rr.planned_end_at<=p_now) THEN
  UPDATE public.room_memberships SET status='left',ended_at=coalesce(rr.planned_end_at,r.closed_at,p_now),version=version+1,control_version=control_version+1,
    last_renew_command=NULL,last_renew_receipt=NULL WHERE room_id=p_room AND status='active';
 END IF;
 IF public.rooms_effective_status((SELECT x FROM public.rooms x WHERE id=p_room),p_now)='archived' AND r.status='open' THEN
  UPDATE public.rooms SET status='archived',archived_at=p_now,version=version+1 WHERE id=p_room;
 END IF;
 PERFORM public.rooms_emit_locked(p_room,p_now);
 PERFORM public.rooms_schedule_locked(p_room,p_now);
END $$;
CREATE FUNCTION public.rooms_access_json(p_actor uuid,p_room uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rooms%ROWTYPE; m public.room_memberships%ROWTYPE; access_state text; reason text; allowed boolean=true;
BEGIN
 SELECT * INTO r FROM public.rooms WHERE id=p_room;
 IF NOT FOUND THEN RETURN jsonb_build_object('roomId',p_room,'state','none','canRejoin',false,'reason','NOT_FOUND','isOwner',false,'canEdit',false,'canClose',false); END IF;
 SELECT * INTO m FROM public.room_memberships WHERE room_id=p_room AND user_id=p_actor;
 access_state=coalesce(m.status,'none');
 IF m.status='active' AND NOT public.rooms_member_live(m,p_now) THEN access_state='expired'; END IF;
 IF public.rooms_is_suspended(p_actor) THEN access_state='suspended'; reason='ACCOUNT_SUSPENDED'; allowed=false;
 ELSIF EXISTS(SELECT 1 FROM public.room_bans WHERE membership_id=m.id AND revoked_at IS NULL) THEN access_state='banned'; reason='ROOM_BANNED'; allowed=false;
 ELSIF public.rooms_member_live(m,p_now) THEN allowed=true;
 ELSIF public.rooms_effective_status(r,p_now)<>'open' THEN access_state=public.rooms_effective_status(r,p_now); reason=upper('ROOM_'||access_state); allowed=false;
 ELSIF EXISTS(SELECT 1 FROM public.room_access_cutoffs c WHERE c.membership_id=m.id AND c.reason='remove' AND ((c.run_id IS NOT NULL AND c.run_id=r.current_run_id) OR (c.run_id IS NULL AND c.access_epoch=r.access_epoch))) THEN reason='REMOVED_FOR_RUN'; allowed=false;
 END IF;
 RETURN jsonb_build_object('roomId',p_room,'state',access_state,'canRejoin',allowed,'reason',reason,'isOwner',coalesce(r.owner_id=p_actor,false),
  'canEdit',coalesce(r.owner_id=p_actor AND public.rooms_effective_status(r,p_now)='open' AND NOT public.rooms_is_suspended(p_actor),false),
  'canClose',coalesce(r.owner_id=p_actor AND public.rooms_effective_status(r,p_now)='open' AND NOT public.rooms_is_suspended(p_actor),false));
END $$;
CREATE FUNCTION public.rooms_me_json(p_actor uuid,p_room uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.room_memberships%ROWTYPE; r public.rooms%ROWTYPE; member_json jsonb; member_status text;
BEGIN
 SELECT * INTO m FROM public.room_memberships WHERE user_id=p_actor
 ORDER BY (status='active') DESC,joined_at DESC,id DESC LIMIT 1;
 IF m.id IS NOT NULL THEN
  SELECT * INTO r FROM public.rooms WHERE id=m.room_id;
  member_status=m.status;
  IF m.status='active' AND NOT public.rooms_member_live(m,p_now) THEN member_status='expired'; END IF;
  member_json=jsonb_build_object('id',m.id,'roomId',m.room_id,'status',member_status,'version',m.version,
   'deviceId',m.device_id,'controlVersion',m.control_version,'lastSeenAt',m.last_seen_at,'seatExpiresAt',m.last_seen_at+interval '180 seconds',
   'joinedAt',m.joined_at,'visibilityVersion',m.visibility_version,'intent',m.intent,'isOwner',coalesce(r.owner_id=p_actor,false),
   'isHost',coalesce(r.current_host_membership_id=m.id,false));
 END IF;
 RETURN jsonb_build_object('accountId',p_actor,'revision',coalesce((SELECT revision FROM public.room_accounts WHERE user_id=p_actor),0),
 'serverTime',p_now,'membership',member_json,'room',public.rooms_public_json(m.room_id,p_now),
 'requestedAccess',CASE WHEN p_room IS NULL THEN NULL ELSE public.rooms_access_json(p_actor,p_room,p_now) END,
 'timeRevision',coalesce((SELECT revision FROM public.time_accounts WHERE user_id=p_actor),0),
 'activeTimeSessionId',(SELECT id FROM public.time_sessions WHERE user_id=p_actor AND status IN ('running','paused','needsReview')),
 'canModerate',public.rooms_is_moderator(p_actor));
END $$;
