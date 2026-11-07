-- Public profile links can be used in Circle without leaking an ID in the anonymous DTO.
CREATE OR REPLACE FUNCTION public.social_discoverable(p_viewer uuid,p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.social_peer(p_viewer,p_target) AND (
 EXISTS(SELECT 1 FROM public.social_settings WHERE user_id=p_target AND public_profile)
 OR EXISTS(SELECT 1 FROM public.profile_preferences WHERE user_id=p_target AND public_link)
 OR EXISTS(SELECT 1 FROM public.people_visibility v JOIN public.catalog_offerings o ON o.id=v.offering_id WHERE v.user_id=p_target AND v.visible AND o.status='published' AND public.social_enrolled(p_viewer,o.id) AND public.social_enrolled(p_target,o.id))
 OR EXISTS(SELECT 1 FROM public.ranking_participation rp WHERE rp.user_id=p_target AND rp.enabled AND (rp.scope_id='time' OR EXISTS(SELECT 1 FROM public.comparison_scopes s JOIN public.catalog_offerings o ON o.id=s.offering_id WHERE s.id=rp.scope_id AND o.status='published' AND public.social_scope_comparable(s.id)))))
$$;
CREATE FUNCTION public.follow_public_handle(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;actor uuid:=auth.uid();
BEGIN
 IF NOT public.social_active(actor) THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 IF p_command->>'type' IS DISTINCT FROM 'follow' OR p_command->>'targetId' IS NULL OR p_command->>'targetId' !~* '^[a-z][a-z0-9-]{2,29}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 SELECT user_id INTO target FROM public.profile_preferences WHERE handle=lower(p_command->>'targetId') AND public_link;
 IF target IS NULL OR NOT public.social_peer(actor,target) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 RETURN public.execute_social(jsonb_set(p_command,'{targetId}',to_jsonb(target::text)));
END $$;
REVOKE ALL ON FUNCTION public.follow_public_handle(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.follow_public_handle(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
