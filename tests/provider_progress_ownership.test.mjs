import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { createHarness, A, B, track, plain, extractionManifest } from './helpers/provider_progress_harness.mjs';
const observations=[];
const freeze=value=>JSON.parse(JSON.stringify(value));
async function start(options={}){const h=createHarness(options);await h.play(track(A));h.expire();await h.settle();return h;}
async function refresh(h){const before=h.providerCalls.length;await h.clearCurrent();await h.releaseClear();h.expire();await h.settle();}
async function staleAfterRefresh(options={}) {
 const h=await start(options);const initial=h.view();await refresh(h);const before=h.view();
 h.provider('spotify',0).resolve(null);await h.settle();const after=h.view();



 const oldFallback=h.provider('lrclib');oldFallback.resolve(h.result(oldFallback,'obsolete fallback result'));await h.settle();
 const oldDone=freeze({view:h.view(),cache:h.context.CACHE[A],snapshots:h.snapshots,providerCacheWrites:h.cacheWrites,activeProgress:h.manager.getActiveLyricsSearchProgress(A,null,h.c._lyricsProgressRequestId)});


 const newPrimary=h.provider('spotify',1);newPrimary.resolve(h.result(newPrimary,'fresh primary result'));await h.settle();
 const completed=h.view();
 const calls=freeze(h.providerCalls.map(q=>({id:q.id,uri:q.info.uri,settled:q.settled})));const progress=freeze(h.progress);const stats=freeze(h.statsCalls);
 const drain=await h.finishAll();
 observations.push({name:`stale-after-current-cache-refresh:${options.typeFirst===false?'provider-first':'default-type-first'}:${options.queuedState?'queued':'sync'}`,initial,before,after,oldDone,completed,calls,progress,stats,drain,desired:{beforeProvider:'Primary',afterProvider:'Primary',currentToken:[2],currentProvider:'spotify'}});
}
async function joinControl(){
 const h=await start();const before=h.view();const joined=h.c.fetchLyrics(track(A));await h.settle();h.expire();await h.settle();const after=h.view();

 const p=h.provider('spotify');p.resolve(h.result(p));await h.settle();await joined;const completed=h.view();const progress=freeze(h.progress);const drain=await h.finishAll();
 observations.push({name:'same-generation-same-key-join-and-replay',before,after,completed,progress,drain});
}
async function legitimateFallback({foreignClear=false}={}){
 const h=await start();const before=h.view();if(foreignClear)h.context.window.LyricsService.clearLyricsSnapshot(B);
 h.provider('spotify').resolve(null);await h.settle();const after=h.view();
 const f=h.provider('lrclib');f.resolve(h.result(f,'legitimate fallback'));await h.settle();const completed=h.view();
 const progress=freeze(h.progress);const drain=await h.finishAll();observations.push({name:foreignClear?'still-owned-current-fallback-after-other-uri-generation-clear':'legitimate-current-fallback',before,after,completed,progress,drain});
}
async function foreignUri(){
 const h=await start();await h.play(track(B));h.expire();await h.settle();const before=h.view();h.provider('spotify',0,A).resolve(null);await h.settle();const after=h.view();
 const f=h.provider('lrclib',0,A);f.resolve(h.result(f,'A cache warming'));await h.settle();const oldDone=freeze({view:h.view(),cacheA:h.context.CACHE[A],snapshotA:h.context.window.LyricsService.getLyricsSnapshot(A)});
 const p=h.provider('spotify',0,B);p.resolve(h.result(p,'B result'));await h.settle();const completed=h.view();const drain=await h.finishAll();observations.push({name:'foreign-uri-progress-and-cache-warming',before,after,oldDone,completed,drain});
}
async function repeatedRefresh(){
 const h=await start({queuedState:true});await refresh(h);await refresh(h);const before=h.view();
 h.provider('spotify',0).resolve(null);await h.settle();const afterFirstOld=h.view();h.provider('spotify',1).resolve(null);await h.settle();const afterSecondOld=h.view();
 for(let i=0;i<2;i++){const f=h.provider('lrclib',i);f.resolve(h.result(f,`obsolete ${i}`));await h.settle();}
 const oldDone=h.view();
 const p=h.provider('spotify',2);p.resolve(h.result(p,'third current result'));await h.settle();const completed=h.view();
 const progress=freeze(h.progress);const drain=await h.finishAll();observations.push({name:'two-current-cache-refreshes',before,afterFirstOld,afterSecondOld,oldDone,completed,progress,drain,desired:{afterFirstOldProvider:'Primary',afterSecondOldProvider:'Primary',currentToken:[3]}});
}
async function inactiveTokenControl(){
 const h=await start();await refresh(h);const p=h.provider('spotify',1);p.resolve(h.result(p,'current completes first'));await h.settle();const before=h.view();
 h.provider('spotify',0).resolve(null);await h.settle();const after=h.view();
 const f=h.provider('lrclib');f.resolve(h.result(f,'older completion after newer'));await h.settle();const oldDone=h.view();const drain=await h.finishAll();observations.push({name:'old-progress-after-current-token-completed',before,after,oldDone,drain});
}

