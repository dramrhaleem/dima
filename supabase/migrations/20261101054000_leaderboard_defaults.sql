-- Leaderboards use a derived default, not writes during GET or a preference backfill.
-- Every saved false remains an explicit opt-out. Public profiles/peers/follows stay independent.
CREATE FUNCTION public.social_board_eligible(p_user uuid,p_scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.social_active(p_user) AND (p_scope='time' OR EXISTS(
 SELECT 1 FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id
 WHERE s.id=p_scope AND o.status='published' AND public.social_scope_comparable(s.id)
 AND public.social_enrolled(p_user,o.id)))
$$;
REVOKE ALL ON FUNCTION public.social_board_eligible(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.read_social(p_view text,p_key text DEFAULT NULL,p_period text DEFAULT 'week',p_category text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();result jsonb;v_window_start timestamptz;v_window_end timestamptz;scope_key text;denominator numeric;target uuid;settings public.social_settings%ROWTYPE;can_participate boolean;
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 IF p_period NOT IN ('week','month','overall') OR p_category NOT IN ('all','learning','work') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422'; END IF;
 v_window_start=date_trunc(CASE WHEN p_period='month' THEN 'month' ELSE 'week' END,now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 v_window_end=v_window_start+CASE WHEN p_period='month' THEN interval '1 month' ELSE interval '7 days' END;
 IF p_view='sharing' THEN
 SELECT * INTO settings FROM public.social_settings WHERE user_id=actor;
 RETURN jsonb_build_object('revision',coalesce(settings.revision,0),'publicProfile',coalesce(settings.public_profile,false),'bio',coalesce(settings.bio,''),'allowFollow',coalesce(settings.allow_follow,false),'weeklyTime',coalesce(settings.weekly_time,false),'courseProgress',coalesce(settings.course_progress,false));
 ELSIF p_view='circle' THEN
 SELECT jsonb_build_object('incoming',coalesce(jsonb_agg(item) FILTER(WHERE subject_id=actor AND status='pending'),'[]'),'outgoing',coalesce(jsonb_agg(item) FILTER(WHERE follower_id=actor AND status='pending'),'[]'),'following',coalesce(jsonb_agg(item) FILTER(WHERE follower_id=actor AND status='accepted'),'[]'),'followers',coalesce(jsonb_agg(item) FILTER(WHERE subject_id=actor AND status='accepted'),'[]')) INTO result FROM
 (SELECT r.subject_id,r.follower_id,r.status,jsonb_build_object('id',r.id,'profileId',p.user_id,'displayName',p.display_name,'status',r.status,'revision',r.revision) item FROM public.follow_relationships r JOIN public.account_profiles p ON p.user_id=CASE WHEN r.subject_id=actor THEN r.follower_id ELSE r.subject_id END
 WHERE (r.subject_id=actor OR r.follower_id=actor) AND r.status IN ('pending','accepted') AND public.social_peer(actor,p.user_id) ORDER BY r.updated_at DESC,r.id LIMIT 200) q;
 RETURN result;
 ELSIF p_view='people' THEN
 IF NOT public.social_enrolled(actor,p_key) OR NOT EXISTS(SELECT 1 FROM public.catalog_offerings WHERE id=p_key AND status='published') THEN
 IF EXISTS(SELECT 1 FROM public.people_visibility WHERE user_id=actor AND offering_id=p_key) THEN
 RETURN jsonb_build_object('rows','[]'::jsonb,'visible',(SELECT visible FROM public.people_visibility WHERE user_id=actor AND offering_id=p_key),'revision',(SELECT revision FROM public.people_visibility WHERE user_id=actor AND offering_id=p_key),'unavailable',true);
 END IF;
 RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
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
 SELECT s.required_weight INTO denominator FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id WHERE s.id=p_key AND o.status='published' AND public.social_scope_comparable(s.id);
 IF NOT FOUND THEN
 IF EXISTS(SELECT 1 FROM public.ranking_participation WHERE user_id=actor AND scope_id=p_key) THEN
 RETURN jsonb_build_object('scope',p_key,'scoringVersion','weighted-v1','window',NULL,'calculatedAt',statement_timestamp(),'generation',statement_timestamp()::text,'correctedAt',NULL,'unit','weight','requiredWeight',NULL,'rows','[]'::jsonb,'scopes','[]'::jsonb,'unavailable',true,'participation',jsonb_build_object('canParticipate',false,'enabled',(SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=p_key),'revision',(SELECT revision FROM public.ranking_participation WHERE user_id=actor AND scope_id=p_key)));
 END IF;
 RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 END IF;
 can_participate=public.social_board_eligible(actor,scope_key);
 WITH scores AS (
 SELECT p.user_id,p.display_name,CASE WHEN p_view='time' THEN coalesce((SELECT sum(greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at),v_window_end)-greatest(i.start_at,v_window_start))))
 FROM public.time_intervals i JOIN public.time_sessions ts ON ts.id=i.session_id WHERE i.user_id=p.user_id AND ts.status='finalized' AND i.source='server' AND i.eligibility='eligible' AND i.end_at IS NOT NULL AND i.start_at<v_window_end AND i.end_at>v_window_start AND (p_category='all' OR ts.category=p_category)),0)
 ELSE coalesce((SELECT sum((task->>'weight')::numeric) FROM public.comparison_scopes s CROSS JOIN LATERAL jsonb_array_elements(s.tasks) task JOIN public.first_credit_claims c ON c.user_id=p.user_id AND c.lineage_id=task->>'lineageId' AND c.active WHERE s.id=p_key AND (p_period='overall' OR (NOT c.baseline AND c.accepted_at>=v_window_start AND c.accepted_at<v_window_end))),0) END score
 FROM public.account_profiles p
 LEFT JOIN public.ranking_participation rp ON rp.user_id=p.user_id AND rp.scope_id=scope_key
 WHERE coalesce(rp.enabled,true) AND public.social_peer(actor,p.user_id) AND public.social_board_eligible(p.user_id,scope_key)
 ), ranked AS (SELECT *,rank() OVER(ORDER BY score DESC) rank FROM scores WHERE score>0)
 SELECT coalesce(jsonb_agg(jsonb_build_object('profileId',user_id,'displayName',display_name,'score',score,'rank',rank,'profileVisible',user_id=actor OR public.social_discoverable(actor,user_id) OR EXISTS(SELECT 1 FROM public.follow_relationships f WHERE f.follower_id=actor AND f.subject_id=user_id AND f.status='accepted')) ORDER BY rank,user_id),'[]') INTO result FROM (SELECT * FROM ranked ORDER BY rank,user_id LIMIT 50) q;
 RETURN jsonb_build_object('scope',scope_key,'scoringVersion','weighted-v1','window',CASE WHEN p_period='overall' THEN NULL ELSE jsonb_build_object('start',v_window_start,'end',v_window_end) END,'calculatedAt',statement_timestamp(),'generation',statement_timestamp()::text,'correctedAt',NULL,'unit',CASE WHEN p_view='time' THEN 'seconds' ELSE 'weight' END,'requiredWeight',denominator,'rows',result,
 'participation',jsonb_build_object('canParticipate',can_participate,'enabled',can_participate AND coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),true),'revision',coalesce((SELECT revision FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),0)),
 'scopes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'offeringId',offering_id,'title',title)) FROM (SELECT s.id,s.offering_id,v.snapshot->>'title' title FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id JOIN public.curriculum_versions v ON v.id=s.version_id WHERE o.status='published' AND public.social_scope_comparable(s.id) ORDER BY s.id LIMIT 100) q),'[]'));
 ELSIF p_view IN ('profile','shared') THEN
 BEGIN target=p_key::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END;
 IF NOT public.social_peer(actor,target) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT * INTO settings FROM public.social_settings WHERE user_id=target;
 IF p_view='profile' AND NOT coalesce(settings.public_profile,false) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF p_view='shared' AND actor<>target AND NOT public.social_discoverable(actor,target) AND NOT EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=actor AND subject_id=target AND status='accepted') THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 SELECT jsonb_build_object('profileId',user_id,'displayName',display_name,'bio',CASE WHEN settings.public_profile THEN settings.bio ELSE '' END,'visibilityRevision',coalesce(settings.revision,0),'verifiedAt',statement_timestamp()) INTO result FROM public.account_profiles WHERE user_id=target;
 IF p_view='shared' AND settings.weekly_time AND (actor=target OR EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=actor AND subject_id=target AND status='accepted')) THEN
 result=result||jsonb_build_object('weeklyTimeSeconds',(SELECT coalesce(sum(greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at),v_window_end)-greatest(i.start_at,v_window_start)))),0) FROM public.time_intervals i JOIN public.time_sessions s ON s.id=i.session_id WHERE i.user_id=target AND s.status='finalized' AND i.end_at IS NOT NULL AND i.start_at<v_window_end AND i.end_at>v_window_start));
 END IF;
 IF p_view='shared' AND settings.course_progress AND (actor=target OR EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=actor AND subject_id=target AND status='accepted')) THEN
 result=result||jsonb_build_object('courses',coalesce((SELECT jsonb_agg(jsonb_build_object('scopeId',id,'title',title,'requiredWeight',required_weight,'completedWeight',completed)) FROM
 (SELECT s.id,v.snapshot->>'title' title,s.required_weight,(SELECT coalesce(sum((task->>'weight')::numeric),0) FROM jsonb_array_elements(s.tasks) task JOIN public.first_credit_claims c ON c.lineage_id=task->>'lineageId' AND c.user_id=target AND c.active) completed FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id AND o.current_version_id=s.version_id JOIN public.curriculum_versions v ON v.id=s.version_id WHERE o.status='published' AND public.social_scope_comparable(s.id) AND public.social_enrolled(target,o.id) LIMIT 20) q),'[]'));
 END IF;
 RETURN result;
 ELSE RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404'; END IF;
