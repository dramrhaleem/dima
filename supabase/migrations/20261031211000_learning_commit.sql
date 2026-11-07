-- B2 follow-up: compact operation receipts and serialize with profile changes.
-- Initial migration was applied locally before final review; no reset or data loss.
GRANT USAGE ON SCHEMA public TO service_role;
CREATE OR REPLACE FUNCTION public.commit_learning_command(p_actor uuid,p_expected integer,p_profile_revision integer,p_command jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.learning_operations%ROWTYPE; current_revision integer; profile_revision integer;
BEGIN
 IF p_actor IS NULL OR p_expected < 0 OR jsonb_typeof(p_result->'state') IS DISTINCT FROM 'object' OR (p_result->'state'->>'revision')::integer <> p_expected+1 OR (p_command->>'expectedRevision')::integer <> p_expected THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';
 END IF;
 -- Same account lock used by profile commands closes timezone/apply races.
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 SELECT * INTO previous FROM public.learning_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid;
 IF FOUND THEN
  IF previous.command <> p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('state',(SELECT state FROM public.learning_workspaces WHERE user_id=p_actor),'previewId',previous.result->'previewId');
 END IF;
 SELECT revision INTO profile_revision FROM public.account_profiles WHERE user_id=p_actor FOR SHARE;
 IF profile_revision IS DISTINCT FROM p_profile_revision THEN RAISE EXCEPTION 'PROFILE_CHANGED' USING ERRCODE='PT409'; END IF;
 SELECT revision INTO current_revision FROM public.learning_workspaces WHERE user_id=p_actor FOR UPDATE;
 IF coalesce(current_revision,0) <> p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.learning_workspaces(user_id,revision,state) VALUES(p_actor,p_expected+1,p_result->'state')
 ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,updated_at=now();
 INSERT INTO public.learning_operations(user_id,operation_id,command,result) VALUES(p_actor,(p_command->>'operationId')::uuid,p_command,jsonb_build_object('revision',p_expected+1,'previewId',p_result->'previewId'));
 RETURN p_result;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
