/* Behavioral structural checks; not a substitute for rendered browser QA. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const listeners={};const saved=new Map();const document={documentElement:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn)}};
const ctx=vm.createContext({document,window:{addEventListener:()=>{},scrollTo:()=>{}},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},console,location:{hash:''},Date,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,confirm:()=>true,Blob,URL});
vm.runInContext(fs.readFileSync(new URL('./app.js',import.meta.url),'utf8'),ctx);
const evaluate=s=>vm.runInContext(s,ctx);
for(const view of ['today','plan','recovery','setup','courses','library','detail','editor','activity','boards','settings','more']){const html=evaluate(`${view}()`);assert.ok(html.includes('<h1>'),`${view}: heading`);assert.ok(!html.includes('undefined'),`${view}: undefined`)}
evaluate("state.recovered='deadline'");const deadlinePlan=evaluate('plan()');assert.ok(deadlinePlan.includes('2 Nov')&&deadlinePlan.includes('4 Nov'));assert.ok(deadlinePlan.includes('75 min · revised'));assert.ok(deadlinePlan.includes('60 min · planned'),'Saturday remains unchanged');assert.ok(deadlinePlan.includes('30 Nov 2026'));evaluate("state.recovered='workload'");const workloadPlan=evaluate('plan()');assert.ok(workloadPlan.includes('7 Dec 2026'));assert.ok(workloadPlan.includes('carried over · 30 min'));assert.ok(!workloadPlan.includes('75 min · revised'));evaluate('state.recovered=null');
evaluate('const renderForDelegation=render;render=()=>{};renderTimer=()=>{};announce=()=>{};');
evaluate("complete('pm1')");assert.equal(evaluate('state.done.length'),1);assert.equal(evaluate('state.sessions.length'),0,'Completion must not create time');
evaluate("complete('pm1')");assert.equal(evaluate('state.done.length'),0,'Reopening removes completion');
evaluate("complete('not-a-task')");assert.equal(evaluate('state.done.length'),0,'Unknown task not added');
evaluate('startTimer();');const started=evaluate('state.timer.started');evaluate('startTimer();');assert.equal(evaluate('state.timer.started'),started,'Duplicate start preserves single timer');
evaluate('state.timer.started=Date.now()-5000;pauseTimer()');assert.equal(evaluate('state.timer.running'),false);assert.ok(evaluate('elapsed()')>=5);evaluate('finishTimer()');assert.equal(evaluate('state.timer'),null);assert.equal(evaluate('state.sessions.length'),1);assert.equal(evaluate('state.done.length'),0,'Finishing timer must not complete task');
evaluate('startTimer();state.timer.started=Date.now()-20000000');assert.equal(evaluate('elapsed()'),14400,'Four-hour continuous interval cap');evaluate('finishTimer()');
assert.ok(saved.get('dima.identity.prototype.v1'),'Namespaced local persistence');
assert.equal(evaluate("esc('<script>\"&')"),'&lt;script&gt;&quot;&amp;','Private titles escape markup');
console.log('PASS: 12 view renders; recovery branches and Saturday preservation; completion/reopening; completion/time separation; single timer; pause/finish; interval cap; namespaced storage; text escaping.');

// Exact task-derived ring values; elapsed time never changes task progress.
for (let n=0;n<=4;n++) {
  evaluate(`state.done=TASKS.slice(0,${n}).map(t=>t.id)`);
  const html=evaluate('today()');
  assert.ok(html.includes(`<dima-progress value="${n*25}" label="Sample task completion">`),'Ring uses actual sample task fraction');
  assert.ok(html.includes(`<strong>${n} of 4</strong>`),'Ring is accompanied by an exact task count');
}
evaluate("state.done=[];state.plan={course:'CS50 Business',prior:'existing',target:'2026-12-15',minutes:45,days:['Mon','Wed']}");
const restored=evaluate('setup()');
assert.ok(restored.includes('<option selected>CS50 Business</option>'),'Saved course restored in editor');
assert.ok(restored.includes('<option value="existing" selected>'),'Saved prior-progress preference restored');
assert.ok(restored.includes('value="2026-12-15"'),'Saved target restored');
const commands=evaluate('workspaceCommands()');
const validRoutes=['today','plan','recovery','setup','courses','library','editor','activity','boards','settings'];
for(const command of commands){
  assert.ok(command.label&&command.description,'Useful command label and context');
  assert.ok(validRoutes.some(route=>command.href===`#${route}`)||['../studio.html','landing.html'].includes(command.href),'Commands link only to real destinations');
  assert.equal(Object.keys(command).sort().join(','),'description,href,label','Commands are navigation only, never mutation handlers');
}
assert.equal(new Set(commands.map(c=>c.href)).size,commands.length,'No duplicate destinations');
const snapshot=evaluate('JSON.stringify(state)');
let opened;
ctx.window.DimaUI={openCommands:(items,trigger)=>{opened=items},init:()=>{}};
evaluate('openWorkspaceCommands(null)');
assert.equal(opened.length,commands.length);
assert.equal(evaluate('JSON.stringify(state)'),snapshot,'Opening command search does not mutate learning state');
console.log('PASS: exact 0–100% sample progress; plan edit restores saved preferences; 12 real command destinations; no state mutation on command open.');

// Exercise delegated events with a real parent chain populated by the app renderer.
// Styling metadata on main must not be mistaken for a navigation control.
const mainElement={dataset:{},innerHTML:'',focus:()=>{},parentElement:null};
document.querySelector=selector=>selector==='#main'?mainElement:null;
evaluate("state.done=[];state.timer=null;view='today';renderForDelegation()");
function descendant(dataset,parentElement=mainElement){
  return {dataset,parentElement,closest(selector){
    const match=/^\[data-([a-z-]+)\]$/.exec(selector);
    if(!match)return null;
    const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    for(let node=this;node;node=node.parentElement)if(Object.hasOwn(node.dataset,key))return node;
    return null;
  }};
}
const completeButton=descendant({complete:'pm1'});
listeners.click[0]({target:completeButton});
assert.equal(evaluate("state.done.includes('pm1')"),true,'Click completion inside main must reach completion handler');
listeners.click[0]({target:completeButton});
assert.equal(evaluate("state.done.includes('pm1')"),false,'Second delegated click reopens the task');
listeners.click[0]({target:descendant({action:'start'})});
assert.ok(evaluate('state.timer?.running'),'Focus action inside main reaches timer handler');
listeners.click[0]({target:descendant({view:'settings'})});
assert.equal(evaluate('view'),'settings','Explicit navigation controls still navigate');
document.querySelector=()=>null;
console.log('PASS: rendered main ancestor does not intercept completion, reopening or focus clicks; explicit navigation still works.');
