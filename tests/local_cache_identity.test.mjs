import assert from 'node:assert/strict';
import test from 'node:test';
import {cacheHarness,realClearOpenFailure,A,B,track,plain} from './helpers/local_cache_harness.mjs';
const id=uri=>uri?.split(':')[2];
const events=h=>h.trace.map(e=>e.event);
const summary=h=>({trace:plain(h.trace),state:h.state(),toasts:plain(h.toasts),errors:h.errors.map(args=>args.map(String)),actionErrors:h.actions.filter(a=>a.error).map(a=>String(a.error))});
const scenarios=[
 {name:'matching ready A',accepted:track(A),publicItem:track(A),want:A},
 {name:'accepted ready A public lag B',accepted:track(A),publicItem:track(B),want:A},
 {name:'accepted URI-only A public lag B',accepted:{uri:A},publicItem:track(B),want:A},
 {name:'accepted URI-only A matching public A',accepted:{uri:A},publicItem:{uri:A},want:A},
 {name:'accepted ready A absent public',accepted:track(A),publicItem:null,want:A},
 {name:'accepted URI-only A absent public',accepted:{uri:A},publicItem:null,want:A},
 {name:'no internal item ordinary public A',accepted:null,publicItem:track(A),want:A},
 {name:'internal lacks URI ordinary public A',accepted:{metadata:{}},publicItem:track(A),want:A},
 {name:'helper unavailable ordinary public A',accepted:track(A),publicItem:track(A),helper:'absent',want:A},
 {name:'Utils unavailable ordinary public A',accepted:track(A),publicItem:track(A),helper:'utils-absent',want:A},
 {name:'helper unavailable public lag cannot reveal accepted URI',accepted:track(A),publicItem:track(B),helper:'absent',want:B},
 {name:'synthetic null snapshot public lag uses public compatibility',accepted:track(A),publicItem:track(B),helper:'null',want:B},
 {name:'synthetic null snapshot ordinary public A',accepted:null,publicItem:track(A),helper:'null',want:A},
 {name:'synthetic undefined snapshot ordinary public A',accepted:null,publicItem:track(A),helper:'undefined',want:A},
 {name:'synthetic URI-less snapshot ordinary public A',accepted:null,publicItem:track(A),helper:'empty',want:A},
 {name:'actual no input',accepted:null,publicItem:null,want:null},
 {name:'helper unavailable no public input',accepted:track(A),publicItem:null,helper:'absent',want:null},
 {name:'synthetic null snapshot no public input',accepted:null,publicItem:null,helper:'null',want:null},
];
for(const fallbackClock of [false,true])for(const scenario of scenarios)test(`origin ${scenario.name}; fallbackClock=${fallbackClock}`,async()=>{
 const h=cacheHarness({...scenario,fallbackClock});
 try{
  // The accepted snapshot remains authoritative while component state is stale.
  h.container.currentTrackUri=B;h.container.state={uri:B};
  await h.mount();const snapshot=plain(h.snapshot()),resolved=plain(h.resolved());
  if(scenario.helper==='absent')delete h.context.window.Utils.getPlayerPlaybackSnapshot;
  else if(scenario.helper==='utils-absent')delete h.context.window.Utils;
  else if(scenario.helper)h.context.window.Utils.getPlayerPlaybackSnapshot=()=>scenario.helper==='null'?null:scenario.helper==='empty'?{}:undefined;
  const call=h.click();await h.settle();const beforeReload=summary(h);await h.finish();await call;
  // Drain all actual callback work before asserting the captured origin.
  const origin=scenario.want;
  if (!scenario.helper && scenario.accepted?.uri === A) assert.equal(snapshot.uri,A);
  if (scenario.accepted?.uri === A && !scenario.accepted.metadata && scenario.publicItem?.uri === B) assert.equal(resolved,null);
  const cleared=h.gates.filter(g=>g.kind==='clear-track').map(g=>g.id);
  assert.deepEqual(cleared,origin?[id(origin)]:[]);
  if(origin){
   assert.equal(beforeReload.trace.some(e=>e.event==='reload'),false);
   for(const event of ['translator-memory','translator-inflight','sync-clear'])assert.equal(h.trace.find(e=>e.event===event).args[0],id(origin));
   assert.equal(h.trace.find(e=>e.event==='cultural-track').args[0],origin);
   assert.equal(h.trace.find(e=>e.event==='cache-manager').uri,origin);
   assert.equal(beforeReload.state.cache[origin],undefined);assert.equal(beforeReload.state.dm[origin],undefined);
   const other=origin===A?B:A;assert.ok(beforeReload.state.cache[other]);assert.ok(beforeReload.state.dm[other]);
   for(const event of ['_inflightGemini','_inflightTrad'])assert.deepEqual(h.trace.find(e=>e.event===event).selected,[`${origin}:fixture`]);
   assert.deepEqual(h.trace.filter(e=>e.event==='reload').map(e=>e.args),[[false]]);
   assert.deepEqual(h.toasts,[{kind:'success',message:'notifications.localCacheTrackCleared'}]);
  }else{
   assert.deepEqual(h.toasts,[{kind:'error',message:'notifications.noTrackPlaying'}]);
   assert.equal(h.trace.filter(e=>['reload','cultural-track','sync-clear','cache-manager'].includes(e.event)).length,0);
  }
 }finally{await h.finish();}
});

