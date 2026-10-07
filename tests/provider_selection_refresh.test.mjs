// Actual provider menu, ordered store helpers, playback and fetch methods.
// External I/O, hooks, elements and state scheduling remain inert.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.js', root), 'utf8');
const options = readFileSync(new URL('OptionsMenu.js', root), 'utf8');
const service = readFileSync(new URL('LyricsService.js', root), 'utf8');
const utils = readFileSync(new URL('Utils.js', root), 'utf8');
const playback = createRequire(import.meta.url)('../PlaybackClock.js');
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const cut = (source, start, end) => {
  const a = source.indexOf(start); assert.ok(a >= 0, start);
  const b = source.indexOf(end, a + start.length); assert.ok(b > a, end);
  return source.slice(a,b);
};
const method = (source, name, indent = '  ') => {
  const a = source.search(new RegExp(`^${indent}(?:async )?${name}\\(`, 'm'));
  assert.ok(a >= 0, name);
  const tail = source.slice(a);
  // All selected production methods close at their declaration indentation.
  const end = tail.search(new RegExp(`^${indent}\\}[,]?\\s*$`, 'm'));
  assert.ok(end > 0, `end ${name}`);
  return tail.slice(0,end) + tail.slice(end).split('\n')[0];
};
const methods = ['getLyricsLayoutHasLyrics','getLoadingLyricsState','infoFromTrack','fetchLyrics',
  'resolveLyricsForMode','isPlaybackUriCurrent','beginPlaybackTrackTransition',
  'clearPlaybackTrackResolutionTimer','schedulePlaybackTrackResolution','commitResolvedPlaybackTrack',
  'commitDjNarrationTrack','getEffectiveBackgroundMode','fetchColors','selectLyricsProviderForCurrentTrack'];
