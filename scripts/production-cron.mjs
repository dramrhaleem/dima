import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const allowed=['--config','--secrets','--apply','--verify'];
if(args.some((arg,index)=>!allowed.includes(arg)&&!['--config','--secrets'].includes(args[index-1])))throw new Error('Unknown argument');
function privateRead(path){if((statSync(path).mode&0o077)!==0)throw new Error('Private files require0600');return readFileSync(path,'utf8');}
const configPath=args.includes('--config')?resolve(args[args.indexOf('--config')+1]):'/home/amro/.local/state/dima-production/connection.json';
const config=JSON.parse(privateRead(configPath));
if(!/^[a-z]{20}$/.test(config.projectRef)||config.user!==`postgres.${config.projectRef}`||!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host)||Number(config.port)!==5432||config.database!=='postgres')throw new Error('Require explicit hosted session-pooler project connection');
const secretsPath=args.includes('--secrets')?resolve(args[args.indexOf('--secrets')+1]):resolve(dirname(configPath),'worker-secrets.json');
const secrets=JSON.parse(privateRead(secretsPath));
const token=secrets.DIMA_JOBS_TOKEN;
if(typeof token!=='string'||token.length<32||/[\r\n\0]/.test(token))throw new Error('Missing dispatcher token');
const password=privateRead(config.passwordFile).trim();
const env={...process.env,PGHOST:config.host,PGPORT:'5432',PGUSER:config.user,PGDATABASE:'postgres',PGPASSWORD:password,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15',PGAPPNAME:'dima-production-cron',DIMA_JOBS_TOKEN:token};
const keys=['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME','DIMA_JOBS_TOKEN'];
function sql(query,label){
 const result=spawnSync('docker',['exec','-i',...keys.flatMap(key=>['-e',key]),config.psqlContainer,'psql','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,env,encoding:'utf8',timeout:90000,maxBuffer:2e6});
 if(result.status!==0){writeFileSync(resolve(dirname(configPath),'cron-private.log'),`${label}\n${result.stderr??''}`.replaceAll(token,'[REDACTED]').replaceAll(password,'[REDACTED]'),{mode:0o600});throw new Error(`${label} failed; sanitized private diagnostic retained`);}
 return result.stdout.trim();
}
const inventory=JSON.parse(sql(`BEGIN READ ONLY; SELECT json_build_object(
 'cronAvailable',EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron'),
 'netAvailable',EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_net'),
 'vaultReady',to_regclass('vault.decrypted_secrets') IS NOT NULL,
 'cronInstalled',to_regclass('cron.job') IS NOT NULL,
 'dispatcherExists',to_regprocedure('dima_deploy.enqueue_dispatch()') IS NOT NULL,
 'migrations',(SELECT count(*) FROM dima_deploy.migrations)); COMMIT;`,'Read prerequisites'));
if(!inventory.cronAvailable||!inventory.netAvailable||!inventory.vaultReady||inventory.migrations<27)throw new Error('Hosted database prerequisites are incomplete');
const existing=inventory.cronInstalled?JSON.parse(sql(`SELECT coalesce(json_agg(row_to_json(x)),'[]'::json) FROM(SELECT jobid,jobname,schedule,command,active,username FROM cron.job WHERE jobname='dima-dispatch-every-minute') x;`,'Read owned schedule')):[];
if(existing.some(job=>job.command!=='SELECT dima_deploy.enqueue_dispatch();'||job.username!=='postgres'))throw new Error('Existing named job differs; refusing to overwrite');
if(inventory.dispatcherExists&&sql("SELECT obj_description('dima_deploy.enqueue_dispatch()'::regprocedure,'pg_proc');",'Read dispatcher ownership')!=='Dima hosted dispatcher v1: fixed HTTPS target, Vault bearer token, empty JSON, bounded timeout.')throw new Error('Existing dispatcher function differs');
const schemaProbes=[];
for(const profile of ['net','vault','dima_deploy']){
 // Use a concrete, zero-row table request. This project's OpenAPI index is
 // unavailable to anon even though its ordinary table/Auth requests succeed.
 const response=await fetch(`${secrets.SUPABASE_URL}/rest/v1/http_request_queue?select=id&limit=0`,{headers:{apikey:secrets.SUPABASE_ANON_KEY,Authorization:`Bearer ${secrets.SUPABASE_ANON_KEY}`,'Accept-Profile':profile},signal:AbortSignal.timeout(15000)});
 const body=await response.json().catch(()=>null);
 schemaProbes.push({profile,status:response.status,code:body?.code??null});
}
if(schemaProbes.some(probe=>probe.status!==406||probe.code!=='PGRST106'))throw new Error('Private deployment schemas must remain excluded from the Data API');
const unsafeRpcCount=Number(sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')) AND (p.proname ~* '(execute_sql|run_sql|query_sql|http_post|http_get)' OR p.prosrc ~* '(http_request_queue|decrypted_secrets|execute.*sql|execute.*query)');",'Check public SQL/queue RPC boundary'));
if(unsafeRpcCount!==0)throw new Error('Public SQL/queue/Vault RPC requires review before enabling cron');
console.log(JSON.stringify({projectRef:config.projectRef,mode:args.includes('--apply')?'apply':'read-only',inventory,existing},null,2));
if(args.includes('--apply')){
 // psql's environment variable is used only as Vault input; never stored in the
 // scheduled SQL, function body, diagnostic record or public evidence.
 const vaultInput=`\\getenv dima_jobs_token DIMA_JOBS_TOKEN
SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name='dima_jobs_token') AS has_token \\gset
\\if :has_token
SELECT (SELECT decrypted_secret=:'dima_jobs_token' FROM vault.decrypted_secrets WHERE name='dima_jobs_token') AS same_token \\gset
\\if :same_token
\\else
DO $$ BEGIN RAISE EXCEPTION 'Existing Vault dispatcher token differs; explicit rotation required'; END $$;
\\endif
\\else
SELECT vault.create_secret(:'dima_jobs_token','dima_jobs_token','Dima fixed endpoint dispatcher bearer token') AS secret_id \\gset
\\endif
`;
 sql(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('dima-hosted-dispatcher-v1',0));\n${vaultInput}\n${readFileSync(resolve(root,'supabase/deployment/hosted_dispatcher.sql'),'utf8')}\nCOMMIT;`,'Configure hosted dispatcher');
}
if(args.includes('--apply')||args.includes('--verify')){
 const state=JSON.parse(sql(`BEGIN READ ONLY; SELECT json_build_object(
 'job',(SELECT row_to_json(j) FROM(SELECT jobid,jobname,schedule,command,active,username FROM cron.job WHERE jobname='dima-dispatch-every-minute') j),
 'vaultTokenPresent',EXISTS(SELECT 1 FROM vault.secrets WHERE name='dima_jobs_token'),
 'clientCannotExecute',NOT has_function_privilege('anon','dima_deploy.enqueue_dispatch()','EXECUTE') AND NOT has_function_privilege('authenticated','dima_deploy.enqueue_dispatch()','EXECUTE'),
 'managedQueueSqlReadableByApiRoles',has_table_privilege('anon','net.http_request_queue','SELECT') OR has_table_privilege('authenticated','net.http_request_queue','SELECT') OR has_table_privilege('service_role','net.http_request_queue','SELECT'),
 'latestCronRun',(SELECT row_to_json(r) FROM(SELECT status,start_time,end_time FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='dima-dispatch-every-minute') ORDER BY start_time DESC LIMIT 1) r),
 'latestHttp',(SELECT row_to_json(r) FROM(SELECT d.request_id,d.queued_at,h.status_code,h.timed_out,h.error_msg FROM dima_deploy.dispatch_requests d LEFT JOIN net._http_response h ON h.id=d.request_id ORDER BY d.queued_at DESC LIMIT 1) r),
 'lastSuccessfulHttp',(SELECT row_to_json(r) FROM(SELECT d.request_id,d.queued_at,h.status_code FROM dima_deploy.dispatch_requests d JOIN net._http_response h ON h.id=d.request_id WHERE h.status_code=200 ORDER BY d.queued_at DESC LIMIT 1) r)); COMMIT;`,'Verify hosted dispatcher'));
 const evidence={checkedAt:new Date().toISOString(),projectRef:config.projectRef,target:'https://dima.study/api/internal/jobs/dispatch',configured:state.job?.active===true&&state.job?.schedule==='* * * * *'&&state.vaultTokenPresent&&state.clientCannotExecute,observedHttpSuccess:Boolean(state.lastSuccessfulHttp),schemaProbes,unsafePublicRpcCount:unsafeRpcCount,secretStorage:'Vault encrypted at rest; pg_net transient managed queue contains authorization while pending. Private schemas are excluded from Data API; direct database operators can read the queue.',state};
 writeFileSync(resolve(root,'docs/evidence/B7_HOSTED_CRON.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));
 if(!evidence.configured)throw new Error('Dispatcher configuration verification failed');
}
