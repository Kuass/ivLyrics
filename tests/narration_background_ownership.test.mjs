// Actual narration detection, transition, renderer/menu and storage helper bodies.
// Transport, transactions, hooks and elements are inert; visual payload continuity
// is verified separately from the departed track's explicit background mode.
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
  'commitDjNarrationTrack','getEffectiveBackgroundMode','fetchColors','selectBackgroundForCurrentTrack','updateVisualOnConfigChange'];
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
const observations = [];
const activeHarnesses=new Set();
test.afterEach(async()=>{for(const h of activeHarnesses)await h.finish();});
function harness({mode='blur-gradient-background', queuedState=false, noDynamicDefinition=false, initialOverrides={}}={}) {
  const queries=[], cosmos=[], palettes=[], colorTasks=[], lyricTasks=[], publications=[], warnings=[], errors=[], stateQueue=[], timers=new Map();
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
  const context=vm.createContext({indexedDB,react,document:{body:{}},getSettingsSurfaceTheme:()=> 'dark',ivLyricsDebug(){},getLyricsTypographyStyleVariables:()=>({}),I18n:{t:key=>key},Toast:{success:message=>toasts.push({kind:'success',message}),error:message=>toasts.push({kind:'error',message})},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},getOptionsText:(key,fallback)=>fallback,getBackgroundPresetLabel:mode=>mode,SettingRowDescription:'SettingRowDescription',ICONS:{background:'background'},IvLyricsTooltip:'IvLyricsTooltip',IvLyricsToolbarIcon:'IvLyricsToolbarIcon',IvConfigSlider:'IvConfigSlider',ConfigSlider:'ConfigSlider',IvConfigButton:'IvConfigButton',ConfigButton:'ConfigButton',openOptionsModal(title,items,onChange){modal={title,items,onChange(...args){const p=onChange(...args);const task={promise:p,done:false};menuTasks.push(task);p.then(()=>task.done=true);return p;}};},console:{warn:(...v)=>warnings.push(v),error:(...v)=>errors.push(v)},Spicetify:spicetify,CONFIG:config,CACHE:{},SYNCED:1,
    getRememberedLyricsRenderModeLock:()=>-1,getRememberedIvLyricsFullscreenPresentation:()=> 'standard',
    IVLYRICS_BACKGROUND_MODE_IDS:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'],
    getLyricsDataMode:mode=>mode,getLyricsModeTypeKey:mode=>config.modes[mode],isLyricsRenderCacheCurrent:()=>true,
    hasInstrumentalMarker:()=>false,getCurrentTranslationTargetLanguage:()=> 'ko',getCurrentLyricsPronunciationNotation:()=> 'translation',
    getNonSectionLyricsText:lyrics=>lyrics.map(l=>l.text).join('\n'),
    Date:{now:()=>now},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    ensurePlaybackProgressGuard:()=>({getSnapshot:()=>clock.getSnapshot(),clearCorrection:()=>clock.invalidate()}),
    window:{VideoBackground:'VideoBackground',innerWidth:1000,scrollX:0,scrollY:0,ivLyricsBackgroundPresets:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'].map(id=>({id})),dispatchEvent:event=>events.push(plain(event)),ivLyricsPlaybackClock:playback,Translator:{clearInflightRequests(){}},LyricsService:{
      getTrackLanguageOverride:uri=>readOther('language',uri),getTrackLyricsProviderOverride:uri=>readOther('provider',uri),
      getLyricsFromProviders:async info=>({uri:info.uri,provider:'inert',synced:[{text:`Lyric ${info.title}`,startTime:0}]}),
      publishLyricsSnapshot(){},
    }},
  });
  vm.runInContext(`const Utils={_colorCache:new Map(),${method(utils,'convertIntToRGB')}\n${method(utils,'isColorLight')}\nextractTrackId:uri=>uri?.startsWith('spotify:track:')?uri.slice(14):null,detectLanguage:()=> 'en'};globalThis.Utils=Utils;\n`+
    `window.Utils={${['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack','clearSafePlayerProgressCorrection'].map(n=>method(service,n,'        ')).join('\n')}};\n`+
    cut(index,'function getIvLyricsGlobalBackgroundMode(', 'window.ivLyricsBackgroundFlagIds')+'\n'+
    cut(index,'const createTrackOverrideDB = (','const TrackLanguageDB =')+'\n'+cut(index,'const TrackBackgroundDB =','window.TrackLanguageDB =')+'\n'+cut(index,'const readFiniteNumber =','const readNumericSetting =')+'\n'+cut(options,'const OptionsMenu =','const ICONS =')+'\n'+cut(options,'const getTrackBackgroundOptions =','// 최적화 #5')+'\n'+cut(options,'const TrackBackgroundButton =','const clampSyncOffset =')+'\n'+cut(options,'const IvOptionList =','// Helper: open a compact options modal')+'\n'+
    cut(index,'const computeBaseLyricsStyleVariables = (','// Builds the initial LyricsContainer')+'\n'+
    cut(index,'const emptyState = {','\nconst getPlainLyricsLineText')+'\n'+
    cut(index,'const createInitialLyricsContainerState = () => ({','\n// note/placeholder-only line')+'\n'+
    `class Container {${methods.map(n=>method(index,n)).join('\n')}};globalThis.Container=Container;globalThis.empty=emptyState;globalThis.initial=createInitialLyricsContainerState;\n`+
    `globalThis.menuElement=function(){const effectiveBackgroundMode=this.getEffectiveBackgroundMode(this.state.trackBackgroundOverride);return ${cut(index,'react.createElement(TrackBackgroundButton, {','              react.createElement(RegenerateTranslationButton,').trim().replace(/,$/,'')};};globalThis.OptionsMenu=OptionsMenu;globalThis.TrackBackgroundButton=TrackBackgroundButton;globalThis.IvOptionList=IvOptionList;globalThis.renderBackground=function(){const isSyncCreatorActive=false;const fullscreenPresentation=this.state.fullscreenPresentation||'standard';const isVideoStagePresentation=fullscreenPresentation==='video';${cut(index,'    const effectiveBackgroundMode = this.getEffectiveBackgroundMode(this.state.trackBackgroundOverride);','    const computeExtendedLyricsStyleVariables =')};${cut(index,'    const shouldUseVideoBackground =','    const renderFloatingToolbarIcon =')};${cut(index,'    const renderStaticGradientBackground =','    const renderFloatingToolbar =')};return {effectiveBackgroundMode,backgroundStyle,styleVariables:this.styleVariables,staticNode:renderStaticGradientBackground(),videoNode:renderVideoBackgroundChild(),shouldUseVideoBackground,shouldRenderStaticBackground};};globalThis.replaceStorageForOpenFailure=()=>{TrackBackgroundDB.setOverride=createTrackOverrideDB({dbName:'ivLyrics-background-db',storeName:'track-background-overrides',label:'Background',setting:'background',methods:['getOverride','setOverride','clearOverride'],normalize:normalizeIvLyricsTrackBackgroundOverride}).setOverride;TrackBackgroundDB.clearOverride=createTrackOverrideDB({dbName:'ivLyrics-background-db',storeName:'track-background-overrides',label:'Background',setting:'background',methods:['getOverride','setOverride','clearOverride'],normalize:normalizeIvLyricsTrackBackgroundOverride}).clearOverride;};`+
    'globalThis.computeLyricsBackgroundStyle=computeLyricsBackgroundStyle;globalThis.buildAmbientGradientColorVars=buildAmbientGradientColorVars;globalThis.getAlbumAmbientColors=getAlbumAmbientColors;',context);
  const c=new context.Container();
  Object.assign(c,{state:{...context.initial(),currentLyrics:[],uri:'',lyricsDisplayUri:null},currentTrackUri:'',
    _lyricsFetchSeq:0,_activeLyricsFetchSeq:0,_lyricsTransitionSeq:0,_playbackTrackResolutionSeq:0,_isComponentMounted:true,
    clearPendingLyricsUpdates(){},closeLyricsEditModal(){},lyricsSaved:()=>false,fetchMetadataTranslation(){},fetchTempo(){},resetDelay(){},loadSavedVideoForTrack(){},
    startLyricsLoading:()=>1,clearLyricsLoading(){},getCurrentMode:()=>1,isModeAvailable:()=>false,getAutomaticMode:()=>1,applyTranslationStates:()=>({}),refineLanguageWithAI(){},
    setState(patch,callback){const scheduled={patch:plain(typeof patch==='function'?{}:patch),current:c.currentTrackUri};stateJobs.push(scheduled);const job=()=>{const p=typeof patch==='function'?patch(this.state):patch;this.state={...this.state,...p};scheduled.appliedCurrent=this.currentTrackUri;if(Object.hasOwn(p,'colorsUri')&&p.colorsUri)publications.push(plain({current:this.currentTrackUri,stateUri:this.state.uri,displayUri:this.state.lyricsDisplayUri,coverUrl:this.state.coverUrl,...p}));if(callback){const cb=()=>{callbacks.push({scheduledCurrent:scheduled.current,current:this.currentTrackUri,override:plain(this.state.trackBackgroundOverride)});callback();};if(holdCallbacks)callbackQueue.push(cb);else cb();}};if(queuedState)stateQueue.push(job);else job();},
    forceUpdate(){renders.push(plain(context.renderBackground.call(this)));},
  });
  const originalColors=c.fetchColors,originalLyrics=c.fetchLyrics,originalSelect=c.selectBackgroundForCurrentTrack;
  c.selectBackgroundForCurrentTrack=function(...args){const p=originalSelect.apply(this,args);const t={mode:args[0],promise:p,done:false};selectorTasks.push(t);p.then(()=>t.done=true);return p;}.bind(c);
  c.fetchColors=function(...args){const p=originalColors.apply(this,args);const t={uri:args[0],promise:p,done:false};colorTasks.push(t);p.then(()=>t.done=true);return p;};
  c.fetchLyrics=function(...args){const p=originalLyrics.apply(this,args);const t={uri:args[0]?.uri,promise:p,done:false};lyricTasks.push(t);p.then(()=>t.done=true);return p;};
  const h={c,context,spicetify,transactions,storageTrace,otherReads,
    holdOther(kind,uri){heldOtherReads.add(`${kind}:${uri}`);},
    async releaseOther(){for(const q of otherReads.filter(q=>!q.settled))q.resolve(null);await this.settleState();},
    async beginPlay(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`play-${lyricTasks.length}`,isPaused:false};c.schedulePlaybackTrackResolution(accepted);await this.settleState();assert.equal(c.currentTrackUri,accepted.uri);assert.equal(c.state.uri,accepted.uri);},
    storageRequests,storageOpens,persisted,events,toasts,selectorTasks,callbackQueue,callbacks,renders,stateJobs,
    holdCallbacks(value){holdCallbacks=value;},releaseCallbacks(){holdCallbacks=false;while(callbackQueue.length)callbackQueue.shift()();},
    failNextOpen(){nextOpenFailure=true;context.replaceStorageForOpenFailure();},
    openMenu(){const el=context.menuElement.call(c);const ui=context.TrackBackgroundButton(el.props);ui.children[0].props.onClick();return modal;},
    choose(mode){const opened=this.openMenu();assert.ok(opened);const list=context.IvOptionList({items:opened.items[0].items,onChange:opened.onChange});const row=list.children[0].find(r=>r.props.key==='track-background-mode');const control=row.children[0].children[1].children[0];assert.ok(control.props.options.some(o=>o.key===mode));hookSlots=[];hookCursor=0;let dropdown=context.OptionsMenu(control.props);dropdown.children[0].props.onClick();hookCursor=0;dropdown=context.OptionsMenu(control.props);const item=dropdown.children[1].children[0].find(item=>item.props.key===mode);let prevented=0,stopped=0;item.props.onMouseDown({preventDefault(){prevented++;},stopPropagation(){stopped++;}});assert.equal(prevented,1);assert.equal(stopped,1);return menuTasks.at(-1).promise;},
    pendingWrite(){return storageRequests.find(q=>!q.settled&&q.operation!=='get');},
    snapshot(){return plain({error:c.state.error,colorsUri:c.state.colorsUri,isLoading:c.state.isLoading,storageTrace,transactions:transactions.map(({id,mode,started,finished})=>({id,mode,started,finished})),otherReads:otherReads.map(q=>({kind:q.kind,uri:q.args.uri,settled:q.settled})),current:c.currentTrackUri,uri:c.state.uri,display:c.state.lyricsDisplayUri,instanceOverride:c.trackBackgroundOverride,stateOverride:c.state.trackBackgroundOverride,render:context.renderBackground.call(c),persistent:[...persisted],events,toasts,colorCalls:colorTasks.map(t=>t.uri),publications});},
    expireResolution(){now+=5000;const fns=[...timers.values()];timers.clear();for(const fn of fns)fn();},
    spicetify,clock,queries,cosmos,palettes,colorTasks,lyricTasks,publications,warnings,errors,timers,stateQueue,config,
    async settleState(){for(let i=0;i<6;i++){while(stateQueue.length)stateQueue.shift()();await flush();}},
    async play(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`play-${lyricTasks.length}`,isPaused:false};c.schedulePlaybackTrackResolution(accepted);await this.settleState();assert.equal(c.currentTrackUri,accepted.uri);assert.equal(c.state.uri,accepted.uri);assert.equal(c.state.lyricsDisplayUri,accepted.uri);assert.equal(c.state.isLoading,false);assert.equal(timers.size,0);},
    async refresh(item){spicetify.Player.data.item=item;spicetify.Platform.PlayerAPI._state.item=item;c.fetchLyrics(item,-1,true);await this.settleState();},
    pending(kind,uri){return queries.find(q=>!q.settled&&q.kind===kind&&(!uri||q.args.uri===uri||q.args.imageUris?.[0]===uri));},
    async resolve(q,response){assert.ok(q,'pending query exists');q.resolve(response);await this.settleState();},
    async reject(q){assert.ok(q);q.reject(Error('inert rejection'));await this.settleState();},
    render(){return plain(context.renderBackground.call(c).backgroundStyle);},
    async finish(deactivate=true){this.releaseCallbacks();for(let i=0;i<12;i++){for(const q of otherReads.filter(q=>!q.settled))q.resolve(null);for(const tx of transactions.filter(tx=>!tx.finished&&tx.started)){for(const q of tx.requests.filter(q=>!q.settled))if(q.operation!=='get')q.resolve();if(tx.mode==='readwrite'&&tx.requests.every(q=>q.settled))tx.complete();}for(const q of queries.filter(q=>!q.settled))q.resolve(q.kind==='base'?base(q.args.uri===B?'#445566':'#112233'):dynamic(q.args.imageUris[0]));for(const q of cosmos.filter(q=>!q.settled))q.resolve({entries:[{color_swatches:[{preset:'VIBRANT_NON_ALARMING',color:0x112233}]}]});for(const q of palettes.filter(q=>!q.settled))q.resolve(null);await this.settleState();if([...queries,...cosmos,...palettes].every(q=>q.settled)&&colorTasks.every(t=>t.done)&&lyricTasks.every(t=>t.done))break;}await Promise.all([...colorTasks,...lyricTasks,...selectorTasks,...menuTasks].map(t=>t.promise));assert.ok([...queries,...cosmos,...palettes].every(q=>q.settled),'all inert I/O settled');assert.ok([...colorTasks,...lyricTasks].every(t=>t.done),'all unchanged-method promises completed');assert.equal(timers.size,0,'no resolution timers remain');assert.equal(stateQueue.length,0);assert.ok(storageRequests.every(q=>q.settled),'all storage requests settled');assert.ok(transactions.every(tx=>tx.finished),'all transactions complete or abort');assert.ok(otherReads.every(q=>q.settled),'all separate-store read promises settle');assert.ok(selectorTasks.every(t=>t.done),'all selector promises completed');assert.equal(callbackQueue.length,0);assert.equal(errors.length,this.expectedErrors||0,'only explicitly expected errors');assert.ok(menuTasks.every(t=>t.done),'all menu callback promises completed');if(deactivate){clock.destroy();activeHarnesses.delete(this);}},
  };activeHarnesses.add(h);return h;
}
async function finishTrackColors(h,uri,cover){await h.resolve(h.pending('base',uri),base(uri===B?'#445566':'#112233'));const q=h.pending('dynamic',cover);if(q)await h.resolve(q,dynamic(cover));}


