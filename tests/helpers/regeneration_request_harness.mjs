// Complete production methods and callbacks run unchanged in a VM.
// React scheduling, player data, AI transport, and persistent storage are inert.
// The storage adapter serializes transactions in creation order, including reads.
// No native IndexedDB, provider, Spotify, browser, or network execution occurs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('index.js', root), 'utf8');
const serviceSource = readFileSync(new URL('LyricsService.js', root), 'utf8');
const utilsSource = readFileSync(new URL('Utils.js', root), 'utf8');
const optionsSource = readFileSync(new URL('OptionsMenu.js', root), 'utf8');
const playbackApi = createRequire(import.meta.url)('../../PlaybackClock.js');
function between(src, from, to) { const start=src.indexOf(from),end=src.indexOf(to,start+from.length);assert.ok(start>=0&&end>start,from);return src.slice(start,end); }
function method(src,name,indent=2,isStatic=false) { const lead=' '.repeat(indent);const start=src.search(new RegExp(`^${lead}${isStatic?'static ':''}(?:async )?${name}\\(`,'m'));assert.ok(start>=0,name);const tail=src.slice(start);const end=tail.search(new RegExp(`^${lead}\\}[,]?\\s*$`,'m'));assert.ok(end>0,name);return tail.slice(0,end)+tail.slice(end).split('\n')[0]; }
export const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const A='spotify:track:AAAAAAAAAAAAAAAAAAAAAA',B='spotify:track:BBBBBBBBBBBBBBBBBBBBBB',L='spotify:local:Fixture:Album:Local:200';
export const track=(uri,metadata=true)=>({uri,type:'track',...(metadata?{metadata:{title:uri===A?'Track A':uri===B?'Track B':'Local track',artist_name:uri===A?'Artist A':uri===B?'Artist B':'Local artist',duration:'200000'}}:{})});
export const lines=uri=>[{text:uri===A?'わたしの古いうた':uri===B?'あなたの新しいうた':'ここはローカルのうた',startTime:1000}];
export const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const noop=()=>{};
const gate=()=>{let yes,no;const q={settled:false,promise:new Promise((r,j)=>{yes=r;no=j})};q.resolve=v=>{assert.equal(q.settled,false);q.settled=true;yes(v)};q.reject=v=>{assert.equal(q.settled,false);q.settled=true;no(v)};return q;};

