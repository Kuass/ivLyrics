import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
const root=process.env.IVLYRICS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'CommunityVideoSelector.js'),'utf8');
const utilsSource=readFileSync(resolve(root,'Utils.js'),'utf8');
const cut=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);assert.ok(a>=0&&b>a);return s.slice(a,b);};
const selection=cut(source,'const COMMUNITY_VIDEO_MAX_START_TIME_SECONDS','// 현재 음악 재생 시간에 맞춰');
const componentSource=cut(source,'const CommunityVideoSelector = ({','window.CommunityVideoSelector =');
const youtubePatterns=cut(utilsSource,'const YOUTUBE_ID_PATTERNS = [','const IV_LYRICS_COMPARISON_APOSTROPHE_REGEX');
const youtubeExtractor=cut(utilsSource,'  extractYouTubeVideoId(url) {','\n  /**\n   * 공식 채널 영상 우선 선택');
const extractYouTubeVideoId=vm.runInNewContext(`${youtubePatterns}\n({${youtubeExtractor}}).extractYouTubeVideoId;`);
const confirmSource=cut(source,'const ConfirmDialog =','const COMMUNITY_VIDEO_MAX_START_TIME_SECONDS');
const identitySource=cut(utilsSource,'  isSpotifyTrackId(value) {','  // ==========================================\n  // 커뮤니티 영상 추천 시스템');
const identity=vm.runInNewContext(`({${identitySource}})`,{window:{}});
const trackUri='spotify:track:abcdefghijklmnopqrstuv';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const row=(id)=>({id,youtubeVideoId:String(id).padEnd(11,'0').slice(0,11),youtubeTitle:id,score:0,likes:0,dislikes:0,userVote:null,submitterId:'other',startTime:0,skipSegments:[]});
const submittedRow=(id='newly-submitted',videoId='abcdefghijk')=>({...row(id),youtubeVideoId:videoId});
// The URL parser and complete parent component run verbatim. Debounced title
// timers stay inert, modeling a permitted immediate submit after a pasted URL.
function harness({hide=true,onCommit=null,local=false,syncDeleteFailure=false}={}){
 const slots=[],effects=[],reads=[],validations=[],submissions=[],votes=[],deletions=[],timers=new Map(),toasts=[],selections=[],deleteCalls=[];let cursor=0,dirty=false,tree,maxActiveReads=0;
 const react={
  Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const n=cursor++;if(!slots[n]){const s={kind:'state',value:typeof initial==='function'?initial():initial};s.set=next=>{const value=typeof next==='function'?next(s.value):next;if(!Object.is(value,s.value)){s.value=value;dirty=true;}};slots[n]=s;}return[slots[n].value,slots[n].set];},
  useRef(initial){const n=cursor++;if(!slots[n])slots[n]={kind:'ref',value:{current:initial}};return slots[n].value;},
  useCallback(fn,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))slots[n]={kind:'callback',value:fn,deps:[...deps]};return slots[n].value;},
  useEffect(setup,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){slots[n]={kind:'effect',setup,deps:[...deps],cleanup:old?.cleanup};effects.push(slots[n]);}},
 };
 const ctx={react,URL,CONFIG:{visual:{'community-video-hide-disliked':hide}},I18n:{t:x=>x},Toast:{success:x=>toasts.push(x),error:x=>toasts.push(x)},console:{error(){}},
  Utils:{getCurrentUserHash:()=> 'synthetic-hash',extractTrackId:uri=>identity.extractTrackId(uri),extractYouTubeVideoId,normalizeVideoSkipSegments:value=>value||[],
   getCommunityVideos(...args){const d=defer();const record={...d,args,settled:false};reads.push(record);maxActiveReads=Math.max(maxActiveReads,reads.filter(r=>!r.settled).length);return d.promise.finally(()=>{record.settled=true;});},
   validateYouTubeVideo(id){const d=defer();validations.push({...d,id});return d.promise;},
   submitCommunityVideo(...args){const d=defer();submissions.push({...d,args});return d.promise;},
   getSelectedVideo(...args){const d=defer();reads.push({...d,args});return d.promise;},removeSelectedVideo(...args){deleteCalls.push(args);const d=defer();deletions.push({...d,args});return d.promise;},getYouTubeVideoTitle(){throw Error('Timer helper must remain inert');},voteCommunityVideo(...args){const d=defer();votes.push({...d,args});return d.promise;},deleteCommunityVideo(...args){deleteCalls.push(args);if(syncDeleteFailure)throw Error('inert synchronous deletion failure');const d=defer();deletions.push({...d,args});return d.promise;},
  },StorageManager:{saveConfig(){}},window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),ConfirmDialog:'InertConfirm',SyncedVideoPreview:'InertPreview',SimpleVideoPreview:'InertSimplePreview',
 };
 const component=vm.runInNewContext(`${selection}\n${componentSource}\nCommunityVideoSelector;`,ctx);
 const commit=()=>{for(let i=0;i<20;i++){cursor=0;dirty=false;tree=component({trackUri:local?'spotify:local:artist:album:title:123':trackUri,currentVideoId:null,onVideoSelect:value=>selections.push(value),onClose(){}});for(const effect of effects.splice(0)){effect.cleanup?.();effect.cleanup=effect.setup();}if(!dirty){onCommit?.(tree);return tree;}}throw Error('Inert hooks failed to settle');};
 function all(node=tree){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(all);return[node,...node.children.flatMap(all)];}
 const find=className=>all().find(n=>n.props.className===className);
 const click=className=>{const n=find(className);assert.ok(n,`Visible ${className}`);assert.notEqual(n.props.disabled,true,`Enabled ${className}`);const result=n.props.onClick({stopPropagation(){}});commit();return result;};
 const beginVote=(kind='like')=>{const button=all().find(n=>n.type==='button'&&n.props.className?.startsWith(`vote-btn ${kind} `)&&!n.props.disabled);assert.ok(button);assert.notEqual(button.props.disabled,true);const result=button.props.onClick();commit();return result;};
 const typeUrl=value=>{const input=all().find(n=>n.type==='input'&&n.props.placeholder?.startsWith('https://youtube'));assert.ok(input);input.props.onChange({target:{value}});commit();};
 const readResult=async(i,videos)=>{reads[i].resolve({videos});await tick();commit();};
 const beginSubmit=(url='https://www.youtube.com/watch?v=abcdefghijk')=>{click('community-video-add-btn');typeUrl(url);click('community-video-submit-btn');};
 const acceptSubmit=async()=>{const i=validations.length-1;validations[i].resolve({valid:true,title:'Synthetic title'});await tick();commit();const j=submissions.length-1;submissions[j].resolve({data:{action:'created'}});await tick();commit();};
 const replayLoadEffect=()=>{const e=slots.find(s=>s.kind==='effect'&&String(s.setup).includes('loadVideos();'));assert.ok(e);e.cleanup?.();e.cleanup=e.setup();commit();};
 const confirm=vm.runInNewContext(`${confirmSource}\nConfirmDialog;`,{react:{createElement:react.createElement,useRef:()=>({current:null}),useEffect(){}},I18n:ctx.I18n});
 const beginDelete=()=>{click('action-btn delete');const dialog=all().find(n=>n.type==='InertConfirm');assert.equal(dialog.props.isOpen,true);const button=all(confirm(dialog.props)).find(n=>n.props.className==='confirm-dialog-btn confirm');assert.ok(button);button.props.onClick();commit();};
 const deleteButton=id=>{const item=all().find(n=>n.props.key===id);assert.ok(item);return all(item).find(n=>n.props.className==='action-btn delete');};
 const confirmDelete=()=>{const dialog=all().find(n=>n.type==='InertConfirm');assert.equal(dialog.props.isOpen,true);const n=all(confirm(dialog.props)).find(n=>n.props.className==='confirm-dialog-btn confirm');const callback=n.props.onClick;callback();commit();return callback;};
 const openDelete=id=>{const n=deleteButton(id);assert.ok(n);assert.notEqual(n.props.disabled,true);n.props.onClick({stopPropagation(){}});commit();return all().find(n=>n.type==='InertConfirm');};
 const startDelete=id=>{openDelete(id);return confirmDelete();};
 commit();return {deleteButton,startDelete,openDelete,selections,deleteCalls,reads,validations,submissions,votes,deletions,toasts,find,click,typeUrl,commit,beginSubmit,beginVote,beginDelete,acceptSubmit,readResult,replayLoadEffect,get videos(){return slots[0].value;},get maxActiveReads(){return maxActiveReads;},get titles(){return all().filter(n=>n.props.className==='community-video-title-text').flatMap(n=>n.children);}};
}

