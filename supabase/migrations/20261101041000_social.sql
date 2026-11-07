-- B6: current-policy social reads, opt-in boards, one existing time ledger.
CREATE TABLE public.social_settings (
 user_id uuid PRIMARY KEY REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0, public_profile boolean NOT NULL DEFAULT false,
 bio text NOT NULL DEFAULT '' CHECK(length(bio)<=280),allow_follow boolean NOT NULL DEFAULT false,
 weekly_time boolean NOT NULL DEFAULT false,course_progress boolean NOT NULL DEFAULT false
);
CREATE TABLE public.people_visibility (
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 offering_id text REFERENCES public.catalog_offerings(id),visible boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,offering_id)
);
CREATE TABLE public.ranking_participation (
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 scope_id text NOT NULL,enabled boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,scope_id)
);
CREATE TABLE public.follow_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),follower_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 subject_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled','revoked')),revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(follower_id,subject_id),CHECK(follower_id<>subject_id)
);
CREATE INDEX follow_incoming ON public.follow_relationships(subject_id,status);
CREATE TABLE public.social_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,
 type text NOT NULL CHECK(type IN ('follow-request','follow-accepted')),relationship_id uuid REFERENCES public.follow_relationships(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz
);
CREATE INDEX social_notification_owner ON public.social_notifications(user_id,created_at DESC,id);
CREATE TABLE public.social_operations (
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,operation_id uuid,command jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE public.first_credit_claims (
 user_id uuid REFERENCES public.account_profiles(user_id) ON DELETE CASCADE,lineage_id text NOT NULL,
 accepted_at timestamptz NOT NULL,baseline boolean NOT NULL,active boolean NOT NULL,PRIMARY KEY(user_id,lineage_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['social_settings','people_visibility','ranking_participation','follow_relationships','social_notifications','social_operations','first_credit_claims'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
-- No inherited anonymous public profile table path can bypass viewer blocks.
REVOKE SELECT ON public.public_profiles FROM anon,authenticated;
CREATE FUNCTION public.social_active(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_profiles WHERE user_id=p_user AND onboarded)
 AND NOT EXISTS(SELECT 1 FROM public.account_suspensions WHERE user_id=p_user AND revoked_at IS NULL AND effective_at<=now())
$$;
CREATE FUNCTION public.social_peer(p_viewer uuid,p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.social_active(p_target) AND NOT EXISTS(SELECT 1 FROM public.user_blocks WHERE revoked_at IS NULL AND ((blocker_id=p_viewer AND blocked_id=p_target)OR(blocker_id=p_target AND blocked_id=p_viewer)))
$$;
CREATE FUNCTION public.social_enrolled(p_user uuid,p_offering text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e WHERE w.user_id=p_user AND e->>'offeringId'=p_offering)
$$;
CREATE FUNCTION public.social_project_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN NEW;END $$;
CREATE TRIGGER social_credit_projection AFTER INSERT OR UPDATE OF state ON public.learning_workspaces FOR EACH ROW EXECUTE FUNCTION public.social_project_credits();
-- Backfill preserves prior claims and accepted timestamps; never invents current-week credit.
INSERT INTO public.first_credit_claims(user_id,lineage_id,accepted_at,baseline,active)
 SELECT w.user_id,(e->>'offeringId')||':'||(c->>'taskId'),coalesce(min((c->>'firstCompletedAt')::timestamptz),w.updated_at),bool_or(c->>'kind'='prior'),bool_or(coalesce((c->>'completed')::boolean,false))
 FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e CROSS JOIN LATERAL jsonb_array_elements(e->'completions') c
 WHERE c->>'firstCompletedAt' IS NOT NULL OR coalesce((c->>'completed')::boolean,false)
 GROUP BY w.user_id,w.updated_at,e->>'offeringId',c->>'taskId' ON CONFLICT DO NOTHING;
CREATE FUNCTION public.social_block_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.revoked_at IS NULL THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(least(NEW.blocker_id::text,NEW.blocked_id::text)||':'||greatest(NEW.blocker_id::text,NEW.blocked_id::text),42));
 UPDATE public.follow_relationships SET status='revoked',revision=revision+1,updated_at=now()
 WHERE status IN ('pending','accepted') AND ((follower_id=NEW.blocker_id AND subject_id=NEW.blocked_id)OR(follower_id=NEW.blocked_id AND subject_id=NEW.blocker_id)); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_block_revoke AFTER INSERT OR UPDATE ON public.user_blocks FOR EACH ROW EXECUTE FUNCTION public.social_block_revoke();
CREATE FUNCTION public.read_social(p_view text,p_key text DEFAULT NULL,p_period text DEFAULT 'week',p_category text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();result jsonb;start_at timestamptz;end_at timestamptz;scope_key text;denominator numeric;target uuid;settings public.social_settings%ROWTYPE;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF p_period NOT IN ('week','month','overall') OR p_category NOT IN ('all','learning','work') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 start_at=date_trunc(CASE WHEN p_period='month' THEN 'month' ELSE 'week' END,now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 end_at=start_at+CASE WHEN p_period='month' THEN interval '1 month' ELSE interval '7 days' END;
 IF p_view='sharing' THEN
 SELECT * INTO settings FROM public.social_settings WHERE user_id=actor;
 RETURN jsonb_build_object('revision',coalesce(settings.revision,0),'publicProfile',coalesce(settings.public_profile,false),'bio',coalesce(settings.bio,''),'allowFollow',coalesce(settings.allow_follow,false),'weeklyTime',coalesce(settings.weekly_time,false),'courseProgress',coalesce(settings.course_progress,false));
 ELSIF p_view='circle' THEN
 SELECT jsonb_build_object('incoming',coalesce(jsonb_agg(item) FILTER(WHERE subject_id=actor AND status='pending'),'[]'),'outgoing',coalesce(jsonb_agg(item) FILTER(WHERE follower_id=actor AND status='pending'),'[]'),'following',coalesce(jsonb_agg(item) FILTER(WHERE follower_id=actor AND status='accepted'),'[]'),'followers',coalesce(jsonb_agg(item) FILTER(WHERE subject_id=actor AND status='accepted'),'[]')) INTO result FROM
 (SELECT r.subject_id,r.follower_id,r.status,jsonb_build_object('id',r.id,'profileId',p.user_id,'displayName',p.display_name,'status',r.status,'revision',r.revision) item FROM public.follow_relationships r JOIN public.account_profiles p ON p.user_id=CASE WHEN r.subject_id=actor THEN r.follower_id ELSE r.subject_id END
 WHERE (r.subject_id=actor OR r.follower_id=actor) AND r.status IN ('pending','accepted') AND public.social_peer(actor,p.user_id) ORDER BY r.updated_at DESC,r.id LIMIT 200) q;
 RETURN result;
 ELSIF p_view='people' THEN
 IF NOT public.social_enrolled(actor,p_key) OR NOT EXISTS(SELECT 1 FROM public.catalog_offerings WHERE id=p_key AND status='published') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('profileId',user_id,'displayName',display_name)) FROM (SELECT p.user_id,p.display_name FROM public.people_visibility v JOIN public.account_profiles p USING(user_id) WHERE v.offering_id=p_key AND v.visible AND public.social_peer(actor,p.user_id) AND public.social_enrolled(p.user_id,p_key) ORDER BY p.user_id LIMIT 50) q),'[]'),
 'visible',coalesce((SELECT visible FROM public.people_visibility WHERE user_id=actor AND offering_id=p_key),false),'revision',coalesce((SELECT revision FROM public.people_visibility WHERE user_id=actor AND offering_id=p_key),0));
 ELSIF p_view='blocks' THEN
 RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'profileId',blocked_id)) FROM (SELECT id,blocked_id FROM public.user_blocks WHERE blocker_id=actor AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100) q),'[]'));
 ELSIF p_view='notifications' THEN
 RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'type',type,'targetId',CASE WHEN available THEN relationship_id END,'available',available,'createdAt',created_at,'readAt',read_at)) FROM
 (SELECT n.*,coalesce(r.status IN ('pending','accepted') AND public.social_peer(actor,CASE WHEN r.subject_id=actor THEN r.follower_id ELSE r.subject_id END),false) available FROM public.social_notifications n LEFT JOIN public.follow_relationships r ON r.id=n.relationship_id WHERE n.user_id=actor ORDER BY n.created_at DESC,n.id LIMIT 50) q),'[]'));
 ELSIF p_view IN ('time','course') THEN
 scope_key=CASE WHEN p_view='time' THEN 'time' ELSE p_key END;
 IF p_view='course' THEN
 SELECT s.required_weight INTO denominator FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id WHERE s.id=p_key AND o.status='published';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 END IF;
 WITH scores AS (
 SELECT p.user_id,p.display_name,CASE WHEN p_view='time' THEN coalesce((SELECT sum(greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at),end_at)-greatest(i.start_at,start_at))))
 FROM public.time_intervals i JOIN public.time_sessions ts ON ts.id=i.session_id WHERE i.user_id=p.user_id AND ts.status='finalized' AND i.source='server' AND i.eligibility='eligible' AND i.end_at IS NOT NULL AND i.start_at<end_at AND i.end_at>start_at AND (p_category='all' OR ts.category=p_category)),0)
 ELSE coalesce((SELECT sum((task->>'weight')::numeric) FROM public.comparison_scopes s CROSS JOIN LATERAL jsonb_array_elements(s.tasks) task JOIN public.first_credit_claims c ON c.user_id=p.user_id AND c.lineage_id=task->>'lineageId' AND c.active WHERE s.id=p_key AND (p_period='overall' OR (NOT c.baseline AND c.accepted_at>=start_at AND c.accepted_at<end_at))),0) END score
 FROM public.ranking_participation rp JOIN public.account_profiles p USING(user_id) WHERE rp.scope_id=scope_key AND rp.enabled AND public.social_peer(actor,p.user_id) AND (p_view='time' OR denominator>0)
 ), ranked AS (SELECT *,rank() OVER(ORDER BY score DESC) rank FROM scores)
 SELECT coalesce(jsonb_agg(jsonb_build_object('profileId',user_id,'displayName',display_name,'score',score,'rank',rank) ORDER BY rank,user_id),'[]') INTO result FROM (SELECT * FROM ranked ORDER BY rank,user_id LIMIT 50) q;
 RETURN jsonb_build_object('scope',scope_key,'scoringVersion','weighted-v1','window',CASE WHEN p_period='overall' THEN NULL ELSE jsonb_build_object('start',start_at,'end',end_at) END,'calculatedAt',statement_timestamp(),'generation',statement_timestamp()::text,'correctedAt',NULL,'unit',CASE WHEN p_view='time' THEN 'seconds' ELSE 'weight' END,'requiredWeight',denominator,'rows',result,
 'participation',jsonb_build_object('enabled',coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),false),'revision',coalesce((SELECT revision FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),0)),
 'scopes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'offeringId',offering_id,'title',title)) FROM (SELECT s.id,s.offering_id,v.snapshot->>'title' title FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id JOIN public.curriculum_versions v ON v.id=s.version_id WHERE o.status='published' ORDER BY s.id LIMIT 100) q),'[]'));
 ELSIF p_view IN ('profile','shared') THEN
 BEGIN target=p_key::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END;
 IF NOT public.social_peer(actor,target) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT * INTO settings FROM public.social_settings WHERE user_id=target;
 IF p_view='profile' AND NOT coalesce(settings.public_profile,false) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF p_view='shared' AND NOT EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=actor AND subject_id=target AND status='accepted') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT jsonb_build_object('profileId',user_id,'displayName',display_name,'bio',CASE WHEN settings.public_profile THEN settings.bio ELSE '' END,'visibilityRevision',settings.revision,'verifiedAt',statement_timestamp()) INTO result FROM public.account_profiles WHERE user_id=target;
 IF p_view='shared' AND settings.weekly_time THEN
 result=result||jsonb_build_object('weeklyTimeSeconds',(SELECT coalesce(sum(greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at),end_at)-greatest(i.start_at,start_at)))),0) FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id WHERE i.user_id=target AND s.status='finalized' AND i.end_at IS NOT NULL AND i.start_at<end_at AND i.end_at>start_at));
 END IF;
 IF p_view='shared' AND settings.course_progress THEN
 result=result||jsonb_build_object('courses',coalesce((SELECT jsonb_agg(jsonb_build_object('scopeId',id,'title',title,'requiredWeight',required_weight,'completedWeight',completed)) FROM
 (SELECT s.id,v.snapshot->>'title' title,s.required_weight,(SELECT coalesce(sum((task->>'weight')::numeric),0) FROM jsonb_array_elements(s.tasks) task JOIN public.first_credit_claims c ON c.lineage_id=task->>'lineageId' AND c.user_id=target AND c.active) completed FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id AND o.current_version_id=s.version_id JOIN public.curriculum_versions v ON v.id=s.version_id WHERE o.status='published' AND public.social_enrolled(target,o.id) LIMIT 20) q),'[]'));
 END IF;
 RETURN result;
 ELSE RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
