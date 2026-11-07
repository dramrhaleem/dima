-- Bounded profile thumbnails. Google remains automatic until an explicit custom/none choice.
ALTER TABLE public.account_profiles ADD COLUMN avatar_mode text NOT NULL DEFAULT 'google' CHECK(avatar_mode IN ('google','custom','none'));
ALTER TABLE public.account_profiles ADD COLUMN avatar_data text CHECK(avatar_data IS NULL OR octet_length(avatar_data)<=45000);
ALTER TABLE public.account_profiles ADD COLUMN avatar_revision integer NOT NULL DEFAULT 0 CHECK(avatar_revision>=0);
CREATE TABLE public.avatar_operations(user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,operation_id uuid NOT NULL,command jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,operation_id));
ALTER TABLE public.avatar_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_operations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.profile_google_avatar(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN value ~ '^https://([a-z0-9-]+\.)?googleusercontent\.com/[^[:cntrl:] ]*$' AND char_length(value)<=2048 THEN value ELSE NULL END
 FROM (SELECT coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture') value FROM auth.users WHERE id=p_user) q
$$;
CREATE FUNCTION public.profile_avatar_url(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN avatar_mode='custom' AND avatar_data IS NOT NULL OR avatar_mode='google' AND public.profile_google_avatar(p_user) IS NOT NULL THEN '/api/v1/profiles/'||p_user::text||'/avatar?v='||avatar_revision::text ELSE NULL END FROM public.account_profiles WHERE user_id=p_user
$$;
CREATE FUNCTION public.avatar_valid_jpeg(p_value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE bytes bytea; v_offset integer:=2; marker integer; length integer; width integer; height integer;
BEGIN
 IF p_value IS NULL OR char_length(p_value)>45000 OR p_value !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' THEN RETURN false;END IF;
 BEGIN bytes=decode(substr(p_value,24),'base64');EXCEPTION WHEN OTHERS THEN RETURN false;END;
 IF octet_length(bytes)<12 OR octet_length(bytes)>32768 OR get_byte(bytes,0)<>255 OR get_byte(bytes,1)<>216 OR get_byte(bytes,octet_length(bytes)-2)<>255 OR get_byte(bytes,octet_length(bytes)-1)<>217 THEN RETURN false;END IF;
 WHILE v_offset+3<octet_length(bytes) LOOP
  IF get_byte(bytes,v_offset)<>255 THEN RETURN false;END IF;v_offset=v_offset+1;
  WHILE v_offset<octet_length(bytes) AND get_byte(bytes,v_offset)=255 LOOP v_offset=v_offset+1;END LOOP;
  IF v_offset+2>=octet_length(bytes) THEN RETURN false;END IF;
  marker=get_byte(bytes,v_offset);v_offset=v_offset+1;
  IF marker IN (218,217) THEN RETURN false;END IF;
  IF marker=1 OR marker BETWEEN 208 AND 215 THEN CONTINUE;END IF;
  length=get_byte(bytes,v_offset)*256+get_byte(bytes,v_offset+1);
  IF length<2 OR v_offset+length>octet_length(bytes) THEN RETURN false;END IF;
  IF marker IN (192,193,194) THEN
   IF length<8 THEN RETURN false;END IF;
   height=get_byte(bytes,v_offset+3)*256+get_byte(bytes,v_offset+4);width=get_byte(bytes,v_offset+5)*256+get_byte(bytes,v_offset+6);
   RETURN width BETWEEN 1 AND 512 AND height BETWEEN 1 AND 512;
  END IF;
  v_offset=v_offset+length;
 END LOOP;
 RETURN false;
END $$;
CREATE FUNCTION public.save_profile_avatar(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();operation uuid;expected integer;current_revision integer;previous public.avatar_operations%ROWTYPE;result jsonb;mode_value text;data_value text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 PERFORM public.account_assert_writable(actor);
 IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_command))<>4 OR NOT(p_command ?& ARRAY['mode','data','expectedRevision','operationId']) OR jsonb_typeof(p_command->'mode') IS DISTINCT FROM 'string' OR jsonb_typeof(p_command->'operationId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_command->'expectedRevision') IS DISTINCT FROM 'number' OR p_command->>'expectedRevision' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 BEGIN operation=(p_command->>'operationId')::uuid;expected=(p_command->>'expectedRevision')::integer;EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END;
 mode_value=p_command->>'mode';data_value=p_command->>'data';
 IF expected<0 OR expected>=2147483647 OR mode_value NOT IN ('google','custom','none') OR (mode_value='custom' AND NOT public.avatar_valid_jpeg(data_value)) OR (mode_value<>'custom' AND p_command->'data'<>'null'::jsonb) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 SELECT * INTO previous FROM public.avatar_operations WHERE user_id=actor AND operation_id=operation;
 IF FOUND THEN IF previous.command<>p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409';END IF;RETURN previous.result;END IF;
 SELECT avatar_revision INTO current_revision FROM public.account_profiles WHERE user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_REQUIRED' USING ERRCODE='PT409';END IF;
 IF current_revision<>expected THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409';END IF;
 IF mode_value='google' AND public.profile_google_avatar(actor) IS NULL THEN RAISE EXCEPTION 'GOOGLE_PHOTO_UNAVAILABLE' USING ERRCODE='PT422';END IF;
 UPDATE public.account_profiles SET avatar_mode=mode_value,avatar_data=data_value,avatar_revision=expected+1,updated_at=now() WHERE user_id=actor;
 result=jsonb_build_object('accountId',actor,'avatarUrl',public.profile_avatar_url(actor),'avatarMode',mode_value,'avatarRevision',expected+1,'googleAvatarUrl',public.profile_google_avatar(actor));
 INSERT INTO public.avatar_operations(user_id,operation_id,command,result) VALUES(actor,operation,p_command,result);
 -- Store only a bounded retry ledger; committed avatar state remains independent.
 DELETE FROM public.avatar_operations WHERE user_id=actor AND operation_id NOT IN (SELECT operation_id FROM public.avatar_operations WHERE user_id=actor ORDER BY created_at DESC,operation_id LIMIT 20);
 RETURN result;
END $$;

CREATE FUNCTION public.read_profile_avatar(p_target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();p public.account_profiles%ROWTYPE;allowed boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401';END IF;
 SELECT * INTO p FROM public.account_profiles WHERE user_id=p_target;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 allowed=actor=p_target;
 IF NOT allowed AND public.social_active(actor) AND public.social_peer(actor,p_target) THEN
  allowed=public.social_discoverable(actor,p_target)
   OR EXISTS(SELECT 1 FROM public.follow_relationships WHERE follower_id=actor AND subject_id=p_target AND status='accepted')
   OR (public.social_board_eligible(p_target,'time') AND coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=p_target AND scope_id='time'),true))
   OR EXISTS(SELECT 1 FROM public.comparison_scopes s WHERE public.social_board_eligible(p_target,s.id) AND coalesce((SELECT enabled FROM public.ranking_participation WHERE user_id=p_target AND scope_id=s.id),true));
 END IF;
 IF NOT allowed THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 IF p.avatar_mode='none' THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='PT404';END IF;
 RETURN jsonb_build_object('mode',p.avatar_mode,'value',CASE WHEN p.avatar_mode='google' THEN public.profile_google_avatar(p_target) ELSE p.avatar_data END,'revision',p.avatar_revision);
END $$;
REVOKE ALL ON FUNCTION public.profile_google_avatar(uuid),public.profile_avatar_url(uuid),public.avatar_valid_jpeg(text),public.save_profile_avatar(jsonb),public.read_profile_avatar(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_profile_avatar(jsonb),public.read_profile_avatar(uuid) TO authenticated;

-- Add images only after the original social query has applied its visibility/block rules.
ALTER FUNCTION public.read_social(text,text,text,text) RENAME TO read_social_before_avatar;
CREATE FUNCTION public.read_social(p_view text,p_key text DEFAULT NULL,p_period text DEFAULT 'week',p_category text DEFAULT 'all') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result=public.read_social_before_avatar(p_view,p_key,p_period,p_category);
 IF p_view IN ('time','course') THEN
  result=jsonb_set(result,'{rows}',coalesce((SELECT jsonb_agg(value||jsonb_build_object('avatarUrl',public.profile_avatar_url((value->>'profileId')::uuid)) ORDER BY ord) FROM jsonb_array_elements(result->'rows') WITH ORDINALITY t(value,ord)),'[]'::jsonb));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_social_before_avatar(text,text,text,text),public.read_social(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_social(text,text,text,text) TO authenticated;