export function harness({mode1='gemini_ko',mode2='none',queuedState=false,overrides={},rawLyrics={}}={}) {
  const providerCalls=[],translatorCalls=[],persistentWrites=[],cacheReads=[],stateWrites=[],presentations=[],errors=[],warnings=[],toasts=[],progress=[],fetches=[],pendingRequests=[],regenerations=[],invalidationCalls=[],cacheWrites=[],storageTrace=[],transactions=[],stateQueue=[],timers=new Map(),memory=new Map(),store=new Map();
  let timerId=0,now=0,modal=null,modalCloses=0,txId=0,holdStorage=false;
  const config={modes:['karaoke','synced','unsynced'],visual:{'translate:translated-lyrics-source':'gemini','translate:target-language':'en','translate:detect-language-override':'off','translate:ai-language-detection':false,'cultural-annotations-enabled':false,'translate:pronunciation-notation':'latin'}};
  for(const name of ['japanese','korean','english','french','gemini']){config.visual[`translation-mode:${name}`]=mode1;config.visual[`translation-mode-2:${name}`]=mode2;}
  const spicetify={Player:{data:{item:null}},Platform:{PlayerAPI:{_state:{}}},LocalStorage:{get:()=>null}};
  const clock=playbackApi.createSpotifyPlaybackClock(spicetify,{autoStart:false,now:()=>now,wallNow:()=>now,schedule(){throw Error('clock timer forbidden')},cancel:noop});
  const storage={getItem:()=>null,getPersisted:()=>null};
  const react={memo:fn=>fn,createElement:(tag,props,...children)=>({tag,props,children})};
  const pump=()=>{
    const tx=transactions.find(t=>!t.finished);
    if(!tx||tx.started||holdStorage)return;
    tx.started=true;storageTrace.push({event:'start',id:tx.id,mode:tx.mode});
    Promise.resolve().then(()=>{
      assert.strictEqual(transactions.find(t=>!t.finished),tx,'FIFO transaction order');
      for(const op of tx.requests){if(op.kind==='put'){store.set(op.value.cacheKey,clone(op.value));persistentWrites.push(clone(op.value));op.request.result=op.value.cacheKey;}else op.request.result=clone(store.get(op.key));op.settled=true;op.request.onsuccess?.();}
      tx.finished=true;storageTrace.push({event:'complete',id:tx.id,mode:tx.mode});tx.oncomplete?.();pump();
    });
  };
  const db={transaction(storeName,mode){assert.equal(storeName,'translations');const tx={id:++txId,mode,started:false,finished:false,requests:[]};transactions.push(tx);storageTrace.push({event:'create',id:tx.id,mode});tx.objectStore=name=>{assert.equal(name,'translations');return {get(key){const request={};cacheReads.push(key);tx.requests.push({kind:'get',key,request,settled:false});Promise.resolve().then(pump);return request;},put(value){const request={};tx.requests.push({kind:'put',value:clone(value),request,settled:false});Promise.resolve().then(pump);return request;}}};return tx;}};
  const window={CONFIG:config,StorageManager:storage,ivLyricsPlaybackClock:playbackApi};
  window.AIAddonManager={getTranslationStyle:()=> 'natural',getTranslationInstruction:()=>'',translateLyrics(options){const q=Object.assign(gate(),{options});providerCalls.push(q);return q.promise;}};
  const context=vm.createContext({window,Spicetify:spicetify,CONFIG:config,CACHE:{},APP_NAME:'ivLyrics',console:{log:noop,warn:(...v)=>warnings.push(clone(v)),error:(...v)=>errors.push(v.map(x=>String(x)))},react,
    localStorage:storage,StorageManager:storage,TrackBackgroundDB:{getOverride:async()=>null},ivLyricsDebug:noop,serviceDebug:noop,I18n:{t:key=>key},
    Toast:{show:message=>toasts.push({kind:'show',message}),success:message=>toasts.push({kind:'success',message}),error:message=>toasts.push({kind:'error',message})},
    RateLimiter:{canMakeCall:()=>true},CacheManager:{get:key=>memory.get(key),set:(key,value)=>{memory.set(key,value);cacheWrites.push({key,value:clone(value)})},clearByUri:uri=>{for(const key of memory.keys())if(key.startsWith(`${uri}:`))memory.delete(key)}},
    setTimeout(fn,delay){timers.set(++timerId,{fn,at:now+delay});return timerId;},clearTimeout:id=>timers.delete(id),Date:{now:()=>now},TextEncoder,
    GENERATION_PILL_TIMING:{loadingDelayMs:1000},ensurePlaybackProgressGuard:()=>({getSnapshot:()=>clock.getSnapshot(),clearCorrection:()=>clock.invalidate()}),
    ConfigButton:function ConfigButton(){},OptionsMenu:function OptionsMenu(){},ConfigSlider:function ConfigSlider(){},IvConfigSlider:function IvConfigSlider(){},SettingRowDescription:'SettingRowDescription',ICONS:{language:'language'},IvLyricsTooltip:'IvLyricsTooltip',IvLyricsToolbarIcon:'IvLyricsToolbarIcon',
    openOptionsModal(title,items,onChange){modal={title,items,onChange};return ()=>{modalCloses++}},
    inertDB:db,fetch:()=>assert.fail('network forbidden'),indexedDB:new Proxy({},{get:()=>assert.fail('native IndexedDB forbidden')}),
  });
  vm.runInContext(`(() => {
    ${between(serviceSource,'    const awaitIdbRequest =','    // Deletes a track')}
    const cache={${['_getTranslationKey','_withSize','getTranslation','setTranslation'].map(n=>method(serviceSource,n,8)).join('\n')}
      _openDB:async()=>inertDB,_isExpired:()=>false,_scheduleSizeEnforcement:()=>{}};
    window.LyricsCache=cache;globalThis.LyricsCache=cache;
    ${between(serviceSource,'    const TrackIdentity = (() => {','    const MODULE_KEY =')}
    ${between(serviceSource,'    const getLyricsTextCacheHash =','    const cleanupWorker =')}
    ${between(serviceSource,'    const Utils = {','    const ApiTracker =')}
    ${between(serviceSource,'    const _translatorInflightRequests =','    // I18n이 로드되기')}
    const getStorageItem=key=>window.StorageManager.getItem(key);
    ${between(serviceSource,'    function getCurrentLanguage()','    class Translator {')}
    class Translator {${method(serviceSource,'clearInflightRequests',8,true)}\n${method(serviceSource,'callGemini',8,true)}}
    window.Translator=Translator;window.ServiceUtils=Utils;window.translationFlights=_translatorInflightRequests;window.pendingRetries=_translatorPendingRetries;
    window.LyricsService={detectLanguage:lyrics=>Utils.detectLanguage(lyrics),extractTrackId:uri=>Utils.extractTrackId(uri),isSpotifyTrackId:value=>Utils.isSpotifyTrackId(value)};
  })();`,context);
  Object.assign(window.LyricsService,{getTrackLanguageOverride:async uri=>overrides[uri]||null,getTrackLyricsProviderOverride:async()=>null,getLyricsFromProviders:async info=>({uri:info.uri,provider:'fixture-lyrics',synced:rawLyrics[info.uri]||lines(info.uri)}),publishLyricsSnapshot:value=>presentations.push(clone(value))});
  const utilityNames=['isSectionHeader','detectLanguage','setDetectedLanguage','getDetectedLanguage','isSpotifyTrackId','extractTrackId','splitInlinePronunciation','buildPronunciationRequestText','segmentTextForPronunciation'];
  const names=['getGeminiTranslation','provideLanguageCode','lyricsSource','resolveLyricsForMode','isCurrentLyricsUri','isCurrentLyricsState','getTranslationTargetLanguage','getLyricsLayoutHasLyrics','getLoadingLyricsState','infoFromTrack','clearPendingLyricsUpdates','fetchLyrics','commitResolvedPlaybackTrack','applyTranslationStates','refineLanguageWithAI','isPlaybackUriCurrent','isModeAvailable','getAutomaticMode','getCurrentMode','optimizeTranslations','applyCulturalAnnotations','isCulturalAnnotationsEnabled','requestCulturalAnnotations','startGenerationRequestLoading','clearGenerationRequestLoading','startLyricsLoading','clearLyricsLoading','startTranslationLoading','clearTranslationLoading','startPhoneticLoading','clearPhoneticLoading','clearCulturalAnnotationsLoading','clearPlaybackTrackResolutionTimer','beginPlaybackTrackTransition','schedulePlaybackTrackResolution','commitDjNarrationTrack','getRegenerationTargets','handleRegenerateTranslationRequest','regenerateTranslation','invalidateSharedLyricsPresentation','applyStreamingTranslation'];
  vm.runInContext(`
    ${between(utilsSource,'const IV_LYRICS_COMPARISON_APOSTROPHE_REGEX','const IV_LYRICS_DEFAULT_SPEAKER_TEXT_COLORS')}
    const Utils={PRONUNCIATION_SEGMENT_SEPARATOR:'｜',${utilityNames.map(n=>method(utilsSource,n)).join('\n')}};
    window.Utils=Object.assign(Utils,{${['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack','clearSafePlayerProgressCorrection'].map(n=>method(serviceSource,n,8)).join('\n')}});
    ${between(source,'const getCurrentTranslationTargetLanguage =','const getUpdateBannerTheme =')}
    ${between(source,'const KARAOKE =','const normalizeLyricsRenderModeLock =')}
    ${between(source,'const emptyState =','// Enhanced cache system')}
    ${between(source,'const GENERATION_REQUEST_PILL_CONFIG =','// Enhanced FAD container detection')}
    ${between(source,'const isTranslationNoteLine =','class LyricsContainer extends')}
    ${between(optionsSource,'const IvConfigButton =','// Helper: open a compact options modal')}
    ${between(optionsSource,'function openRegenerateTranslationChoiceModal(','const TrackBackgroundButton =')}
    class Container {${names.map(n=>method(source,n)).join('\n')}}
    globalThis.Container=Container;globalThis.empty=emptyState;globalThis.newRegistry=()=>new InflightRequestRegistry();
    globalThis.renderButton=function(){const isSyncCreatorActive=false;const mode=this.getCurrentMode();${between(source,'    let showTranslationButton;','    const computeCacheEditModal =')}
      return ${between(source,'react.createElement(RegenerateTranslationButton, {','            ),\n            react.createElement(').trim().replace(/,$/,'')};};
    globalThis.RegenerateTranslationButton=RegenerateTranslationButton;globalThis.IvOptionList=IvOptionList;globalThis.IvConfigButton=IvConfigButton;
    globalThis.cacheHelpers={getCachedTranslationForText,setCachedTranslationForText,getDisplayModeCacheKey};
  `,context);
  const c=new context.Container();
  Object.assign(c,{state:{...context.empty,uri:'',currentLyrics:[],lyricsDisplayUri:null,explicitMode:-1,lockedMode:-1},currentTrackUri:'',trackLanguageOverride:null,_activeLyricsFetchSeq:0,_lyricsFetchSeq:0,_lyricsTransitionSeq:0,_lyricsPresentationSeq:0,_playbackTrackResolutionSeq:0,_localLyricsImportGeneration:0,_isComponentMounted:true,_inflightGemini:context.newRegistry(),_inflightTrad:context.newRegistry(),_dmResults:{},_sharedPresentationKeys:new Map(),_culturalAnnotationResults:new Map(),_generationRequestDetails:new Map(),_visibleGenerationPills:new Set(),_activeLyricsLoadingTokens:new Set(),_activeTranslationLoadingTokens:new Set(),_activePhoneticLoadingTokens:new Set(),_activeCulturalAnnotationsLoadingTokens:new Set(),_lyricsLoadingSeq:0,_translationLoadingSeq:0,_phoneticLoadingSeq:0,_culturalAnnotationsLoadingSeq:0,
    setState(patch,callback){const job=()=>{const next=typeof patch==='function'?patch(this.state):patch;this.state={...this.state,...next};stateWrites.push(clone(next));callback?.()};if(queuedState)stateQueue.push(job);else job();},fetchMetadataTranslation:noop,fetchColors:noop,fetchTempo:noop,loadSavedVideoForTrack:noop,resetDelay:noop,lyricsSaved:()=>false,getSavedLocalLyrics:()=>null,showGenerationPillLoading:noop,clearGenerationPillTimers:noop,hideGenerationPill:noop,completeGenerationPill:noop,
  });
  for(const [name,tasks] of [['fetchLyrics',fetches],['getGeminiTranslation',pendingRequests],['regenerateTranslation',regenerations]]) {const original=c[name];c[name]=function(...args){const p=original.apply(this,args);const task={args,promise:p,done:false};tasks.push(task);p.then(()=>task.done=true,()=>task.done=true);return p};}
  const realCall=window.Translator.callGemini;window.Translator.callGemini=function(options){translatorCalls.push({...clone(options),sequence:translatorCalls.length,uri:c.state.uri,currentUri:c.currentTrackUri});return realCall.call(this,options)};
  const realClear=window.Translator.clearInflightRequests;window.Translator.clearInflightRequests=function(id){invalidationCalls.push(id);return realClear.call(this,id)};
  const realStream=c.applyStreamingTranslation;c.applyStreamingTranslation=function(value){progress.push(clone(value));return realStream.call(this,value)};
  c.handleRegenerateTranslationRequest=c.handleRegenerateTranslationRequest.bind(c);
  const h={expectedRejectedTasks:0,context,c,window,config,rawLyrics,spicetify,clock,providerCalls,translatorCalls,persistentWrites,cacheReads,stateWrites,presentations,errors,warnings,toasts,progress,fetches,pendingRequests,regenerations,invalidationCalls,cacheWrites,storageTrace,transactions,store,memory,stateQueue,timers,
    async settle(){for(let i=0;i<8;i++){while(stateQueue.length)stateQueue.shift()();await flush()}},
    setPlayback(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`fixture-${fetches.length}`,isPaused:false}},
    async load(accepted,publicItem=accepted){this.setPlayback(accepted,publicItem);c.schedulePlaybackTrackResolution(accepted);await this.settle();if(c.state.uri===accepted?.uri&&!c.state.isLoading)c.lyricsSource(c.state,c.getCurrentMode());await this.settle();},
    async refresh(accepted,publicItem=accepted){this.setPlayback(accepted,publicItem);c.fetchLyrics(accepted,-1,true);await this.settle();c.lyricsSource(c.state,c.getCurrentMode());await this.settle();},
    button(){const element=context.renderButton.call(c);return context.RegenerateTranslationButton(element.props).children[0]},
    click(){const button=this.button();assert.equal(button.props.disabled,false,'actual regeneration button admission');button.props.onClick();return modal},
    choose(target){assert.ok(modal);const list=context.IvOptionList({items:modal.items[0].items,onChange:modal.onChange});const row=list.children[0].find(r=>r.props.key===({translation:'regenerate-translation-only',phonetic:'regenerate-phonetic-only',all:'regenerate-both'}[target]));assert.ok(row,target);const node=row.children[0].children[1].children[0];assert.equal(node.tag,context.IvConfigButton);context.IvConfigButton(node.props).props.onClick();return regenerations.at(-1)},
    get modal(){return modal},get modalCloses(){return modalCloses},
    async advance(ms=60){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await this.settle()},
    holdStorage(value){holdStorage=value;if(!value)pump()},
    result(q,label='generated'){return {translation:[`${label} translation ${q.options.text}`],phonetic:[`${label} phonetic ${q.options.text}`]}},
    async completeInitial(){await this.drain();assert.ok(c.state.currentLyrics?.length);assert.equal(c.state.isLoading,false);assert.equal(this.button().props.disabled,false);await this.settle();},
    async drain(){for(let i=0;i<30;i++){holdStorage=false;pump();for(const q of providerCalls)if(!q.settled)q.resolve(this.result(q));await this.settle();await this.advance(1000);if([...fetches,...pendingRequests,...regenerations].every(q=>q.done)&&providerCalls.every(q=>q.settled)&&transactions.every(t=>t.finished)&&!stateQueue.length&&!timers.size)break;}const settled=await Promise.allSettled([...fetches,...pendingRequests,...regenerations].map(q=>q.promise));assert.equal(settled.filter(q=>q.status==='rejected').length,this.expectedRejectedTasks,'only expected rejected task promises');assert.ok(providerCalls.every(q=>q.settled));assert.ok(transactions.every(t=>t.finished));assert.equal(stateQueue.length,0);assert.equal(timers.size,0);assert.ok(errors.length===0,JSON.stringify(errors));},
    snapshot(){return clone({uri:c.state.uri,currentUri:c.currentTrackUri,error:c.state.error,isLoading:c.state.isLoading,displayUri:c.state.lyricsDisplayUri,publicUri:spicetify.Player.data.item?.uri||null,snapshotUri:clock.getSnapshot().uri,lyrics:c.state.currentLyrics,modeResults:c._dmResults,cacheKeys:[...store.keys()],toasts,errors,activeFetch:c._activeLyricsFetchSeq})},
    close(){clock.destroy()},
  };
  return h;
}
