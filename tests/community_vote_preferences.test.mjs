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
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const row=(id)=>({id,youtubeVideoId:String(id).padEnd(11,'0').slice(0,11),youtubeTitle:id,score:0,likes:0,dislikes:0,userVote:null,submitterId:'other',startTime:0,skipSegments:[]});
const submittedRow=(id='newly-submitted',videoId='abcdefghijk')=>({...row(id),youtubeVideoId:videoId});
// Complete component and its actual vote/switch elements run verbatim.
// Hook scheduling, preferences, providers, persistence, and events are inert.
function harness({hide=true,random=false,onCommit=null,currentVideoId=row('b').youtubeVideoId}={}){
 const slots=[],effects=[],reads=[],validations=[],submissions=[],votes=[],deletions=[],timers=new Map(),toasts=[],selections=[],events=[],settingWrites=[];let cursor=0,dirty=false,tree,maxActiveReads=0;
 const react={
  Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const n=cursor++;if(!slots[n]){const s={kind:'state',value:typeof initial==='function'?initial():initial};s.set=next=>{const value=typeof next==='function'?next(s.value):next;if(!Object.is(value,s.value)){s.value=value;dirty=true;}};slots[n]=s;}return[slots[n].value,slots[n].set];},
  useRef(initial){const n=cursor++;if(!slots[n])slots[n]={kind:'ref',value:{current:initial}};return slots[n].value;},
  useCallback(fn,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))slots[n]={kind:'callback',value:fn,deps:[...deps]};return slots[n].value;},
  useEffect(setup,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){slots[n]={kind:'effect',setup,deps:[...deps],cleanup:old?.cleanup};effects.push(slots[n]);}},
 };
 const ctx={react,URL,CONFIG:{visual:{'community-video-hide-disliked':hide,'community-video-random':random}},I18n:{t:x=>x},Toast:{success:x=>toasts.push(x),error:x=>toasts.push(x)},console:{error(){}},
  Utils:{getCurrentUserHash:()=> 'synthetic-hash',extractTrackId:()=> 'synthetic-track',extractYouTubeVideoId,normalizeVideoSkipSegments:value=>value||[],
   getCommunityVideos(...args){const d=defer();const record={...d,args,settled:false};reads.push(record);maxActiveReads=Math.max(maxActiveReads,reads.filter(r=>!r.settled).length);return d.promise.finally(()=>{record.settled=true;});},
   validateYouTubeVideo(id){const d=defer();validations.push({...d,id});return d.promise;},
   submitCommunityVideo(...args){const d=defer();submissions.push({...d,args});return d.promise;},
   getYouTubeVideoTitle(){throw Error('Timer helper must remain inert');},voteCommunityVideo(...args){const d=defer();votes.push({...d,args});return d.promise;},deleteCommunityVideo(...args){const d=defer();deletions.push({...d,args});return d.promise;},
  },StorageManager:{saveConfig:(...args)=>settingWrites.push(args)},window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),ConfirmDialog:'InertConfirm',SyncedVideoPreview:'InertPreview',SimpleVideoPreview:'InertSimplePreview',
 };
 const component=vm.runInNewContext(`${selection}\n${componentSource}\nCommunityVideoSelector;`,ctx);
 const commit=()=>{for(let i=0;i<20;i++){cursor=0;dirty=false;tree=component({trackUri:'spotify:track:synthetic',currentVideoId,onVideoSelect:video=>{selections.push(video);},onClose(){}});for(const effect of effects.splice(0)){effect.cleanup?.();effect.cleanup=effect.setup();}if(!dirty){onCommit?.(tree);return tree;}}throw Error('Inert hooks failed to settle');};
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
 const toggle=(label,{render=true}={})=>{const button=all().find(n=>n.props['aria-labelledby']===label);assert.ok(button);assert.notEqual(button.props.disabled,true);const before=button.props['aria-checked'];const result=button.props.onClick();if(render){commit();const updated=all().find(n=>n.props['aria-labelledby']===label);assert.equal(updated.props['aria-checked'],!before);}return result;};
 commit();return {toggle,selections,events,settingWrites,reads,validations,submissions,votes,deletions,toasts,find,click,typeUrl,commit,beginSubmit,beginVote,beginDelete,acceptSubmit,readResult,replayLoadEffect,get videos(){return slots[0].value;},get maxActiveReads(){return maxActiveReads;},get titles(){return all().filter(n=>n.props.className==='community-video-title-text').map(n=>n.children);}};
}const HIDE='community-video-hide-disliked-label', RANDOM='community-video-random-label';
const hiddenEvents=h=>h.events.filter(e=>e.type==='ivLyrics:communityVideoCurrentHidden');
async function start(options){const h=harness(options);await h.readResult(0,[row('b'),row('c')]);h.beginVote('dislike');assert.equal(h.votes.length,1);return h;}
async function acknowledge(h){h.votes[0].resolve({data:{likes:0,dislikes:1,score:-1}});await tick();h.commit();assert.equal(h.videos.find(v=>v.id==='b').userVote,-1);}
function assertOutcome(h,{hide,random}){
 assert.equal(h.selections.length,hide&&!random?1:0,'selection must follow the currently displayed preference');
 assert.equal(hiddenEvents(h).length,hide&&random?1:0,'hidden event must follow the currently displayed random mode');
 if(hide&&!random)assert.equal(h.selections[0].youtubeVideoId,row('c').youtubeVideoId);
 if(hide&&random)assert.equal(hiddenEvents(h)[0].detail.videoId,row('b').youtubeVideoId);
 assert.deepEqual(Array.from(h.titles.flat()).sort(),hide?['c']:['b','c']);
 assert.equal(h.votes.length,1);assert.equal(h.reads.length,1);
}
for(const random of [false,true])for(const initialHide of [false,true])test(`hide ${initialHide?'on to off':'off to on'} before acknowledgment with random=${random}`,async()=>{
 const h=await start({hide:initialHide,random});await h.toggle(HIDE);assert.equal(h.selections.length,0);assert.equal(hiddenEvents(h).length,0);await acknowledge(h);assertOutcome(h,{hide:!initialHide,random});assert.equal(h.settingWrites.length,1);
});
for(const initialRandom of [false,true])test(`random ${initialRandom?'on to off':'off to on'} before acknowledgment`,async()=>{
 const h=await start({hide:true,random:initialRandom});h.toggle(RANDOM);await acknowledge(h);assertOutcome(h,{hide:true,random:!initialRandom});assert.equal(h.settingWrites.length,1);
});
for(const hide of [false,true])for(const random of [false,true])test(`unchanged preference control hide=${hide} random=${random}`,async()=>{
 const h=await start({hide,random});await acknowledge(h);assertOutcome(h,{hide,random});assert.equal(h.settingWrites.length,0);
});
for(const label of [HIDE,RANDOM])test(`preference round trip retains the final initial value for ${label}`,async()=>{
 const h=await start({hide:true,random:false});await h.toggle(label);await h.toggle(label);await acknowledge(h);assertOutcome(h,{hide:true,random:false});assert.equal(h.settingWrites.length,2);
});
for(const outcome of ['null','reject'])test(`preference edit does not invent a replacement after ${outcome} vote`,async()=>{
 const h=await start({hide:false,random:false});await h.toggle(HIDE);h.toggle(RANDOM);
 if(outcome==='null')h.votes[0].resolve(null);else h.votes[0].reject(new Error('Inert rejected acknowledgment'));
 await tick();h.commit();assert.equal(h.selections.length,0);assert.equal(hiddenEvents(h).length,0);assert.equal(h.videos.find(v=>v.id==='b').userVote,null);
 assert.deepEqual(Array.from(h.titles.flat()).sort(),['b','c']);assert.equal(h.settingWrites.length,2);
});

