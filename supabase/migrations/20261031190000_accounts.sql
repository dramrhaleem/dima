-- B1: private account data, protected roles and atomic versioned profile commands.
-- Additive migration; no B0 or existing Auth data is removed.
CREATE TABLE public.account_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 80 AND display_name !~ '[[:cntrl:]]'),
  timezone text NOT NULL DEFAULT 'UTC',
  intent text NOT NULL CHECK (intent IN ('learning', 'work')),
  appearance text NOT NULL DEFAULT 'system' CHECK (appearance IN ('system', 'light', 'dark')),
  reduced_motion boolean NOT NULL DEFAULT false,
  onboarded boolean NOT NULL DEFAULT false,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT onboarded OR char_length(btrim(display_name)) BETWEEN 1 AND 80)
);
CREATE TABLE public.account_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('member', 'moderator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.profile_operations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  command jsonb NOT NULL,
  profile_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
-- Separate future public projection. No publishing command or user write grant in B1.
-- It deliberately contains no email, timezone, preferences, role or activity.
CREATE TABLE public.public_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280),
  visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profile_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_profiles, public.account_roles, public.profile_operations, public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_profiles, public.account_roles, public.profile_operations TO authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
CREATE POLICY account_profiles_owner_read ON public.account_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY account_roles_owner_read ON public.account_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY profile_operations_owner_read ON public.profile_operations FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY public_profiles_public_read ON public.public_profiles FOR SELECT TO anon, authenticated USING (visible);
CREATE POLICY public_profiles_owner_read ON public.public_profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE FUNCTION public.save_account_profile(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  operation uuid;
  expected integer;
  current_revision integer;
  previous public.profile_operations%ROWTYPE;
  result jsonb;
  name_value text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'PT401'; END IF;
  -- Strict JSON contract also applies to callers bypassing the HTTP API.
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'PT422';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_command)) <> 8
    OR NOT (p_command ?& ARRAY['displayName','timezone','intent','appearance','reducedMotion','onboarded','expectedRevision','operationId'])
    OR jsonb_typeof(p_command->'displayName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'timezone') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'intent') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'appearance') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'operationId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'expectedRevision') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_command->'reducedMotion') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_command->'onboarded') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'PT422'; END IF;
  BEGIN
    operation := (p_command->>'operationId')::uuid;
    expected := (p_command->>'expectedRevision')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'PT422';
  END;
  name_value := btrim(p_command->>'displayName');
  IF expected < 0 OR expected > 2147483646
    OR (p_command->>'expectedRevision') !~ '^[0-9]+$'
    OR char_length(name_value) > 80 OR name_value ~ '[[:cntrl:]]'
    OR ((p_command->>'onboarded')::boolean AND char_length(name_value) = 0)
    OR char_length(p_command->>'timezone') > 100
    OR ((p_command->>'timezone') <> 'UTC' AND strpos(p_command->>'timezone','/') = 0)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_command->>'timezone')
    OR (p_command->>'intent') NOT IN ('learning','work')
    OR (p_command->>'appearance') NOT IN ('system','light','dark')
  THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'PT422'; END IF;
  -- The Auth account exists before a profile; serialize first insert and later updates.
  -- Row lock is scoped to this caller and follows the Account-first lock order.
  PERFORM 1 FROM auth.users WHERE id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'PT401'; END IF;
  SELECT * INTO previous FROM public.profile_operations WHERE user_id = actor AND operation_id = operation;
  IF FOUND THEN
    IF previous.command <> p_command THEN RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE = 'PT409'; END IF;
    RETURN previous.profile_result;
  END IF;
  SELECT revision INTO current_revision FROM public.account_profiles WHERE user_id = actor;
  IF coalesce(current_revision,0) <> expected THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE = 'PT409'; END IF;
  -- Once minimum onboarding is completed, later draft saves cannot undo that state.
  IF EXISTS (SELECT 1 FROM public.account_profiles WHERE user_id = actor AND onboarded)
    AND NOT (p_command->>'onboarded')::boolean
  THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'PT422'; END IF;
  INSERT INTO public.account_profiles(user_id,display_name,timezone,intent,appearance,reduced_motion,onboarded,revision)
    VALUES(actor,name_value,p_command->>'timezone',p_command->>'intent',p_command->>'appearance',
      (p_command->>'reducedMotion')::boolean,(p_command->>'onboarded')::boolean,expected+1)
    ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name,timezone=EXCLUDED.timezone,
      intent=EXCLUDED.intent,appearance=EXCLUDED.appearance,reduced_motion=EXCLUDED.reduced_motion,
      onboarded=EXCLUDED.onboarded,revision=EXCLUDED.revision,updated_at=now();
  SELECT jsonb_build_object('displayName',display_name,'timezone',timezone,'intent',intent,'appearance',appearance,
    'reducedMotion',reduced_motion,'onboarded',onboarded,'revision',revision)
    INTO result FROM public.account_profiles WHERE user_id = actor;
  INSERT INTO public.profile_operations(user_id,operation_id,command,profile_result) VALUES(actor,operation,p_command,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_account_profile(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_account_profile(jsonb) TO authenticated;
COMMENT ON TABLE public.account_roles IS 'Privileged grants only; user metadata and profile commands cannot assign roles.';
COMMENT ON TABLE public.public_profiles IS 'Explicit public projection; defaults private; publishing is not enabled by B1.';
COMMENT ON FUNCTION public.save_account_profile(jsonb) IS 'B1 caller-owned optimistic/idempotent profile save. No caller-supplied owner or role.';