// This added boundary uses the public fetch method; the first nine scenarios
// retain the ordinary enabled Settings current-cache button witness.
async function joinAfterRetiredExhaustion(queuedState) {
 const h=createHarness({queuedState});
 await h.play(track(A));h.expire();await h.settle();
 await h.clearCurrent();await h.releaseClear();h.expire();await h.settle();
 const refreshed=h.view();

 h.provider('spotify',0).resolve(null);await h.settle();
 h.provider('lrclib',0).resolve(null);await h.settle();
 const oldDone={view:h.view(),activeProgress:h.manager.getActiveLyricsSearchProgress(A,null,h.c._lyricsProgressRequestId),cache:plain(h.context.CACHE[A])};



 const callCount=h.providerCalls.length;
 const joined=h.c.fetchLyrics(track(A));await h.settle();h.expire();await h.settle();
 const afterJoin=h.view();const afterJoinCallCount=h.providerCalls.length;



 const primary=h.provider('spotify',1);primary.resolve(h.result(primary,'current joined result'));
 await h.settle();await joined;
 const complete=h.view();
 const drain=await h.finishAll();
 observations.push({name:`public-method-join-after-retired-exhaustion:${queuedState ? "queued" : "sync"}`,queuedState,refreshed,oldDone,afterJoin,complete,callCount,afterJoinCallCount,progress:plain(h.progress),drain});
}

test('provider progress stays with the admitted loader through refresh, fallback and join', async (t) => {
 await staleAfterRefresh();
 await staleAfterRefresh({queuedState:true});
 await staleAfterRefresh({typeFirst:false});
 await joinControl();
 await legitimateFallback();
 await legitimateFallback({foreignClear:true});
 await foreignUri();
 await repeatedRefresh();
 await inactiveTokenControl();
 await joinAfterRetiredExhaustion(false);
 await joinAfterRetiredExhaustion(true);
 for (const observation of observations) delete observation.desired;
 if (process.env.IVLYRICS_PROGRESS_EVIDENCE) {
  writeFileSync(join(process.env.IVLYRICS_PROGRESS_EVIDENCE,'observed.json'), JSON.stringify({frozenAfterAllScenariosDrained:true,observations},null,2)+'\n');
  writeFileSync(join(process.env.IVLYRICS_PROGRESS_EVIDENCE,'extraction-manifest.json'), JSON.stringify(extractionManifest(),null,2)+'\n');
 }
 for (const observation of observations) {
  assert.equal(observation.drain.promisesDrained,true);
  for (const key of ['timers','stateQueue','activeTokens','serviceInflight','progressEntries','errors']) assert.equal(observation.drain[key],0);
 }
 const { checks } = JSON.parse(readFileSync(new URL('./helpers/provider_progress_desired.json',import.meta.url),'utf8'));
 for (const check of checks) {
  await t.test(`${check.scenario}: ${check.path}`, () => {
   const observation=observations.find(row=>row.name===check.scenario);
   const actual=check.path.split('.').reduce((value,key)=>value?.[key],observation);
   assert.deepEqual(actual,check.expected);
  });
 }
 for (const observation of observations.filter(row=>row.oldDone?.activeProgress!==undefined)) {
  await t.test(`${observation.name}: retired cleanup preserves current Primary progress`,()=> {
   assert.equal(observation.oldDone.activeProgress?.providerName,'Primary');
  });
 }
 for (const row of observations.filter(row=>row.name.startsWith('public-method-join'))) {
  await t.test(`${row.name}: replays current owner without duplicate providers`,()=> {
   assert.equal(row.oldDone.cache,undefined);
   assert.deepEqual(row.oldDone.view.token,[2]);
   assert.equal(row.afterJoinCallCount,row.callCount);
   assert.deepEqual(row.afterJoin.token,[3]);
   assert.equal(row.afterJoin.loadingLabelText,'Primary');
   assert.equal(row.complete.provider,'spotify');
   assert.equal(row.complete.accessibleDescription,'Primary Complete!');
  });
 }
});

