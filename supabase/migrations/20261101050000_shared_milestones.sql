-- Explicit, revocable course milestones. Sharing never creates time or ranking credit.
CREATE TABLE public.shared_milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 scope_id text NOT NULL REFERENCES public.comparison_scopes(id),
 audience text NOT NULL DEFAULT 'accepted-followers' CHECK(audience='accepted-followers'),
 revision integer NOT NULL DEFAULT 1,
 published_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 UNIQUE(user_id,scope_id)
);
CREATE TABLE public.milestone_encouragements (
 milestone_id uuid REFERENCES public.shared_milestones(id) ON DELETE CASCADE,
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(milestone_id,user_id)
);
CREATE INDEX milestone_encouragement_daily ON public.milestone_encouragements(user_id,created_at);
CREATE TABLE public.milestone_operations (
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 operation_id uuid, command jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE public.shared_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_encouragements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_milestones,public.milestone_encouragements,public.milestone_operations FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.milestone_eligible(p_user uuid,p_scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.social_active(p_user) AND EXISTS(
 SELECT 1 FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id AND o.current_version_id=s.version_id
 WHERE s.id=p_scope AND o.status='published' AND s.required_weight>0 AND public.social_scope_comparable(s.id)
 AND public.social_enrolled(p_user,o.id) AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(s.tasks) t WHERE NOT EXISTS(
 SELECT 1 FROM public.first_credit_claims c WHERE c.user_id=p_user AND c.lineage_id=t->>'lineageId' AND c.active)))
$$;
CREATE FUNCTION public.milestone_visible(p_viewer uuid,p_milestone uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.social_active(p_viewer) AND EXISTS(SELECT 1 FROM public.shared_milestones m
 WHERE m.id=p_milestone AND m.revoked_at IS NULL AND public.milestone_eligible(m.user_id,m.scope_id)
 AND public.social_peer(p_viewer,m.user_id) AND (p_viewer=m.user_id OR EXISTS(
 SELECT 1 FROM public.follow_relationships r WHERE r.follower_id=p_viewer AND r.subject_id=m.user_id AND r.status='accepted')))
$$;
CREATE FUNCTION public.read_milestones() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 SELECT jsonb_build_object('candidates',coalesce((SELECT jsonb_agg(x) FROM (
 SELECT s.id AS "scopeId",v.snapshot->>'title' AS title,coalesce(m.revision,0) AS revision,m.id AS "milestoneId",(m.revoked_at IS NULL AND m.id IS NOT NULL) AS published
 FROM public.comparison_scopes s JOIN public.curriculum_versions v ON v.id=s.version_id LEFT JOIN public.shared_milestones m ON m.scope_id=s.id AND m.user_id=actor
 WHERE public.milestone_eligible(actor,s.id) ORDER BY s.id LIMIT 100) x),'[]'::jsonb),
 'mine',coalesce((SELECT jsonb_agg(x) FROM (
 SELECT m.id,m.scope_id AS "scopeId",v.snapshot->>'title' AS title,m.revision,m.published_at AS "publishedAt",m.revoked_at AS "revokedAt",public.milestone_eligible(actor,m.scope_id) AS eligible
 FROM public.shared_milestones m JOIN public.comparison_scopes s ON s.id=m.scope_id JOIN public.curriculum_versions v ON v.id=s.version_id WHERE m.user_id=actor ORDER BY m.published_at DESC LIMIT 100) x),'[]'::jsonb),
 'feed',coalesce((SELECT jsonb_agg(x) FROM (
 SELECT m.id,m.user_id AS "profileId",p.display_name AS "displayName",v.snapshot->>'title' AS title,m.published_at AS "publishedAt",
 (SELECT count(*) FROM public.milestone_encouragements e WHERE e.milestone_id=m.id AND public.social_peer(actor,e.user_id)) AS encouragements,
 EXISTS(SELECT 1 FROM public.milestone_encouragements e WHERE e.milestone_id=m.id AND e.user_id=actor) AS encouraged
 FROM public.shared_milestones m JOIN public.account_profiles p ON p.user_id=m.user_id JOIN public.comparison_scopes s ON s.id=m.scope_id JOIN public.curriculum_versions v ON v.id=s.version_id
 WHERE public.milestone_visible(actor,m.id) ORDER BY m.published_at DESC,m.id LIMIT 50) x),'[]'::jsonb),
 'verifiedAt',statement_timestamp()) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.preview_milestone(p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF NOT public.milestone_eligible(actor,p_scope) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
 SELECT jsonb_build_object('scopeId',s.id,'title',v.snapshot->>'title','displayName',p.display_name,'audience','accepted-followers','revision',coalesce(m.revision,0),'workspaceRevision',w.revision,'previewToken',md5(s.id||':'||w.revision::text||':'||coalesce(m.revision,0)::text||':'||p.revision::text),'followerCount',(SELECT count(*) FROM public.follow_relationships r WHERE r.subject_id=actor AND r.status='accepted' AND public.social_peer(actor,r.follower_id))) INTO result
 FROM public.comparison_scopes s JOIN public.curriculum_versions v ON v.id=s.version_id JOIN public.account_profiles p ON p.user_id=actor JOIN public.learning_workspaces w ON w.user_id=actor LEFT JOIN public.shared_milestones m ON m.user_id=actor AND m.scope_id=s.id WHERE s.id=p_scope;
 RETURN result;
END $$;
CREATE FUNCTION public.execute_milestone(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op uuid:=(p_command->>'operationId')::uuid; kind text:=p_command->>'type'; previous jsonb; m public.shared_milestones%ROWTYPE; preview jsonb; target uuid;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF op IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 SELECT command INTO previous FROM public.milestone_operations WHERE user_id=actor AND operation_id=op;
 IF FOUND THEN
  IF previous<>p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409';END IF;
  RETURN jsonb_build_object('data',public.read_milestones(),'replayed',true);
 END IF;
 IF (SELECT count(*) FROM public.milestone_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';END IF;
 IF kind='publish' THEN
  IF p_command->>'audience' IS DISTINCT FROM 'accepted-followers' OR p_command->'acknowledgeSharing' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CONSENT_REQUIRED' USING ERRCODE='PT422';END IF;
  PERFORM 1 FROM public.learning_workspaces WHERE user_id=actor FOR SHARE;
  preview=public.preview_milestone(p_command->>'scopeId');
  IF preview IS NULL OR preview->>'previewToken' IS DISTINCT FROM p_command->>'previewToken' THEN RAISE EXCEPTION 'PREVIEW_CHANGED' USING ERRCODE='PT409';END IF;
  INSERT INTO public.shared_milestones(user_id,scope_id) VALUES(actor,p_command->>'scopeId')
  ON CONFLICT(user_id,scope_id) DO UPDATE SET revoked_at=NULL,published_at=CASE WHEN shared_milestones.revoked_at IS NULL THEN shared_milestones.published_at ELSE now() END,revision=shared_milestones.revision+1;
 ELSIF kind='revoke' THEN
  UPDATE public.shared_milestones SET revoked_at=coalesce(revoked_at,now()),revision=revision+1 WHERE id=(p_command->>'milestoneId')::uuid AND user_id=actor AND revision=(p_command->>'expectedRevision')::integer;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='encourage' THEN
  target=(p_command->>'milestoneId')::uuid;
  SELECT * INTO m FROM public.shared_milestones WHERE id=target FOR UPDATE;
  IF NOT FOUND OR m.user_id=actor OR NOT public.milestone_visible(actor,target) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.milestone_encouragements WHERE milestone_id=target AND user_id=actor) THEN
   IF (SELECT count(*) FROM public.milestone_encouragements WHERE user_id=actor AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=20 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';END IF;
   INSERT INTO public.milestone_encouragements(milestone_id,user_id) VALUES(target,actor);
  END IF;
 ELSE RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 INSERT INTO public.milestone_operations(user_id,operation_id,command) VALUES(actor,op,p_command);
 RETURN jsonb_build_object('data',public.read_milestones(),'operationId',op);
END $$;
REVOKE ALL ON FUNCTION public.milestone_eligible(uuid,text),public.milestone_visible(uuid,uuid),public.read_milestones(),public.preview_milestone(text),public.execute_milestone(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_milestones(),public.preview_milestone(text),public.execute_milestone(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
