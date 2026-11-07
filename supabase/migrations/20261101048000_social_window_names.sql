-- Avoid PL/pgSQL window variables shadowing time_intervals.start_at/end_at.
CREATE OR REPLACE FUNCTION public.read_social(p_view text,p_key text DEFAULT NULL,p_period text DEFAULT 'week',p_category text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();result jsonb;v_window_start timestamptz;v_window_end timestamptz;scope_key text;denominator numeric;target uuid;settings public.social_settings%ROWTYPE;
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
 RETURN jsonb_build_object('scope',p_key,'scoringVersion','weighted-v1','window',NULL,'calculatedAt',statement_timestamp(),'generation',statement_timestamp()::text,'correctedAt',NULL,'unit','weight','requiredWeight',NULL,'rows','[]'::jsonb,'scopes','[]'::jsonb,'unavailable',true,'participation',jsonb_build_object('enabled',(SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=p_key),'revision',(SELECT revision FROM public.ranking_participation WHERE user_id=actor AND scope_id=p_key)));
 END IF;
 RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 END IF;
 WITH scores AS (
 SELECT p.user_id,p.display_name,CASE WHEN p_view='time' THEN coalesce((SELECT sum(greatest(0,extract(epoch FROM least(coalesce(i.effective_end_at,i.end_at),v_window_end)-greatest(i.start_at,v_window_start))))
 FROM public.time_intervals i JOIN public.time_sessions ts ON ts.id=i.session_id WHERE i.user_id=p.user_id AND ts.status='finalized' AND i.source='server' AND i.eligibility='eligible' AND i.end_at IS NOT NULL AND i.start_at<v_window_end AND i.end_at>v_window_start AND (p_category='all' OR ts.category=p_category)),0)
 ELSE coalesce((SELECT sum((task->>'weight')::numeric) FROM public.comparison_scopes s CROSS JOIN LATERAL jsonb_array_elements(s.tasks) task JOIN public.first_credit_claims c ON c.user_id=p.user_id AND c.lineage_id=task->>'lineageId' AND c.active WHERE s.id=p_key AND (p_period='overall' OR (NOT c.baseline AND c.accepted_at>=v_window_start AND c.accepted_at<v_window_end))),0) END score
 FROM public.ranking_participation rp JOIN public.account_profiles p USING(user_id) WHERE rp.scope_id=scope_key AND rp.enabled AND public.social_peer(actor,p.user_id) AND (p_view='time' OR denominator>0)
 ), ranked AS (SELECT *,rank() OVER(ORDER BY score DESC) rank FROM scores)
 SELECT coalesce(jsonb_agg(jsonb_build_object('profileId',user_id,'displayName',display_name,'score',score,'rank',rank) ORDER BY rank,user_id),'[]') INTO result FROM (SELECT * FROM ranked ORDER BY rank,user_id LIMIT 50) q;
 RETURN jsonb_build_object('scope',scope_key,'scoringVersion','weighted-v1','window',CASE WHEN p_period='overall' THEN NULL ELSE jsonb_build_object('start',v_window_start,'end',v_window_end) END,'calculatedAt',statement_timestamp(),'generation',statement_timestamp()::text,'correctedAt',NULL,'unit',CASE WHEN p_view='time' THEN 'seconds' ELSE 'weight' END,'requiredWeight',denominator,'rows',result,
 'participation',jsonb_build_object('enabled',coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),false),'revision',coalesce((SELECT revision FROM public.ranking_participation WHERE user_id=actor AND scope_id=scope_key),0)),
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
NOTIFY pgrst,'reload schema';
