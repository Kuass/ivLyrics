// Self-contained loading-status fixture. No dependency on the note-ownership fixture.
// Actual selector, fetch, presentation, Translator, and page/row code runs unchanged.
// Provider calls, storage, playback, and React elements/hooks are inert boundaries.
// State is immediate or FIFO queued; this is structural HTML, not browser pixels.
// Unknown work throws; finish() drains all provider promises, microtasks and timers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
export const root = process.env.IVLYRICS_TEST_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.IVLYRICS_TEST_SOURCE_ROOT) + sep)
  : new URL('../../', import.meta.url);
const files=Object.fromEntries(['index.js','Pages.js','OptionsMenu.js','LyricsService.js','Utils.js','AIAddonManager.js','style.css'].map(f=>[f,readFileSync(new URL(f,root),'utf8')]));
export const manifest=[];
const sha=s=>createHash('sha256').update(s).digest('hex');
function record(file,label,a,b,kind){const s=files[file].slice(a,b);manifest.push({file,label,kind,start:a,end:b,startLine:files[file].slice(0,a).split('\n').length,endLine:files[file].slice(0,b).split('\n').length,sha256:sha(s)});return s;}
function cut(file,start,end,kind='complete declarations'){const s=files[file],a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`${file} ${start} ... ${end}`);return record(file,start,a,b,kind);}
function method(file,name,indent='  '){const s=files[file],a=s.search(new RegExp(`^${indent}(?:static )?(?:async )?${name}\\(`,'m'));assert.ok(a>=0,name);const tail=s.slice(a),end=tail.search(new RegExp(`^${indent}\\},?\\s*$`,'m'));assert.ok(end>0,name);return record(file,name,a,a+end+tail.slice(end).split('\n')[0].length,'complete method');}
function decl(file,name){const s=files[file],a=s.search(new RegExp(`^const ${name} =`,'m'));assert.ok(a>=0,name);const tail=s.slice(a+1),next=tail.search(/^(?:const |let |class |function |window\.)/m);assert.ok(next>0,name);return record(file,name,a,a+1+next,'complete declaration');}
const idxNames = [
  'getCurrentTranslationTargetLanguage',
  'getTranslationPartText',
  'getDisplayedVocalParts',
  'buildTranslationLineRequests',
  'getNonSectionLyricsText',
  'getTranslationSourceCacheHash',
  'cloneTranslationVocals',
  'withoutVocalSupplementField',
  'PRONUNCIATION_DISPLAY_MODES',
  'isPronunciationDisplayMode',
  'mergeVocalTranslationFields',
  'hasInstrumentalMarker',
  'emptyState',
  'createInitialLyricsContainerState',
  'isTranslationNoteLine',
  'areTranslationTextsSimilar',
  'GENERATION_PILL_TIMING',
  'GENERATION_REQUEST_PILL_CONFIG',
  'SYNC_DATA_RENDERER_VERSION',
  'getLyricsProviderSelectionPolicy',
  'isLyricsRenderCacheCurrent',
];
const methods = [
  'clearGenerationPillTimers',
  'nextGenerationPillRevision',
  'showGenerationPillLoading',
  'hideGenerationPill',
  'completeGenerationPill',
  'getCurrentCulturalAnnotationLyrics',
  'regenerateCulturalAnnotations',
  'getTranslationTargetLanguage',
  'isCulturalAnnotationsEnabled',
  'getCulturalAnnotationSourceLines',
  'clearCulturalAnnotationsForTrack',
  'clearAllCulturalAnnotations',
  'applyCulturalAnnotations',
  'requestCulturalAnnotations',
  'selectLyricsProviderForCurrentTrack',
  'infoFromTrack',
  'fetchLyrics',
  'resolveLyricsForMode',
  'lyricsSource',
  'optimizeTranslations',
  'provideLanguageCode',
  'isCurrentLyricsUri',
  'isCurrentLyricsState',
  'clearPendingLyricsUpdates',
  'getLyricsLayoutHasLyrics',
  'getLoadingLyricsState',
  'startGenerationRequestLoading',
  'updateGenerationRequestLoading',
  'clearGenerationRequestLoading',
  'startLyricsLoading',
  'clearLyricsLoading',
  'clearPhoneticLoading',
  'clearTranslationLoading',
  'startCulturalAnnotationsLoading',
  'clearCulturalAnnotationsLoading',
  'applyTranslationStates',
  'isPlaybackUriCurrent',
  'isModeAvailable',
  'getAutomaticMode',
  'getCurrentMode',
];
const pageNames = [
  'INTERLUDE_MIN_DURATION_MS',
  'INTERLUDE_MARKER_REGEX',
  'INTERLUDE_NOTE_CHARACTER_REGEX',
  'safeRenderText',
  'getLyricsDisplayMode',
  'getFirstTrimmedString',
  'getEmbeddedAuxiliaryDisplayValues',
  'normalizeDisplayedCulturalAnnotations',
  'getRubySourceText',
  'getCulturalMarkerHTML',
  'getCulturalMarkerRawOffset',
  'renderAnnotatedLyricHTML',
  'renderLyricSubLine',
  'renderLyricMainContent',
  'normalizeUnsyncedLyrics',
  'getUnsyncedLineRenderData',
  'getPlainLyricText',
  'getInterludeCandidateText',
  'normalizeInterludeMarkerText',
  'isInterludeMarkerText',
  'isMusicNoteInterludeMarkerText',
  'toFiniteTime',
  'getInterludeInfo',
  'getInstrumentalBreakKind',
  'getCurrentTrackDurationMs',
  'hasKaraokeVocalRows',
  'createCopyHandler',
  'LyricsLineBlock',
  'UnsyncedLyricsPage',
  'LyricsPageRenderer',
];
const statusSource=`globalThis.statusStack=function(isSyncCreatorActive=false){${cut('index.js','    const computeGenerationStatusStack = () => {','    const computeTrackSyncAdjustPill = () => {','exact render-body generation-status slice')} return generationStatusStack;};`;
record('AIAddonManager.js','full unchanged module',0,files['AIAddonManager.js'].length,'complete module');
record('style.css','description clipping CSS',files['style.css'].indexOf('.lyrics-generation-status-description {'),files['style.css'].indexOf('.lyrics-generation-status-icon {'),'complete CSS rule');
const source=statusSource+'\n'+idxNames.map(n=>decl('index.js',n)).join('\n')+'\n'+
 cut('index.js','const KARAOKE =','const normalizeLyricsRenderModeLock =')+'\n'+
 `class Container {constructor(){${cut('index.js', '    this._culturalAnnotationResults = new Map();', '    this._isComponentMounted = false;', 'exact constructor initialization slice')}}${methods.map(n=>method('index.js',n)).join('\n')}};globalThis.Container=Container;globalThis.initial=createInitialLyricsContainerState;\n`+
 cut('LyricsService.js','    const getLyricsTextCacheHash =','    const isCachedTranslationStructurallyValid =')+'\n'+
 cut('LyricsService.js','    function getTranslationTargetLanguage()','    class Translator {')+'\n'+
 `class Translator {${method('LyricsService.js','generateCulturalAnnotations','        ')}};window.Translator=Translator;\n`+
 `Object.assign(window.LyricsService,{${method('LyricsService.js','getLyricsFromProviders','        ')}});\n`+
 cut('Utils.js','const IV_LYRICS_COMPARISON_APOSTROPHE_REGEX =','const IV_LYRICS_DEFAULT_SPEAKER_TEXT_COLORS =')+'\n'+
 ['KANJI_CHARACTER_REGEX','CLEAN_HTML_RT_REGEX','CLEAN_HTML_RUBY_REGEX','CLEAN_HTML_TAG_REGEX'].map(n=>decl('Utils.js',n)).join('\n')+'\n'+
 `Object.assign(Utils,{${['isSectionHeader','rubyTextToHTML','isSpotifyTrackId','extractTrackId','setDetectedLanguage','getDetectedLanguage','applyFuriganaIfEnabled','formatLyricLineToCopy'].map(n=>method('Utils.js',n)).join('\n')}});\n`+
 pageNames.map(n=>decl('Pages.js',n)).join('\n')+'\n'+
 decl('OptionsMenu.js','LyricsProviderSelectButton')+'\n'+
 `globalThis.renderGate=function(){const mode=this.getCurrentMode();const isSyncCreatorActive=false;${cut('index.js','    // Get current display modes to track changes','    // Always render the Conversions button', 'exact render-body slice')} };\n`+
 `globalThis.menuElement=function(){const isLocalTrack=false;const currentTrackInfo={uri:this.state.uri};return ${cut('index.js','react.createElement(LyricsProviderSelectButton, {','              react.createElement(TrackBackgroundButton,','exact render-body element slice').trim().replace(/,$/,'')};};\n`+
 `globalThis.renderedPage=function(){const mode=this.getCurrentMode();const isSyncCreatorActive=false;const syncCreatorPlainLyrics=[];${cut('index.js','    const renderedCurrentLyrics =','    // Tab bar removed','exact render-body page and identity-gate slice')} const hasLyricsLayout=this.getLyricsLayoutHasLyrics();${cut('index.js','    const shouldHideFullscreenLyrics =','    const shouldUseFullscreenNoLyricsLayout =','exact fullscreen visibility slice')} return !shouldHideFullscreenLyrics && !suppressStaleLyricsPage && activeLyricsPage;};\n`+
 'window.LyricsPageRenderer=LyricsPageRenderer;globalThis.page=LyricsPageRenderer;globalThis.button=LyricsProviderSelectButton;globalThis.row=LyricsLineBlock;globalThis.unsynced=UnsyncedLyricsPage;';
