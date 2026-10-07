// Actual menu, store helper, playback transition and renderer bodies. The inert
// store adapter enforces overlapping transaction order; no IndexedDB engine runs.
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
function checkIdentity(actual, expected, label) { assert.equal(actual, expected, label); }
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
    window:{innerWidth:1000,scrollX:0,scrollY:0,ivLyricsBackgroundPresets:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'].map(id=>({id})),dispatchEvent:event=>events.push(plain(event)),ivLyricsPlaybackClock:playback,Translator:{clearInflightRequests(){}},LyricsService:{
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
    `globalThis.menuElement=function(){const effectiveBackgroundMode=this.getEffectiveBackgroundMode(this.state.trackBackgroundOverride);return ${cut(index,'react.createElement(TrackBackgroundButton, {','              react.createElement(RegenerateTranslationButton,').trim().replace(/,$/,'')};};globalThis.OptionsMenu=OptionsMenu;globalThis.TrackBackgroundButton=TrackBackgroundButton;globalThis.IvOptionList=IvOptionList;globalThis.renderBackground=function(){const isSyncCreatorActive=false;const fullscreenPresentation='standard';${cut(index,'    const effectiveBackgroundMode = this.getEffectiveBackgroundMode(this.state.trackBackgroundOverride);','    const computeExtendedLyricsStyleVariables =')};${cut(index,'    const shouldUseVideoBackground =','    const renderFloatingToolbarIcon =')};${cut(index,'    const renderStaticGradientBackground =','    const renderVideoBackgroundChild =')};return {effectiveBackgroundMode,backgroundStyle,styleVariables:this.styleVariables,staticNode:renderStaticGradientBackground()};};globalThis.replaceStorageForOpenFailure=()=>{TrackBackgroundDB.setOverride=createTrackOverrideDB({dbName:'ivLyrics-background-db',storeName:'track-background-overrides',label:'Background',setting:'background',methods:['getOverride','setOverride','clearOverride'],normalize:normalizeIvLyricsTrackBackgroundOverride}).setOverride;TrackBackgroundDB.clearOverride=createTrackOverrideDB({dbName:'ivLyrics-background-db',storeName:'track-background-overrides',label:'Background',setting:'background',methods:['getOverride','setOverride','clearOverride'],normalize:normalizeIvLyricsTrackBackgroundOverride}).clearOverride;};`+
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
    async finish(){this.releaseCallbacks();for(let i=0;i<12;i++){for(const q of otherReads.filter(q=>!q.settled))q.resolve(null);for(const tx of transactions.filter(tx=>!tx.finished&&tx.started)){for(const q of tx.requests.filter(q=>!q.settled))if(q.operation!=='get')q.resolve();if(tx.mode==='readwrite'&&tx.requests.every(q=>q.settled))tx.complete();}for(const q of queries.filter(q=>!q.settled))q.resolve(q.kind==='base'?base(q.args.uri===B?'#445566':'#112233'):dynamic(q.args.imageUris[0]));for(const q of cosmos.filter(q=>!q.settled))q.resolve({entries:[{color_swatches:[{preset:'VIBRANT_NON_ALARMING',color:0x112233}]}]});for(const q of palettes.filter(q=>!q.settled))q.resolve(null);await this.settleState();if([...queries,...cosmos,...palettes].every(q=>q.settled)&&colorTasks.every(t=>t.done)&&lyricTasks.every(t=>t.done))break;}await Promise.all([...colorTasks,...lyricTasks,...selectorTasks,...menuTasks].map(t=>t.promise));assert.ok([...queries,...cosmos,...palettes].every(q=>q.settled),'all inert I/O settled');assert.ok([...colorTasks,...lyricTasks].every(t=>t.done),'all unchanged-method promises completed');assert.equal(timers.size,0,'no resolution timers remain');assert.equal(stateQueue.length,0);assert.ok(storageRequests.every(q=>q.settled),'all storage requests settled');assert.ok(transactions.every(tx=>tx.finished),'all transactions complete or abort');assert.ok(otherReads.every(q=>q.settled),'all separate-store read promises settle');assert.ok(selectorTasks.every(t=>t.done),'all selector promises completed');assert.equal(callbackQueue.length,0);assert.equal(errors.length,this.expectedErrors||0,'only explicitly expected errors');assert.ok(menuTasks.every(t=>t.done),'all menu callback promises completed');clock.destroy();activeHarnesses.delete(this);},
  };activeHarnesses.add(h);return h;
}
async function finishTrackColors(h,uri,cover){await h.resolve(h.pending('base',uri),base(uri===B?'#445566':'#112233'));const q=h.pending('dynamic',cover);if(q)await h.resolve(q,dynamic(cover));}