const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
const track = (uri, cover = uri === A ? 'cover-A' : 'cover-B') => ({ uri, type:'track', metadata: {
  title: uri === A ? 'Track A' : 'Track B', artist_name:'Fixture artist', album_title:'Fixture album',
  duration:'200000', image_xlarge_url:cover,
} });
const flush = async () => { for (let i=0;i<35;i++) await Promise.resolve(); };
const deferred = (kind, args) => {
  let yes, no;
  const gate = { kind, args, settled:false, promise:new Promise((resolve,reject)=>{yes=resolve;no=reject;}) };
  gate.resolve = value => { assert.equal(gate.settled,false); gate.settled=true; yes(value); };
  gate.reject = value => { assert.equal(gate.settled,false); gate.settled=true; no(value); };
  return gate;
};
const base = (hex = '#112233') => ({data:{trackUnion:{albumOfTrack:{coverArt:{extractedColors:{colorDark:{hex}}}}}}});
const dynamic = (cover='cover-A') => {
  const v = cover.includes('B') ? {red:0,green:1,blue:0} : cover.includes('new') ? {red:0,green:0,blue:1} : {red:1,green:0,blue:0};
  return {data:{getDynamicColorsByUris:[{minContrast:{backgroundBase:v},highContrast:{backgroundBase:v},higherContrast:{backgroundBase:v}}]}};
};
const defects = [];
const observations = [];
const activeHarnesses=new Set();
test.afterEach(async()=>{for(const h of activeHarnesses)await h.finish();});
function checkIdentity(actual, expected, label, trace = null) {
  defects.push({ label, actual, expected, trace });
  if (process.env.CHOICE_REGRESSIONS === '1') assert.equal(actual, expected, label);
  else assert.notEqual(actual, expected, `OBSERVED DEFECT: ${label}`);
}
function harness({mode='blur-gradient-background', queuedState=false, noDynamicDefinition=false, initialOverrides={}}={}) {
  const queries=[], cosmos=[], palettes=[], colorTasks=[], lyricTasks=[], publications=[], warnings=[], errors=[], stateQueue=[], timers=new Map();
  const providerCalls=[], snapshotClears=[], cacheInvalidations=[], modalCloses=[];
  const storageRequests=[], storageOpens=[], persisted=new Map(Object.entries(initialOverrides)), events=[], toasts=[], selectorTasks=[], callbackQueue=[], callbacks=[], renders=[], stateJobs=[];
  let modal=null, holdCallbacks=false, nextOpenFailure=false, now=0, timerId=0;
  let hookSlots=[], hookCursor=0;
  const menuTasks=[];
  const react={memo:fn=>fn,createElement:(tag,props,...children)=>({tag,props,children}),
    useState(initial){const pos=hookCursor++;if(!(pos in hookSlots))hookSlots[pos]=typeof initial==='function'?initial():initial;return [hookSlots[pos],value=>{hookSlots[pos]=typeof value==='function'?value(hookSlots[pos]):value;}];},
    useRef(initial){const pos=hookCursor++;if(!(pos in hookSlots))hookSlots[pos]={current:initial};return hookSlots[pos];},
    useMemo:fn=>fn(),useEffect(){},
  };
  const transactions=[],storageTrace=[],otherReads=[],heldOtherReads=new Set();
  let transactionId=0;
  const eligible=tx=>!transactions.some(prior=>prior.id<tx.id&&!prior.finished&&prior.stores.some(s=>tx.stores.includes(s))&&(tx.mode==='readwrite'||prior.mode==='readwrite'));
  const pump=()=>{for(const tx of transactions){if(!tx.finished&&!tx.started&&eligible(tx)){tx.started=true;storageTrace.push({event:'transaction-start',id:tx.id,mode:tx.mode});for(const entry of tx.requests)entry.start();}}};
  const indexedDB={open(name,version){
    assert.equal(name,'ivLyrics-provider-db','only the inert provider DB is modeled');
    const request={};storageOpens.push({name,version});const fail=nextOpenFailure;nextOpenFailure=false;
    Promise.resolve().then(()=>{
      if(fail){request.error=Error('inert open failure');request.onerror();return;}
      request.result={transaction(stores,mode){
        const tx={id:++transactionId,stores,mode,started:false,finished:false,requests:[],aborted:false};transactions.push(tx);storageTrace.push({event:'transaction-create',id:tx.id,mode});
        tx.complete=()=>{assert.ok(tx.started&&!tx.finished,'only a started unfinished transaction completes');assert.ok(tx.requests.every(q=>q.settled),'requests finish before transaction');if(!tx.aborted)for(const q of tx.requests){if(q.operation==='put')persisted.set(q.key,q.value);if(q.operation==='delete')persisted.delete(q.key);}tx.finished=true;storageTrace.push({event:tx.aborted?'transaction-abort':'transaction-complete',id:tx.id});tx.oncomplete?.();pump();};
        return Object.assign(tx,{objectStore(store){return Object.fromEntries(['get','put','delete'].map(operation=>[operation,(...args)=>{
          const key=operation==='put'?args[1]:args[0],value=operation==='put'?plain(args[0]):undefined,r={};
          const entry={operation,key,value,stores,mode,store,tx,settled:false};storageRequests.push(entry);tx.requests.push(entry);storageTrace.push({event:'request-create',id:tx.id,operation,key});
          entry.resolve=()=>{assert.ok(tx.started&&eligible(tx),'same-store transaction ordering blocks request');assert.equal(entry.settled,false);entry.settled=true;r.result=operation==='get'?plain(persisted.get(key)):operation==='put'?key:undefined;storageTrace.push({event:'request-success',id:tx.id,operation,key});r.onsuccess();if(operation==='get')Promise.resolve().then(tx.complete);};
          entry.reject=()=>{assert.ok(tx.started&&eligible(tx));assert.equal(entry.settled,false);entry.settled=true;tx.aborted=true;r.error=Error('inert request failure');storageTrace.push({event:'request-error',id:tx.id,operation,key});r.onerror();Promise.resolve().then(tx.complete);};
          entry.commit=tx.complete;
          entry.start=()=>{if(operation==='get')Promise.resolve().then(entry.resolve);};
          pump();if(tx.started&&operation==='get'&&!entry.autoQueued){entry.autoQueued=true;}return r;
        }]))}});
      }};
      request.onsuccess();
    });return request;
  }};
  const readOther=(kind,uri)=>{const q=deferred(kind,{uri});otherReads.push(q);if(!heldOtherReads.has(`${kind}:${uri}`))q.resolve(null);return q.promise;};
  const config={modes:['karaoke','synced','unsynced'],visual:{[mode]:true,'background-brightness':100,'solid-background-color':'rgb(171,205,239)'}};
  const spicetify={ReactDOM:{createPortal:node=>node},Player:{data:{item:null}},Platform:{PlayerAPI:{_state:{}}},GraphQL:{Definitions:{fetchExtractedColorForTrackEntity:'base',...(!noDynamicDefinition?{getDynamicColorsByUris:'dynamic'}:{})},Request(kind,args){const q=deferred(kind,plain(args)); queries.push(q);return q.promise;}},CosmosAsync:{get(url){const q=deferred('cosmos',{url});cosmos.push(q);return q.promise;}},colorExtractor(uri){const q=deferred('palette',{uri});palettes.push(q);return q.promise;}};
  const clock=playback.createSpotifyPlaybackClock(spicetify,{autoStart:false,now:()=>now,wallNow:()=>now,schedule(){throw Error('unexpected clock timer')},cancel(){}});
  const context=vm.createContext({indexedDB,react,readOther,document:{body:{}},getSettingsSurfaceTheme:()=> 'dark',ivLyricsDebug(){},getLyricsTypographyStyleVariables:()=>({}),I18n:{t:key=>key},Toast:{success:message=>toasts.push({kind:'success',message}),error:message=>toasts.push({kind:'error',message})},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},getOptionsText:(key,fallback)=>fallback,getBackgroundPresetLabel:mode=>mode,SettingRowDescription:'SettingRowDescription',ICONS:{background:'background',provider:'provider'},IvLyricsTooltip:'IvLyricsTooltip',IvLyricsToolbarIcon:'IvLyricsToolbarIcon',IvConfigSlider:'IvConfigSlider',ConfigSlider:'ConfigSlider',IvConfigButton:'IvConfigButton',ConfigButton:'ConfigButton',openOptionsModal(title,items,onChange){modal={title,items,onChange(...args){const p=onChange(...args);const task={promise:p,done:false};menuTasks.push(task);p.then(()=>task.done=true);return p;}};return ()=>modalCloses.push(true);},console:{warn:(...v)=>warnings.push(v),error:(...v)=>errors.push(v)},Spicetify:spicetify,CONFIG:config,CACHE:{},SYNCED:1,
    getRememberedLyricsRenderModeLock:()=>-1,getRememberedIvLyricsFullscreenPresentation:()=> 'standard',
    IVLYRICS_BACKGROUND_MODE_IDS:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'],
    getLyricsDataMode:mode=>mode,getLyricsModeTypeKey:mode=>config.modes[mode],isLyricsRenderCacheCurrent:()=>true,
    hasInstrumentalMarker:()=>false,getCurrentTranslationTargetLanguage:()=> 'ko',getCurrentLyricsPronunciationNotation:()=> 'translation',
    getNonSectionLyricsText:lyrics=>lyrics.map(l=>l.text).join('\n'),
    Date:{now:()=>now},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    ensurePlaybackProgressGuard:()=>({getSnapshot:()=>clock.getSnapshot(),clearCorrection:()=>clock.invalidate()}),
    window:{LyricsAddonManager:{getEnabledProviders:()=>[{id:'inert-one',name:'Inert One'},{id:'inert-two',name:'Inert Two'}]},innerWidth:1000,scrollX:0,scrollY:0,ivLyricsBackgroundPresets:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'].map(id=>({id})),dispatchEvent:event=>events.push(plain(event)),ivLyricsPlaybackClock:playback,Translator:{clearInflightRequests(){}},LyricsService:{
      getTrackLanguageOverride:uri=>readOther('language',uri),clearLyricsSnapshot:uri=>snapshotClears.push(uri),
      getLyricsFromProviders:async (info,ignored,mode,provider)=>{providerCalls.push({uri:info.uri,mode,provider});return {uri:info.uri,provider:provider||'inert-auto',synced:[{text:`Lyric ${info.title}`,startTime:0}]};},
      publishLyricsSnapshot(){},
    }},
  });
  vm.runInContext(`const Utils={_colorCache:new Map(),${method(utils,'convertIntToRGB')}\n${method(utils,'isColorLight')}\nextractTrackId:uri=>uri?.startsWith('spotify:track:')?uri.slice(14):null,detectLanguage:()=> 'en'};globalThis.Utils=Utils;\n`+
    `window.Utils={${['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack','clearSafePlayerProgressCorrection'].map(n=>method(service,n,'        ')).join('\n')}};\n`+
    cut(index,'function getIvLyricsGlobalBackgroundMode(', 'window.ivLyricsBackgroundFlagIds')+'\n'+
    cut(index,'const createTrackOverrideDB = (','const TrackLanguageDB =')+'\n'+cut(index,'const TrackLyricsProviderDB =','const TrackBackgroundDB =')+'\nconst TrackBackgroundDB={getOverride:uri=>readOther(\"background\",uri)};\nconst trackOverrideDatabases = new Map();\n'+cut(service,'    const openTrackOverrideDatabase =','    const sendLyricsToConsumers =')+'\nObject.assign(window.LyricsService,{'+method(service,'getTrackLyricsProviderOverride','        ')+'});\nconst CacheManager={_cache:new Map(),'+method(index,'clearByUri')+'};globalThis.CacheManager=CacheManager;\n'+'\n'+cut(index,'const readFiniteNumber =','const readNumericSetting =')+'\n'+cut(options,'const OptionsMenu =','const ICONS =')+'\n'+cut(options,'const getTrackBackgroundOptions =','// 최적화 #5')+'\n'+cut(options,'const LyricsProviderSelectButton =','function openRegenerateTranslationChoiceModal(')+'\n'+cut(options,'const IvOptionList =','// Helper: open a compact options modal')+'\n'+
    cut(index,'const computeBaseLyricsStyleVariables = (','// Builds the initial LyricsContainer')+'\n'+
    cut(index,'const emptyState = {','\nconst getPlainLyricsLineText')+'\n'+
    cut(index,'const createInitialLyricsContainerState = () => ({','\n// note/placeholder-only line')+'\n'+
    `class Container {${methods.map(n=>method(index,n)).join('\n')}};globalThis.Container=Container;globalThis.empty=emptyState;globalThis.initial=createInitialLyricsContainerState;\n`+
    `globalThis.menuElement=function(){${cut(index,'    const currentPlayerItem = Spicetify.Player.data?.item;','    const isVideoStagePresentation =')};return ${cut(index,'react.createElement(LyricsProviderSelectButton, {','              react.createElement(TrackBackgroundButton,').trim().replace(/,$/,'')};};globalThis.OptionsMenu=OptionsMenu;globalThis.LyricsProviderSelectButton=LyricsProviderSelectButton;globalThis.IvOptionList=IvOptionList;globalThis.renderBackground=function(){const isSyncCreatorActive=false;const fullscreenPresentation='standard';${cut(index,'    const effectiveBackgroundMode = this.getEffectiveBackgroundMode(this.state.trackBackgroundOverride);','    const computeExtendedLyricsStyleVariables =')};${cut(index,'    const shouldUseVideoBackground =','    const renderFloatingToolbarIcon =')};${cut(index,'    const renderStaticGradientBackground =','    const renderVideoBackgroundChild =')};return {effectiveBackgroundMode,backgroundStyle,styleVariables:this.styleVariables,staticNode:renderStaticGradientBackground()};};globalThis.replaceStorageForOpenFailure=()=>{const fresh=createTrackOverrideDB({dbName:'ivLyrics-provider-db',storeName:'track-lyrics-provider-overrides',label:'Provider',setting:'provider',methods:['getProvider','setProvider','clearProvider']});TrackLyricsProviderDB.setProvider=fresh.setProvider;TrackLyricsProviderDB.clearProvider=fresh.clearProvider;};`+
    'globalThis.computeLyricsBackgroundStyle=computeLyricsBackgroundStyle;globalThis.buildAmbientGradientColorVars=buildAmbientGradientColorVars;globalThis.getAlbumAmbientColors=getAlbumAmbientColors;',context);
  const c=new context.Container();
  Object.assign(c,{state:{...context.initial(),currentLyrics:[],uri:'',lyricsDisplayUri:null},currentTrackUri:'',
    _lyricsFetchSeq:0,_activeLyricsFetchSeq:0,_lyricsTransitionSeq:0,_playbackTrackResolutionSeq:0,_isComponentMounted:true,_localLyricsImportGeneration:0,_dmResults:{},
    clearPendingLyricsUpdates(){},closeLyricsEditModal(){},lyricsSaved:()=>false,getSavedLocalLyrics:()=>null,fetchMetadataTranslation(){},fetchTempo(){},resetDelay(){},loadSavedVideoForTrack(){},
    startLyricsLoading:()=>1,clearLyricsLoading(){},getCurrentMode:()=>1,isModeAvailable:()=>false,getAutomaticMode:()=>1,applyTranslationStates:()=>({}),refineLanguageWithAI(){},
    setState(patch,callback){const scheduled={patch:plain(typeof patch==='function'?{}:patch),current:c.currentTrackUri};stateJobs.push(scheduled);const job=()=>{const p=typeof patch==='function'?patch(this.state):patch;this.state={...this.state,...p};scheduled.appliedCurrent=this.currentTrackUri;if(Object.hasOwn(p,'colorsUri')&&p.colorsUri)publications.push(plain({current:this.currentTrackUri,stateUri:this.state.uri,displayUri:this.state.lyricsDisplayUri,coverUrl:this.state.coverUrl,...p}));if(callback){const cb=()=>{callbacks.push({scheduledCurrent:scheduled.current,current:this.currentTrackUri,override:plain(this.state.trackBackgroundOverride)});callback();};if(holdCallbacks)callbackQueue.push(cb);else cb();}};if(queuedState)stateQueue.push(job);else job();},
    forceUpdate(){renders.push(plain(context.renderBackground.call(this)));},
  });
  const clearByUri=context.CacheManager.clearByUri;context.CacheManager.clearByUri=function(uri){cacheInvalidations.push(uri);return clearByUri.call(this,uri);};
  const originalColors=c.fetchColors,originalLyrics=c.fetchLyrics,originalSelect=c.selectLyricsProviderForCurrentTrack;
  c.selectLyricsProviderForCurrentTrack=function(...args){const p=originalSelect.apply(this,args);const t={mode:args[0],promise:p,done:false};selectorTasks.push(t);p.then(()=>t.done=true);return p;}.bind(c);
  c.fetchColors=function(...args){const p=originalColors.apply(this,args);const t={uri:args[0],promise:p,done:false};colorTasks.push(t);p.then(()=>t.done=true);return p;};
  c.fetchLyrics=function(...args){const p=originalLyrics.apply(this,args);const t={uri:args[0]?.uri,promise:p,done:false};lyricTasks.push(t);p.then(()=>t.done=true);return p;};
  const h={c,context,spicetify,transactions,storageTrace,otherReads,providerCalls,snapshotClears,cacheInvalidations,modalCloses,
    holdOther(kind,uri){heldOtherReads.add(`${kind}:${uri}`);},
    async releaseOther(){for(const q of otherReads.filter(q=>!q.settled))q.resolve(null);await this.settleState();},
    async beginPlay(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`play-${lyricTasks.length}`,isPaused:false};c.schedulePlaybackTrackResolution(accepted);await this.settleState();assert.equal(c.currentTrackUri,accepted.uri);assert.equal(c.state.uri,accepted.uri);},
    storageRequests,storageOpens,persisted,events,toasts,selectorTasks,callbackQueue,callbacks,renders,stateJobs,
    holdCallbacks(value){holdCallbacks=value;},releaseCallbacks(){holdCallbacks=false;while(callbackQueue.length)callbackQueue.shift()();},
    failNextOpen(){nextOpenFailure=true;context.replaceStorageForOpenFailure();},
    openMenu(){const el=context.menuElement.call(c);const ui=context.LyricsProviderSelectButton(el.props);assert.equal(ui.children[0].props.disabled,false,'real provider button is enabled at admission');ui.children[0].props.onClick();return modal;},
    choose(mode){const opened=this.openMenu();assert.ok(opened);const list=context.IvOptionList({items:opened.items[0].items,onChange:opened.onChange});const row=list.children[0].find(r=>r.props.key==='track-lyrics-provider');const control=row.children[0].children[1].children[0];assert.ok(control.props.options.some(o=>o.key===mode));hookSlots=[];hookCursor=0;let dropdown=context.OptionsMenu(control.props);dropdown.children[0].props.onClick();hookCursor=0;dropdown=context.OptionsMenu(control.props);const item=dropdown.children[1].children[0].find(item=>item.props.key===mode);let prevented=0,stopped=0;item.props.onMouseDown({preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(prevented,1);assert.equal(stopped,1);return menuTasks.at(-1).promise;},
    pendingWrite(){return storageRequests.find(q=>!q.settled&&q.operation!=='get');},
    snapshot(){return plain({error:c.state.error,colorsUri:c.state.colorsUri,isLoading:c.state.isLoading,storageTrace,transactions:transactions.map(({id,mode,started,finished})=>({id,mode,started,finished})),otherReads:otherReads.map(q=>({kind:q.kind,uri:q.args.uri,settled:q.settled})),current:c.currentTrackUri,uri:c.state.uri,display:c.state.lyricsDisplayUri,instanceOverride:c.trackLyricsProviderOverride,stateOverride:c.state.trackLyricsProviderOverride,buttonDisabled:context.LyricsProviderSelectButton(context.menuElement.call(c).props).children[0].props.disabled,currentLyrics:plain(c.state.currentLyrics),provider:c.state.provider,activeSeq:c._activeLyricsFetchSeq,persistent:[...persisted],events,toasts,colorCalls:colorTasks.map(t=>t.uri),publications});},
    expireResolution(){now+=5000;const fns=[...timers.values()];timers.clear();for(const fn of fns)fn();},
    spicetify,clock,queries,cosmos,palettes,colorTasks,lyricTasks,publications,warnings,errors,timers,stateQueue,config,
    async settleState(){for(let i=0;i<6;i++){while(stateQueue.length)stateQueue.shift()();await flush();}},
    async play(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`play-${lyricTasks.length}`,isPaused:false};c.schedulePlaybackTrackResolution(accepted);await this.settleState();assert.equal(c.currentTrackUri,accepted.uri);assert.equal(c.state.uri,accepted.uri);assert.equal(c.state.lyricsDisplayUri,accepted.uri);assert.equal(c.state.isLoading,false);assert.equal(timers.size,0);},
    async refresh(item){spicetify.Player.data.item=item;spicetify.Platform.PlayerAPI._state.item=item;c.fetchLyrics(item,-1,true);await this.settleState();},
    pending(kind,uri){return queries.find(q=>!q.settled&&q.kind===kind&&(!uri||q.args.uri===uri||q.args.imageUris?.[0]===uri));},
    async resolve(q,response){assert.ok(q,'pending query exists');q.resolve(response);await this.settleState();},
    async reject(q){assert.ok(q);q.reject(Error('inert rejection'));await this.settleState();},
    render(){return plain(context.renderBackground.call(c).backgroundStyle);},
    async finish(){this.releaseCallbacks();for(let i=0;i<12;i++){for(const q of otherReads.filter(q=>!q.settled))q.resolve(null);for(const tx of transactions.filter(tx=>!tx.finished&&tx.started)){for(const q of tx.requests.filter(q=>!q.settled))if(q.operation!=='get')q.resolve();if(tx.mode==='readwrite'&&tx.requests.every(q=>q.settled))tx.complete();}for(const q of queries.filter(q=>!q.settled))q.resolve(q.kind==='base'?base(q.args.uri===B?'#445566':'#112233'):dynamic(q.args.imageUris[0]));for(const q of cosmos.filter(q=>!q.settled))q.resolve({entries:[{color_swatches:[{preset:'VIBRANT_NON_ALARMING',color:0x112233}]}]});for(const q of palettes.filter(q=>!q.settled))q.resolve(null);await this.settleState();if([...queries,...cosmos,...palettes].every(q=>q.settled)&&colorTasks.every(t=>t.done)&&lyricTasks.every(t=>t.done))break;}await Promise.all([...colorTasks,...lyricTasks,...selectorTasks,...menuTasks].map(t=>t.promise));assert.ok([...queries,...cosmos,...palettes].every(q=>q.settled),'all inert I/O settled');assert.ok([...colorTasks,...lyricTasks].every(t=>t.done),'all unchanged-method promises completed');assert.equal(timers.size,0,'no resolution timers remain');assert.equal(stateQueue.length,0);assert.ok(storageRequests.every(q=>q.settled),'all storage requests settled');assert.ok(transactions.every(tx=>tx.finished),'all transactions complete or abort');assert.ok(otherReads.every(q=>q.settled),'all separate-store read promises settle');assert.ok(selectorTasks.every(t=>t.done),'all selector promises completed');assert.equal(callbackQueue.length,0);assert.equal(errors.length,this.expectedErrors||0,'only explicitly expected errors');assert.ok(menuTasks.every(t=>t.done),'all menu callback promises completed');clock.destroy();activeHarnesses.delete(this);},
  };activeHarnesses.add(h);return h;
}
async function finishTrackColors(h,uri,cover){await h.resolve(h.pending('base',uri),base(uri===B?'#445566':'#112233'));const q=h.pending('dynamic',cover);if(q)await h.resolve(q,dynamic(cover));}

