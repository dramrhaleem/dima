-- Named curriculum positions are a separate, explicit per-version sharing choice.
-- No raw learning workspace is exposed. Reading never creates a preference.
CREATE TABLE public.course_live_sharing (
  user_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
  scope_id text NOT NULL REFERENCES public.comparison_scopes(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,scope_id)
);
CREATE INDEX course_live_visible_scope ON public.course_live_sharing(scope_id,user_id) WHERE enabled;
ALTER TABLE public.course_live_sharing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_live_sharing FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.course_live_enrolled(p_user uuid,p_offering text,p_version text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.learning_workspaces w
 CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e
 WHERE w.user_id=p_user AND e->>'offeringId'=p_offering AND e->'snapshot'->>'version'=p_version)
$$;
REVOKE ALL ON FUNCTION public.course_live_enrolled(uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.read_course_live(p_offering text,p_version text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();scope_row public.comparison_scopes%ROWTYPE;snapshot jsonb;
 pref public.course_live_sharing%ROWTYPE;ranking_enabled boolean;available boolean;result jsonb;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 SELECT s.* INTO scope_row FROM public.comparison_scopes s
 JOIN public.curriculum_versions v ON v.id=s.version_id
 WHERE s.offering_id=p_offering AND v.version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT v.snapshot INTO snapshot FROM public.curriculum_versions v WHERE v.id=scope_row.version_id;
 SELECT * INTO pref FROM public.course_live_sharing WHERE user_id=actor AND scope_id=scope_row.id;
 available=public.social_scope_comparable(scope_row.id) AND public.course_live_enrolled(actor,p_offering,p_version);
 ranking_enabled=coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_row.id),public.social_board_eligible(actor,scope_row.id));
 IF NOT available AND pref.user_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 result=jsonb_build_object('accountId',actor,'offeringId',p_offering,'version',p_version,'scopeId',scope_row.id,'title',snapshot->>'title',
 'calculatedAt',statement_timestamp(),'refreshAfterSeconds',15,'sharing',jsonb_build_object('enabled',coalesce(pref.enabled,false),'revision',coalesce(pref.revision,0),'rankingEnabled',ranking_enabled),
 'rows','[]'::jsonb,'totalParticipants',0,'truncated',false);
 IF NOT available THEN RETURN result||jsonb_build_object('unavailable',true);END IF;

 WITH task_map AS MATERIALIZED (
  SELECT t->>'id' task_id,t->>'title' task_title,m->>'id' module_id,m->>'title' module_title,
   co,mo,ta,(st->>'weight')::numeric weight
  FROM jsonb_array_elements(snapshot->'courses') WITH ORDINALITY cs(c,co)
  CROSS JOIN LATERAL jsonb_array_elements(c->'modules') WITH ORDINALITY ms(m,mo)
  CROSS JOIN LATERAL jsonb_array_elements(m->'tasks') WITH ORDINALITY ts(t,ta)
  JOIN LATERAL jsonb_array_elements(scope_row.tasks) st ON st->>'taskId'=t->>'id'
 ), eligible AS MATERIALIZED (
  SELECT p.user_id,p.display_name,e.enrollment
  FROM public.course_live_sharing consent
  JOIN public.account_profiles p ON p.user_id=consent.user_id
  JOIN public.learning_workspaces w ON w.user_id=p.user_id
  CROSS JOIN LATERAL (SELECT value enrollment FROM jsonb_array_elements(w.state->'enrollments')
    WHERE value->>'offeringId'=p_offering AND value->'snapshot'->>'version'=p_version LIMIT 1) e
  LEFT JOIN public.ranking_participation rp ON rp.user_id=p.user_id AND rp.scope_id=scope_row.id
  WHERE consent.scope_id=scope_row.id AND consent.enabled AND public.social_peer(actor,p.user_id)
   AND coalesce(rp.enabled,public.social_board_eligible(p.user_id,scope_row.id))
 ), chosen AS MATERIALIZED (
  SELECT * FROM eligible ORDER BY (user_id=actor) DESC,user_id LIMIT 100
 ), completed AS MATERIALIZED (
  SELECT p.user_id,t.*,c.value completion
  FROM chosen p CROSS JOIN LATERAL jsonb_array_elements(p.enrollment->'completions') c
  JOIN task_map t ON t.task_id=c.value->>'taskId'
  WHERE (c.value->>'completed')::boolean AND p.enrollment->'taskIds' ? t.task_id
 ), members AS (
  SELECT p.user_id,jsonb_build_object('profileId',p.user_id,'displayName',p.display_name,'avatarUrl',public.profile_avatar_url(p.user_id),
   'percent',round(100*coalesce((SELECT sum(weight) FROM completed c WHERE c.user_id=p.user_id),0)/scope_row.required_weight,1),
   'completedCount',(SELECT count(*) FROM completed c WHERE c.user_id=p.user_id),'totalCount',(SELECT count(*) FROM task_map),
   'modules',(SELECT coalesce(jsonb_agg(jsonb_build_object('moduleId',module_id,'completedCount',done,'totalCount',total) ORDER BY co,mo),'[]')
    FROM (SELECT t.module_id,min(t.co) co,min(t.mo) mo,count(*) total,count(c.task_id) done FROM task_map t
    LEFT JOIN completed c ON c.user_id=p.user_id AND c.task_id=t.task_id GROUP BY t.module_id) groups),
   'latest',(SELECT jsonb_build_object('taskId',c.task_id,'taskTitle',c.task_title,'moduleId',c.module_id,'moduleTitle',c.module_title,
     'completedAt',coalesce(c.completion->>'firstCompletedAt',c.completion->>'completedAt'),'kind',c.completion->>'kind')
    FROM completed c WHERE c.user_id=p.user_id AND coalesce(c.completion->>'firstCompletedAt',c.completion->>'completedAt') IS NOT NULL
    ORDER BY coalesce(c.completion->>'firstCompletedAt',c.completion->>'completedAt') DESC,c.co DESC,c.mo DESC,c.ta DESC LIMIT 1)) item
  FROM chosen p
 ) SELECT result||jsonb_build_object('rows',coalesce((SELECT jsonb_agg(item ORDER BY (user_id=actor) DESC,user_id) FROM members),'[]'),
  'totalParticipants',(SELECT count(*) FROM eligible),'truncated',(SELECT count(*)>100 FROM eligible)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_course_live(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_course_live(text,text) TO authenticated;

CREATE FUNCTION public.execute_course_live(p_offering text,p_version text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();scope_key text;expected integer;op uuid;old_command jsonb;payload jsonb;next_enabled boolean;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 IF jsonb_typeof(p_command)<>'object' OR NOT (p_command ?& ARRAY['type','enabled','expectedRevision','operationId']) OR p_command->>'type'<>'setCourseLiveSharing'
 OR jsonb_typeof(p_command->'enabled')<>'boolean' OR jsonb_typeof(p_command->'expectedRevision')<>'number'
 OR (SELECT count(*) FROM jsonb_object_keys(p_command))<>4 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 BEGIN expected=(p_command->>'expectedRevision')::integer;op=(p_command->>'operationId')::uuid;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END;
 IF expected IS NULL OR expected<0 OR expected>2147483646 OR op IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 next_enabled=(p_command->>'enabled')::boolean;
 SELECT s.id INTO scope_key FROM public.comparison_scopes s JOIN public.curriculum_versions v ON v.id=s.version_id WHERE s.offering_id=p_offering AND v.version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 payload=p_command||jsonb_build_object('offeringId',p_offering,'version',p_version);
 SELECT command INTO old_command FROM public.social_operations WHERE user_id=actor AND operation_id=op;
 IF FOUND THEN
  IF old_command IS DISTINCT FROM payload THEN RAISE EXCEPTION 'OPERATION_REUSED' USING ERRCODE='PT409';END IF;
  RETURN jsonb_build_object('data',public.read_course_live(p_offering,p_version),'operationId',op,'replayed',true);
 END IF;
 IF next_enabled AND (NOT public.social_scope_comparable(scope_key) OR NOT public.course_live_enrolled(actor,p_offering,p_version)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF NOT next_enabled AND NOT EXISTS(SELECT 1 FROM public.course_live_sharing WHERE user_id=actor AND scope_id=scope_key)
 AND (NOT public.social_scope_comparable(scope_key) OR NOT public.course_live_enrolled(actor,p_offering,p_version)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.course_live_sharing(user_id,scope_id) VALUES(actor,scope_key) ON CONFLICT DO NOTHING;
 UPDATE public.course_live_sharing SET enabled=next_enabled,revision=revision+1,updated_at=statement_timestamp()
 WHERE user_id=actor AND scope_id=scope_key AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 INSERT INTO public.social_operations(user_id,operation_id,command) VALUES(actor,op,payload);
 RETURN jsonb_build_object('data',public.read_course_live(p_offering,p_version),'operationId',op);
END $$;
REVOKE ALL ON FUNCTION public.execute_course_live(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_course_live(text,text,jsonb) TO authenticated;

-- Include explicit per-course companion sharing in owner exports.
CREATE OR REPLACE FUNCTION public.export_own_account() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  ('courseLiveSharing','course_live_sharing','user_id'),
  ('profilePreferences','profile_preferences','user_id'),('rhythmGoals','rhythm_goal_versions','user_id'),
  ('sharedMilestones','shared_milestones','user_id'),('encouragements','milestone_encouragements','user_id'),
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
