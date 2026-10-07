// Execute production requests, real manager fallback and emitted status elements.
// Observe every timeline and neutral drain first, then report flat independent claims.
// No assertion short-circuits a pending transport or a completion timer.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {harness,manifest,root,U} from './helpers/cultural_annotation_loading_harness.mjs';
const all=[];

for(const queued of [false,true]) {
  async function run(name,options,steps){
    const h=harness({queued,...options}),snaps=[];
    const snap=label=>snaps.push(h.snap(label));
    // Observe and drain before registering assertions, even on an unfixed source.
    try { await steps(h,snap); } finally { await h.finish(); }
    snap('fully drained');
    all.push({name,queued,options,snaps,events:h.events,errors:h.errors,cacheReads:h.cacheReads,cacheWrites:h.cacheWrites,timerLog:h.timerLog});
  }
  await run('source switch, retired request fallback',{},async(h,snap)=>{
    await h.play();snap('A primary pending');await h.choose('new');snap('B primary pending');
    await h.reject(0);snap('A fallback pending, B primary pending');
    await h.advance(1500);snap('after 1500 ms pending');
    await h.resolve(2);snap('A fallback completed, B primary pending');
    await h.rerender();snap('ordinary rerender, B primary pending');
    await h.resolve(1);snap('B primary completed');
    await h.advance(520);snap('completion hold elapsed');await h.advance(180);snap('completion exit elapsed');
  });
  await run('same-key regeneration retires prior token',{},async(h,snap)=>{
    await h.play();snap('initial source primary pending');
    const regen=h.c.regenerateCulturalAnnotations();await h.settle();snap('same source regenerated primary pending');
    await h.reject(0);snap('preclear fallback pending, current primary pending');
    await h.resolve(2);snap('preclear fallback completed, current primary pending');
    await h.resolve(1);await regen;await h.settle();snap('current regeneration completed');
  });
  await run('current request legitimate fallback',{},async(h,snap)=>{
    await h.play();snap('current primary pending');await h.reject(0);snap('current fallback pending');
    await h.resolve(1);snap('current fallback completed');
  });
  await run('new request legitimate fallback after retired callback',{},async(h,snap)=>{
    await h.play();await h.choose('new');await h.reject(0);snap('retired fallback pending');
    await h.reject(1);snap('current fallback pending');await h.resolve(2);snap('retired completed');await h.resolve(3);snap('current completed');
  });
  await run('clear without successor',{},async(h,snap)=>{
    await h.play();h.c.clearCulturalAnnotationsForTrack(U,{updateState:true});await h.settle();snap('cleared');
    await h.reject(0);snap('cleared request fallback pending');await h.resolve(1);snap('cleared request completed');
  });
  await run('clear all without successor',{},async(h,snap)=>{
    await h.play();h.c.clearAllCulturalAnnotations({updateState:true});await h.settle();snap('cleared');
    await h.reject(0);snap('cleared request fallback pending');await h.resolve(1);snap('cleared request completed');
  });
  await run('new request completes before retired fallback',{},async(h,snap)=>{
    await h.play();await h.choose('new');await h.resolve(1);snap('new request completed');
    await h.reject(0);snap('retired fallback after current completion');await h.resolve(2);snap('retired request completed');
  });
  await run('pending duplicate current source',{},async(h,snap)=>{
    await h.play();h.c.requestCulturalAnnotations({lyricsState:h.c.state,lyrics:h.c.state.unsynced,sourceLang:'en',uri:U});await h.settle();snap('duplicate admitted');
    await h.reject(0);snap('same current fallback pending');await h.resolve(1);snap('completed');
  });
  await run('completed current cache reuse',{},async(h,snap)=>{
    await h.play();await h.resolve(0);snap('completed');await h.advance(700);
    await h.c.requestCulturalAnnotations({lyricsState:h.c.state,lyrics:h.c.state.unsynced,sourceLang:'en',uri:U});await h.settle();snap('cached reuse');
  });
  await run('feature disabled',{enabled:false},async(h,snap)=>{await h.play();await h.choose('new');snap('disabled source switch');});
  await run('provider capability disabled',{capabilityEnabled:false},async(h,snap)=>{await h.play();snap('no capable provider');});
  await run('providers explicitly disabled',{providerEnabled:false},async(h,snap)=>{await h.play();snap('no enabled provider');});
  await run('reversed configured provider order',{providerOrder:['ai-fallback','ai-primary']},async(h,snap)=>{
    await h.play();snap('configured first pending');await h.reject(0);snap('configured next pending');await h.resolve(1);snap('completed');
  });
  await run('single enabled provider, retired failure',{providerOrder:['ai-primary']},async(h,snap)=>{
    await h.play();await h.choose('new');snap('new primary pending');await h.reject(0);snap('retired request exhausted');await h.resolve(1);snap('current completed');
  });
  await run('distinct providers with same display name',{sameProviderName:true},async(h,snap)=>{
    await h.play();await h.choose('new');snap('new primary pending');await h.reject(0);snap('retired fallback same name');await h.resolve(2);snap('retired completed');await h.resolve(1);snap('current completed');
  });

  await run('older active member retains fallback updates',{},async(h,snap)=>{
    await h.play();
    // Request-interface compatibility control, not a separately traced UI gesture.
    const second=h.c.requestCulturalAnnotations({
      lyricsState:h.c.state, lyrics:[{text:'Independent second source'},{text:'Second line'}],
      sourceLang:'en', uri:U,
    });
    await h.settle();snap('two active members');
    await h.reject(0);snap('older active fallback pending');
    await h.resolve(2);snap('older active member completed');
    await h.resolve(1);await second;snap('newer active member completed');
  });
  await run('current provider exhaustion cleans up',{},async(h,snap)=>{
    await h.play();await h.reject(0);snap('current fallback pending');
    await h.reject(1);snap('current request exhausted');
  });
}