for(const initialHide of [false,true])test(`accepted hide switch is visible before its next render (${initialHide})`,async()=>{
 const h=await start({hide:initialHide,random:false});h.toggle(HIDE,{render:false});await acknowledge(h);assertOutcome(h,{hide:!initialHide,random:false});
});
for(const initialRandom of [false,true])test(`accepted random switch is visible before its next render (${initialRandom})`,async()=>{
 const h=await start({hide:true,random:initialRandom});h.toggle(RANDOM,{render:false});await acknowledge(h);assertOutcome(h,{hide:true,random:!initialRandom});
});
for(const hide of [false,true])for(const random of [false,true])test(`both preference changes compose before acknowledgment (${hide}/${random})`,async()=>{
 const h=await start({hide,random});h.toggle(RANDOM);await h.toggle(HIDE);await acknowledge(h);assertOutcome(h,{hide:!hide,random:!random});assert.equal(h.settingWrites.length,2);
});
for(const random of [false,true])test(`unrelated current video remains untouched after preference change (random=${random})`,async()=>{
 const h=await start({hide:false,random,currentVideoId:row('unrelated').youtubeVideoId});await h.toggle(HIDE);await acknowledge(h);assert.equal(h.selections.length,0);assert.equal(hiddenEvents(h).length,0);assert.deepEqual(Array.from(h.titles.flat()),['c']);
});
test('a like acknowledgment does not replace after both preferences change',async()=>{
 const h=harness({hide:false,random:false});await h.readResult(0,[row('b'),row('c')]);h.beginVote('like');await h.toggle(HIDE);h.toggle(RANDOM);h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();assert.equal(h.videos.find(v=>v.id==='b').userVote,1);assert.equal(h.selections.length,0);assert.equal(hiddenEvents(h).length,0);assert.equal(h.votes.length,1);
});
