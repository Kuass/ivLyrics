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
// The URL parser and complete parent component run verbatim. Debounced title
// timers stay inert, modeling a permitted immediate submit after a pasted URL.
function harness({hide=true,onCommit=null}={}){
 const slots=[],effects=[],reads=[],validations=[],submissions=[],votes=[],deletions=[],timers=new Map(),toasts=[];let cursor=0,dirty=false,tree,maxActiveReads=0;
 const react={
  Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),
  useState(initial){const n=cursor++;if(!slots[n]){const s={kind:'state',value:typeof initial==='function'?initial():initial};s.set=next=>{const value=typeof next==='function'?next(s.value):next;if(!Object.is(value,s.value)){s.value=value;dirty=true;}};slots[n]=s;}return[slots[n].value,slots[n].set];},
  useRef(initial){const n=cursor++;if(!slots[n])slots[n]={kind:'ref',value:{current:initial}};return slots[n].value;},
  useCallback(fn,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i])))slots[n]={kind:'callback',value:fn,deps:[...deps]};return slots[n].value;},
  useEffect(setup,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){slots[n]={kind:'effect',setup,deps:[...deps],cleanup:old?.cleanup};effects.push(slots[n]);}},
 };
 const ctx={react,URL,CONFIG:{visual:{'community-video-hide-disliked':hide}},I18n:{t:x=>x},Toast:{success:x=>toasts.push(x),error:x=>toasts.push(x)},console:{error(){}},
  Utils:{getCurrentUserHash:()=> 'synthetic-hash',extractTrackId:()=> 'synthetic-track',extractYouTubeVideoId,normalizeVideoSkipSegments:value=>value||[],
   getCommunityVideos(...args){const d=defer();const record={...d,args,settled:false};reads.push(record);maxActiveReads=Math.max(maxActiveReads,reads.filter(r=>!r.settled).length);return d.promise.finally(()=>{record.settled=true;});},
   validateYouTubeVideo(id){const d=defer();validations.push({...d,id});return d.promise;},
   submitCommunityVideo(...args){const d=defer();submissions.push({...d,args});return d.promise;},
   getYouTubeVideoTitle(){throw Error('Timer helper must remain inert');},voteCommunityVideo(...args){const d=defer();votes.push({...d,args});return d.promise;},deleteCommunityVideo(...args){const d=defer();deletions.push({...d,args});return d.promise;},
  },StorageManager:{saveConfig(){}},window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),ConfirmDialog:'InertConfirm',SyncedVideoPreview:'InertPreview',SimpleVideoPreview:'InertSimplePreview',
 };
 const component=vm.runInNewContext(`${selection}\n${componentSource}\nCommunityVideoSelector;`,ctx);
 const commit=()=>{for(let i=0;i<20;i++){cursor=0;dirty=false;tree=component({trackUri:'spotify:track:synthetic',currentVideoId:null,onVideoSelect(){throw Error('Selection outside read assessment');},onClose(){}});for(const effect of effects.splice(0)){effect.cleanup?.();effect.cleanup=effect.setup();}if(!dirty){onCommit?.(tree);return tree;}}throw Error('Inert hooks failed to settle');};
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
 commit();return {reads,validations,submissions,votes,deletions,toasts,find,click,typeUrl,commit,beginSubmit,beginVote,beginDelete,acceptSubmit,readResult,replayLoadEffect,get videos(){return slots[0].value;},get maxActiveReads(){return maxActiveReads;},get titles(){return all().filter(n=>n.props.className==='community-video-title-text').flatMap(n=>n.children);}};
}
test('initial pending read omits ordinary add and submit controls',()=>{const h=harness();assert.equal(h.reads.length,1);assert.ok(h.find('community-video-loading'));assert.equal(h.find('community-video-add-btn'),undefined);assert.equal(h.find('community-video-submit-btn'),undefined);});
test('unrelated preference rerenders do not start another effect read',async()=>{const h=harness();const current=h.reads.length;h.click('community-video-random-switch');h.click('community-video-random-switch');assert.equal(h.reads.length,current);await h.readResult(0,[]);h.commit();assert.equal(h.reads.length,1);assert.ok(h.find('community-video-add-btn'));});
test('accepted ordinary submission starts one refresh and hides further submit controls',async()=>{const h=harness();await h.readResult(0,[]);h.beginSubmit();assert.equal(h.find('community-video-submit-btn').props.disabled,true);await h.acceptSubmit();assert.equal(h.reads.length,2);assert.equal(h.maxActiveReads,1);assert.ok(h.find('community-video-loading'));assert.equal(h.find('community-video-add-btn'),undefined);assert.equal(h.find('community-video-submit-btn'),undefined);await h.readResult(1,[row('new')]);assert.ok(h.find('community-video-add-btn'));});
test('cancel and reopen while submitting preserves disabled submit admission',async()=>{const h=harness();await h.readResult(0,[]);h.beginSubmit();h.click('community-video-add-btn');h.click('community-video-add-btn');h.typeUrl('https://youtu.be/lmnopqrstuv');assert.equal(h.find('community-video-submit-btn').props.disabled,true);assert.equal(h.validations.length,1);await h.acceptSubmit();assert.equal(h.reads.length,2);assert.equal(h.maxActiveReads,1);});
test('three ordinary accepted submissions remain serial across completed reads',async()=>{const h=harness();await h.readResult(0,[]);for(let i=0;i<3;i++){h.beginSubmit();await h.acceptSubmit();assert.equal(h.reads.length,i+2);await h.readResult(i+1,[row(`new-${i}`)]);}assert.equal(h.maxActiveReads,1);assert.equal(h.submissions.length,3);});
test('invalid video validation starts no refresh',async()=>{const h=harness();await h.readResult(0,[]);h.beginSubmit();h.validations[0].resolve({valid:false,error:'notFound'});await tick();h.commit();assert.equal(h.reads.length,1);assert.equal(h.submissions.length,0);assert.equal(h.find('community-video-submit-btn').props.disabled,false);});
test('failed ordinary submission starts no refresh',async()=>{const h=harness();await h.readResult(0,[]);h.beginSubmit();h.validations[0].resolve({valid:true,title:'Synthetic'});await tick();h.submissions[0].reject(new Error('Synthetic rejected submit'));await tick();h.commit();assert.equal(h.reads.length,1);assert.equal(h.find('community-video-submit-btn').props.disabled,false);});
test('initial read error exposes no ordinary reload or submission control',async()=>{const h=harness();h.reads[0].reject(new Error('Synthetic read error'));await tick();h.commit();assert.ok(h.find('community-video-error'));assert.equal(h.find('community-video-add-btn'),undefined);assert.equal(h.find('community-video-submit-btn'),undefined);assert.equal(h.reads.length,1);});
for (const kind of ['like','dislike']) test(`ordinary pending ${kind} survives the accepted Add read while retaining its new row`,async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote(kind);
 assert.equal(h.votes.length,1);assert.equal(h.votes[0].args[0],'b');assert.ok(h.find('community-video-add-btn'));
 h.beginSubmit();await h.acceptSubmit();assert.equal(h.reads.length,2);assert.equal(h.reads[1].settled,false);
 const value=kind==='like'?1:-1;
 h.votes[0].resolve({data:{likes:value===1?1:0,dislikes:value===-1?1:0,score:value}});await tick();h.commit();
 assert.equal(h.videos.find(v=>v.id==='b').userVote,value);
 // The already-started read contains the new submitted row and a pre-vote B snapshot.
 await h.readResult(1,[row('b'),submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,value);
 assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);
 assert.equal(h.titles.includes('newly-submitted'),true);
 assert.equal(h.titles.includes('b'),kind==='like');
 assert.equal(h.maxActiveReads,1);assert.equal(h.votes.length,1);assert.equal(h.submissions.length,1);
});
test('read before vote completion preserves newly submitted row and later vote',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 await h.readResult(1,[row('b'),submittedRow()]);
 h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();
 assert.equal(h.videos.find(v=>v.id==='b').userVote,1);assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);
});
test('vote completed before submission read preserves current server snapshot',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();
 h.beginSubmit();await h.acceptSubmit();await h.readResult(1,[{...row('b'),userVote:1,likes:1,score:1},submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,1);assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);
});
test('null pending vote preserves submitted read without an acknowledged vote',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].resolve(null);await tick();h.commit();await h.readResult(1,[row('b'),submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,null);assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);
});
for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])test(`three accepted votes survive the read in completion order ${order}`,async()=>{
 const h=harness();await h.readResult(0,['a','b','c'].map(row));
 for(let i=0;i<3;i++)h.beginVote();h.beginSubmit();await h.acceptSubmit();
 for(const index of order){h.votes[index].resolve({data:{likes:index+1,dislikes:0,score:index+1}});await tick();h.commit();}
 await h.readResult(1,[...['a','b','c'].map(row),submittedRow()]);
 for(const [index,id]of ['a','b','c'].entries()){const video=h.videos.find(v=>v.id===id);assert.equal(video.likes,index+1);assert.equal(video.userVote,1);}
 assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);assert.equal(h.votes.length,3);assert.equal(h.reads.length,2);assert.equal(h.maxActiveReads,1);
});
for(const order of [[0,1],[1,0]])test(`acknowledged cancellation remains explicit alongside another vote (${order})`,async()=>{
 const h=harness({hide:false}),b={...row('b'),userVote:-1,dislikes:1,score:-1};await h.readResult(0,[b,row('c')]);
 h.beginVote('dislike');h.beginVote('like');assert.equal(h.votes[0].args[1],0);h.beginSubmit();await h.acceptSubmit();
 for(const index of order){h.votes[index].resolve({data:index===0?{likes:0,dislikes:0,score:0}:{likes:2,dislikes:0,score:2}});await tick();h.commit();}
 await h.readResult(1,[b,row('c'),submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,null);assert.equal(h.videos.find(v=>v.id==='b').dislikes,0);
 assert.equal(h.videos.find(v=>v.id==='c').userVote,1);assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);assert.equal(h.votes.length,2);
});
test('reapplication preserves read metadata and the counts observed at acknowledgment',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 const data={likes:4,dislikes:1,score:3};h.votes[0].resolve({data});await tick();h.commit();Object.assign(data,{likes:999,score:999});
 await h.readResult(1,[{...row('b'),youtubeTitle:'Updated server title',startTime:7,skipSegments:[{start:1,end:2}]},submittedRow()]);
 const b=h.videos.find(v=>v.id==='b');assert.equal(b.likes,4);assert.equal(b.dislikes,1);assert.equal(b.score,3);assert.equal(b.youtubeTitle,'Updated server title');assert.equal(b.startTime,7);assert.deepEqual(b.skipSegments,[{start:1,end:2}]);
});
test('a rejected vote does not override the later read',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].reject(new Error('Inert vote-helper rejection'));await tick();h.commit();
 await h.readResult(1,[{...row('b'),userVote:1,likes:8,score:8},submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').likes,8);assert.equal(h.videos.some(v=>v.id==='newly-submitted'),true);
});
test('an acknowledged delete removes its row from the submitted read without dropping the new row',async()=>{
 const h=harness(),owned={...row('b'),submitterId:'synthetic-hash'};await h.readResult(0,[owned]);h.beginDelete();
 assert.equal(h.deletions.length,1);assert.ok(h.find('community-video-add-btn'));h.beginSubmit();await h.acceptSubmit();
 h.deletions[0].resolve({success:true});await tick();h.commit();assert.equal(h.videos.length,0);
 await h.readResult(1,[owned,submittedRow()]);assert.deepEqual(Array.from(h.videos,v=>v.id),['newly-submitted']);
 assert.equal(h.deletions.length,1);assert.equal(h.submissions.length,1);assert.equal(h.toasts.filter(value=>value==='communityVideo.deleted').length,1);
});
for(const outcome of ['null','reject'])test(`a ${outcome} delete leaves returned rows intact`,async()=>{
 const h=harness(),owned={...row('b'),submitterId:'synthetic-hash'};await h.readResult(0,[owned]);h.beginDelete();h.beginSubmit();await h.acceptSubmit();
 if(outcome==='null')h.deletions[0].resolve(null);else h.deletions[0].reject(new Error('Inert delete-helper rejection'));
 await tick();h.commit();await h.readResult(1,[owned,submittedRow()]);assert.deepEqual(Array.from(h.videos,v=>v.id),['b','newly-submitted']);
});
test('a subsequent ordinary read does not retain mutations from a completed read',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();await h.readResult(1,[row('b'),submittedRow()]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,1);
 h.beginSubmit('https://youtu.be/lmnopqrstuv');await h.acceptSubmit();
 await h.readResult(2,[row('b'),submittedRow(),submittedRow('next-submitted','lmnopqrstuv')]);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,null);assert.equal(h.videos.some(v=>v.id==='next-submitted'),true);assert.equal(h.maxActiveReads,1);
});
test('an incoming list that omits the voted target does not have that row reinserted',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();await h.readResult(1,[submittedRow()]);
 assert.deepEqual(Array.from(h.videos,v=>v.id),['newly-submitted']);
});
test('helper rejection preserves accepted local data and ends loading',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();
 h.reads[1].reject(new Error('Inert read-helper rejection'));await tick();h.commit();
 assert.equal(h.videos.find(v=>v.id==='b').userVote,1);assert.ok(h.find('community-video-error'));assert.equal(h.find('community-video-loading'),undefined);
});
test('an empty successful read retains membership semantics after a local vote',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 h.votes[0].resolve({data:{likes:1,dislikes:0,score:1}});await tick();h.commit();await h.readResult(1,[]);
 assert.equal(h.videos.length,0);assert.ok(h.find('community-video-empty'));
});
test('read reconciliation leaves the supplied read and acknowledgment objects unchanged',async()=>{
 const h=harness();await h.readResult(0,[row('b')]);h.beginVote();h.beginSubmit();await h.acceptSubmit();
 const data=Object.freeze({likes:2,dislikes:0,score:2});h.votes[0].resolve({data});await tick();h.commit();
 const incoming=Object.freeze([Object.freeze(row('b')),Object.freeze(submittedRow())]);const before=JSON.stringify(incoming);
 await h.readResult(1,incoming);assert.equal(JSON.stringify(incoming),before);assert.equal(data.likes,2);assert.equal(h.videos.find(v=>v.id==='b').likes,2);
});