test('current invalidation order and pre-await scope are preserved',async()=>{
 const h=cacheHarness();try{await h.mount();h.trace.length=0;const cache=h.cache,dm=h.container._dmResults;h.click();await h.settle();const pre=summary(h);await h.finish();
 assert.deepEqual(pre.trace.map(e=>e.event),['translator-memory','translator-inflight','cultural-track','cache-manager','cache-delete','dm-delete','_inflightGemini','_inflightTrad','sync-clear','clear-track-start']);
 assert.deepEqual(events(h).slice(-5),['clear-track-complete','stats-start','stats-complete','reload','toast-success']);
 assert.equal(h.cache,cache);assert.equal(h.container._dmResults,dm);
 assert.deepEqual(h.trace.find(e=>e.event==='sync-clear').args,[id(A),{preserveOpenDb:true}]);
 assert.deepEqual(h.trace.find(e=>e.event==='cultural-track').args,[A,{updateState:true}]);
 }finally{await h.finish();}
});
for(const changeAt of ['render-to-click','clear-await','stats-await'])test(`click-time identity captured across ${changeAt}`,async()=>{
 const h=cacheHarness();try{await h.mount();const renderedButton=h.button('Current');
 if(changeAt==='render-to-click')h.play(track(B));
 const call=h.click('Current',renderedButton);await h.settle();
 if(changeAt==='clear-await')h.play(track(B));
 h.pending('clear-track')[0].resolve();await h.settle();
 if(changeAt==='stats-await')h.play(track(B));
 await h.finish();await call;
 const origin=changeAt==='render-to-click'?B:A;
 assert.equal(h.gates.find(g=>g.kind==='clear-track').id,id(origin));
 for(const event of ['translator-memory','translator-inflight','sync-clear'])assert.equal(h.trace.find(e=>e.event===event).args[0],id(origin));
 assert.equal(h.trace.find(e=>e.event==='cultural-track').args[0],origin);
 assert.deepEqual(h.trace.filter(e=>e.event==='reload').map(e=>e.args),[[false]]);
 assert.equal(h.toasts.at(-1).message,'notifications.localCacheTrackCleared');
 }finally{await h.finish();}
});

// These are the selected error-boundary policy for the new helper dependency,
// separate from the established public/accepted-origin regressions above.
for (const fallbackClock of [false, true]) {
 test(`snapshot failure is logged without a public fallback; fallbackClock=${fallbackClock}`, async () => {
  const h = cacheHarness({ accepted: track(A), publicItem: track(B), fallbackClock });
  try {
   await h.mount();
   const before = h.state();
   const failure = Error('inert playback progress failure');
   h.spicetify.Player.getProgress = () => { throw failure; };
   h.trace.length = 0;
   const click = h.click();
   await h.finish();
   await click;
   assert.deepEqual(h.trace, [], 'no cache mutations, reload or notifications');
   assert.deepEqual(h.state(), before);
   assert.equal(h.actions.filter(action => action.error).length, 0);
   assert.equal(h.errors.length, 1);
   assert.equal(h.errors[0][0], '[LocalCacheManager] Clear track failed:');
   assert.equal(h.errors[0][1], failure);
  } finally {
   await h.finish();
  }
 });
}
for(const readiness of ['initial-loading','stats-zero','stats-unavailable','stats-failure','stats-youtube-only'])test(`actual button readiness ${readiness}`,async()=>{
 const h=cacheHarness();try{
  h.render();const firstCurrent=h.button('Current').props.disabled,firstAll=h.button('All').props.disabled;h.runEffects();
  if(readiness==='stats-failure')h.pending('stats')[0].reject('inert stats failure');
  else if(readiness!=='initial-loading')h.pending('stats')[0].resolve(readiness==='stats-unavailable'?null:readiness==='stats-youtube-only'?{youtube:1}:{});
  await h.settle();const current=h.button('Current').props.disabled,all=h.button('All').props.disabled;
  h.click();await h.finish();
  assert.equal(firstCurrent,undefined);assert.equal(firstAll,true);assert.equal(current,undefined);assert.equal(all,readiness!=='stats-youtube-only');
  assert.equal(h.gates.filter(g=>g.kind==='clear-track').length,1);assert.equal(h.toasts.at(-1).kind,'success');
  assert.equal(h.errors.length,readiness==='stats-failure'?1:0);
 }finally{await h.finish();}
});