for (const queuedState of [false,true]) for (const publicLag of [false,true]) for (const choice of ['inert-one','auto']) {
  test(`ordinary provider choice across A to accepted B; queued=${queuedState}; public lag=${publicLag}; choice=${choice}`,async()=>{
    const h=harness({queuedState,initialOverrides:{[A]:'inert-two',[B]:'inert-two'}});
    await h.play(track(A));await finishTrackColors(h,A,'cover-A');
    h.context.CACHE[A]={marker:'origin'};h.context.CACHE[B]={marker:'other',trackLyricsProviderOverride:'inert-two'};
    h.c._dmResults[A]={marker:'origin'};h.c._dmResults[B]={marker:'other'};
    h.context.CacheManager._cache.set(`translation:${A}`,{});h.context.CacheManager._cache.set(`translation:${B}`,{});
    const selected=h.choose(choice);await flush();const write=h.pendingWrite();assert.ok(write);assert.equal(write.key,A);
    await h.beginPlay(track(B),publicLag?track(A):track(B));
    assert.equal(h.clock.getSnapshot().uri,B);assert.equal(h.c.state.isLoading,true);
    const bRead=h.storageRequests.find(q=>q.operation==='get'&&q.key===B);assert.ok(bRead);assert.equal(bRead.tx.started,false);
    assert.throws(()=>bRead.resolve(),/same-store transaction ordering/);
    write.resolve();await h.settleState();await selected;
    const afterAck=h.snapshot();assert.equal(write.tx.finished,false);assert.equal(bRead.settled,false);
    assert.deepEqual(h.cacheInvalidations,[A]);assert.equal(h.c._dmResults[A],undefined);assert.deepEqual(h.c._dmResults[B],{marker:'other'});
    assert.equal(h.context.CacheManager._cache.has(`translation:${A}`),false);assert.equal(h.context.CacheManager._cache.has(`translation:${B}`),true);
    assert.deepEqual(h.toasts,[{kind:'success',message:'notifications.lyricsProviderSaved'}]);assert.equal(h.modalCloses.length,1);
    write.commit();await h.settleState();await h.finish();
    const final=h.snapshot();assert.equal(h.clock.getSnapshot().uri,B);
    assert.equal(h.persisted.get(A)??null,choice==='auto'?null:choice);assert.equal(h.persisted.get(B),'inert-two');
    const success=h.storageTrace.findIndex(e=>e.event==='request-success'&&e.id===write.tx.id);
    const complete=h.storageTrace.findIndex(e=>e.event==='transaction-complete'&&e.id===write.tx.id);
    const read=h.storageTrace.findIndex(e=>e.event==='request-success'&&e.id===bRead.tx.id);
    assert.ok(success<complete&&complete<read);
    observations.push({case:'ordered-transition',queuedState,publicLag,choice,afterAck,final,providerCalls:h.providerCalls,snapshotClears:h.snapshotClears,cacheInvalidations:h.cacheInvalidations,modalCloses:h.modalCloses});
    assert.equal(afterAck.current,B);assert.equal(afterAck.uri,B);
    assert.equal(final.current,B);assert.equal(final.uri,B);assert.equal(final.display,B);assert.equal(final.isLoading,false);assert.equal(final.buttonDisabled,false);
    assert.equal(final.stateOverride,'inert-two');assert.equal(final.provider,'inert-two');
    assert.equal(h.lyricTasks.filter(task=>task.uri===B).length,2,'preserve current-track refresh');
    assert.equal(h.providerCalls.filter(call=>call.uri===B).length,1,'only latest B proceeds past ordered override reads');
  });
}