// Direct API compatibility controls. These do not claim an ordinary Settings path.
test('same-key admission and initial progress can reenter before providers start', async () => {
 const h=createHarness();
 const service=h.context.window.LyricsService;
 let originalId,admissionJoinId,progressJoinId,admissionJoin,progressJoin;
 let admissionSawProgress,initialSawOwner,progressJoinStarted=false;
 const stop=h.manager.on('lyrics:search:progress', detail=> {
  if (!detail.replayed && !progressJoinStarted) {
   progressJoinStarted=true;
   initialSawOwner=originalId===detail.requestId;
   progressJoin=service.getLyricsFromProviders(track(A),[],1,null,id=>{progressJoinId=id;});
  }
 });
 const original=service.getLyricsFromProviders(track(A),[],1,null,id=> {
  originalId=id;
  admissionSawProgress=h.manager.getActiveLyricsSearchProgress(A,null,id);
  admissionJoin=service.getLyricsFromProviders(track(A),[],1,null,owner=>{admissionJoinId=owner;});
 });
 const synchronousProgress=h.manager.getActiveLyricsSearchProgress(A,null,originalId);
 await h.settle();
 const callCount=h.providerCalls.length;
 const active=h.manager.getActiveLyricsSearchProgress(A,null,originalId);
 for (const provider of h.providerCalls) provider.resolve(h.result(provider,'joined direct API result'));
 const results=await Promise.all([original,admissionJoin,progressJoin]);
 stop();const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.equal(admissionSawProgress,null);
 assert.equal(initialSawOwner,true);
 assert.equal(synchronousProgress.requestId,originalId);
 assert.equal(synchronousProgress.stage,'sync-data');
 assert.equal(typeof originalId,'symbol');
 assert.equal(admissionJoinId,originalId);
 assert.equal(progressJoinId,originalId);
 assert.equal(active.requestId,originalId);
 assert.equal(callCount,1);
 for (const result of results) assert.equal(result.provider,'spotify');
});

for (const throwingCaller of ['original','join']) {
 test(`throwing ${throwingCaller} admission callback leaves the admitted work joinable`, async () => {
  const h=createHarness();const service=h.context.window.LyricsService;
  const failure=new Error('inert admission failure');let owner,joinedOwner;
  let original,failed;
  if (throwingCaller==='original') {
   failed=service.getLyricsFromProviders(track(A),[],1,null,id=>{owner=id;throw failure;}).catch(error=>error);
  } else {
   original=service.getLyricsFromProviders(track(A),[],1,null,id=>{owner=id;});
   failed=service.getLyricsFromProviders(track(A),[],1,null,()=>{throw failure;}).catch(error=>error);
  }
  const joined=service.getLyricsFromProviders(track(A),[],1,null,id=>{joinedOwner=id;});
  await h.settle();
  const callCount=h.providerCalls.length;
  const active=h.manager.getActiveLyricsSearchProgress(A,null,owner);
  const p=h.provider('spotify');p.resolve(h.result(p));
  const [error,result]=await Promise.all([failed,joined]);if(original)await original;
  const drain=await h.finishAll();
  assert.equal(drain.promisesDrained,true);
  assert.equal(error,failure);
  assert.equal(typeof owner,'symbol');
  assert.equal(joinedOwner,owner);
  assert.equal(active.requestId,owner);
  assert.equal(callCount,1);
  assert.equal(result.provider,'spotify');
 });
}