const owned=id=>({...row(id),submitterId:'synthetic-hash'});
async function start(){const h=harness();await h.readResult(0,['a','b','c'].map(owned));return h;}
async function settle(h,index,outcome='success'){if(outcome==='reject')h.deletions[index].reject(new Error('inert delete rejection'));else h.deletions[index].resolve(outcome==='null'?null:{success:true});await tick();h.commit();}
test('different pending deletions keep both rows disabled',async()=>{const h=await start();h.startDelete('a');h.startDelete('b');assert.equal(h.deletions.length,2);assert.equal(h.deleteButton('a').props.disabled,true);assert.equal(h.deleteButton('b').props.disabled,true);});
for(const first of [0,1])test(`completion ${first} cannot reopen the other pending row`,async()=>{const h=await start();h.startDelete('a');h.startDelete('b');await settle(h,first);assert.equal(h.deleteButton(first===0?'b':'a').props.disabled,true);});
test('ordinary third delete is blocked while its earlier request remains pending',async()=>{const h=await start();h.startDelete('a');h.startDelete('b');await settle(h,0);if(!h.deleteButton('b').props.disabled)h.startDelete('b');assert.equal(h.deletions.length,2);});
for(const outcome of ['null','reject'])test(`failed other row cannot reopen a pending delete (${outcome})`,async()=>{const h=await start();h.startDelete('a');h.startDelete('b');await settle(h,0,outcome);assert.equal(h.deleteButton('a').props.disabled,false);assert.equal(h.deleteButton('b').props.disabled,true);});
test('single deletion disables until success and removes only its row',async()=>{const h=await start();h.startDelete('a');assert.deepEqual(h.deletions[0].args,['a',trackUri]);assert.equal(h.deleteButton('a').props.disabled,true);await settle(h,0);assert.deepEqual(Array.from(h.videos,v=>v.id),['b','c']);assert.equal(h.deletions.length,1);});
for(const outcome of ['null','reject'])test(`a completed failed delete can be retried (${outcome})`,async()=>{const h=await start();h.startDelete('a');await settle(h,0,outcome);assert.equal(h.deleteButton('a').props.disabled,false);h.startDelete('a');assert.equal(h.deletions.length,2);});
test('other authors have no deletion button',async()=>{const h=harness();await h.readResult(0,[row('a')]);assert.equal(h.deleteButton('a'),undefined);assert.equal(h.deletions.length,0);});