END $$;
CREATE FUNCTION public.execute_social(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();kind text:=p_command->>'type';expected integer:=(p_command->>'expectedRevision')::integer;op uuid:=(p_command->>'operationId')::uuid;
 old_command jsonb;target uuid;rel public.follow_relationships%ROWTYPE;scope_key text;result jsonb;out_view text;out_key text;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 IF expected IS NULL OR expected<0 OR op IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 SELECT command INTO old_command FROM public.social_operations WHERE user_id=actor AND operation_id=op;
 IF FOUND AND old_command<>p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409';END IF;
 -- Replay returns newly authorized current DTOs, never a stored private snapshot.
 IF kind='setSharing' THEN out_view='sharing';
 ELSIF kind='setPeople' THEN out_view='people';out_key=p_command->>'offeringId';
 ELSIF kind='setParticipation' THEN out_view=CASE WHEN p_command->>'board'='time' THEN 'time' ELSE 'course' END;out_key=p_command->>'scopeId';
 ELSIF kind IN ('block','unblock') THEN out_view='blocks';
 ELSIF kind='readNotifications' THEN out_view='notifications';
 ELSE out_view='circle';END IF;
 IF old_command IS NOT NULL THEN RETURN jsonb_build_object('data',public.read_social(out_view,out_key),'replayed',true);END IF;
 IF (SELECT count(*) FROM public.social_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='PT429';END IF;
 IF kind='setSharing' THEN
 IF jsonb_typeof(p_command->'publicProfile')<>'boolean' OR jsonb_typeof(p_command->'allowFollow')<>'boolean' OR jsonb_typeof(p_command->'weeklyTime')<>'boolean' OR jsonb_typeof(p_command->'courseProgress')<>'boolean' OR length(p_command->>'bio')>280 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 INSERT INTO public.social_settings(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 UPDATE public.social_settings SET public_profile=(p_command->>'publicProfile')::boolean,bio=p_command->>'bio',allow_follow=(p_command->>'allowFollow')::boolean,weekly_time=(p_command->>'weeklyTime')::boolean,course_progress=(p_command->>'courseProgress')::boolean,revision=revision+1 WHERE user_id=actor AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='setPeople' THEN
 IF NOT public.social_enrolled(actor,out_key) OR NOT EXISTS(SELECT 1 FROM public.catalog_offerings WHERE id=out_key AND status='published') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.people_visibility(user_id,offering_id) VALUES(actor,out_key) ON CONFLICT DO NOTHING;
 UPDATE public.people_visibility SET visible=(p_command->>'visible')::boolean,revision=revision+1 WHERE user_id=actor AND offering_id=out_key AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='setParticipation' THEN
 IF p_command->>'board' NOT IN ('time','course') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 scope_key=CASE WHEN out_view='time' THEN 'time' ELSE out_key END;
 IF out_view='course' AND NOT EXISTS(SELECT 1 FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id WHERE s.id=scope_key AND o.status='published' AND s.required_weight>0 AND public.social_enrolled(actor,o.id)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.ranking_participation(user_id,scope_id) VALUES(actor,scope_key) ON CONFLICT DO NOTHING;
 UPDATE public.ranking_participation SET enabled=(p_command->>'enabled')::boolean,revision=revision+1 WHERE user_id=actor AND scope_id=scope_key AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='follow' THEN
 target=(p_command->>'targetId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(least(actor::text,target::text)||':'||greatest(actor::text,target::text),42));
 IF target=actor OR NOT public.social_peer(actor,target) OR NOT EXISTS(SELECT 1 FROM public.social_settings WHERE user_id=target AND allow_follow) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 -- A known ID alone is insufficient discovery: require independent visibility or an existing relationship.
 IF NOT EXISTS(SELECT 1 FROM public.social_settings WHERE user_id=target AND public_profile)
 AND NOT EXISTS(SELECT 1 FROM public.people_visibility v JOIN public.catalog_offerings o ON o.id=v.offering_id WHERE v.user_id=target AND v.visible AND o.status='published' AND public.social_enrolled(actor,o.id) AND public.social_enrolled(target,o.id))
 AND NOT EXISTS(SELECT 1 FROM public.ranking_participation WHERE user_id=target AND enabled)
 AND NOT EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=target AND subject_id=actor AND status='accepted')
 THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT * INTO rel FROM public.follow_relationships WHERE follower_id=actor AND subject_id=target FOR UPDATE;
 IF FOUND THEN
 IF rel.status IN ('pending','accepted') THEN RAISE EXCEPTION 'RELATIONSHIP_EXISTS' USING ERRCODE='PT409';END IF;
 -- Start-again uses revision zero because closed relationships are not exposed to callers.
 IF expected<>0 THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 UPDATE public.follow_relationships SET status='pending',revision=revision+1,updated_at=now() WHERE id=rel.id RETURNING * INTO rel;
 ELSE INSERT INTO public.follow_relationships(follower_id,subject_id,status) VALUES(actor,target,'pending') RETURNING * INTO rel; END IF;
 INSERT INTO public.social_notifications(user_id,type,relationship_id) VALUES(target,'follow-request',rel.id);
 ELSIF kind IN ('accept','decline','cancel','revoke') THEN
 SELECT * INTO rel FROM public.follow_relationships WHERE id=(p_command->>'relationshipId')::uuid;
 IF NOT FOUND OR actor NOT IN (rel.follower_id,rel.subject_id) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(least(rel.follower_id::text,rel.subject_id::text)||':'||greatest(rel.follower_id::text,rel.subject_id::text),42));
 SELECT * INTO rel FROM public.follow_relationships WHERE id=(p_command->>'relationshipId')::uuid FOR UPDATE;
 IF NOT FOUND OR actor NOT IN (rel.follower_id,rel.subject_id) OR NOT public.social_peer(actor,CASE WHEN rel.follower_id=actor THEN rel.subject_id ELSE rel.follower_id END) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF rel.revision<>expected THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF (kind IN ('accept','decline') AND (actor<>rel.subject_id OR rel.status<>'pending')) OR (kind='cancel' AND(actor<>rel.follower_id OR rel.status<>'pending')) OR(kind='revoke' AND rel.status<>'accepted') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 UPDATE public.follow_relationships SET status=CASE kind WHEN 'accept' THEN 'accepted' WHEN 'decline' THEN 'declined' WHEN 'cancel' THEN 'cancelled' ELSE 'revoked' END,revision=revision+1,updated_at=now() WHERE id=rel.id;
 IF kind='accept' THEN INSERT INTO public.social_notifications(user_id,type,relationship_id) VALUES(rel.follower_id,'follow-accepted',rel.id);END IF;
 ELSIF kind='block' THEN
 target=(p_command->>'targetId')::uuid;
 IF target=actor OR NOT EXISTS(SELECT 1 FROM public.account_profiles WHERE user_id=target) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.user_blocks(blocker_id,blocked_id,created_at) VALUES(actor,target,now()) ON CONFLICT(blocker_id,blocked_id) WHERE revoked_at IS NULL DO NOTHING;
 ELSIF kind='unblock' THEN
 UPDATE public.user_blocks SET revoked_at=now() WHERE id=(p_command->>'blockId')::uuid AND blocker_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 ELSIF kind='readNotifications' THEN
 IF jsonb_array_length(p_command->'ids') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 UPDATE public.social_notifications SET read_at=coalesce(read_at,now()) WHERE user_id=actor AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_command->'ids'));
 ELSE RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 INSERT INTO public.social_operations(user_id,operation_id,command) VALUES(actor,op,p_command);
 result=public.read_social(out_view,out_key);
 RETURN jsonb_build_object('data',result,'operationId',op);
END $$;
-- Private original IDs remain intact. Approval maps their claims to the stable public offering;
-- copying preserves the original timestamp/baseline, and subsequent Undo mirrors active state.
CREATE FUNCTION public.social_map_publication_claims(p_owner uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.first_credit_claims(user_id,lineage_id,accepted_at,baseline,active)
 SELECT DISTINCT c.user_id,r.offering_id||substring(c.lineage_id FROM length(r.draft_id)+1),c.accepted_at,c.baseline,c.active
 FROM public.first_credit_claims c JOIN (SELECT DISTINCT owner_id,draft_id,offering_id,snapshot FROM public.publication_requests WHERE status='approved' AND owner_id=p_owner) r ON r.owner_id=c.user_id AND starts_with(c.lineage_id,r.draft_id||':')
 WHERE EXISTS(SELECT 1 FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e
 CROSS JOIN LATERAL jsonb_array_elements(e->'snapshot'->'courses') ec CROSS JOIN LATERAL jsonb_array_elements(ec->'modules') em CROSS JOIN LATERAL jsonb_array_elements(em->'tasks') et
 CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'courses') pc CROSS JOIN LATERAL jsonb_array_elements(pc->'modules') pm CROSS JOIN LATERAL jsonb_array_elements(pm->'tasks') pt
 WHERE w.user_id=p_owner AND e->>'offeringId'=r.draft_id AND c.lineage_id=r.draft_id||':'||(et->>'id') AND et=pt)
 ON CONFLICT(user_id,lineage_id) DO UPDATE SET active=excluded.active
$$;
CREATE FUNCTION public.social_publication_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='approved' THEN PERFORM public.social_map_publication_claims(NEW.owner_id);END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_publication_credits AFTER INSERT OR UPDATE OF status ON public.publication_requests FOR EACH ROW EXECUTE FUNCTION public.social_publication_credits();
CREATE OR REPLACE FUNCTION public.social_project_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.first_credit_claims SET active=false WHERE user_id=NEW.user_id;
 INSERT INTO public.first_credit_claims(user_id,lineage_id,accepted_at,baseline,active)
 SELECT NEW.user_id,(e->>'offeringId')||':'||(c->>'taskId'),coalesce(min((c->>'firstCompletedAt')::timestamptz),statement_timestamp()),bool_or(c->>'kind'='prior'),bool_or(coalesce((c->>'completed')::boolean,false))
 FROM jsonb_array_elements(NEW.state->'enrollments') e CROSS JOIN LATERAL jsonb_array_elements(e->'completions') c
 WHERE c->>'firstCompletedAt' IS NOT NULL OR coalesce((c->>'completed')::boolean,false)
 GROUP BY e->>'offeringId',c->>'taskId'
 ON CONFLICT(user_id,lineage_id) DO UPDATE SET active=excluded.active;
 PERFORM public.social_map_publication_claims(NEW.user_id);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.social_enrolled(p_user uuid,p_offering text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e WHERE w.user_id=p_user AND (e->>'offeringId'=p_offering OR EXISTS(SELECT 1 FROM public.publication_requests r WHERE r.owner_id=p_user AND r.draft_id=e->>'offeringId' AND r.offering_id=p_offering AND r.status='approved')))
$$;
CREATE FUNCTION public.read_progress_time(p_start timestamptz,p_end timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();result jsonb;tz text;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '32 days' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 SELECT timezone INTO tz FROM public.account_profiles WHERE user_id=actor;
 WITH periods AS (SELECT s.category,s.status,i.source,i.eligibility,greatest(i.start_at,p_start) begin_at,least(coalesce(i.effective_end_at,i.end_at,least(i.boundary_at,statement_timestamp())),p_end) end_at FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id WHERE i.user_id=actor AND i.start_at<p_end AND coalesce(i.effective_end_at,i.end_at,i.boundary_at)>p_start),
 totals AS (SELECT *,greatest(0,extract(epoch FROM end_at-begin_at)) seconds FROM periods)
 SELECT jsonb_build_object('learningSeconds',coalesce(sum(seconds) FILTER(WHERE category='learning'),0),'workSeconds',coalesce(sum(seconds) FILTER(WHERE category='work'),0),'timerSeconds',coalesce(sum(seconds) FILTER(WHERE source='server'),0),'manualSeconds',coalesce(sum(seconds) FILTER(WHERE source='manual'),0),'pendingSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='pending' OR status<>'finalized'),0),'eligibleSeconds',coalesce(sum(seconds) FILTER(WHERE eligibility='eligible' AND status='finalized'),0),
 'activeDays',coalesce((SELECT jsonb_agg(day_label) FROM (SELECT to_char(d,'YYYY-MM-DD') AS day_label FROM generate_series((p_start AT TIME ZONE tz)::date::timestamp,((p_end-interval '1 microsecond') AT TIME ZONE tz)::date::timestamp,interval '1 day') d CROSS JOIN periods i WHERE i.status='finalized' AND i.eligibility<>'pending' GROUP BY d HAVING sum(greatest(0,extract(epoch FROM least(i.end_at,(d+interval '1 day') AT TIME ZONE tz)-greatest(i.begin_at,d AT TIME ZONE tz))))>=600) q),'[]')) INTO result FROM totals;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.social_active(uuid),public.social_peer(uuid,uuid),public.social_enrolled(uuid,text),public.social_project_credits(),public.social_block_revoke(),public.social_map_publication_claims(uuid),public.social_publication_credits(),public.read_social(text,text,text,text),public.execute_social(jsonb),public.read_progress_time(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social(text,text,text,text),public.execute_social(jsonb),public.read_progress_time(timestamptz,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
