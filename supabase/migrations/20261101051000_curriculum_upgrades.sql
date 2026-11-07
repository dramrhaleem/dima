-- Optional upgrades use the existing owner/revision/idempotency aggregate commit.
-- Serialize the final target with publication changes; stale previews never switch snapshots.
ALTER FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) RENAME TO commit_learning_before_upgrade;
CREATE FUNCTION public.commit_learning_command(p_actor uuid,p_expected integer,p_profile_revision integer,p_command jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target jsonb; live_snapshot jsonb; original jsonb; preview jsonb; enrollment_id text; offering_id_value text; reserved boolean;
BEGIN
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF p_command->>'type' IN ('previewUpgrade','applyUpgrade') AND NOT EXISTS(SELECT 1 FROM public.learning_operations WHERE user_id=p_actor AND operation_id=(p_command->>'operationId')::uuid) THEN
  IF p_command->>'type'='previewUpgrade' THEN
   SELECT p INTO preview FROM jsonb_array_elements(p_result->'state'->'upgradePreviews') p WHERE p->>'id'=p_result->>'previewId';
   target:=preview->'target';enrollment_id:=preview->>'enrollmentId';
  ELSE
   SELECT p INTO preview FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'upgradePreviews') p WHERE w.user_id=p_actor AND p->>'id'=p_command->>'previewId';
   enrollment_id:=preview->>'enrollmentId';
   SELECT e->'snapshot' INTO target FROM jsonb_array_elements(p_result->'state'->'enrollments') e WHERE e->>'id'=enrollment_id;
   IF preview IS NULL OR target IS DISTINCT FROM preview->'target' OR jsonb_array_length(preview->'unresolved')<>0 OR (preview->>'baseRevision')::integer<>p_expected OR (preview->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'PREVIEW_STALE' USING ERRCODE='PT409';END IF;
  END IF;
  SELECT e INTO original FROM public.learning_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.state->'enrollments') e WHERE w.user_id=p_actor AND e->>'id'=enrollment_id;
  IF original IS NULL OR target IS NULL OR target->>'id' IS DISTINCT FROM original->>'offeringId' THEN RAISE EXCEPTION 'PREVIEW_STALE' USING ERRCODE='PT409';END IF;
  offering_id_value:=original->>'offeringId';
  SELECT v.snapshot INTO live_snapshot FROM public.catalog_offerings c JOIN public.curriculum_versions v ON v.id=c.current_version_id WHERE c.id=offering_id_value AND c.status='published' FOR SHARE OF c;
  SELECT EXISTS(SELECT 1 FROM public.catalog_offerings c WHERE c.id=offering_id_value) INTO reserved;
  IF reserved AND live_snapshot IS DISTINCT FROM target THEN RAISE EXCEPTION 'CATALOG_CHANGED' USING ERRCODE='PT409';END IF;
 END IF;
 RETURN public.commit_learning_before_upgrade(p_actor,p_expected,p_profile_revision,p_command,p_result);
END $$;
REVOKE ALL ON FUNCTION public.commit_learning_before_upgrade(uuid,integer,integer,jsonb,jsonb),public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_learning_command(uuid,integer,integer,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