test('confirmation cancel starts no deletion and leaves its row enabled',async()=>{const h=await start();const dialog=h.openDelete('a');dialog.props.onCancel();h.commit();assert.equal(h.deletions.length,0);assert.equal(h.deleteButton('a').props.disabled,false);});
test('retained same-row confirmation callback cannot dispatch twice while pending',async()=>{const h=await start();const callback=h.startDelete('a');callback();h.commit();assert.equal(h.deletions.length,1);assert.equal(h.deleteButton('a').props.disabled,true);await settle(h,0);assert.equal(h.videos.some(v=>v.id==='a'),false);});
test('synchronous provider failure releases only its row and permits another confirmation',async()=>{const h=harness({syncDeleteFailure:true});await h.readResult(0,['a','b'].map(owned));h.startDelete('a');h.commit();assert.equal(h.deleteCalls.length,1);assert.equal(h.deleteButton('a').props.disabled,false);h.startDelete('a');assert.equal(h.deleteCalls.length,2);assert.equal(h.selections.length,0);});
for(const outcome of ['success','reject'])test(`local deletion retains cleanup and admission (${outcome})`,async()=>{const h=harness({local:true});h.reads[0].resolve({youtubeVideoId:'abcdefghijk',youtubeTitle:'Local',startTime:0,skipSegments:[]});await tick();h.commit();const callback=h.startDelete('local');callback();h.commit();assert.equal(h.deletions.length,1);assert.deepEqual(h.deletions[0].args,['spotify:local:artist:album:title:123']);assert.equal(h.deleteButton('local').props.disabled,true);await settle(h,0,outcome);if(outcome==='success'){assert.equal(h.videos.length,0);assert.deepEqual(h.selections,[null]);}else{assert.equal(h.deleteButton('local').props.disabled,false);assert.equal(h.selections.length,0);h.startDelete('local');assert.equal(h.deletions.length,2);}});
