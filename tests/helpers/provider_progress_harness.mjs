import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { harness as reloadHarness, A, B, track, plain, root as helperRoot } from './reload_harness.mjs';
import { controls } from './reload_settings.mjs';
export { A, B, track, plain };
assert.equal(helperRoot.href, new URL('../../',import.meta.url).href, 'helper source must be isolated pinned checkout');
const texts = Object.fromEntries(['index.js','LyricsService.js','LyricsAddonManager.js','Settings.js','style.css','PlaybackClock.js','tests/helpers/reload_harness.mjs','tests/helpers/reload_settings.mjs'].map(name=>[name,readFileSync(new URL(`../../${name}`,import.meta.url),'utf8')]));
const sha = text => createHash('sha256').update(text).digest('hex');
const excerpts = new Map();
function record(file, name, start, text) {
  excerpts.set(`${file}:${name}`, { file, name, firstLine:texts[file].slice(0,start).split('\n').length, lastLine:texts[file].slice(0,start+text.length).split('\n').length, sha256:sha(text), bytes:Buffer.byteLength(text) });
  return text;
}
function cut(file,start,end) { const text=texts[file]; const a=text.indexOf(start), b=text.indexOf(end,a+start.length); assert.ok(a>=0&&b>a); return record(file,`${start} → ${end}`,a,text.slice(a,b)); }
function method(file,name,indent='  ') {const text=texts[file];const a=text.search(new RegExp(`^${indent}(?:async )?${name}\\(`,'m'));assert.ok(a>=0, name);const tail=text.slice(a);const b=tail.search(new RegExp(`^${indent}\\}[,]?\\s*$`,'m'));assert.ok(b>0,name);return record(file,name,a,tail.slice(0,b)+tail.slice(b).split('\n')[0]);}
const methods=['clearPendingLyricsUpdates','clearGenerationPillTimers','nextGenerationPillRevision','showGenerationPillLoading','hideGenerationPill','completeGenerationPill','startGenerationRequestLoading','updateGenerationRequestLoading','clearGenerationRequestLoading','startLyricsLoading','clearLyricsLoading','clearPhoneticLoading','clearTranslationLoading','clearCulturalAnnotationsLoading','handleLyricsProviderAttempt'];
const serviceMethods=['getLyricsFromProviders','publishLyricsSnapshot','getLyricsSnapshot','clearLyricsPresentationSnapshot','clearLyricsSnapshot','getCachedLyrics','cacheLyrics'];
const labels={ 'syncCreator.loadLyrics':'Load lyrics','syncCreator.loadingLyrics':'Loading lyrics...', 'generationStatus.complete':'Complete!', 'settings.lyricsProviders.types.synced':'Synced lyrics' };
export function createHarness({queuedState=false,typeFirst=true}={}) {
 const h=reloadHarness({queuedState});
 const providerCalls=[],progress=[],snapshots=[],cacheWrites=[],cacheReads=[],statsCalls=[];
 const realConsole=h.context.console;
 realConsole.info=()=>{};
 h.context.I18n.t=key=>labels[key]||key;
 h.context.window.CONFIG=h.config;
 h.config.visual['prefer-lyrics-type-over-provider-order']=typeFirst;
 h.context.window.SyncDataService.getAvailableProviders=async()=>[];
 h.context.window.SyncDataService.getSyncData=async()=>null;
 h.spicetify.LocalStorage={get:()=>null,set(){throw Error('Unexpected persistent write');}};
 const c=h.c;
 vm.runInContext(cut('index.js','const GENERATION_PILL_TIMING =','// Enhanced FAD container detection')+`\nObject.assign(Container.prototype,{${methods.map(name=>method('index.js',name)).join(',\n')}});`,h.context);
 for(const name of methods) delete c[name];
 // Execute the exact constructor initialization block for token and pill ownership.
 vm.runInContext(`globalThis.initPills=function(){${cut('index.js','    this._lyricsLoadingSeq = 0;','    this._sharedPresentationKeys =')}};`,h.context);
 h.context.initPills.call(c);
 // These are real service maps/generation, signatures, and method bodies. Only unrelated IO is inert.
 vm.runInContext(`${cut('LyricsService.js','    const lyricsPresentationSnapshots = new Map();','    const openTrackOverrideDatabase =')}\nObject.assign(window.LyricsService,{${serviceMethods.map(name=>method('LyricsService.js',name,'        ')).join('\n')}});globalThis.serviceState=()=>({generation:lyricsProviderRequestGeneration,inflight:[...lyricsProviderInflightRequests.keys()],snapshots:[...lyricsPresentationSnapshots.keys()]});`,h.context);
 const providerCache=new Map();
 h.context.LyricsCache.getLyrics=async (id,provider)=>{cacheReads.push({id,provider});return providerCache.get(`${id}:${provider}`)||null;};
 h.context.LyricsCache.setLyrics=async (id,provider,result)=>{providerCache.set(`${id}:${provider}`,plain(result));cacheWrites.push({id,provider,result:plain(result)});return true;};
 h.context.LyricsCache.getStats=async()=>{statsCalls.push({clearsCompleted:h.clears.filter(x=>x.settled).length});return {lyrics:providerCache.size||1};};
 const actualClear=h.context.LyricsCache.clearTrack;
 h.context.LyricsCache.clearTrack=async id=>{const result=await actualClear(id);for(const key of providerCache.keys())if(key.startsWith(`${id}:`))providerCache.delete(key);return result;};
 h.context.window.LyricsService.extractTrackId=h.context.Utils.extractTrackId;
 h.context.window.addEventListener('ivLyrics:shared-lyrics-updated',e=>snapshots.push(plain(e.detail)));
 vm.runInContext(texts['LyricsAddonManager.js'],h.context,{filename:'LyricsAddonManager.js'});
 const manager=h.context.window.LyricsAddonManager;
 function provider(id,name) { return {id,name,author:'inert fixture',description:'Controlled inert provider boundary',version:'1.0',supports:{karaoke:false,synced:true,unsynced:false},defaultEnabled:true,getLyrics(info){let resolve;const q={id,name,info:plain(info),settled:false};q.promise=new Promise(done=>resolve=done);q.resolve=value=>{assert.equal(q.settled,false);q.settled=true;resolve(value);};providerCalls.push(q);return q.promise;}}; }
 assert.equal(manager.register(provider('spotify','Primary')),true);
 assert.equal(manager.register(provider('lrclib','Fallback')),true);
 c.handleLyricsProviderAttempt=c.handleLyricsProviderAttempt.bind(c);
 // Exact componentDidMount subscription statement; the handler is never invoked directly.
 vm.runInContext(`globalThis.subscribe=function(){${cut('index.js','    this._unsubscribeLyricsProviderAttempt = window.LyricsAddonManager?.on?.(','    this.handleSyncCreatorVisibility =') }}`,h.context);
 h.context.subscribe.call(c);
 const stopProgress=manager.on('lyrics:search:progress',detail=>progress.push(plain(detail)));
 vm.runInContext(`globalThis.renderStatus=function(){const isSyncCreatorActive=this.state.isSyncCreatorActive===true;${cut('index.js','    const computeGenerationStatusStack = () => {','    const computeTrackSyncAdjustPill =')}return generationStatusStack;};`,h.context);
 h.context.react={createElement:(tag,props,...children)=>({tag,props,children})};
 const ui=controls(h);
 Object.assign(h,{providerCalls,progress,snapshots,cacheWrites,cacheReads,statsCalls,providerCache,manager,ui,
  serviceState:()=>plain(h.context.serviceState()),
  provider(id,index=0,uri=A){const call=providerCalls.filter(q=>q.id===id&&q.info.uri===uri)[index];assert.ok(call,`${id} #${index} ${uri}`);return call;},
  result(q,text='current result'){return {uri:q.info.uri,provider:q.id,synced:[{startTime:0,text},{startTime:1000,text:`${text} second line`}]};},
  render(){return plain(h.context.renderStatus.call(c));},
  view(){
   const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'&&'tag'in node?[node,...nodes(node.children)]:[];
   const stack=h.render();const ns=nodes(stack);const pill=ns.find(n=>n.props?.['data-kind']==='lyrics');const pns=nodes(pill);
   return plain({current:c.currentTrackUri,loading:c.state.isLoading,token:[...c._activeLyricsLoadingTokens],generation:h.serviceState().generation,inflight:h.serviceState().inflight,
    phase:pill?.props?.['data-phase']||null,role:stack?.props?.role||null,ariaLive:stack?.props?.['aria-live']||null,
    loadingLabelText:pns.find(n=>n.props?.className==='lyrics-generation-status-loading-label')?.children?.[0]||null,
    accessibleDescription:pns.find(n=>n.props?.className==='lyrics-generation-status-description')?.children?.[0]||null,
    provider:c.state.provider||null,lyrics:c.state.currentLyrics||[],snapshot:h.context.window.LyricsService.getLyricsSnapshot(c.currentTrackUri)?.rawResult?.provider||null});
  },
  async clearCurrent(){const task={kind:'settings',done:false};task.promise=ui.cache('Current');h.tasks.push(task);task.promise.then(()=>task.done=true,error=>{task.done=true;task.error=error;});await h.settle();return task;},
  async releaseClear(){const clear=h.clears.find(q=>!q.settled);assert.ok(clear,'enabled current-cache button called actual handler');clear.resolve();await h.settle();},
  async finishAll(){
   await manager.init();
   for(let i=0;i<20;i++){
    for(const q of h.clears.filter(q=>!q.settled))q.resolve();
    for(const q of h.reads.filter(q=>!q.settled))q.resolve();
    for(const q of providerCalls.filter(q=>!q.settled))q.resolve(h.result(q,`drained ${q.name}`));
    await h.settle();
    if(h.timers.size)h.expire();
    await h.settle();
    if(h.tasks.every(t=>t.done)&&providerCalls.every(q=>q.settled)&&!h.timers.size&&!h.serviceState().inflight.length)break;
   }
   await h.finish();
   assert.ok(providerCalls.every(q=>q.settled));assert.equal(h.serviceState().inflight.length,0);
   assert.equal(c._activeLyricsLoadingTokens.size,0);assert.equal(c._generationPillTimers.size,0);
   assert.equal(h.manager._activeLyricsSearchProgress.size,0);assert.equal(h.manager._lyricsSearchProgressByRequest?.size ?? 0,0);assert.equal(h.stateQueue.length,0);
   assert.equal(c.state.error,null);assert.ok(h.tasks.every(t=>!t.error));
   c._unsubscribeLyricsProviderAttempt();stopProgress();
   return {tasks:h.tasks.length,providers:providerCalls.length,promisesDrained:true,timers:h.timers.size,stateQueue:h.stateQueue.length,activeTokens:c._activeLyricsLoadingTokens.size,serviceInflight:h.serviceState().inflight.length,progressEntries:manager._activeLyricsSearchProgress.size+(manager._lyricsSearchProgressByRequest?.size ?? 0),errors:h.errors.length};
  }
 });
 return h;
}
export function extractionManifest(){
 const indexMethods=['getLyricsLayoutHasLyrics','getLoadingLyricsState','infoFromTrack','fetchLyrics','resolveLyricsForMode','isPlaybackUriCurrent','beginPlaybackTrackTransition','clearPlaybackTrackResolutionTimer','schedulePlaybackTrackResolution','commitResolvedPlaybackTrack','commitDjNarrationTrack','componentWillUnmount','updateVisualOnConfigChange','clearByUri'];
 for(const name of indexMethods)method('index.js',name);
 for(const name of ['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack','clearSafePlayerProgressCorrection'])method('LyricsService.js',name,'        ');
 // Enumerate the unchanged helper's literal cut boundaries as well.
 for(const helper of ['tests/helpers/reload_harness.mjs','tests/helpers/reload_settings.mjs']){
  const regex=/cut\((index|service|settings), '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\)/g;
  for(const match of texts[helper].matchAll(regex)){
   const value=x=>x.replace(/\\n/g,'\n').replace(/\\'/g,"'");
   cut({index:'index.js',service:'LyricsService.js',settings:'Settings.js'}[match[1]],value(match[2]),value(match[3]));
  }
 }
 const manifest={sourceRoot:new URL('../../',import.meta.url).pathname,files:Object.entries(texts).map(([file,text])=>({file,bytes:Buffer.byteLength(text),sha256:sha(text)})),extractions:[...excerpts.values()],fullProductionUnits:['LyricsAddonManager.js','PlaybackClock.js'],boundaries:['React/hooks and state scheduler are inert element records, not a mounted browser DOM','Provider.getLyrics uses deferred inert results only; no installed providers execute','LyricsCache reads/writes/clear/stats are inert in-memory collaborators; no IndexedDB','Track overrides, translations, sync-data, colors, tempo and unrelated rendering remain original reload-helper inert collaborators','Exact service admission/dedup/generation/snapshot and cache wrapper methods execute; full LyricsService extension startup does not','Exact container loading/token lifecycle, Settings LocalCacheManager section, reload/fetch and rendered status expression execute; full React root does not']};
 return manifest;
}
