-- Include the member-owned web-completion features in account exports.
CREATE OR REPLACE FUNCTION public.export_own_account() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb; part jsonb; entry record;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='PT401'; END IF;
 result:=jsonb_build_object('format','dima-account-export-v1','exportedAt',now(),'accountId',actor,
 'profile',(SELECT to_jsonb(p)-'user_id' FROM public.account_profiles p WHERE user_id=actor),
 'learning',(SELECT state FROM public.learning_workspaces WHERE user_id=actor));
 -- Fixed allowlist only: never moderation audit, other members, secrets or operation payloads.
 FOR entry IN SELECT * FROM (VALUES
  ('sessions','time_sessions','user_id'),('intervals','time_intervals','user_id'),('corrections','time_corrections','user_id'),
  ('publicationRequests','publication_requests','owner_id'),('sharingSettings','social_settings','user_id'),
  ('peopleVisibility','people_visibility','user_id'),('rankingParticipation','ranking_participation','user_id'),
  ('profilePreferences','profile_preferences','user_id'),('rhythmGoals','rhythm_goal_versions','user_id'),
  ('sharedMilestones','shared_milestones','user_id'),('encouragements','milestone_encouragements','user_id'),
  ('notifications','social_notifications','user_id'),('firstCredits','first_credit_claims','user_id')
 ) AS entries(label,table_name,owner_column) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(row)-%L),''[]''::jsonb) FROM (SELECT * FROM public.%I WHERE %I=$1 LIMIT 5001) row',entry.owner_column,entry.table_name,entry.owner_column) INTO part USING actor;
  IF jsonb_array_length(part)>5000 THEN RAISE EXCEPTION 'EXPORT_TOO_LARGE' USING ERRCODE='PT413'; END IF;
  result:=result||jsonb_build_object(entry.label,part);
 END LOOP;
 IF octet_length(result::text)>20000000 THEN RAISE EXCEPTION 'EXPORT_TOO_LARGE' USING ERRCODE='PT413'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.export_own_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_own_account() TO authenticated;
NOTIFY pgrst,'reload schema';
