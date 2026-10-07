// Complete production LocalCacheManager, actual playback clock,
// actual snapshot/stable-item helpers and CacheManager.clearByUri. Inert hooks,
// storage/translator/inflight/notification boundaries; no React/browser/IDB/I/O.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const root = new URL('../../', import.meta.url);
export const source = name => readFileSync(new URL(name, root), 'utf8');
export const cut = (s, start, end) => {const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return s.slice(a,b);};
export const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const A='spotify:track:AAAAAAAAAAAAAAAAAAAAAA', B='spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
export const track=uri=>({uri,type:'track',metadata:{title:'Fixture',artist_name:'Fixture',duration:'200000'}});
const playback=createRequire(import.meta.url)(new URL('PlaybackClock.js',root).pathname);
const method=(s,name,indent='        ')=>{const a=s.search(new RegExp('^'+indent+'(?:async )?'+name+'\\(','m'));assert.ok(a>=0,name);const tail=s.slice(a),b=tail.search(new RegExp('^'+indent+'\\}[,]?\\s*$','m'));assert.ok(b>0,name);return tail.slice(0,b)+tail.slice(b).split('\n')[0];};
const elements=node=>Array.isArray(node)?node.flatMap(elements):node&&typeof node==='object'&&'tag'in node?[node,...elements(node.children)]:[];
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
export function cacheHarness({accepted=track(A),publicItem=accepted,fallbackClock=false}={}) {
 const trace=[],toasts=[],errors=[],gates=[],actions=[],slots=[],effects=[];let cursor=0,statsCount=0;
 const spicetify={Player:{data:{item:publicItem}},Platform:{PlayerAPI:{_state:{item:accepted,isPaused:true}}}};
 const gate=(kind,id)=>{let done,fail;const entry={kind,id,settled:false,promise:new Promise((r,j)=>{done=r;fail=j;})};entry.resolve=(value=true)=>{assert.equal(entry.settled,false);entry.settled=true;trace.push({event:kind+'-complete',id,value:plain(value)});done(value);};entry.reject=message=>{assert.equal(entry.settled,false);entry.settled=true;trace.push({event:kind+'-reject',id});fail(Error(message));};gates.push(entry);trace.push({event:kind+'-start',id});return entry.promise;};
 const record=event=>(...args)=>trace.push({event,args:plain(args)});
 const makeObject=event=>new Proxy({[A]:{value:'A'},[B]:{value:'B'},unrelated:{value:'other'}},{deleteProperty(target,key){trace.push({event,key});return Reflect.deleteProperty(target,key);}});
 const cache=makeObject('cache-delete');
 const container={_dmResults:makeObject('dm-delete'),clearCulturalAnnotationsForTrack:record('cultural-track'),clearAllCulturalAnnotations:record('cultural-all')};
 const inflightKeys=[`${A}:fixture`,`${B}:fixture`,`${A}More:fixture`,'unrelated'];
 for(const key of ['_inflightGemini','_inflightTrad'])container[key]={invalidate:predicate=>trace.push({event:key,selected:inflightKeys.filter(k=>!predicate||predicate(k))})};
 const context=vm.createContext({
  Spicetify:spicetify,console:{error:(...args)=>errors.push(args)},serviceDebug(){},performance:{now:()=>0},
  react:{createElement:(tag,props,...children)=>({tag,props,children})},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}},
  getSafeSettingsLocale:()=> 'en',getSettingsText:(_,fallback)=>fallback,I18n:{t:key=>key},
  Toast:{success:message=>{trace.push({event:'toast-success',message});toasts.push({kind:'success',message});},error:message=>{trace.push({event:'toast-error',message});toasts.push({kind:'error',message});}},
  LyricsCache:{getStats:()=>gate('stats',++statsCount),clearTrack:id=>gate('clear-track',id),clearAll:()=>gate('clear-all',null)},
  reloadLyrics:(...args)=>{trace.push({event:'reload',args});},
  window:{CACHE:cache,lyricContainer:container,
   Translator:{clearMemoryCache:record('translator-memory'),clearInflightRequests:record('translator-inflight'),clearAllMemoryCache:record('translator-all-memory'),clearAllInflightRequests:record('translator-all-inflight')},
   SyncDataService:{clearCache:record('sync-clear'),getOpenDbCacheInfo:()=>null},
   ivLyricsPlaybackClock:fallbackClock?undefined:{...playback,createSpotifyPlaybackClock:(s,options)=>playback.createSpotifyPlaybackClock(s,{...options,autoStart:false,now:()=>0,wallNow:()=>0,schedule(){throw Error('unexpected clock timer');},cancel(){}})}
  }
 });
 const service=source('LyricsService.js');
 vm.runInContext([
  cut(service,'    const IVLYRICS_PROGRESS_GUARD_KEY =','    const Utils = {'),
  'window.Utils={'+['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack'].map(name=>method(service,name)).join('\n')+'};',
  'window.CacheManager={_cache:new Map(),clear(){this._cache.clear();},'+method(source('index.js'),'clearByUri','  ')+'};',
  cut(source('Settings.js'),'const LocalCacheManager = () => {','// 디버그 정보 패널 컴포넌트'),
  'globalThis.renderCache=LocalCacheManager;'
 ].join('\n'),context);
 const manager=context.window.CacheManager;
 for(const uri of[A,B])manager._cache.set('translation:'+uri,{});
 const actualClear=manager.clearByUri;manager.clearByUri=function(uri){trace.push({event:'cache-manager',uri});return actualClear.call(this,uri);};
 const actualClearAll=manager.clear;manager.clear=function(){trace.push({event:'cache-manager-all'});return actualClearAll.call(this);};
 const h={context,spicetify,container,cache,manager,trace,toasts,errors,gates,actions,
  render(){cursor=0;return context.renderCache();},
  button(scope){const button=elements(this.render()).find(e=>e.tag==='button'&&e.children.includes('settingsAdvanced.cacheManagement.localCache.clear'+scope));assert.ok(button,scope);return button;},
  runEffects(){for(const fn of effects.splice(0))fn();},
  async mount(stats={lyrics:1}){this.render();this.runEffects();this.pending('stats')[0].resolve(stats);await flush();return this.render();},
  pending(kind){return gates.filter(g=>!g.settled&&(!kind||g.kind===kind));},
  click(scope='Current',button=this.button(scope)){assert.ok(!button.props.disabled,'actual button is enabled');const promise=button.props.onClick();const action={promise,done:false};actions.push(action);promise.then(()=>{action.done=true;},error=>{action.done=true;action.error=error;});return promise;},
  play(next,publicNext=next){spicetify.Platform.PlayerAPI._state.item=next;spicetify.Player.data.item=publicNext;},
  snapshot(){return context.window.Utils.getPlayerPlaybackSnapshot();},
  resolved(){return context.window.Utils.resolveStablePlaybackTrack();},
  state(){return {cache:plain(cache),dm:plain(container._dmResults),translated:[...manager._cache.keys()]};},
  settle:flush,
  async finish(){for(let i=0;i<10;i++){for(const g of this.pending())g.resolve(g.kind==='stats'?{lyrics:1}:true);await flush();if(gates.every(g=>g.settled)&&actions.every(a=>a.done))break;}assert.ok(gates.every(g=>g.settled),'all inert storage/stat operations drain');assert.ok(actions.every(a=>a.done),'all actual click promises drain');context.window.__ivLyricsPlaybackProgressGuard?.destroy();},
 };
 return h;
}
export async function realClearOpenFailure(){const logs=[];const cache=vm.runInNewContext('({'+cut(source('LyricsService.js'),'        async clearTrack(trackId) {','        async clearAll()')+'})',{console:{error:(...args)=>logs.push(args)}});cache._openDB=async()=>{throw Error('inert cache open failure');};const result=await cache.clearTrack(A.split(':')[2]);return{result,logs:logs.length};}