for (const queuedState of [false,true]) for (const choice of ['inert-one','auto']) {
  test(`current provider choice preserves its storage and refresh contract; queued=${queuedState}; choice=${choice}`,async()=>{
    const h=harness({queuedState,initialOverrides:{[A]:'inert-two'}});
    await h.play(track(A));await finishTrackColors(h,A,'cover-A');
    const selected=h.choose(choice);await flush();const write=h.pendingWrite();assert.ok(write);
    write.resolve();await h.settleState();await selected;assert.equal(write.tx.finished,false);
    assert.equal(h.persisted.get(A),'inert-two');
    write.commit();await h.settleState();await h.finish();
    const value=choice==='auto'?null:choice;
    assert.equal(h.persisted.get(A)??null,value);assert.equal(h.c.trackLyricsProviderOverride,value);
    assert.equal(h.c.state.trackLyricsProviderOverride,value);assert.equal(h.c.state.isLoading,false);
    assert.equal(h.c.state.uri,A);assert.equal(h.c.state.provider,value||'inert-auto');
    assert.deepEqual(h.cacheInvalidations,[A]);assert.deepEqual(h.snapshotClears,[A]);
    assert.deepEqual(h.toasts,[{kind:'success',message:'notifications.lyricsProviderSaved'}]);
    assert.equal(h.modalCloses.length,1);
  });
}

