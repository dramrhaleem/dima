-- Separate public-link consent; existing signed-in discoverability never becomes anonymous consent.
CREATE TABLE public.profile_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 handle text UNIQUE CHECK(handle IS NULL OR handle ~ '^[a-z][a-z0-9-]{2,29}$'),
 public_link boolean NOT NULL DEFAULT false,
 public_bio text NOT NULL DEFAULT '' CHECK(length(public_bio)<=280),
 CHECK(NOT public_link OR handle IS NOT NULL)
);
CREATE TABLE public.rhythm_goal_versions (
 user_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 effective_week date NOT NULL,
 days integer CHECK(days BETWEEN 1 AND 7),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,effective_week)
);
ALTER TABLE public.profile_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rhythm_goal_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_preferences, public.rhythm_goal_versions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.read_profile_settings(p_week date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); prefs public.profile_preferences%ROWTYPE;
 week_start date:=(date_trunc('week',now() AT TIME ZONE 'UTC'))::date; selected_week date;
 current_goal jsonb;next_goal jsonb;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 selected_week=coalesce(p_week,week_start);
 SELECT * INTO prefs FROM public.profile_preferences WHERE user_id=actor;
 SELECT jsonb_build_object('days',days,'effectiveWeek',effective_week) INTO current_goal FROM public.rhythm_goal_versions WHERE user_id=actor AND effective_week<=selected_week ORDER BY effective_week DESC LIMIT 1;
 SELECT jsonb_build_object('days',days,'effectiveWeek',effective_week) INTO next_goal FROM public.rhythm_goal_versions WHERE user_id=actor AND effective_week>week_start ORDER BY effective_week LIMIT 1;
 RETURN jsonb_build_object('accountId',actor,'revision',coalesce(prefs.revision,0),'handle',prefs.handle,'publicLink',coalesce(prefs.public_link,false),'bio',coalesce(prefs.public_bio,''),'currentGoal',current_goal,'nextGoal',next_goal,'nextEffectiveWeek',week_start+7);
END $$;
REVOKE ALL ON FUNCTION public.read_profile_settings(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_profile_settings(date) TO authenticated;

CREATE FUNCTION public.execute_profile_settings(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();kind text:=p_command->>'type';expected integer;op uuid;old_command jsonb;new_handle text;new_days integer;week_start date:=(date_trunc('week',now() AT TIME ZONE 'UTC'))::date;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 BEGIN expected=(p_command->>'expectedRevision')::integer;op=(p_command->>'operationId')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END;
 IF expected IS NULL OR expected<0 OR op IS NULL OR kind NOT IN ('setPublicLink','setRhythmGoal') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 SELECT command INTO old_command FROM public.social_operations WHERE user_id=actor AND operation_id=op;
 IF FOUND THEN
  IF old_command<>p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409';END IF;
  RETURN jsonb_build_object('data',public.read_profile_settings(),'replayed',true);
 END IF;
 IF (SELECT count(*) FROM public.social_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';END IF;
 INSERT INTO public.profile_preferences(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 UPDATE public.profile_preferences SET revision=revision+1 WHERE user_id=actor AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF kind='setPublicLink' THEN
  new_handle=nullif(lower(trim(p_command->>'handle')),'');
  IF jsonb_typeof(p_command->'publicLink') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_command->'bio') IS DISTINCT FROM 'string' OR length(p_command->>'bio')>280
   OR (new_handle IS NOT NULL AND (new_handle !~ '^[a-z][a-z0-9-]{2,29}$' OR new_handle=ANY(ARRAY['admin','administrator','support','dima','api','auth','account','settings','privacy','terms','help','moderator','root','system','library','rooms','www'])))
   OR ((p_command->>'publicLink')::boolean AND (new_handle IS NULL OR p_command->>'consentVersion' IS DISTINCT FROM '1')) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
  BEGIN
   UPDATE public.profile_preferences SET handle=new_handle,public_link=(p_command->>'publicLink')::boolean,public_bio=p_command->>'bio' WHERE user_id=actor;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'HANDLE_UNAVAILABLE' USING ERRCODE='PT409';END;
 ELSE
  IF p_command->'days' IS NULL OR jsonb_typeof(p_command->'days') NOT IN ('number','null') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
  IF p_command->'days'<>'null'::jsonb THEN
   IF (p_command->>'days')!~ '^[1-7]$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
   new_days=(p_command->>'days')::integer;
  END IF;
  INSERT INTO public.rhythm_goal_versions(user_id,effective_week,days) VALUES(actor,week_start+7,new_days)
  ON CONFLICT(user_id,effective_week) DO UPDATE SET days=excluded.days,updated_at=now();
 END IF;
 INSERT INTO public.social_operations(user_id,operation_id,command) VALUES(actor,op,p_command);
 RETURN jsonb_build_object('data',public.read_profile_settings(),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.execute_profile_settings(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_profile_settings(jsonb) TO authenticated;

CREATE FUNCTION public.read_public_profile(p_handle text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('handle',s.handle,'displayName',p.display_name,'bio',s.public_bio) INTO result
 FROM public.profile_preferences s JOIN public.account_profiles p USING(user_id)
 WHERE s.handle=lower(p_handle) AND s.public_link AND public.social_peer(auth.uid(),s.user_id);
 IF result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_public_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_public_profile(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.read_progress_time(p_start timestamptz,p_end timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();result jsonb;tz text;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '32 days' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 tz='UTC'; -- Rhythm uses the same UTC week boundaries as Progress and saved goals.
 WITH periods AS (SELECT s.category,s.status,i.source,i.eligibility,greatest(i.start_at,p_start) begin_at,least(coalesce(i.effective_end_at,i.end_at,least(i.boundary_at,statement_timestamp())),p_end) end_at FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id WHERE i.user_id=actor AND i.start_at<p_end AND coalesce(i.effective_end_at,i.end_at,i.boundary_at)>p_start),
 totals AS (SELECT *,greatest(0,extract(epoch FROM end_at-begin_at)) seconds FROM periods)
 SELECT jsonb_build_object('learningSeconds',coalesce(sum(seconds) FILTER(WHERE category='learning'),0),'workSeconds',coalesce(sum(seconds) FILTER(WHERE category='work'),0),'timerSeconds',coalesce(sum(seconds) FILTER(WHERE source='server'),0),'manualSeconds',coalesce(sum(seconds) FILTER(WHERE source='manual'),0),'pendingSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='pending' OR status<>'finalized'),0),'eligibleSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='eligible' AND status='finalized'),0),
 'activeDays',coalesce((SELECT jsonb_agg(day_label) FROM (SELECT to_char(d,'YYYY-MM-DD') AS day_label FROM generate_series((p_start AT TIME ZONE tz)::date::timestamp,((p_end-interval '1 microsecond') AT TIME ZONE tz)::date::timestamp,interval '1 day') d CROSS JOIN periods i WHERE i.status='finalized' AND i.eligibility<>'pending' GROUP BY d HAVING sum(greatest(0,extract(epoch FROM least(i.end_at,(d+interval '1 day') AT TIME ZONE tz)-greatest(i.begin_at,d AT TIME ZONE tz))))>=600) q),'[]')) INTO result FROM totals;
 RETURN result;
END $$;
