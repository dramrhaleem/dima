-- B2 private aggregate: immutable curriculum snapshots, revisioned planning and progress.
-- Canonical business validation is server-only; anon/authenticated cannot call writer.
CREATE TABLE public.learning_workspaces (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision >= 0),
 state jsonb NOT NULL CHECK(jsonb_typeof(state) = 'object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.learning_operations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 command jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE public.learning_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_operations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_workspaces,public.learning_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.learning_workspaces,public.learning_operations TO authenticated;
GRANT SELECT ON public.learning_workspaces,public.learning_operations TO service_role;
CREATE POLICY learning_owner_read ON public.learning_workspaces FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY learning_receipt_owner_read ON public.learning_operations FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);

CREATE FUNCTION public.commit_learning_command(p_actor uuid,p_expected integer,p_profile_revision integer,p_command jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.learning_operations%ROWTYPE; current_revision integer; profile_revision integer;
BEGIN
 IF p_actor IS NULL OR p_expected < 0 OR jsonb_typeof(p_result->'state') IS DISTINCT FROM 'object' OR (p_result->'state'->>'revision')::integer <> p_expected+1 OR (p_command->>'expectedRevision')::integer <> p_expected THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='PT422';
 END IF;
 -- Same per-account lock as profile changes, followed by a row lock, closes timezone/apply races.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));
 SELECT * INTO previous FROM public.learning_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid;
 IF FOUND THEN
  IF previous.command <> p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE='PT409'; END IF;
  RETURN previous.result;
 END IF;
 SELECT revision INTO profile_revision FROM public.account_profiles WHERE user_id=p_actor FOR SHARE;
 IF profile_revision IS DISTINCT FROM p_profile_revision THEN RAISE EXCEPTION 'PROFILE_CHANGED' USING ERRCODE='PT409'; END IF;
 SELECT revision INTO current_revision FROM public.learning_workspaces WHERE user_id=p_actor FOR UPDATE;
 IF coalesce(current_revision,0) <> p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.learning_workspaces(user_id,revision,state) VALUES(p_actor,p_expected+1,p_result->'state')
 ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,updated_at=now();
 INSERT INTO public.learning_operations(user_id,operation_id,command,result) VALUES(p_actor,(p_command->>'operationId')::uuid,p_command,p_result);
 RETURN p_result;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) TO service_role;
COMMENT ON TABLE public.learning_workspaces IS 'B2 private versioned aggregate; API validates commands, service writer performs atomic CAS. No public activity projection.';
NOTIFY pgrst,'reload schema';