for (const publicLag of [false,true]) for (const choice of ['inert-one','auto']) {
  test(`request error retains accepted B and origin persistence; lag=${publicLag}; choice=${choice}`,async()=>{
    const h=harness({initialOverrides:{[A]:'inert-two',[B]:'inert-two'}});
    await h.play(track(A));await finishTrackColors(h,A,'cover-A');
    const selected=h.choose(choice);await flush();const write=h.pendingWrite();
    await h.beginPlay(track(B),publicLag?track(A):track(B));
    h.expectedErrors=1;write.reject();await h.settleState();await selected;await h.finish();
    assert.equal(write.tx.aborted,true);assert.equal(h.persisted.get(A),'inert-two');
    assert.equal(h.c.currentTrackUri,B);assert.equal(h.c.state.uri,B);assert.equal(h.c.state.isLoading,false);
    assert.equal(h.c.state.provider,'inert-two');assert.deepEqual(h.cacheInvalidations,[]);
    assert.deepEqual(h.toasts,[{kind:'error',message:'notifications.lyricsProviderSaveFailed'}]);
    assert.equal(h.modalCloses.length,1);
  });
}

for (const queuedState of [false,true]) for (const publicLag of [false,true]) {
  test(`selector callback delayed until after B completes; queued=${queuedState}; public lag=${publicLag}`,async()=>{
    const h=harness({queuedState,initialOverrides:{[B]:'inert-two'}});
    await h.play(track(A));await finishTrackColors(h,A,'cover-A');
    const selected=h.choose('inert-one');await flush();const write=h.pendingWrite();
    h.holdCallbacks(true);write.resolve();await h.settleState();await selected;
    assert.equal(h.callbackQueue.length,1);write.commit();await h.settleState();h.holdCallbacks(false);
    await h.play(track(B),publicLag?track(A):track(B));await finishTrackColors(h,B,publicLag?'cover-A':'cover-B');
    const before=h.snapshot();assert.equal(before.uri,B);assert.equal(before.isLoading,false);
    h.releaseCallbacks();await h.settleState();await h.finish();const final=h.snapshot();
    assert.equal(h.clock.getSnapshot().uri,B);assert.equal(h.persisted.get(A),'inert-one');
    assert.deepEqual(h.toasts,[{kind:'success',message:'notifications.lyricsProviderSaved'}]);
    observations.push({case:'delayed-state-callback',queuedState,publicLag,before,final,providerCalls:h.providerCalls,snapshotClears:h.snapshotClears});
    assert.equal(final.uri,B);assert.equal(final.current,B);assert.equal(final.isLoading,false);assert.equal(final.stateOverride,'inert-two');
    assert.equal(h.providerCalls.filter(call=>call.uri===B).length,2);
  });
}

