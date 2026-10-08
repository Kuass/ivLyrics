// Executes selected current production source unchanged. Synthetic data and adapters
// are explicit: no native React scheduling, live player/provider or IndexedDB.
// Layout, scrolling and reveal effects are inert; active-line rows are projected
// by the full production engine. Requests capture immutable readonly values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const files=['index.js','Utils.js','LyricsService.js','Pages.js','PlaybackClock.js'];
const src=Object.fromEntries(files.map(f=>[f,readFileSync(new URL(f,root),'utf8')]));
const sha=v=>createHash('sha256').update(v).digest('hex');
const extracts=[];
function part(file, start, end, includeEnd = false) {
  const source = src[file], from = source.indexOf(start), boundary = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && boundary > from, `${file}: ${start}`);
  assert.equal(source.indexOf(start, from + start.length), -1, `unique extraction: ${start}`);
  const to = includeEnd ? boundary + end.length : boundary;
  const code = source.slice(from, to);
  extracts.push({ file, start, end, includeEnd, from, to,
    startLine: source.slice(0, from).split('\n').length,
    endLine: source.slice(0, to - 1).split('\n').length,
    sha256: sha(code), bytes: Buffer.byteLength(code),
    byteStart: Buffer.byteLength(source.slice(0, from)), byteEnd: Buffer.byteLength(source.slice(0, to)) });
  return code;
}
function method(name){const s=src['index.js'],a=s.search(new RegExp(`^  (?:async )?${name}\\(`,'m'));assert.ok(a>=0,name);const n=s.slice(a+1).search(/^  (?:async )?\w+\(/m);assert.ok(n>=0);return part('index.js',s.slice(a,a+s.slice(a).indexOf('\n')),s.slice(a+1+n,a+1+n+s.slice(a+1+n).indexOf('\n')));}
const clockModule=createRequire(import.meta.url)(new URL('PlaybackClock.js',root).pathname);
const methods=['isCurrentLyricsUri','isCurrentLyricsState','getLyricsLayoutHasLyrics','getLoadingLyricsState','infoFromTrack','fetchLyrics','resolveLyricsForMode','isPlaybackUriCurrent','beginPlaybackTrackTransition','clearPlaybackTrackResolutionTimer','schedulePlaybackTrackResolution','commitResolvedPlaybackTrack'];
const containerCode=methods.map(method).join('\n');
const emptyMatch=src['index.js'].match(/const emptyState = (\{[\s\S]*?\n\});/);
const emptyCode=part('index.js','const emptyState =',src['index.js'].slice(src['index.js'].indexOf(emptyMatch[0])+emptyMatch[0].length,src['index.js'].indexOf(emptyMatch[0])+emptyMatch[0].length+80));
const readCode=part('index.js','const initDB = () => {','\nconst TrackSyncDB =')+'\nconst TrackSyncDB = {\n'+part('index.js','  async getOffset(trackUri) {','\n  async setOffset(trackUri, offset)')+'\n};';
const utilsCode=part('Utils.js','  async getTrackSyncOffset(trackUri) {','\n  async setTrackSyncOffset(')+part('Utils.js','  isSpotifyTrackId(value) {','\n  // ==========================================\n  // 커뮤니티 영상 추천 시스템');
const globalOffsetCode=part('Utils.js','  getGlobalSyncOffset() {','\n  setGlobalSyncOffset(offset)');
const progressCode=part('LyricsService.js','    const clampPlayerProgress =','\n    const Utils = {');
const progressMembers=part('LyricsService.js','        getSafePlayerProgress() {','\n        isSpotifyTrackId(value)');
const pageCode=[
 part('Pages.js','const safeRenderText =','function renderLyricsUnavailable'),
 part('Pages.js','const getCurrentTrackUri =','// Manual scrolling moves'),
 part('Pages.js','const normalizeUnsyncedLyrics =','const getCopyableText ='),
 part('Pages.js','const getPseudoKaraokeRenderAdvance =','const LyricsLineBlock ='),
 part('Pages.js','const getKaraokeLineBounds =','const buildKaraokeFuriganaMap ='),
 part('Pages.js','const prepareGlobalCharTimeline =','const EMPTY_GLOBAL_CHAR_STATE ='),
 part('Pages.js','window.ivLyricsLyricRendererPrimitives = Object.freeze({','\n});',true),
 part('Pages.js','const PSEUDO_KARAOKE_SOURCES =','const KARAOKE_RTL_STRONG_CHAR_REGEX ='),
 part('Pages.js','const KARAOKE_COMBINING_MARK_REGEX =','const getKaraokeVocalRows ='),
 part('Pages.js','const KARAOKE_PRE_SPACE_MIN_DURATION_MS =','const KARAOKE_FILL_CORRECTION_DEFAULT_POINTS ='),
 part('Pages.js','const getCopyableText =','const INTERLUDE_MIN_DURATION_MS ='),
 part('Pages.js','const KARAOKE_TRAILING_INTERLUDE_DELAY_MS =','const getKaraokeSpeakerPresentation ='),
 part('Pages.js','const getLastSyllableEndTime =','const getInterludeInfo ='),
 part('Pages.js','const buildKaraokeCumulativeEndTimes =','const isTrailingKaraokeInterludePositionActive ='),
 part('Pages.js','const buildKaraokeTimedChars =','const getActiveKaraokeTimedCharIndex ='),
 part('Pages.js','const renderLyricsItems =','// Global animation manager'),
 part('Pages.js','const useTrackPosition =','const getKaraokeLineBounds ='),
 part('Pages.js','const SyncedLyricsPage =','// Global SearchBar manager'),
 part('Pages.js','const SyncedExpandedLyricsPage =','const UnsyncedLyricsPage ='),
 part('Pages.js','const LyricsPageRenderer =','window.LyricsPageRenderer ='),
].join('\n');
const pageAdmission=part('index.js','    const computeActiveLyricsPage =','\n    // Tab bar removed');
export const track=id=>({uri:`spotify:track:${id.repeat(22)}`,metadata:{title:id,artist_name:'Fixture artist',duration:'100000'},duration:{milliseconds:100000}});
export const lines=id=>[{text:`${id}:first`,startTime:0,endTime:3000},{text:`${id}:second`,startTime:3000,endTime:8000},{text:`${id}:third`,startTime:8000,endTime:10000}];
export const micro=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t?.type?[t,...nodes(t.children)]:[];
export function runtime({stateMode='immediate',compact=true,initial='A',publicId=initial,internalId=initial,offsets={[track('A').uri]:2000,[track('B').uri]:-1000},internalMetadata=true}={}){
 const trace=[],reads=[],requests=[],events=[],timers=new Map(),animations=new Set(),visibility=new Set();let timerId=0,now=1000,position=2500,disposed=false;
 const listeners=new Map();
 const window={addEventListener(t,f){if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t).add(f);},removeEventListener(t,f){listeners.get(t)?.delete(f);},dispatchEvent(e){events.push({type:e.type,detail:e.detail});for(const f of [...listeners.get(e.type)||[]])f(e);return true;}};
 const player={data:{item:track(publicId),isPaused:true},getProgress:()=>position,getDuration:()=>100000,isPlaying:()=>false,addEventListener(){},removeEventListener(){}};
 const Spicetify={Player:player,Platform:{PlayerAPI:{_state:{item:internalMetadata?track(internalId):{uri:track(internalId).uri},isPaused:true,positionAsOfTimestamp:position,timestamp:now,duration:100000,playbackId:'play-'+internalId}},PlaybackAPI:{_isLocal:false}}};
 const readonlyDB={transaction(stores,mode){assert.deepEqual([...stores],['track-sync-offsets']);assert.equal(mode,'readonly','no writes permitted');trace.push(['transaction',mode]);let used=false;return{objectStore(name){assert.equal(name,'track-sync-offsets');return{get(key){assert.equal(used,false);used=true;const request={};const captured=offsets[key]||0;const pending={key,captured,request,done:false};reads.push(pending);trace.push(['get',key,captured]);return request;}};}};}};
 const indexedDB={open(){throw Error('read fixture preopens inert DB; native IndexedDB prohibited');}};
 const fiberMap=new Map();let fiber=null;
 function slot(){assert.ok(fiber);return [fiber,fiber.cursor++];}
 function setValue(f,i,next){const apply=()=>{const value=typeof next==='function'?next(f.hooks[i].value):next;if(!Object.is(value,f.hooks[i].value)){f.hooks[i].value=value;f.dirty=true;}};if(!f.mounted){trace.push(['ignored-unmounted-state',f.name,i]);return;}if(stateMode==='queued')f.queue.push(apply);else apply();}
 const useState=initial=>{const[f,i]=slot();f.hooks[i]??={value:typeof initial==='function'?initial():initial};return[f.hooks[i].value,next=>setValue(f,i,next)];};
 const useMemo=(factory,deps)=>{const[f,i]=slot();if(!f.hooks[i]||!same(f.hooks[i].deps,deps))f.hooks[i]={value:factory(),deps};return f.hooks[i].value;};
 const useRef=value=>useMemo(()=>({current:value}),[]);
 const useEffect=(callback,deps)=>{const[f,i]=slot();const old=f.hooks[i];if(!old||!same(old.deps,deps)){f.hooks[i]={deps,cleanup:old?.cleanup};f.effects.push(()=>{f.hooks[i].cleanup?.();f.hooks[i].cleanup=callback();});}};
 const inertLayoutEffect=()=>{slot();};
 const react={memo:f=>f,Fragment:'fragment',createElement:(type,props,...children)=>({type,props,children})};
 const CONFIG={modes:['karaoke','synced','unsynced'],visual:{delay:0,'global-sync-offset':0,'instrumental-break-auto-detect':false,'performance-frame-rate':100,'synced-compact':compact,'translate:display-mode':'original','lines-before':3,'lines-after':3}};
 const context=vm.createContext({window,Spicetify,react,CONFIG,indexedDB,DB_NAME:'ivLyrics-db',DB_VERSION:1,STORE_NAME:'track-sync-offsets',dbInstance:readonlyDB,ivLyricsDebug(){},console,
 performance:{now:()=>now},Date:{now:()=>now},setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId;},clearTimeout:id=>timers.delete(id),
 CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
 useMemo,useState,useRef,useEffect,useCallback:(f,d)=>useMemo(()=>f,d),useSyncedLayoutEffect:inertLayoutEffect,
 useLyricsTrackReveal(){},useScrollActivity:()=>({isScrolling:false,handleContainerClick(){}}),
 AnimationManager:{addCallback:f=>animations.add(f),removeCallback:f=>animations.delete(f)},VisibilityManager:{addListener:f=>visibility.add(f),removeListener:f=>visibility.delete(f)},
 hasKaraokeVocalRows:()=>false,
 I18n:{t:x=>x},emptyLine:{startTime:0,endTime:0,text:[]},getInterludeInfo:()=>({isInterlude:false}),getCurrentTrackDurationMs:()=>null,createActiveTrailingKaraokeInterludeLine:()=>null,getKaraokeSpeakerStyle:()=>({}),getKaraokeLineMetaClass:()=>'',prefersReducedLyricsMotion:()=>true,PAGES_IV_LYRICS_SPEAKER_CLASS_CONTRACT:Symbol.for('ivLyrics.speakerColors.classNameContract'),toFiniteTime:v=>v==null||!Number.isFinite(Number(v))?null:Number(v),EMPTY_GLOBAL_CHAR_STATE:{globalCharOffsets:[],activeGlobalCharIndex:-1},KARAOKE_COMPLETION_POSITION_OFFSET_MS:900,KARAOKE_RELEASE_WINDOW_MS:820,
 LyricsLineBlock:function LyricsLineBlock(){},IdlingIndicator:()=>null,SearchBar:()=>null,UnsyncedLyricsPage:()=>null,CreditFooter:()=>null,LyricsUnavailableView:()=>null,
 SYNCED:1,KARAOKE:0,WORD_KARAOKE:3,UNSYNCED:2,CACHE:{},getLyricsDataMode:m=>m,getLyricsModeTypeKey:m=>CONFIG.modes[m],isLyricsRenderCacheCurrent:()=>true,hasInstrumentalMarker:()=>false,getCurrentTranslationTargetLanguage:()=> 'ko',getCurrentLyricsPronunciationNotation:()=> 'translation',getNonSectionLyricsText:xs=>xs.map(x=>x.text).join('\n'),TrackBackgroundDB:{getOverride:async()=>null},
 IVLYRICS_PROGRESS_GUARD_KEY:'fixture-progress-guard',IVLYRICS_PROGRESS_GUARD_VERSION:1,serviceDebug(){},
 });
 window.ivLyricsPlaybackClock={...clockModule,createSpotifyPlaybackClock:(sp,opts)=>clockModule.createSpotifyPlaybackClock(sp,{...opts,autoStart:false,now:()=>now,wallNow:()=>now})};
 vm.runInContext(`${emptyCode}\n${readCode}\n${progressCode}\nglobalThis.Utils={${utilsCode}};globalThis.serviceUtils={${progressMembers}};\nUtils.detectLanguage=()=> 'en';Utils.getInlinePronunciationSegments=()=>null;Utils.applyFuriganaIfEnabled=x=>x;Utils.formatLyricLineToCopy=(...p)=>p.filter(Boolean).join('\\n');window.Utils=serviceUtils;\nclass Container{${containerCode}\n getAdmittedPage(){ const mode=this.fixtureMode; const syncCreatorPlainPage=null; const isSyncCreatorActive=false; const renderedCurrentLyrics=this.state.currentLyrics; const renderedUnsyncedLyrics=this.state.unsynced; ${pageAdmission}\nreturn suppressStaleLyricsPage?null:activeLyricsPage; }}\nglobalThis.Container=Container;\n${pageCode}\nwindow.LyricsPageRenderer=LyricsPageRenderer;`,context);
 window.Translator={clearInflightRequests(){}};
 window.LyricsService={getTrackLanguageOverride:async()=>null,getTrackLyricsProviderOverride:async()=>null,getLyricsSnapshot:()=>null,publishLyricsSnapshot:s=>trace.push(['publish',s.trackUri]),getLyricsFromProviders(info){let resolve;const promise=new Promise(r=>resolve=r);requests.push({info,resolve,done:false});return promise;}};
 const c=new context.Container();const classQueue=[];
 Object.assign(c,{fixtureMode:1,state:{...vm.runInContext('emptyState',context),uri:track(initial).uri,currentLyrics:lines(initial),synced:lines(initial),isLoading:false,lyricsStatus:'ready',lyricsDisplayUri:track(initial).uri,lockedMode:-1,explicitMode:-1},currentTrackUri:track(initial).uri,_lyricsFetchSeq:0,_activeLyricsFetchSeq:0,_lyricsTransitionSeq:0,_playbackTrackResolutionSeq:0,_isComponentMounted:true,_localLyricsImportGeneration:0,
 setState(patch,cb){const apply=()=>{this.state={...this.state,...patch};trace.push(['class-state',this.state.uri,this.state.lyricsStatus,this.state.currentLyrics?.length||0]);cb?.();};if(stateMode==='queued')classQueue.push(apply);else apply();},clearPendingLyricsUpdates(){},closeLyricsEditModal(){},lyricsSaved:()=>false,fetchMetadataTranslation(){},fetchColors(){},fetchTempo(){},resetDelay(){},loadSavedVideoForTrack(){},startLyricsLoading:()=>1,clearLyricsLoading(){},getCurrentMode:()=>1,isModeAvailable:()=>false,getAutomaticMode:s=>s.synced?.length?1:-1,applyTranslationStates:()=>({}),refineLanguageWithAI(){}});window.lyricContainer=c;
 function getFiber(name){if(!fiberMap.has(name))fiberMap.set(name,{name,hooks:[],queue:[],effects:[],cursor:0,dirty:false,mounted:true});return fiberMap.get(name);}
 function renderFiber(name,fn,props){const f=getFiber(name);f.cursor=0;f.dirty=false;fiber=f;try{return fn(props);}finally{fiber=null;}}
 function flushStates(){while(classQueue.length)classQueue.shift()();for(const f of fiberMap.values())while(f.queue.length)f.queue.shift()();}
 function flushEffects(){for(const f of fiberMap.values())while(f.effects.length)f.effects.shift()();}
 function unmount(name){const f=fiberMap.get(name);if(!f)return;for(const h of f.hooks)h?.cleanup?.();f.mounted=false;f.queue=[];f.effects=[];fiberMap.delete(name);}
 let lastTree=null,lastProps=null,lastComponent=null,rendererProps=null;
 function render(){flushStates();const admitted=rendererProps===null?c.getAdmittedPage():{type:window.LyricsPageRenderer,props:rendererProps};assert.ok(admitted,'state display-URI guard must admit page');const renderer=renderFiber('renderer',admitted.type,admitted.props);const child=renderer.children[0];if(child.type!==lastComponent){unmount('page');lastComponent=child.type;}lastProps=child.props;lastTree=renderFiber('page',child.type,child.props);return snapshot();}
 function snapshot(){const rows=nodes(lastTree).filter(n=>n.type===context.LyricsLineBlock);return{current:c.currentTrackUri,stateUri:c.state.uri,displayUri:c.state.lyricsDisplayUri,status:c.state.lyricsStatus,isLoading:c.state.isLoading,publicUri:player.data?.item?.uri||'',playback:window.Utils.getPlayerPlaybackSnapshot(),childTrackUri:lastProps?.trackUri,childComponent:lastComponent===vm.runInContext('SyncedLyricsPage',context)?'SyncedLyricsPage':lastComponent===vm.runInContext('SyncedExpandedLyricsPage',context)?'SyncedExpandedLyricsPage':'unavailable',isKara:lastProps?.isKara===true,karaokeGranularity:lastProps?.karaokeRenderGranularity,lyricTexts:lastProps?.lyrics?.map(l=>l.text),rows:rows.map(n=>({text:n.props.originalText,active:n.props.isCurrentLine,className:n.props.className,position:n.props.position})),offset: (fiberMap.get('primitive')||fiberMap.get('page'))?.hooks[0]?.value,position:(fiberMap.get('primitive')||fiberMap.get('page'))?.hooks[4]?.value,reads:reads.map(r=>({key:r.key,captured:r.captured,done:r.done})),events:events.filter(e=>e.type==='ivLyrics:lyric-index-changed').map(e=>e.detail)};}
 async function settle({releaseReads=true,renderStep=render}={}){for(let i=0;i<20;i++){flushStates();renderStep();flushEffects();await micro();if(releaseReads)for(const r of reads)if(!r.done){r.done=true;r.request.result=r.captured;r.request.onsuccess();trace.push(['read-success',r.key,r.captured]);}await micro();flushStates();if(![...fiberMap.values()].some(f=>f.dirty||f.queue.length||f.effects.length)&&!classQueue.length){renderStep();return snapshot();}}throw Error('hook settling bound exceeded');}
 function renderPrimitive(...args){return renderFiber('primitive',()=>window.ivLyricsLyricRendererPrimitives.useLyricsPlaybackPosition(...args),{});}
 return{c,context,CONFIG,reads,requests,trace,events,render,settle,snapshot,flushStates,flushEffects,
 installGlobalOffsetReader(){window.CONFIG=CONFIG;context.localStorage={getItem(key){assert.equal(key,'ivLyrics:visual:global-sync-offset');return null;}};context.Utils.getGlobalSyncOffset=vm.runInContext(`({${globalOffsetCode}}).getGlobalSyncOffset`,context);},
 setRendererProps(props){rendererProps=props;},
 renderPrimitive,
 settlePrimitive(args=[],options={}){return settle({...options,renderStep:()=>renderPrimitive(...args)});},
 unmountPrimitive(){unmount('primitive');},
 notifyUri(uri,offset){window.dispatchEvent(new context.CustomEvent('ivLyrics:offset-changed',{detail:{trackUri:uri,offset}}));},
 notifyGlobal(offset){window.dispatchEvent(new context.CustomEvent('ivLyrics:global-offset-changed',{detail:{offset}}));},
 setPublic(id){player.data.item=track(id);},setInternal(id,{metadata=true}={}){Spicetify.Platform.PlayerAPI._state={...Spicetify.Platform.PlayerAPI._state,item:metadata?track(id):{uri:track(id).uri},playbackId:'play-'+id};},
 async transition(id){c.schedulePlaybackTrackResolution(track(id));flushStates();await micro();flushStates();},
 async ready(id){await micro();flushStates();const q=requests.find(r=>!r.done&&r.info.uri===track(id).uri);assert.ok(q,`provider ${id} request exists`);q.done=true;q.resolve({uri:q.info.uri,provider:'inert-fixture',synced:lines(id)});await micro();flushStates();assert.equal(c.state.lyricsStatus,'ready');assert.equal(c.state.uri,track(id).uri);},
 async release(index){const r=reads[index];assert.ok(r&&!r.done);r.done=true;r.request.result=r.captured;r.request.onsuccess();trace.push(['read-success',r.key,r.captured]);await micro();},
 notify(id,offset){window.dispatchEvent(new context.CustomEvent('ivLyrics:offset-changed',{detail:{trackUri:track(id).uri,offset}}));},
 tick(ms=10){now+=ms;position+=ms;Spicetify.Platform.PlayerAPI._state.positionAsOfTimestamp=position;Spicetify.Platform.PlayerAPI._state.timestamp=now;for(const f of [...animations])f();},
 unmount(){unmount('page');unmount('renderer');},
 async drain(){this.unmount();this.unmountPrimitive();c._isComponentMounted=false;c.clearPlaybackTrackResolutionTimer();for(const r of reads)if(!r.done)await this.release(reads.indexOf(r));for(const q of requests)if(!q.done){q.done=true;q.resolve({uri:q.info.uri,provider:'inert-fixture',synced:lines(q.info.title)});}await micro();flushStates();window['fixture-progress-guard']?.destroy();timers.clear();disposed=true;return{pendingReads:reads.filter(r=>!r.done).length,pendingProviders:requests.filter(r=>!r.done).length,listeners:[...listeners.values()].reduce((n,x)=>n+x.size,0),animations:animations.size,visibility:visibility.size,hookFibers:fiberMap.size,classQueue:classQueue.length,timers:timers.size,disposed};}
 };
}
export const extractionManifest = {
 sourceHashes:Object.fromEntries(files.map(f=>[f,sha(src[f])])), wholeFiles:['PlaybackClock.js'], extracts,
 scope:'Actual clock, safe progress, resolver, ready container, renderer, both synced pages, hooks, full synced engine and row projection. Explicit immediate/FIFO hook model; inert readonly storage/provider/player. No native timing or write-transaction claims.',
};