test('direct manager omitted-owner calls keep separate entries and legacy URI/provider access', async () => {
 const h=createHarness();const m=h.manager;
 const old=m.getLyrics(track(A));await h.settle();
 const oldProgress=m.getActiveLyricsSearchProgress(A);
 const current=m.getLyrics(track(A));await h.settle();
 const currentProgress=m.getActiveLyricsSearchProgress(A);
 const lookupOld=m.getActiveLyricsSearchProgress(A,null,oldProgress.requestId);
 const lookupCurrent=m.getActiveLyricsSearchProgress(A,null,currentProgress.requestId);
 const wrongUri=m.getActiveLyricsSearchProgress(B,null,currentProgress.requestId);
 const wrongProvider=m.getActiveLyricsSearchProgress(A,'lrclib',currentProgress.requestId);
 h.provider('spotify',0).resolve(null);await h.settle();
 const afterOldPublish=m.getActiveLyricsSearchProgress(A);
 const scopedCurrentAfterOldPublish=m.replayActiveLyricsSearchProgress(A,null,currentProgress.requestId);
 const legacyReplayAfterOldPublish=m.replayActiveLyricsSearchProgress(A);
 h.provider('lrclib',0).resolve(null);await old;await h.settle();
 const afterOldCleanup=m.getActiveLyricsSearchProgress(A,null,currentProgress.requestId);
 const legacyAfterOldCleanup=m.getActiveLyricsSearchProgress(A);
 const oldGone=m.getActiveLyricsSearchProgress(A,null,oldProgress.requestId);
 const replay=m.replayActiveLyricsSearchProgress(A,null,currentProgress.requestId);
 // Explicit cleanup must only remove that exact entry; repeated old cleanup is inert.
 m.clearActiveLyricsSearchProgress(A,null,oldProgress.requestId);
 const afterRepeatedCleanup=m.getActiveLyricsSearchProgress(A,null,currentProgress.requestId);
 const p=h.provider('spotify',1);p.resolve(h.result(p));await current;
 const empty=m.getActiveLyricsSearchProgress(A);
 const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.equal(typeof oldProgress.requestId,'symbol');
 assert.notEqual(oldProgress.requestId,currentProgress.requestId);
 assert.equal(lookupOld.requestId,oldProgress.requestId);
 for (const progress of [lookupCurrent,scopedCurrentAfterOldPublish,afterOldCleanup,replay,afterRepeatedCleanup]) {
  assert.equal(progress.requestId,currentProgress.requestId);
  assert.equal(progress.providerName,'Primary');
 }
 assert.equal(afterOldPublish.requestId,oldProgress.requestId);
 assert.equal(afterOldPublish.providerName,'Fallback');
 assert.equal(legacyReplayAfterOldPublish.requestId,oldProgress.requestId);
 assert.equal(legacyReplayAfterOldPublish.providerName,'Fallback');
 assert.equal(replay.replayed,true);
 assert.equal(wrongUri,null);assert.equal(wrongProvider,null);
 assert.equal(legacyAfterOldCleanup,null);
 assert.equal(oldGone,null);assert.equal(empty,null);
});

test('legacy clear without owner clears its URI/provider entries only', async () => {
 const h=createHarness();const m=h.manager;
 const first=m.getLyrics(track(A));await h.settle();
 const second=m.getLyrics(track(A));await h.settle();
 const foreign=m.getLyrics(track(B));await h.settle();
 const forced=m.getLyrics(track(A),'lrclib');await h.settle();
 const firstOwner=[...m._activeLyricsSearchProgress.values()].find(p=>p.uri===A&&p.forcedProviderId===null).requestId;
 m.clearActiveLyricsSearchProgress(A);
 const cleared=m.getActiveLyricsSearchProgress(A);
 const clearedOwner=m.getActiveLyricsSearchProgress(A,null,firstOwner);
 const keptForeign=m.getActiveLyricsSearchProgress(B);
 const keptForced=m.getActiveLyricsSearchProgress(A,'lrclib');
 for(const p of h.providerCalls)p.resolve(h.result(p));
 await Promise.all([first,second,foreign,forced]);
 const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.equal(cleared,null);assert.equal(clearedOwner,null);
 assert.equal(keptForeign.uri,B);assert.equal(keptForced.forcedProviderId,'lrclib');
});