test('clear-all remains unscoped and requires positive stats, even with no playback',async()=>{
 const h=cacheHarness({accepted:null,publicItem:null});try{await h.mount({lyrics:1});h.trace.length=0;const oldDm=h.container._dmResults,cache=h.cache;h.click('All');await h.settle();const pre=summary(h);await h.finish();
 assert.equal(h.cache,cache);assert.notEqual(h.container._dmResults,oldDm);assert.deepEqual(pre.state,{cache:{},dm:{},translated:[]});
 assert.deepEqual(pre.trace.map(e=>e.event),['translator-all-memory','translator-all-inflight','cultural-all','cache-manager-all','cache-delete','cache-delete','cache-delete','_inflightGemini','_inflightTrad','sync-clear','clear-all-start']);
 for(const event of ['_inflightGemini','_inflightTrad'])assert.equal(h.trace.find(e=>e.event===event).selected.length,4);
 assert.deepEqual(h.trace.find(e=>e.event==='sync-clear').args,[null,{preserveOpenDb:true}]);
 assert.deepEqual(h.trace.filter(e=>e.event==='reload').map(e=>e.args),[[false]]);assert.equal(h.toasts.at(-1).message,'notifications.localCacheCleared');
 }finally{await h.finish();}
});

test('real LyricsCache open failure returns false; current button still reloads and reports success',async()=>{
 const result=await realClearOpenFailure();const h=cacheHarness();try{await h.mount();h.click();h.pending('clear-track')[0].resolve(result.result);await h.finish();assert.deepEqual(result,{result:false,logs:1});assert.equal(h.toasts.at(-1).kind,'success');assert.deepEqual(h.trace.filter(e=>e.event==='reload').map(e=>e.args),[[false]]);}finally{await h.finish();}
});
for(const failure of ['translator','sync','persistent','stats-after-clear','reload-sync'])test(`preserved failure boundary ${failure}`,async()=>{
 const h=cacheHarness();try{await h.mount();
 if(failure==='translator')h.context.window.Translator.clearMemoryCache=()=>{throw Error('inert translator failure');};
 if(failure==='sync')h.context.window.SyncDataService.clearCache=()=>{throw Error('inert sync failure');};
 if(failure==='reload-sync')h.context.reloadLyrics=()=>{throw Error('inert reload failure');};
 h.click();await h.settle();
 if(failure==='persistent')h.pending('clear-track')[0].reject('inert persistent failure');
 if(failure==='stats-after-clear'){h.pending('clear-track')[0].resolve();await h.settle();h.pending('stats')[0].reject('inert post-clear stats failure');}
 await h.finish();assert.equal(h.errors.length,1);assert.equal(h.actions.filter(a=>a.error).length,0);
 assert.equal(h.toasts.length,failure==='stats-after-clear'?1:0);
 assert.equal(h.trace.filter(e=>e.event==='reload').length,failure==='stats-after-clear'?1:0);
 assert.equal(h.gates.filter(g=>g.kind==='clear-track').length,['translator','sync'].includes(failure)?0:1);
 }finally{await h.finish();}
});

test('button success does not await global reload continuation',async()=>{
 const h=cacheHarness();let resolve;const pending=new Promise(r=>{resolve=r;});let finished=false;pending.then(()=>{finished=true;});
 try{await h.mount();h.context.reloadLyrics=(...args)=>{h.trace.push({event:'reload',args});return pending;};const click=h.click();await h.finish();await click;assert.equal(finished,false);assert.equal(h.toasts.at(-1).kind,'success');}finally{resolve();await pending;await h.finish();}
});
for(const uri of ['spotify:local:Artist:Album:Song:200','spotify:episode:CCCCCCCCCCCCCCCCCCCCCC','spotify:media:DDDDDDDDDDDDDDDDDDDDDD','unparseable','spotify:track:'])test(`legacy split-ID characterization ${uri}`,async()=>{
 const h=cacheHarness({accepted:track(uri),publicItem:track(uri)});try{await h.mount();h.click();await h.finish();const trackId=id(uri);assert.deepEqual(h.gates.filter(g=>g.kind==='clear-track').map(g=>g.id),trackId?[trackId]:[]);assert.equal(h.toasts.at(-1).kind,trackId?'success':'error');}finally{await h.finish();}
});
for(const fallbackClock of[false,true])test(`actual snapshot helper return and throw contract; fallbackClock=${fallbackClock}`,async()=>{
 const h=cacheHarness({accepted:{uri:A},publicItem:track(B),fallbackClock});try{const withUri=plain(h.snapshot()),stable=plain(h.resolved());h.play(null,null);const absent=plain(h.snapshot());h.play(null,track(B));const ordinaryFallback=plain(h.snapshot());h.spicetify.Player.getProgress=()=>{throw Error('inert progress failure');};let thrown;try{h.snapshot();}catch(error){thrown=error.message;}assert.equal(withUri.uri,A);assert.equal(withUri.item.metadata,undefined);assert.equal(stable,null);assert.equal(absent.uri,null);assert.equal(typeof absent,'object');assert.equal(ordinaryFallback.uri,B);assert.equal(thrown,'inert progress failure');}finally{await h.finish();}
});