const scenarios=all,checks=[];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function check(s,label,actual,expected,category='control'){checks.push({scenario:s?.name??'source',queued:s?.queued??null,label,category,actual,expected,pass:same(actual,expected)});}
const pick=(s,label)=>s.snaps.find(x=>x.label===label);
function nodes(t,cls){const result=[];function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return;}if(x.props?.className===cls)result.push(x);x.children?.forEach(walk);}walk(t);return result;}
const descriptions=t=>nodes(t.statusStack,'lyrics-generation-status-description').map(x=>x.children.join(''));
const loading=s=>s.snaps.filter(t=>t.generationPills['cultural-annotations'].phase==='loading');
const label='문화적 설명',primary='문화적 설명을 생성하는 중...: Primary AI',fallback='문화적 설명을 생성하는 중...: Fallback AI';
check(null,'every executed source extraction has its recorded exact bytes',manifest.every(x=>createHash('sha256').update(readFileSync(new URL(x.file,root),'utf8').slice(x.start,x.end)).digest('hex')===x.sha256),true);
const css=readFileSync(new URL('style.css',root),'utf8');
check(null,'status description is clipped but not display:none or visibility:hidden',/\.lyrics-generation-status-description \{[\s\S]*?clip: rect\(0, 0, 0, 0\);/.test(css)&&!/(?:display:\s*none|visibility:\s*hidden)/.test(css.match(/\.lyrics-generation-status-description \{[^}]*\}/)[0]),true);
for(const s of scenarios){
  const last=s.snaps.at(-1);
  check(s,'all external provider promises settled',last.requests.every(q=>q.settled),true);
  check(s,'all component and transport pending maps empty',[last.pendingKeys,last.inflightKeys,last.lyricsProviderKeys],[[],[],[]]);
  check(s,'no active annotation loading token',last.activeTokens,[]);
  check(s,'no remaining timers',last.pendingTimers,[]);
  check(s,'annotation status removed after completion',last.generationPills['cultural-annotations'].phase,'idle');
  check(s,'sync creator suppresses actual status consumer',s.snaps.every(t=>t.suppressedStatus===null),true);
  check(s,'painted loading text excludes provider names',loading(s).every(t=>same(nodes(t.statusStack,'lyrics-generation-status-loading-label').map(x=>x.children.join('')),[label])),true);
  check(s,'status is polite and description is not aria hidden',s.snaps.filter(t=>t.statusStack).every(t=>t.statusStack.props.role==='status'&&t.statusStack.props['aria-live']==='polite'&&nodes(t.statusStack,'lyrics-generation-status-description').every(n=>n.props['aria-hidden']===undefined)),true);
  check(s,'only controlled rejection/admission warnings',s.errors.every(e=>e.event==='warn'&&(/Provider ai-(primary|fallback) failed/.test(e.args?.[0])&&e.args?.[1]==='controlled transport failure'||e.args?.[0]==='[AIAddonManager] No cultural annotation providers enabled'||e.args?.[0]==='[ivLyrics] Cultural annotation request failed:'&&/No AI providers enabled|controlled transport failure/.test(e.args?.[1]))||e.event==='toast'&&/No AI providers enabled|controlled transport failure/.test(e.message)),true);
  switch(s.name){
  case 'source switch, retired request fallback':{
    const a=pick(s,'A primary pending'),b=pick(s,'B primary pending'),late=pick(s,'A fallback pending, B primary pending');
    check(s,'actual source change retires token 1 and activates token 2',[a.activeTokens,b.activeTokens],[[1],[2]]);
    check(s,'real manager sequence is primary A, primary B, fallback A',late.requests.map(q=>[q.provider,q.lines[0].text]),[['ai-primary','Old river proverb'],['ai-primary','New city image'],['ai-fallback','Old river proverb']]);
    check(s,'new request starts with own provider description',descriptions(b),[primary]);
    check(s,'current accessible status keeps current provider during and after retired fallback',['A fallback pending, B primary pending','after 1500 ms pending','A fallback completed, B primary pending','ordinary rerender, B primary pending'].map(l=>descriptions(pick(s,l))),[[primary],[primary],[primary],[primary]],'desired ownership');
    check(s,'retired completion does not clear current token',pick(s,'A fallback completed, B primary pending').activeTokens,[2]);
    check(s,'successful old and new source transports both warm cache',s.cacheWrites.length,2);
    check(s,'completion consumer substitutes complete description',descriptions(pick(s,'B primary completed')),[`${label} 완료!`]);
    check(s,'actual completion timer phases honored',['B primary completed','completion hold elapsed','completion exit elapsed'].map(l=>pick(s,l).generationPills['cultural-annotations'].phase),['complete','exiting','idle']);
    check(s,'no cultural loading delay timer',a.pendingTimers.every(t=>t.delay===95000),true);
    check(s,'primary selector is enabled while annotations load',s.events.some(e=>e.event==='provider-button'&&e.disabled===false&&e.culturalLoading===true),true);
    break;}
  case 'same-key regeneration retires prior token':{
    const n=pick(s,'same source regenerated primary pending'),late=pick(s,'preclear fallback pending, current primary pending');
    check(s,'actual regeneration advances epoch and retires prior token',[n.epoch,n.activeTokens],[1,[2]]);
    check(s,'regeneration admits identical lines twice',same(n.requests[0].lines,n.requests[1].lines),true);
    check(s,'current accessible status keeps regenerated provider during retired fallback',[descriptions(late),descriptions(pick(s,'preclear fallback completed, current primary pending'))],[[primary],[primary]],'desired ownership');
    check(s,'old result does not publish across epoch clear',pick(s,'preclear fallback completed, current primary pending').resultEntries,[]);
    check(s,'preclear success still warms underlying cache',pick(s,'preclear fallback completed, current primary pending').cacheWrites,1);
    break;}
  case 'older active member retains fallback updates':
    check(s,'older token remains an active member alongside the newer token',pick(s,'two active members').activeTokens,[1,2]);
    check(s,'real fallback keeps both token memberships',pick(s,'older active fallback pending').activeTokens,[1,2]);
    check(s,'older active member may still update accessible status',descriptions(pick(s,'older active fallback pending')),[fallback]);
    check(s,'older active completion removes only its own token',pick(s,'older active member completed').activeTokens,[2]);
    check(s,'both active members successful work warms cache',s.cacheWrites.length,2);break;
  case 'current provider exhaustion cleans up':
    check(s,'current fallback updates before provider exhaustion',descriptions(pick(s,'current fallback pending')),[fallback]);
    check(s,'exhausted current request removes status',pick(s,'current request exhausted').statusStack,null);
    check(s,'failed request does not warm cache',s.cacheWrites.length,0);
    check(s,'provider exhaustion keeps the ordinary error notification',s.errors.some(e=>e.event==='toast'),true);break;
  case 'current request legitimate fallback':
    check(s,'current fallback updates accessible provider',descriptions(pick(s,'current fallback pending')),[fallback]);break;
  case 'new request legitimate fallback after retired callback':
    check(s,'current and old sources both reach fallback',pick(s,'current fallback pending').requests.map(q=>q.provider),['ai-primary','ai-primary','ai-fallback','ai-fallback']);
    check(s,'current fallback updates and keeps its accessible provider after old completion',['current fallback pending','retired completed'].map(l=>descriptions(pick(s,l))),[[fallback],[fallback]]);break;
  case 'clear without successor':case 'clear all without successor':
    check(s,'retired fallback cannot recreate status without active tokens',pick(s,'cleared request fallback pending').statusStack,null);
    check(s,'cleared request cannot publish component note',last.resultEntries,[]);
    check(s,'cleared successful request still warms cache',s.cacheWrites.length,1);break;
  case 'new request completes before retired fallback':
    check(s,'late fallback after current completion cannot restart loading',pick(s,'retired fallback after current completion').generationPills['cultural-annotations'].phase,'complete');
    check(s,'completion accessible text has no old provider',descriptions(pick(s,'retired fallback after current completion')),[`${label} 완료!`]);break;
  case 'pending duplicate current source':
    check(s,'same pending source shares existing request and token',[pick(s,'duplicate admitted').requests.length,pick(s,'duplicate admitted').activeTokens],[1,[1]]);break;
  case 'completed current cache reuse':
    check(s,'cached source does not create another provider call',last.requests.length,1);break;
  case 'feature disabled':case 'provider capability disabled':case 'providers explicitly disabled':
    check(s,'no external annotation provider starts',last.requests.length,0);break;
  case 'reversed configured provider order':
    check(s,'actual stored order is honored',last.requests.map(q=>q.provider),['ai-fallback','ai-primary']);break;
  case 'single enabled provider, retired failure':
    check(s,'one enabled provider has no second-provider label callback',descriptions(pick(s,'retired request exhausted')),[primary]);
    check(s,'only primary transports run',last.requests.map(q=>q.provider),['ai-primary','ai-primary']);break;
  case 'distinct providers with same display name':
    check(s,'same names produce no observable description change',descriptions(pick(s,'retired fallback same name')),descriptions(pick(s,'new primary pending')));break;
  }
}

// These are flat tests: failed parent summaries cannot inflate assertion counts.
for (const {scenario,queued,label,category,actual,expected} of checks) {
  const scheduler = queued === null ? 'source' : queued ? 'queued' : 'immediate';
  test(`${scheduler}: ${scenario}: ${category}: ${label}`, () => {
    assert.deepEqual(actual, expected);
  });
}