for (const queuedState of [false,true]) for (const choice of ['inert-one','auto']) {
  test(`valid current A selection with lagging public B; queued=${queuedState}; choice=${choice}`,async()=>{
    const h=harness({queuedState,initialOverrides:{[A]:'inert-two',[B]:'inert-two'}});
    await h.play(track(B));await finishTrackColors(h,B,'cover-B');
    await h.play(track(A),track(B));await finishTrackColors(h,A,'cover-B');
    assert.equal(h.clock.getSnapshot().uri,A);assert.equal(h.c.currentTrackUri,A);assert.equal(h.c.state.isLoading,false);
    const selected=h.choose(choice);await flush();const write=h.pendingWrite();assert.equal(write.key,A);
    write.resolve();await h.settleState();await selected;
    const afterAck=h.snapshot();assert.equal(afterAck.current,A);assert.equal(afterAck.uri,A);
    write.commit();await h.settleState();await h.finish();const final=h.snapshot();
    assert.equal(h.clock.getSnapshot().uri,A);assert.equal(final.current,A);assert.equal(final.uri,A);
    assert.equal(final.isLoading,false);assert.equal(final.buttonDisabled,false);assert.ok(final.currentLyrics.length>0);
    assert.equal(h.persisted.get(A)??null,choice==='auto'?null:choice);assert.equal(h.persisted.get(B),'inert-two');
    assert.deepEqual(h.cacheInvalidations,[A]);assert.deepEqual(h.snapshotClears,[A]);
    assert.deepEqual(h.toasts,[{kind:'success',message:'notifications.lyricsProviderSaved'}]);
    observations.push({case:'valid-current-public-lag',queuedState,choice,afterAck,final,providerCalls:h.providerCalls,snapshotClears:h.snapshotClears});
  });
}

for (const queuedState of [false,true]) test(`same-URI refresh preserves the selected provider after ordered reads; queued=${queuedState}`,async()=>{
  const h=harness({queuedState,initialOverrides:{[A]:'inert-two'}});
  await h.play(track(A));await finishTrackColors(h,A,'cover-A');
  const selected=h.choose('inert-one');await flush();const write=h.pendingWrite();
  await h.refresh(track(A));
  assert.equal(h.c.currentTrackUri,A);
  write.resolve();await h.settleState();await selected;write.commit();await h.settleState();await h.finish();
  assert.equal(h.c.currentTrackUri,A);assert.equal(h.c.state.uri,A);assert.equal(h.c.state.isLoading,false);
  assert.equal(h.c.state.trackLyricsProviderOverride,'inert-one');assert.equal(h.c.state.provider,'inert-one');
});

for (const queuedState of [false,true]) test(`A to B to A keeps an acknowledged origin choice usable; queued=${queuedState}`,async()=>{
  const h=harness({queuedState,initialOverrides:{[B]:'inert-two'}});
  await h.play(track(A));await finishTrackColors(h,A,'cover-A');
  const selected=h.choose('inert-one');await flush();const write=h.pendingWrite();
  await h.beginPlay(track(B));await h.beginPlay(track(A));
  write.resolve();await h.settleState();await selected;write.commit();await h.settleState();await h.finish();
  assert.equal(h.c.currentTrackUri,A);assert.equal(h.c.state.isLoading,false);assert.equal(h.c.state.provider,'inert-one');
  assert.equal(h.persisted.get(A),'inert-one');assert.equal(h.persisted.get(B),'inert-two');
});

