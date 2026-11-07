-- B0 infrastructure proof only; no course/progress/session business data.
-- Apply only to a Dima development database. Remove this probe before B7.
CREATE TABLE public.foundation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120 AND char_length(label) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX foundation_checks_owner_created_idx ON public.foundation_checks(owner_id, created_at DESC);
ALTER TABLE public.foundation_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foundation_checks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.foundation_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.foundation_checks TO authenticated;
CREATE POLICY foundation_checks_select_owner ON public.foundation_checks FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY foundation_checks_insert_owner ON public.foundation_checks FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id);
COMMENT ON TABLE public.foundation_checks IS 'B0 local infrastructure proof; not product progress or production data.';