const modes = ['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'];
const DJ='spotify:media:fixture-dj-narration';
const providerDJ='spotify:track:NNNNNNNNNNNNNNNNNNNNNN';
const narration = detection => detection==='media'
  ? {uri:DJ,type:'track',provider:'ordinary',metadata:{title:'Fixture narration',artist_name:'DJ',image_url:'dj-art'}}
  : {uri:providerDJ,type:'track',provider:'narration-v2',metadata:{title:'Fixture narration',artist_name:'DJ',image_url:'dj-art'}};
const globals = (h, mode) => {for(const m of modes)h.config.visual[m]=m===mode;};
const inspect = h => {
  const props=h.context.menuElement.call(h.c).props;
  const button=h.context.TrackBackgroundButton(props).children[0];
  const menu=h.openMenu();
  return {...h.snapshot(),defaultEffectiveMode:h.c.getEffectiveBackgroundMode(),
    menu:{uri:props.trackUri,overrideMode:props.overrideMode,effectiveMode:props.effectiveMode,active:button.props['data-active'],
      selected:menu.items[0].items.find(i=>i.key==='track-background-mode').defaultValue.key},
    visuals:plain({colors:h.c.state.colors,dynamicColors:h.c.state.dynamicColors,albumPalette:h.c.state.albumPalette,colorsUri:h.c.state.colorsUri,tempo:h.c.state.tempo,coverUrl:h.c.state.coverUrl,videoInfo:h.c.state.videoInfo}),
    counts:{lyrics:h.lyricTasks.length,colors:h.colorTasks.length,storage:h.storageRequests.length,otherReads:h.otherReads.length}};
};
function contract(actual, expected, label) { assert.deepEqual(plain(actual), plain(expected), label); }
async function prepared({override='solid-background',global='blur-gradient-background',queuedState=false}={}){
  const h=harness({mode:global,queuedState,initialOverrides:override?{[A]:{mode:override}}:{}});
  await h.play(track(A));await h.finish(false);
  // Tempo and existing video details are inert initial visual data. They are not
  // evidence that a provider or video component supplied them in a browser.
  h.c.state.tempo='0.42s';h.c.state.videoInfo={videoId:'fixture-previous-video'};
  return h;
}
async function enter(h,detection='media'){
  const before=inspect(h),item=narration(detection);
  await h.play(item);
  assert.equal(h.clock.getSnapshot().djNarration,true,'actual PlaybackClock detected the supplied signal');
  await h.finish(false);
  const after=inspect(h);
  assert.equal(after.current,item.uri);assert.equal(after.uri,item.uri);assert.equal(after.display,item.uri);
  assert.equal(after.error,'DJ narration');assert.equal(after.isLoading,false);
  assert.equal(h.c.state.lyricsStatus,'empty');assert.equal(h.c.state.lyricsLoadingHasLyrics,false);
  assert.equal(h.c.state.currentLyrics,null);assert.equal(h.c.state.videoInfo,null);
  assert.equal(after.instanceOverride,null,'DJ explicitly clears instance ownership');
  assert.deepEqual(after.counts,before.counts,'DJ schedules no lyrics/color/storage/other override reads');
  for(const key of ['colors','dynamicColors','albumPalette','colorsUri','tempo'])assert.deepEqual(after.visuals[key],before.visuals[key],key+' continuity is preserved');
  assert.equal(after.visuals.coverUrl,'dj-art','coverUrl is narration metadata, not outgoing artwork');
  assert.equal(h.events.length,0);assert.equal(h.toasts.length,0);
  return {before,after};
}
for(const queuedState of [false,true])for(const override of modes)test(`prior explicit ${override} belongs only to the departed track, queued=${queuedState}`,async()=>{
  const global=override==='blur-gradient-background'?'solid-background':'blur-gradient-background';
  const h=await prepared({override,global,queuedState});const {before,after}=await enter(h);
  assert.equal(after.defaultEffectiveMode,global);
  assert.equal(after.menu.uri,DJ);assert.equal(h.persisted.has(DJ),false);assert.deepEqual(h.persisted.get(A),{mode:override});
  const trace={before,after};await h.finish();
  contract({state:after.stateOverride,mode:after.render.effectiveBackgroundMode,selected:after.menu.selected,active:after.menu.active},
    {state:null,mode:global,selected:'inherit',active:'false'},`departed explicit ${override} should not remain the narration track override; queued=${queuedState}`,trace);
});
for(const queuedState of [false,true])for(const global of modes)test(`inherited global ${global}, queued=${queuedState}`,async()=>{
  const h=await prepared({override:null,global,queuedState});const trace=await enter(h);
  assert.equal(trace.after.stateOverride,null);assert.equal(trace.after.render.effectiveBackgroundMode,global);
  assert.equal(trace.after.defaultEffectiveMode,global);assert.equal(trace.after.menu.selected,'inherit');assert.equal(trace.after.menu.active,'false');
  await h.finish();observations.push({case:'global-inheritance-control',global,queuedState,...trace});
});
for(const queuedState of [false,true])test(`provider-only detection clears prior explicit mode, queued=${queuedState}`,async()=>{
  const h=await prepared({queuedState});const trace=await enter(h,'provider');
  assert.equal(trace.after.uri,providerDJ);
  await h.finish();contract(trace.after.stateOverride,null,'provider-only DJ detection should clear departed mode',trace);
});
for(const isFullscreen of [false,true])for(const prior of ['video-background',null])test(`fullscreen-only setting remains meaningful; fullscreen=${isFullscreen}, prior=${prior}`,async()=>{
  const h=await prepared({override:prior,global:prior?'solid-background':'video-background'});
  h.config.visual['video-background-fullscreen-only']=true;h.c.state.isFullscreen=isFullscreen;
  const trace=await enter(h);const expected=prior?'solid-background':isFullscreen?'video-background':'blur-gradient-background';
  assert.equal(trace.after.render.effectiveBackgroundMode,expected);assert.equal(trace.after.render.shouldUseVideoBackground,expected==='video-background');
  assert.equal(trace.after.menu.selected,'inherit');
  await h.finish();observations.push({case:'fullscreen-restriction-control',isFullscreen,prior,...trace});
});
for(const queuedState of [false,true])test(`ordinary next-track commit clears override while retaining visual data; queued=${queuedState}`,async()=>{
  const h=await prepared({queuedState});const before=inspect(h);h.holdOther('language',B);
  await h.beginPlay(track(B));const loading=inspect(h);
  assert.equal(loading.isLoading,true);assert.equal(loading.instanceOverride,null);assert.equal(loading.stateOverride,null);
  assert.equal(loading.render.effectiveBackgroundMode,'blur-gradient-background');assert.equal(loading.menu.selected,'inherit');
  for(const key of ['colors','dynamicColors','albumPalette','colorsUri','tempo'])assert.deepEqual(loading.visuals[key],before.visuals[key]);
  await h.releaseOther();await h.finish();assert.equal(h.c.state.trackBackgroundOverride,null);
  observations.push({case:'ordinary-transition-control',queuedState,before,loading,final:inspect(h)});
});
for(const queuedState of [false,true])test(`settled menu choice before narration does not need a late write; queued=${queuedState}`,async()=>{
  const h=await prepared({override:null,queuedState});const p=h.choose('solid-background');await flush();
  const req=h.pendingWrite();assert.equal(req.key,A);req.resolve();await h.settleState();await p;req.commit();await h.finish(false);
  assert.deepEqual(h.persisted.get(A),{mode:'solid-background'});
  // Origin event/toast are already complete before narration. Preserve and clear
  // only their observation logs so enter can prove no new DJ side effects.
  const origin={events:plain(h.events),toasts:plain(h.toasts)};assert.equal(origin.events[0].detail.trackUri,A);
  h.events.length=0;h.toasts.length=0;
  const trace=await enter(h);assert.ok(h.transactions.every(t=>t.finished));await h.finish();
  contract(trace.after.stateOverride,null,'fully completed menu choice still belongs only to outgoing A',{origin,...trace});
});
for(const queuedState of [false,true])test(`next ordinary track restores its own override after narration; queued=${queuedState}`,async()=>{
  const h=await prepared({queuedState});const trace=await enter(h);h.persisted.set(B,{mode:'colorful'});
  await h.play(track(B));await h.finish();assert.deepEqual(plain(h.c.state.trackBackgroundOverride),{mode:'colorful'});
  assert.equal(h.c.getEffectiveBackgroundMode(),'colorful');assert.equal(h.c.state.error,null);
  observations.push({case:'narration-exit-control',queuedState,...trace,final:inspect(h)});
});
for(const queuedState of [false,true])test(`repeated narration signal keeps global mode ownership without pending work; queued=${queuedState}`,async()=>{
  const h=await prepared({queuedState});const first=await enter(h);await h.play(narration('media'));await h.finish();
  const second=inspect(h);assert.equal(second.stateOverride,null);assert.equal(second.defaultEffectiveMode,'blur-gradient-background');
  assert.deepEqual(second.counts,first.after.counts);observations.push({case:'repeat-narration-control',queuedState,first,second});
});