export const U='spotify:track:AAAAAAAAAAAAAAAAAAAAAA',V='spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
export const words={old:['Old river proverb','Old verse two'],new:['New city image','New verse two'],other:['Other track image','Other track second']};
const plain=v=>JSON.parse(JSON.stringify(v));
function deferred(args){let resolve,reject;const q={args:plain(args),settled:false,promise:new Promise((a,b)=>{resolve=a;reject=b})};q.resolve=v=>{assert.ok(!q.settled);q.settled=true;resolve(v);};q.reject=e=>{assert.ok(!q.settled);q.settled=true;reject(e);};return q;}
export function harness({queued=false,enabled=true,providerOrder=['ai-primary','ai-fallback'],providerEnabled=true,capabilityEnabled=true,sameProviderName=false}={}){
 const storage=new Map([['ivLyrics:ai:provider-order',JSON.stringify(providerOrder)],...providerOrder.flatMap(id=>[[`ivLyrics:ai:enabled:${id}`,String(providerEnabled)],[`ivLyrics:ai:addon:${id}:capability:culturalAnnotations`,JSON.stringify(capabilityEnabled)]])]);
 const calls=[],lyricCalls=[],events=[],errors=[],cacheReads=[],cacheWrites=[],stateQueue=[],timers=new Map(),persisted=new Map(),cache=new Map();let clockMs=0;const timerLog=[];let nextTimer=0,dirty=false,version=0,renderCount=0,modal=null,inStateUpdater=false;let c;
 const CONFIG={modes:['karaoke','synced','unsynced'],visual:{'cultural-annotations-enabled':enabled,'translate:target-language':'ko','translate:detect-language-override':'en','translation-mode:english':'none','translation-mode-2:english':'none','translate:display-mode':'below','pronunciation-inline':false,'furigana-enabled':false}};
 const react={memo:f=>f,createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment'};
 const io={window:null,CONFIG,react,CACHE:{},I18n:{t:k=>({'generationStatus.culturalAnnotations':'문화적 설명','generationStatus.culturalAnnotationsLoading':'문화적 설명을 생성하는 중...','generationStatus.complete':'완료!'}[k]||k)},Toast:{show:m=>events.push({event:'toast',kind:'show',message:m}),success:m=>events.push({event:'toast',kind:'success',message:m}),error:m=>errors.push({event:'toast',message:m})},
  useMemo:f=>f(),useCallback:f=>f,useRef:v=>({current:v}),useLyricsTrackReveal(){},SearchBar:'SearchBar',CreditFooter:'CreditFooter',SyncedLyricsPage:'SyncedLyricsPage',SyncedExpandedLyricsPage:'SyncedExpandedLyricsPage',LyricsUnavailableView:'LyricsUnavailableView',InterludeIndicator:'InterludeIndicator',KaraokeLine:'KaraokeLine',
  IvLyricsTooltip:'IvLyricsTooltip',IvLyricsToolbarIcon:'IvLyricsToolbarIcon',OptionsMenu:'OptionsMenu',SettingRowDescription:'SettingRowDescription',ICONS:{provider:'provider'},getOptionsText:(k,f)=>f,
  INTERLUDE_MIN_DURATION_MS:5000,INTERLUDE_MARKER_REGEX:/^[♪\s]+$/,INTERLUDE_NOTE_CHARACTER_REGEX:/[♪]/,
  getRememberedLyricsRenderModeLock:()=>-1,getRememberedIvLyricsFullscreenPresentation:()=> 'standard',getCurrentLyricsPronunciationNotation:()=> 'translation',isLyricsRenderCacheCurrent:()=>true,
  getStorageItem:()=>null,getCurrentLanguage:()=> 'ko',localStorage:{getItem:()=>null},_translatorInflightRequests:new Map(),lyricsProviderInflightRequests:new Map(),lyricsProviderRequestGeneration:0,ivLyricsDebug(){},
  console:{warn:(...a)=>errors.push({event:'warn',args:a.map(String)}),error:(...a)=>errors.push({event:'error',args:a.map(String)})},setTimeout(fn,delay=0){timers.set(++nextTimer,{fn,at:clockMs+delay,delay});timerLog.push({event:'set',id:nextTimer,delay,at:clockMs+delay});return nextTimer;},clearTimeout:id=>timers.delete(id),
  Utils:{extractTrackId:uri=>uri?.startsWith('spotify:track:')?uri.slice(14):null,detectLanguage:()=> {assert.equal(inStateUpdater,false,'language detection must stay outside state updaters');return 'en';},setDetectedLanguage(){},applyFuriganaIfEnabled:t=>t,formatLyricLineToCopy:()=> '',getDetectedLanguage:()=> 'en'},
  Spicetify:{LocalStorage:{get:k=>storage.get(k)??null,set:(k,v)=>storage.set(k,v)},Player:{data:{item:null}}},
  TrackLyricsProviderDB:{async setProvider(uri,p){persisted.set(uri,p);events.push({event:'set-provider',uri,provider:p});},async clearProvider(uri){persisted.delete(uri);events.push({event:'clear-provider',uri});},async getProvider(uri){return persisted.get(uri)||null;}},TrackBackgroundDB:{async getOverride(){return null;}},TrackLanguageDB:{async getLanguage(){return 'en';}},CacheManager:{clearByUri:uri=>events.push({event:'clear-display-cache',uri})},
  LyricsCache:{async clearCulturalAnnotationsForTrack(trackId){for(const key of cache.keys())if(JSON.parse(key)[0]===trackId)cache.delete(key);return true;},async getCulturalAnnotations(...args){cacheReads.push(plain(args));return cache.get(JSON.stringify(args))||null;},async setCulturalAnnotations(...args){const value=args.pop();cache.set(JSON.stringify(args),value);cacheWrites.push({key:plain(args),value:plain(value)});}},
  openOptionsModal(title,items,onChange){modal={title,items,onChange};events.push({event:'open-provider-menu',title});return ()=>events.push({event:'close-provider-menu'});}
 };
 io.window={CONFIG,Utils:{resolveStablePlaybackTrack:()=>io.Spicetify.Player.data.item},ivLyricsTextComparison:{normalize:t=>String(t||'').trim().toLowerCase(),areEquivalent:(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase()},
  LyricsAddonManager:{getEnabledProviders:()=>[{id:'old',name:'Old fixture lyrics'},{id:'new',name:'New fixture lyrics'}],async getLyrics(info,override){const source=info.uri===V?'other':(override||'old');lyricCalls.push({uri:info.uri,override,source});return {uri:info.uri,provider:source,providerSelectionPolicy:'type-first-v1:sync-data-first',unsynced:words[source].map(text=>({text}))};}},
  LyricsService:{getTrackLanguageOverride:async()=> 'en',getTrackLyricsProviderOverride:uri=>io.TrackLyricsProviderDB.getProvider(uri),clearLyricsSnapshot:uri=>events.push({event:'clear-snapshot',uri}),getLyricsSnapshot:()=>null,publishLyricsSnapshot:s=>events.push({event:'snapshot',uri:s.trackUri,source:s.source})}
 };
 const context=vm.createContext(io);vm.runInContext(files['AIAddonManager.js'],context,{filename:'actual-AIAddonManager.js'});const manager=io.window.AIAddonManager;for(const id of ['ai-primary','ai-fallback'])manager.register({id,author:'Fixture',description:'Inert external transport',version:'1',getSettingsUI(){return null;},name:sameProviderName?'Shared AI':id==='ai-primary'?'Primary AI':'Fallback AI',supports:{culturalAnnotations:true},generateCulturalAnnotations(args){const q=deferred(args);q.provider=id;calls.push(q);events.push({event:'annotation-provider-start',request:calls.length-1,provider:id,args:plain(args)});return q.promise;}});for(const type of ['start','success','error'])manager.on(`ai:request:${type}`,detail=>events.push({event:`ai:request:${type}`,detail:plain(detail)}));vm.runInContext(source,context,{filename:'extracted-production.js'});c=new context.Container();c.state=context.initial();c.selectLyricsProviderForCurrentTrack=c.selectLyricsProviderForCurrentTrack.bind(c);Object.assign(c,{_isComponentMounted:true,currentTrackUri:'',_lyricsFetchSeq:0,_activeLyricsFetchSeq:0,_lyricsTransitionSeq:0,_lyricsPresentationSeq:0,_localLyricsImportGeneration:0,_dmResults:{},_generationRequestDetails:new Map(),_visibleGenerationPills:new Set(),_generationPillTimers:new Map(),_generationPillRevisions:new Map(),_sharedPresentationKeys:new Map()});
 const setDetectedLanguage=io.Utils.setDetectedLanguage;io.Utils.setDetectedLanguage=function(...args){assert.equal(inStateUpdater,false,'detected language writes must stay outside state updaters');return setDetectedLanguage.apply(this,args);};
 for(const prefix of ['Lyrics','Phonetic','Translation','CulturalAnnotations']){c[`_active${prefix}LoadingTokens`]=new Set();c[`_${prefix[0].toLowerCase()+prefix.slice(1)}LoadingSeq`]=0;}
 Object.assign(c,{setState(patch,callback){const job=()=>{let next;inStateUpdater=true;try{next=typeof patch==='function'?patch(c.state):patch;}finally{inStateUpdater=false;}c.state={...c.state,...next};version++;dirty=true;callback?.();};if(queued)stateQueue.push(job);else job();},fetchMetadataTranslation(){},fetchColors(){},fetchTempo(){},resetDelay(){},lyricsSaved(){return false;},refineLanguageWithAI(){throw Error('unexpected language refinement');}});
 function tree(node){if(node==null||typeof node!=='object')return node;if(Array.isArray(node))return node.map(tree);if(typeof node.type==='function')return tree(node.type(node.props));return {...node,children:node.children.map(tree)};}
 function htmlSummary(){const result=tree(context.renderedPage.call(c));const ps=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}if(n.type==='p')ps.push({className:n.props.className||null,html:n.props.dangerouslySetInnerHTML?.__html||null});n.children?.forEach(walk);}walk(result);return ps;}
 async function settle(){let stable=0,prior='';for(let n=0;n<500;n++){await Promise.resolve();while(stateQueue.length)stateQueue.shift()();if(dirty){dirty=false;renderCount++;context.renderGate.call(c);}const now=JSON.stringify([version,calls.length,lyricCalls.length,stateQueue.length,dirty,cacheWrites.length,io._translatorInflightRequests.size,c._culturalAnnotationRequests.size]);if(now===prior)stable++;else stable=0;prior=now;if(stable===25)return;}throw Error('nonquiescent scheduler');}
 function snap(label){const p=htmlSummary();return {label,clockMs,statusStack:tree(context.statusStack.call(c)),suppressedStatus:tree(context.statusStack.call(c,true)),generationPills:plain(c.state.generationPills),details:[...c._generationRequestDetails],activeTokens:[...c._activeCulturalAnnotationsLoadingTokens],visiblePills:[...c._visibleGenerationPills],pendingTimers:[...timers].map(([id,t])=>({id,at:t.at,delay:t.delay})),uri:c.state.uri,displayUri:c.state.lyricsDisplayUri,isFullscreen:c.state.isFullscreen,provider:c.state.provider,loading:c.state.isLoading,epoch:c._culturalAnnotationCacheEpoch,current:plain(c.state.currentLyrics||[]),html:p,resultEntries:[...c._culturalAnnotationResults].map(([uri,r])=>({uri,key:r.key,notes:[...r.notesByIndex]})),pendingKeys:[...c._culturalAnnotationRequests.keys()],inflightKeys:[...io._translatorInflightRequests.keys()],lyricsProviderKeys:[...io.lyricsProviderInflightRequests.keys()],requests:calls.map((q,i)=>({id:i,settled:q.settled,provider:q.provider,lines:q.args.lines})),renderCount,lastProcessedUri:c.lastProcessedUri,lastProcessedMode:c.lastProcessedMode,cacheWrites:cacheWrites.length};}
 async function play(uri=U){io.Spicetify.Player.data.item={uri,metadata:{title:'Fixture track',artist_name:'Fixture artist',duration:'200000'}};await c.fetchLyrics(io.Spicetify.Player.data.item);await settle();}
 async function choose(provider){const element=context.menuElement.call(c);const button=context.button(element.props).children[0];events.push({event:'provider-button',disabled:button.props.disabled,culturalLoading:c.state.isCulturalAnnotationsLoading});assert.equal(button.props.disabled,false,'fixture exercises an enabled production control');button.props.onClick();await modal.onChange('track-lyrics-provider',provider);await settle();}
 const answer=q=>({annotations:[{lineIndex:0,expression:q.args.lines[0].text,note:`Meaning of ${q.args.lines[0].text}`}],provider:q.provider});
 async function resolve(i, result=answer(calls[i])){assert.ok(calls[i],`request ${i}`);calls[i].resolve(result);await settle();}
 async function finish(){for(let round=0;round<20;round++){await settle();for(const q of calls)if(!q.settled)q.resolve(answer(q));await settle();const ts=[...timers].filter(([,t])=>t.delay<95000);for(const [id,t]of ts){if(timers.delete(id)){clockMs=Math.max(clockMs,t.at);t.fn();}}await settle();if(calls.every(q=>q.settled)&&!timers.size&&!stateQueue.length&&!dirty&&io._translatorInflightRequests.size===0&&io.lyricsProviderInflightRequests.size===0&&c._culturalAnnotationRequests.size===0)return; }throw Error('incomplete final drain');}
 async function reject(i){calls[i].reject(new Error('controlled transport failure'));await settle();}
 async function advance(ms){const limit=clockMs+ms;for(const [id,t]of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(t.at<=limit&&timers.delete(id)){clockMs=t.at;t.fn();await settle();}}clockMs=limit;await settle();}
 return {c,context,CONFIG,manager,storage,timerLog,reject,advance,calls,events,cacheReads,cacheWrites,lyricCalls,errors,persisted,play,choose,resolve,finish,settle,snap,rerender:async()=>{dirty=true;await settle();}};
}