test('actual stable resolver prefers accepted metadata over lagging public identity',async()=>{
  const h=harness();await h.play(track(B),track(A));await finishTrackColors(h,B,'cover-A');
  const snapshot=h.context.window.Utils.getPlayerPlaybackSnapshot();
  const resolved=h.context.window.Utils.resolveStablePlaybackTrack(null,snapshot);
  assert.equal(snapshot.uri,B);assert.equal(resolved.uri,B);assert.equal(resolved.metadata.title,'Track B');
  await h.finish();
});

for (const clockResolverPresent of [false,true]) test(`stable wrapper rejects mismatched metadata-less snapshot without public fallback; resolver=${clockResolverPresent}`,async()=>{
  const h=harness();await h.play(track(A));await finishTrackColors(h,A,'cover-A');
  h.spicetify.Platform.PlayerAPI._state.item={uri:B};
  if(!clockResolverPresent)h.context.window.ivLyricsPlaybackClock={};
  const snapshot=h.context.window.Utils.getPlayerPlaybackSnapshot();
  assert.equal(snapshot.uri,B);
  assert.equal(h.context.window.Utils.resolveStablePlaybackTrack(null,snapshot),null);
  await h.finish();
});

for (const queuedState of [false,true]) test(`authoritative resolver rejection preserves completed A readiness; queued=${queuedState}`,async()=>{
  const h=harness({queuedState,initialOverrides:{[A]:'inert-two',[B]:'inert-two'}});
  await h.play(track(B));await finishTrackColors(h,B,'cover-B');
  await h.play(track(A),track(B));await finishTrackColors(h,A,'cover-B');
  assert.equal(h.c.state.isLoading,false);assert.ok(h.c.state.currentLyrics.length>0);
  const selected=h.choose('inert-one');await flush();const write=h.pendingWrite();
  h.holdCallbacks(true);
  h.spicetify.Platform.PlayerAPI._state.item={uri:A};
  const snapshot=h.context.window.Utils.getPlayerPlaybackSnapshot();
  assert.equal(snapshot.uri,A);assert.equal(h.context.window.Utils.resolveStablePlaybackTrack(null,snapshot),null);
  const beforeSeq=h.c._activeLyricsFetchSeq, beforeTasks=h.lyricTasks.length;
  write.resolve();await h.settleState();await selected;
  const beforeCallback=h.snapshot();
  assert.equal(beforeCallback.current,A);assert.equal(beforeCallback.uri,A);
  assert.equal(beforeCallback.isLoading,false);assert.ok(beforeCallback.currentLyrics.length>0);
  assert.equal(h.lyricTasks.length,beforeTasks);assert.equal(h.c._activeLyricsFetchSeq,beforeSeq);
  assert.equal(h.callbackQueue.length,1,'retain the existing callback boundary without publishing loading');
  h.releaseCallbacks();await h.settleState();write.commit();await h.settleState();await h.finish();
  const final=h.snapshot();assert.equal(h.clock.getSnapshot().uri,A);
  assert.equal(final.current,A);assert.equal(final.uri,A);assert.equal(final.isLoading,false);assert.equal(final.stateOverride,'inert-two');assert.equal(final.instanceOverride,'inert-two');
  observations.push({case:'resolver-rejection-readiness',queuedState,beforeCallback,final,snapshotClears:h.snapshotClears});
});