async function chooseCurrent(h, mode, {queued=false}={}) {
  const promise=h.choose(mode);await flush();
  const request=h.pendingWrite();assert.equal(request.key,h.c.currentTrackUri);
  request.resolve();await flush();
  if(!queued)await h.settleState();
  await promise;request.commit();
  return {events:plain(h.events),toasts:plain(h.toasts),request};
}
for(const detection of ['media','provider'])for(const queuedState of [false,true])for(const mode of modes)test(`settled own DJ choice survives repeated signal: ${detection}, ${mode}, queued=${queuedState}`,async()=>{
  const h=await prepared({override:null,queuedState});await enter(h,detection);
  await chooseCurrent(h,mode);await h.finish(false);
  const before=inspect(h),eventCount=h.events.length,toastCount=h.toasts.length,counts={...before.counts};
  assert.deepEqual(before.stateOverride,{mode});assert.equal(before.menu.selected,mode);
  await h.play(narration(detection));await h.finish();const after=inspect(h);
  assert.deepEqual(after.stateOverride,{mode});assert.equal(after.menu.selected,mode);
  assert.equal(after.instanceOverride,null,'existing instance clear is characterized separately');
  assert.deepEqual(after.counts,counts);assert.equal(h.events.length,eventCount);assert.equal(h.toasts.length,toastCount);
  assert.deepEqual(h.persisted.get(narration(detection).uri),{mode});
  observations.push({case:'settled-own-choice-repeat',detection,mode,queuedState,before,after});
});
for(const detection of ['media','provider'])for(const mode of modes)test(`queued own DJ choice survives repeated signal: ${detection}, ${mode}`,async()=>{
  const h=await prepared({override:null,queuedState:true});await enter(h,detection);
  await chooseCurrent(h,mode,{queued:true});assert.equal(h.c.state.trackBackgroundOverride,null);
  assert.ok(h.stateQueue.length>0,'the acknowledged choice state is still queued');
  const beforeJobs=h.stateJobs.length;
  h.c.schedulePlaybackTrackResolution(narration(detection));
  assert.ok(h.stateJobs.length>beforeJobs,'real narration commit queues its state after the choice');
  await h.finish();const after=inspect(h);
  assert.deepEqual(after.stateOverride,{mode});assert.equal(after.menu.selected,mode);
  assert.deepEqual(h.persisted.get(narration(detection).uri),{mode});
  observations.push({case:'queued-own-choice-repeat',detection,mode,after});
});
for(const queuedState of [false,true])test(`new DJ URI clears the prior narration choice: queued=${queuedState}`,async()=>{
  const h=await prepared({override:null,queuedState});await enter(h,'media');
  await chooseCurrent(h,'solid-background');await h.finish(false);
  const before=inspect(h);h.events.length=0;h.toasts.length=0;
  const result=await enter(h,'provider');await h.finish();
  assert.equal(result.after.uri,providerDJ);assert.equal(result.after.stateOverride,null);
  assert.deepEqual(h.persisted.get(DJ),{mode:'solid-background'});assert.equal(h.persisted.has(providerDJ),false);
  observations.push({case:'different-DJ-URI-carryover',queuedState,before,after:result.after});
});

for(const detection of ['media','provider'])for(const queuedState of [false,true])test(`own DJ inherit choice is preserved on repeated signal: ${detection}, queued=${queuedState}`,async()=>{
  const h=await prepared({override:null,queuedState});await enter(h,detection);
  await chooseCurrent(h,'solid-background');await h.finish(false);
  assert.deepEqual(plain(h.c.state.trackBackgroundOverride),{mode:'solid-background'});
  await chooseCurrent(h,'inherit',{queued:queuedState});
  if(queuedState)assert.deepEqual(plain(h.c.state.trackBackgroundOverride),{mode:'solid-background'},'clear is still queued');
  h.c.schedulePlaybackTrackResolution(narration(detection));await h.finish();
  const after=inspect(h);assert.equal(after.stateOverride,null);assert.equal(after.menu.selected,'inherit');
  assert.equal(h.persisted.has(narration(detection).uri),false);
  observations.push({case:'own-choice-clear-repeat',detection,queuedState,after});
});