test('newer completion does not resurrect the older legacy slot; empty admission clears it', async () => {
 const h=createHarness();const m=h.manager;
 const old=m.getLyrics(track(A));await h.settle();
 const oldOwner=m.getActiveLyricsSearchProgress(A).requestId;
 const current=m.getLyrics(track(A));await h.settle();
 const p=h.provider('spotify',1);p.resolve(h.result(p));await current;
 const legacyAfterCurrent=m.getActiveLyricsSearchProgress(A);
 const retainedOld=m.getActiveLyricsSearchProgress(A,null,oldOwner);
 h.provider('spotify',0).resolve(null);await h.settle();
 const oldRepublished=m.getActiveLyricsSearchProgress(A);
 // A missing forced provider has no initial progress. Its admission still clears
 // its own legacy slot synchronously without erasing another owner's storage.
 const forced=m.getLyrics(track(B),'lrclib');await h.settle();
 const forcedOwner=m.getActiveLyricsSearchProgress(B,'lrclib').requestId;
 m._addons.get('lrclib').defaultEnabled=false;
 const unavailable=m.getLyrics(track(B),'lrclib');
 const legacyAtUnavailableAdmission=m.getActiveLyricsSearchProgress(B,'lrclib');
 const retainedForced=m.getActiveLyricsSearchProgress(B,'lrclib',forcedOwner);
 const unavailableResult=await unavailable;
 const f=h.provider('lrclib',0);f.resolve(h.result(f));
 const b=h.provider('lrclib',0,B);b.resolve(h.result(b));
 await Promise.all([old,forced]);const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.equal(legacyAfterCurrent,null);
 assert.equal(retainedOld.requestId,oldOwner);
 assert.equal(oldRepublished.requestId,oldOwner);
 assert.equal(oldRepublished.providerName,'Fallback');
 assert.equal(legacyAtUnavailableAdmission,null);
 assert.equal(retainedForced.requestId,forcedOwner);
 assert.equal(unavailableResult.error,'Selected lyrics provider is not available');
});

test('direct manager rejection releases owned storage and preserves the legacy error slot', async () => {
 const h=createHarness();const m=h.manager;
 const failure=new Error('inert ISRC rejection');
 h.context.window.SyncDataService.resolveTrackIsrc=async()=>{throw failure;};
 const first=m.getLyrics(track(A)).catch(error=>error);
 const firstOwner=m.getActiveLyricsSearchProgress(A).requestId;
 const second=m.getLyrics(track(A)).catch(error=>error);
 const secondOwner=m.getActiveLyricsSearchProgress(A).requestId;
 const errors=await Promise.all([first,second]);
 const firstOwned=m.getActiveLyricsSearchProgress(A,null,firstOwner);
 const secondOwned=m.getActiveLyricsSearchProgress(A,null,secondOwner);
 const ownedCount=m._lyricsSearchProgressByRequest?.size ?? null;
 const legacy=m.getActiveLyricsSearchProgress(A);
 // The pre-existing direct error contract leaves its one legacy slot until clear.
 m.clearActiveLyricsSearchProgress(A);
 const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.deepEqual(errors,[failure,failure]);
 assert.notEqual(firstOwner,secondOwner);
 assert.equal(firstOwned,null);assert.equal(secondOwned,null);assert.equal(ownedCount,0);
 assert.equal(legacy.requestId,secondOwner);assert.equal(legacy.stage,'sync-data');
});

test('snapshot-publication listener joins and replays until the service inflight entry retires', async () => {
 const h=createHarness();const service=h.context.window.LyricsService;
 let owner,joinedOwner,joined,progressAtJoin,replayedOwner;
 const stop=h.manager.on('lyrics:search:progress',detail=> {
  if(detail.replayed) replayedOwner=detail.requestId;
 });
 h.context.window.addEventListener('ivLyrics:shared-lyrics-updated',()=> {
  joined=service.getLyricsFromProviders(track(A),[],1,null,id=>{joinedOwner=id;});
  progressAtJoin=h.manager.getActiveLyricsSearchProgress(A,null,joinedOwner);
 });
 const initial=service.getLyricsFromProviders(track(A),[],1,null,id=>{owner=id;});
 await h.settle();const p=h.provider('spotify');p.resolve(h.result(p));
 const result=await initial;const joinedResult=await joined;
 const calls=h.providerCalls.length;
 const afterRetirement=h.manager.getActiveLyricsSearchProgress(A,null,owner);
 stop();const drain=await h.finishAll();
 assert.equal(drain.promisesDrained,true);
 assert.equal(typeof owner,'symbol');assert.equal(joinedOwner,owner);
 assert.equal(progressAtJoin?.requestId,owner);
 assert.equal(progressAtJoin?.providerName,'Primary');
 assert.equal(replayedOwner,owner);
 assert.equal(calls,1);assert.equal(joinedResult,result);
 assert.equal(afterRetirement,null);
});