const modes=['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background','inherit'];
const normalized=mode=>mode==='inherit'?null:{mode};
const saveEvent=(uri,override,effectiveMode)=>({type:'ivLyrics:track-background-changed',detail:{trackUri:uri,override,effectiveMode}});
async function startChoice(h,mode){const p=h.choose(mode);await flush();assert.ok(h.pendingWrite(),'actual storage request admitted from menu');return {promise:p,request:h.pendingWrite()};}

async function completeChoice(h,selection){selection.request.resolve();await h.settleState();await selection.promise;assert.equal(selection.request.tx.finished,false,'selector awaits request success, not transaction completion');selection.request.commit();await h.settleState();}
async function transientCase({choice='solid-background',queuedState=false,hold='none',bOverride={mode:'gradient-background'}}={}){
  const globalMode=choice==='blur-gradient-background'?'solid-background':'blur-gradient-background';
  const h=harness({queuedState,mode:globalMode,initialOverrides:{[A]:{mode:'colorful'},...(bOverride?{[B]:bOverride}:{})}});
  await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,choice);assert.equal(selection.request.key,A);
  if(hold!=='none')h.holdOther(hold,B);
  await h.beginPlay(track(B));assert.equal(h.c.state.isLoading,true);assert.equal(h.c.trackBackgroundOverride,null);assert.equal(h.c.state.trackBackgroundOverride,null);
  const bRead=h.storageRequests.find(q=>q.operation==='get'&&q.key===B);assert.ok(bRead);assert.equal(bRead.tx.started,false);assert.equal(bRead.settled,false);assert.ok(selection.request.tx.id<bRead.tx.id);
  assert.throws(()=>bRead.resolve(),/same-store transaction ordering/,'adapter rejects the invalid overtaking used by the provisional fixture');
  const before=h.snapshot();assert.equal(before.render.effectiveBackgroundMode,globalMode);assert.equal(h.events.length,0);
  selection.request.resolve();await h.settleState();await selection.promise;
  assert.equal(selection.request.tx.finished,false);assert.equal(bRead.settled,false);assert.deepEqual(h.persisted.get(A),{mode:'colorful'},'request acknowledgement precedes synthetic commit');
  const transient=h.snapshot();assert.equal(transient.current,B);assert.equal(transient.uri,B);assert.equal(transient.display,B);assert.equal(transient.isLoading,true);
  assert.deepEqual(h.events,[saveEvent(A,{mode:choice},choice)]);assert.deepEqual(h.toasts,[{kind:'success',message:'messages.saved'}]);
  selection.request.commit();await h.settleState();assert.equal(bRead.settled,true);assert.deepEqual(h.persisted.get(A),{mode:choice});
  let afterBackgroundRead=h.snapshot();
  if(hold!=='none'){assert.equal(h.c.state.isLoading,true);await h.releaseOther();}
  await h.finish();const final=h.snapshot();assert.equal(final.uri,B);assert.equal(final.isLoading,false);assert.deepEqual(final.stateOverride,bOverride);assert.deepEqual(final.instanceOverride,bOverride);assert.equal(final.render.effectiveBackgroundMode,bOverride?.mode||globalMode);assert.equal(final.colorsUri,B);assert.equal(h.c.state.colorsUri,B);assert.deepEqual(plain(h.persisted.get(B))??null,bOverride);
  const successIndex=h.storageTrace.findIndex(e=>e.event==='request-success'&&e.id===selection.request.tx.id),commitIndex=h.storageTrace.findIndex(e=>e.event==='transaction-complete'&&e.id===selection.request.tx.id),readIndex=h.storageTrace.findIndex(e=>e.event==='request-success'&&e.id===bRead.tx.id);assert.ok(successIndex<commitIndex&&commitIndex<readIndex,'A success, A transaction finish, B get success are ordered');
  assert.deepEqual(transient.stateOverride, null, 'foreign request cannot publish its state override');
  assert.deepEqual(transient.instanceOverride, null, 'foreign request cannot publish its instance override');
  assert.deepEqual(transient.render.backgroundStyle, before.render.backgroundStyle);
  assert.deepEqual(transient.render.staticNode, before.render.staticNode);
  if (hold !== 'none') assert.deepEqual(afterBackgroundRead.stateOverride, null);
  checkIdentity(transient.render.effectiveBackgroundMode,globalMode,`A ${choice} should not change committed-loading B mode (queued=${queuedState}, hold=${hold})`,{before,transient,afterBackgroundRead,final,storageTrace:h.storageTrace,callbacks:h.callbacks});
}
for(const queuedState of [false,true])for(const choice of modes.filter(m=>m!=='inherit'))test(`ordered A ${choice} cannot change B during override loading; queued=${queuedState}`,()=>transientCase({choice,queuedState}));
for(const hold of ['language','provider'])test(`separate ${hold} read keeps B loading without a foreign override`,()=>transientCase({hold,queuedState:true}));
for(const queuedState of [false,true])test(`inheriting B retains its mode during an origin write; queued=${queuedState}`,()=>transientCase({queuedState,bOverride:null}));