END $$;


CREATE OR REPLACE FUNCTION public.execute_social(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF (coalesce((p_command->>'visible')::boolean,true) AND (NOT public.social_enrolled(actor,out_key) OR NOT EXISTS(SELECT 1 FROM public.catalog_offerings WHERE id=out_key AND status='published'))) OR (NOT (p_command->>'visible')::boolean AND NOT EXISTS(SELECT 1 FROM public.people_visibility WHERE user_id=actor AND offering_id=out_key)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.people_visibility(user_id,offering_id) VALUES(actor,out_key) ON CONFLICT DO NOTHING;
 UPDATE public.people_visibility SET visible=(p_command->>'visible')::boolean,revision=revision+1 WHERE user_id=actor AND offering_id=out_key AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='setParticipation' THEN
 IF p_command->>'board' NOT IN ('time','course') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 scope_key=CASE WHEN out_view='time' THEN 'time' ELSE out_key END;
 IF out_view='course' AND (p_command->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id WHERE s.id=scope_key AND o.status='published' AND public.social_scope_comparable(s.id) AND public.social_enrolled(actor,o.id)) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF out_view='course' AND NOT (p_command->>'enabled')::boolean AND NOT public.social_board_eligible(actor,scope_key) AND NOT EXISTS(SELECT 1 FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 INSERT INTO public.ranking_participation(user_id,scope_id) VALUES(actor,scope_key) ON CONFLICT DO NOTHING;
 UPDATE public.ranking_participation SET enabled=(p_command->>'enabled')::boolean,revision=revision+1 WHERE user_id=actor AND scope_id=scope_key AND revision=expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 ELSIF kind='follow' THEN
 target=(p_command->>'targetId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(least(actor::text,target::text)||':'||greatest(actor::text,target::text),42));
 IF target=actor OR NOT public.social_peer(actor,target) OR NOT EXISTS(SELECT 1 FROM public.social_settings WHERE user_id=target AND allow_follow) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 -- A known ID alone is insufficient discovery: require independent visibility or an existing relationship.
 IF NOT public.social_discoverable(actor,target)
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



NOTIFY pgrst,'reload schema';
