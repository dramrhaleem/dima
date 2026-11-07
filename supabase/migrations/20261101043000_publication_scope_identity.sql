-- Disable competitive comparison when reused task identity changes semantics. Library publication remains available.
CREATE OR REPLACE FUNCTION public.publication_create_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entries jsonb; denominator numeric;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',t->>'id','lineageId',NEW.offering_id||':'||(t->>'id'),'weight',CASE t->>'kind' WHEN 'video' THEN 1 WHEN 'reading' THEN 1 WHEN 'quiz' THEN 2 WHEN 'assignment' THEN 4 WHEN 'project' THEN 8 ELSE NULL END)),'[]'::jsonb)
 INTO entries FROM jsonb_array_elements(NEW.snapshot->'courses') c CROSS JOIN LATERAL jsonb_array_elements(c->'modules') m CROSS JOIN LATERAL jsonb_array_elements(m->'tasks') t WHERE t->>'requirement'='required';
 SELECT CASE WHEN count(*) FILTER(WHERE e->>'weight' IS NULL)>0 THEN NULL ELSE coalesce(sum((e->>'weight')::numeric),0) END INTO denominator FROM jsonb_array_elements(entries) e;
 -- Reused task IDs with a different meaning need a reviewed mapping before competition.
 IF EXISTS(
  SELECT 1 FROM public.curriculum_versions previous
  CROSS JOIN LATERAL jsonb_array_elements(previous.snapshot->'courses') pc
  CROSS JOIN LATERAL jsonb_array_elements(pc->'modules') pm
  CROSS JOIN LATERAL jsonb_array_elements(pm->'tasks') pt
  CROSS JOIN LATERAL jsonb_array_elements(NEW.snapshot->'courses') nc
  CROSS JOIN LATERAL jsonb_array_elements(nc->'modules') nm
  CROSS JOIN LATERAL jsonb_array_elements(nm->'tasks') nt
  WHERE previous.offering_id=NEW.offering_id AND previous.id<>NEW.id
   AND nt->>'requirement'='required' AND pt->>'id'=nt->>'id'
   AND (jsonb_build_array(pt->>'title',pt->>'kind',pt->>'sourceUrl') IS DISTINCT FROM jsonb_build_array(nt->>'title',nt->>'kind',nt->>'sourceUrl'))
 ) THEN denominator:=NULL; END IF;
 INSERT INTO public.comparison_scopes(id,offering_id,version_id,required_weight,tasks) VALUES(NEW.offering_id||'@'||NEW.version,NEW.offering_id,NEW.id,denominator,entries);
 RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