for(const queuedState of [false,true])for(const choice of modes)test(`current ${choice} keeps request-success UI and later commit; queued=${queuedState}`,async()=>{
  const h=harness({queuedState,mode:'gradient-background',initialOverrides:{[A]:{mode:'colorful'}}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,choice);await completeChoice(h,selection);await h.finish();const expected=choice==='inherit'?'gradient-background':choice;assert.deepEqual(plain(h.persisted.get(A))??null,normalized(choice));assert.equal(h.snapshot().render.effectiveBackgroundMode,expected);assert.deepEqual(h.events,[saveEvent(A,normalized(choice),expected)]);assert.deepEqual(h.toasts,[{kind:'success',message:'messages.saved'}]);assert.equal(h.colorTasks.length,['none','solid-background'].includes(choice)?1:2);
});

for(const queuedState of [false,true])for(const bOverride of [null,{mode:'solid-background'}])test(`ordered reset during B loading leaves loading style unchanged and final B correct; queued=${queuedState}; override=${!!bOverride}`,async()=>{
  const h=harness({queuedState,initialOverrides:{[A]:{mode:'colorful'},...(bOverride?{[B]:bOverride}:{})}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'inherit');await h.beginPlay(track(B));const before=h.snapshot();selection.request.resolve();await h.settleState();await selection.promise;const after=h.snapshot();assert.equal(after.render.effectiveBackgroundMode,before.render.effectiveBackgroundMode);assert.deepEqual(after.render.backgroundStyle,before.render.backgroundStyle);assert.equal(after.stateOverride,null);assert.equal(h.persisted.has(A),true);selection.request.commit();await h.settleState();await h.finish();assert.equal(h.persisted.has(A),false);assert.deepEqual(plain(h.c.state.trackBackgroundOverride),bOverride);assert.deepEqual(h.events,[saveEvent(A,null,'blur-gradient-background')]);assert.equal(h.toasts[0].kind,'success');observations.push({case:'reset-no-transient-style-change',queuedState,bOverride,before,after,final:h.snapshot()});
});

for(const choice of ['solid-background','inherit'])for(const retired of [false,true])test(`ordered request error ${choice} retains local state; retired=${retired}`,async()=>{
  const h=harness({initialOverrides:{[A]:{mode:'colorful'},[B]:{mode:'gradient-background'}}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,choice);if(retired)await h.beginPlay(track(B));const before=h.snapshot();h.expectedErrors=1;selection.request.reject();await h.settleState();await selection.promise;await h.finish();assert.deepEqual(h.persisted.get(A),{mode:'colorful'});assert.equal(h.events.length,0);assert.deepEqual(h.toasts,[{kind:'error',message:'messages.error'}]);assert.equal(h.renders.length,0);assert.equal(h.snapshot().render.effectiveBackgroundMode,retired?'gradient-background':'colorful');assert.equal(selection.request.tx.aborted,true);observations.push({case:'request-error',choice,retired,before,final:h.snapshot()});
});
for(const choice of ['solid-background','inherit'])test(`existing swallowed open error is distinct from request error: ${choice}`,async()=>{
  const h=harness({initialOverrides:{[A]:{mode:'colorful'}}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');h.expectedErrors=2;h.failNextOpen();await h.choose(choice);await h.settleState();await h.finish();assert.deepEqual(h.persisted.get(A),{mode:'colorful'});assert.deepEqual(plain(h.c.state.trackBackgroundOverride),normalized(choice));assert.equal(h.toasts[0].kind,'success');assert.equal(h.events[0].detail.trackUri,A);observations.push({case:'open-error-contract',choice,final:h.snapshot()});
});

for(const queuedState of [false,true])test(`late selector callback alone cannot reinstall A after repaired B; queued=${queuedState}`,async()=>{
  const h=harness({queuedState,initialOverrides:{[B]:{mode:'gradient-background'}}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');h.holdCallbacks(true);selection.request.resolve();await h.settleState();await selection.promise;assert.equal(h.callbackQueue.length,1);selection.request.commit();await h.settleState();h.holdCallbacks(false);await h.play(track(B));await finishTrackColors(h,B,'cover-B');const before=h.snapshot();h.releaseCallbacks();assert.deepEqual(h.snapshot(),before);assert.equal(h.renders.at(-1).effectiveBackgroundMode,'gradient-background');await h.finish();observations.push({case:'late-callback-only',queuedState,before,final:h.snapshot()});
});

for(const queuedState of [false,true])test(`A→B→A origin selection remains valid with ordered reads; queued=${queuedState}`,async()=>{
  const h=harness({queuedState});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');await h.beginPlay(track(B));await h.beginPlay(track(A));const oldSeq=h.c._activeLyricsFetchSeq;selection.request.resolve();await h.settleState();await selection.promise;assert.equal(h.c.currentTrackUri,A);assert.equal(h.c.state.trackBackgroundOverride.mode,'solid-background');selection.request.commit();await h.settleState();await h.finish();assert.equal(h.c.state.uri,A);assert.equal(h.c.state.trackBackgroundOverride.mode,'solid-background');assert.equal(h.c._activeLyricsFetchSeq,oldSeq);assert.deepEqual(h.persisted.get(A),{mode:'solid-background'});observations.push({case:'returned-origin',queuedState,final:h.snapshot()});
});

test('same-URI refresh reads follow admitted origin write without generation policy',async()=>{
  const h=harness();await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');await h.refresh(track(A,'cover-A-new'));await completeChoice(h,selection);await h.finish();assert.equal(h.c.state.trackBackgroundOverride.mode,'solid-background');assert.equal(h.c.state.uri,A);
});

test('same-store overlapping choices complete in transaction creation order',async()=>{
  const h=harness();await h.play(track(A));await finishTrackColors(h,A,'cover-A');const first=await startChoice(h,'solid-background');const secondPromise=h.choose('none');await flush();const second=h.storageRequests.find(q=>q.operation!=='get'&&!q.settled&&q!==first.request);assert.equal(second.tx.started,false);assert.throws(()=>second.resolve(),/same-store transaction ordering/);await completeChoice(h,first);assert.equal(second.tx.started,true);second.resolve();await h.settleState();await secondPromise;second.commit();await h.settleState();await h.finish();assert.equal(h.snapshot().render.effectiveBackgroundMode,'none');assert.deepEqual(h.events.map(e=>e.detail.override.mode),['solid-background','none']);observations.push({case:'overlapping-choice-fifo',final:h.snapshot()});
});

test('completed A choice before B transition is correctly replaced by B',async()=>{
  const h=harness({initialOverrides:{[B]:{mode:'gradient-background'}}});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');await completeChoice(h,selection);await h.play(track(B));await h.finish();assert.equal(h.snapshot().render.effectiveBackgroundMode,'gradient-background');
});

test('unresolved departure retains origin selection until B actually commits',async()=>{
  const h=harness();await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');h.spicetify.Platform.PlayerAPI._state.item={uri:B};h.c.schedulePlaybackTrackResolution({uri:B});await h.settleState();assert.equal(h.c.currentTrackUri,A);await completeChoice(h,selection);assert.equal(h.c.state.trackBackgroundOverride.mode,'solid-background');await h.play(track(B));await h.finish();assert.equal(h.snapshot().render.effectiveBackgroundMode,'blur-gradient-background');
});

test('committed B origin wins over lagging public A for a new choice',async()=>{
  const h=harness();await h.play(track(B),track(A));await finishTrackColors(h,B,'cover-A');const selection=await startChoice(h,'solid-background');assert.equal(selection.request.key,B);await completeChoice(h,selection);await h.finish();assert.equal(h.events[0].detail.trackUri,B);
});

test('no-track UI and selector preserve no-track notification',async()=>{const h=harness();assert.equal(h.openMenu(),null);await h.c.selectBackgroundForCurrentTrack('solid-background');await h.finish();assert.equal(h.storageRequests.length,0);assert.equal(h.events.length,0);assert.equal(h.toasts.length,2);});
test('background option callback ignores unrelated settings',async()=>{const h=harness();await h.play(track(A));const modal=h.openMenu();await modal.onChange('unrelated','solid-background');await h.finish();assert.equal(h.selectorTasks.length,0);assert.equal(h.toasts.length,0);});
for(const fullscreen of [false,true])test(`current video selection retains fullscreen restriction ${fullscreen}`,async()=>{const h=harness();h.config.visual['video-background-fullscreen-only']=true;h.c.state.isFullscreen=fullscreen;await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'video-background');await completeChoice(h,selection);await h.finish();assert.equal(h.snapshot().render.effectiveBackgroundMode,fullscreen?'video-background':'blur-gradient-background');});


const DJ='spotify:media:fixture-dj-narration';
const djTrack=()=>({uri:DJ,type:'unknown',provider:'narration',metadata:{title:'Fixture narration',artist_name:'Fixture DJ',duration:'20000',image_xlarge_url:'cover-DJ'}});
for(const queuedState of [false,true])test(`real narration snapshot cannot inherit a late selection; queued=${queuedState}`,async()=>{
  const h=harness({queuedState});await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,'solid-background');const readsBefore=h.storageRequests.filter(q=>q.operation==='get').length,lyricsBefore=h.lyricTasks.length,otherBefore=h.otherReads.length;
  await h.beginPlay(djTrack());assert.equal(h.clock.getSnapshot().djNarration,true);assert.equal(h.clock.getSnapshot().item.provider,'narration');assert.equal(h.c.state.error,'DJ narration');assert.equal(h.c.state.isLoading,false);assert.equal(h.c.state.lyricsDisplayUri,DJ);assert.equal(h.c.trackBackgroundOverride,null);assert.equal(h.c.state.trackBackgroundOverride,null);assert.equal(h.lyricTasks.length,lyricsBefore);assert.equal(h.otherReads.length,otherBefore);assert.equal(h.storageRequests.filter(q=>q.operation==='get').length,readsBefore);
  const before=h.snapshot();assert.equal(before.render.effectiveBackgroundMode,'blur-gradient-background');await completeChoice(h,selection);await h.finish();const final=h.snapshot();assert.equal(final.uri,DJ);assert.equal(final.error,'DJ narration');assert.equal(final.isLoading,false);assert.equal(final.render.staticNode.props.id,'ivLyrics-gradient-background');assert.equal(h.lyricTasks.length,lyricsBefore);assert.equal(h.storageRequests.filter(q=>q.operation==='get').length,readsBefore);assert.deepEqual(h.persisted.get(A),{mode:'solid-background'});assert.equal(h.persisted.has(DJ),false);assert.deepEqual(h.events,[saveEvent(A,{mode:'solid-background'},'solid-background')]);assert.equal(h.toasts[0].kind,'success');
  assert.deepEqual(final.render.backgroundStyle, before.render.backgroundStyle);
  assert.deepEqual(final.render.staticNode, before.render.staticNode);
  assert.equal(final.instanceOverride, null);
  assert.equal(final.stateOverride, null);
  checkIdentity(final.render.effectiveBackgroundMode,'blur-gradient-background',`A solid choice should not replace DJ narration background (queued=${queuedState})`,{kind:'DJ-specific-no-override-read',before,final,storageTrace:h.storageTrace});
});
for(const outcome of ['reset','request-error'])test(`DJ boundary negative control: ${outcome}`,async()=>{
  const h=harness();await h.play(track(A));await finishTrackColors(h,A,'cover-A');const selection=await startChoice(h,outcome==='reset'?'inherit':'solid-background');await h.beginPlay(djTrack());const before=h.snapshot();
  if(outcome==='reset')await completeChoice(h,selection);else{h.expectedErrors=1;selection.request.reject();await h.settleState();await selection.promise;}await h.finish();assert.equal(h.c.state.uri,DJ);assert.deepEqual(h.snapshot().render,before.render);assert.equal(h.c.state.trackBackgroundOverride,null);assert.equal(h.toasts[0].kind,outcome==='reset'?'success':'error');observations.push({case:'DJ-negative-control',outcome,before,final:h.snapshot()});
});