for (const queuedState of [false, true]) {
  for (const availability of ['metadata-less', 'missing', 'snapshot-only']) {
    test(`current refresh admission uses available metadata: ${availability}, queued=${queuedState}`, async () => {
      const h = harness({ queuedState, initialOverrides: { [A]: 'inert-two' } });
      await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
      const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
      h.holdCallbacks(true);
      const before = h.snapshot(), tasks = h.lyricTasks.length;
      if (availability === 'metadata-less') {
        h.spicetify.Player.data.item = { uri: A };
        h.spicetify.Platform.PlayerAPI._state.item = { uri: A };
      } else {
        h.spicetify.Player.data.item = null;
        h.spicetify.Platform.PlayerAPI._state.item = availability === 'missing' ? null : track(A);
      }
      write.resolve(); await h.settleState(); await selected;
      const waiting = h.snapshot();
      h.releaseCallbacks(); await h.settleState(); write.commit(); await h.finish();
      const final = h.snapshot();
      assert.equal(waiting.isLoading, false, 'no loading before a fetch is admitted');
      assert.equal(waiting.stateOverride, before.stateOverride);
      assert.equal(waiting.instanceOverride, before.instanceOverride);
      assert.equal(final.current, A); assert.equal(final.uri, A); assert.equal(final.isLoading, false);
      assert.equal(final.error, null);
      if (availability === 'snapshot-only') {
        assert.equal(h.lyricTasks.length, tasks + 1); assert.equal(final.provider, 'inert-one');
        assert.deepEqual(h.snapshotClears, [A]);
      } else {
        assert.equal(h.lyricTasks.length, tasks); assert.equal(final.activeSeq, before.activeSeq);
        assert.equal(final.stateOverride, before.stateOverride); assert.deepEqual(h.snapshotClears, []);
      }
      assert.equal(h.persisted.get(A), 'inert-one'); assert.deepEqual(h.cacheInvalidations, [A]);
      assert.equal(h.toasts[0].kind, 'success'); assert.equal(h.modalCloses.length, 1);
    });
  }

  for (const rejected of ['mismatch', 'metadata-less', 'missing']) {
    test(`rejected old callback preserves a newer B loading owner: ${rejected}, queued=${queuedState}`, async () => {
      const h = harness({ queuedState, initialOverrides: { [A]: 'inert-two', [B]: 'inert-two' } });
      await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
      const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
      h.holdCallbacks(true); write.resolve(); await h.settleState(); await selected;
      write.commit(); await h.settleState(); h.holdCallbacks(false);
      h.holdOther('language', B); await h.beginPlay(track(B));
      const before = h.snapshot(), tasks = h.lyricTasks.length;
      assert.equal(before.isLoading, true);
      h.spicetify.Platform.PlayerAPI._state.item = { uri: B };
      h.spicetify.Player.data.item = rejected === 'mismatch' ? track(A) : rejected === 'metadata-less' ? { uri: B } : null;
      h.releaseCallbacks(); await h.settleState(); const after = h.snapshot();
      const afterTasks = h.lyricTasks.length;
      h.spicetify.Player.data.item = track(B); h.spicetify.Platform.PlayerAPI._state.item = track(B);
      await h.releaseOther(); await h.finish();
      assert.equal(after.current, B); assert.equal(after.uri, B);
      assert.equal(after.isLoading, true); assert.equal(after.error, before.error);
      assert.equal(after.activeSeq, before.activeSeq); assert.equal(afterTasks, tasks);
      assert.equal(after.stateOverride, before.stateOverride); assert.equal(after.instanceOverride, before.instanceOverride);
      assert.equal(h.c.state.uri, B); assert.equal(h.c.state.isLoading, false);
      assert.equal(h.c.state.provider, 'inert-two');
    });
  }

  test(`acknowledging A does not label B before the refresh callback: queued=${queuedState}`, async () => {
    const h = harness({ queuedState, initialOverrides: { [A]: 'inert-two', [B]: 'inert-two' } });
    await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
    const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
    await h.beginPlay(track(B)); const before = h.snapshot();
    h.holdCallbacks(true); write.resolve(); await h.settleState(); await selected;
    const waiting = h.snapshot();
    write.commit(); await h.settleState(); h.releaseCallbacks(); await h.finish();
    assert.equal(waiting.current, B); assert.equal(waiting.stateOverride, before.stateOverride);
    assert.equal(waiting.instanceOverride, before.instanceOverride);
    assert.equal(waiting.activeSeq, before.activeSeq);
    assert.equal(h.c.state.uri, B); assert.equal(h.c.state.provider, 'inert-two');
    assert.equal(h.persisted.get(A), 'inert-one');
  });

  test(`lower resolver absence preserves authoritative wrapper rejection: queued=${queuedState}`, async () => {
    const next = harness({ queuedState, initialOverrides: { [A]: 'inert-two' } });
    await next.play(track(A), track(B)); await finishTrackColors(next, A, 'cover-B');
    const before = next.snapshot(), tasks = next.lyricTasks.length;
    next.context.window.ivLyricsPlaybackClock = {};
    const selected = next.choose('inert-one'); await flush(); const write = next.pendingWrite();
    write.resolve(); await next.settleState(); await selected; write.commit(); await next.finish();
    assert.equal(next.c.state.uri, A); assert.equal(next.c.state.isLoading, false);
    assert.equal(next.lyricTasks.length, tasks); assert.equal(next.c._activeLyricsFetchSeq, before.activeSeq);
    assert.equal(next.c.state.trackLyricsProviderOverride, 'inert-two');
  });
}

for (const publicLag of [false, true]) {
  test(`missing resolver wrapper retains guarded public compatibility: lag=${publicLag}`, async () => {
    const h = harness({ initialOverrides: { [A]: 'inert-two' } });
    await h.play(track(A), publicLag ? track(B) : track(A));
    await finishTrackColors(h, A, publicLag ? 'cover-B' : 'cover-A');
    delete h.context.window.Utils.resolveStablePlaybackTrack;
    const tasks = h.lyricTasks.length;
    const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
    write.resolve(); await h.settleState(); await selected; write.commit(); await h.finish();
    assert.equal(h.c.state.uri, A); assert.equal(h.c.state.isLoading, false);
    assert.equal(h.lyricTasks.length, tasks + (publicLag ? 0 : 1));
    assert.equal(h.c.state.provider, publicLag ? 'inert-two' : 'inert-one');
  });
}

test('callback admission follows playback before the component URI has caught up', async () => {
  const h = harness({ initialOverrides: { [A]: 'inert-two', [B]: 'inert-two' } });
  await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
  const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
  h.spicetify.Player.data.item = track(B); h.spicetify.Platform.PlayerAPI._state.item = track(B);
  assert.equal(h.c.currentTrackUri, A); assert.equal(h.clock.getSnapshot().uri, B);
  write.resolve(); await h.settleState(); await selected; write.commit(); await h.finish();
  assert.equal(h.c.state.uri, B); assert.equal(h.c.state.provider, 'inert-two');
  assert.equal(h.c.state.isLoading, false); assert.deepEqual(h.cacheInvalidations, [A]);
});

for (const publicLag of [false, true]) {
  test(`accepted local target keeps its existing refresh path: lag=${publicLag}`, async () => {
    const h = harness({ initialOverrides: { [A]: 'inert-two' } });
    await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
    const selected = h.choose('inert-one'); await flush(); const write = h.pendingWrite();
    const local = track('spotify:local:Artist:Album:Title:123', 'cover-local');
    await h.beginPlay(local, publicLag ? track(A) : local);
    write.resolve(); await h.settleState(); await selected; write.commit(); await h.finish();
    assert.equal(h.c.state.uri, local.uri); assert.equal(h.c.state.isLoading, false);
    assert.equal(h.c.state.trackLyricsProviderOverride, null);
    assert.equal(h.persisted.has(local.uri), false); assert.equal(h.persisted.get(A), 'inert-one');
  });
}

for (const choice of ['inert-one', 'auto']) {
  test(`fulfilled open-failure fallback keeps its existing toast and refresh: ${choice}`, async () => {
    const h = harness({ initialOverrides: { [A]: 'inert-two' } });
    await h.play(track(A)); await finishTrackColors(h, A, 'cover-A');
    h.expectedErrors = 2; h.failNextOpen();
    await h.choose(choice); await h.finish();
    assert.equal(h.persisted.get(A), 'inert-two'); assert.equal(h.c.state.provider, 'inert-two');
    assert.equal(h.c.state.isLoading, false);
    assert.deepEqual(h.toasts, [{ kind: 'success', message: 'notifications.lyricsProviderSaved' }]);
    assert.equal(h.modalCloses.length, 1);
  });
}
