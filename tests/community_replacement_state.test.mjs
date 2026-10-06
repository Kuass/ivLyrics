import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
const file = process.env.IVLYRICS_SOURCE_ROOT
  ? resolve(process.env.IVLYRICS_SOURCE_ROOT, 'CommunityVideoSelector.js')
  : new URL('../CommunityVideoSelector.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const cut = (start, end) => { const a=source.indexOf(start), b=source.indexOf(end,a); assert.ok(a>=0&&b>a); return source.slice(a,b); };
const selection = cut('const COMMUNITY_VIDEO_MAX_START_TIME_SECONDS','// 현재 음악 재생 시간에 맞춰');
const setup = cut('const CommunityVideoSelector = ({', '  // 현재 사용자 해시 ID');
const replacement = cut('  const replaceHiddenCurrentVideo =','\n  const toggleHideDislikedVideos');
const toggle = cut('  const toggleHideDislikedVideos =','\n  const resetSubmitForm');
const vote = cut('  const handleVote = async','\n  const applyVideoSelection');
const load = cut('  const loadVideos = useCallback(','\n  useEffect(() => {\n    loadVideos();');
const deletion = cut('  const executeDelete = async','\n  // 영상 미리보기 토글');
const rows = () => ['a','b','c'].map(id=>({id,youtubeVideoId:id,youtubeTitle:id,score:0,likes:0,dislikes:0,userVote:null,startTime:0,skipSegments:[]}));
const tick = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function deferred() { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; }
// All state/ref/callback initializers and list publishers are actual component
// source. The hook scheduler, providers, storage and event target are inert.
function harness({initial=rows(),queue=false,random=false,selectWait=false,local=false,hide=true}={}) {
  const slots=[],updates=[],requests=[],loads=[],deletes=[],selected=[],events=[],errors=[],preferences=[];
  const selectGate=deferred(); let cursor=0,publishHook=null,rendered;
  const onVideoSelect=async info=>{selected.push(info); if(selectWait)await selectGate.promise;};
  const react={
    useState(initialValue){
      const index=cursor++;
      if(!slots[index]) {
        const slot={kind:'state',value:typeof initialValue==='function'?initialValue():initialValue};
        slot.set=value=>{
          if(index===0&&queue)updates.push(value);
          else slot.value=typeof value==='function'?value(slot.value):value;
          if(index===0&&publishHook){const hook=publishHook;publishHook=null;hook();}
        };
        slots[index]=slot;
      }
      assert.equal(slots[index].kind,'state');return[slots[index].value,slots[index].set];
    },
    useRef(initialValue){const index=cursor++;if(!slots[index])slots[index]={kind:'ref',value:{current:initialValue}};assert.equal(slots[index].kind,'ref');return slots[index].value;},
    useCallback(callback,deps){const index=cursor++,old=slots[index];if(!old||old.deps.length!==deps.length||deps.some((dep,i)=>!Object.is(dep,old.deps[i])))slots[index]={kind:'callback',value:callback,deps:[...deps]};return slots[index].value;},
  };
  const ctx={react,CONFIG:{visual:{'community-video-random':random,'community-video-hide-disliked':hide}},currentUserHash:'synthetic',isLocalVideoMode:local,
    console:{error(...args){errors.push(args);}},Toast:{success(){},error(){}},I18n:{t:x=>x},
    StorageManager:{saveConfig:(...args)=>preferences.push(args)},
    window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},
    closeDeleteConfirm(){},
    Utils:{normalizeVideoSkipSegments:value=>value||[],
      voteCommunityVideo(id,type){const d=deferred();requests.push({id,type,...d});return d.promise;},
      getCommunityVideos(){const d=deferred();loads.push(d);return d.promise;},
      getSelectedVideo(){const d=deferred();loads.push(d);return d.promise;},
      deleteCommunityVideo(id){const d=deferred();deletes.push({id,...d});return d.promise;},
      removeSelectedVideo(track){const d=deferred();deletes.push({id:track,...d});return d.promise;},
    },
  };
  const component=vm.runInNewContext(`${selection}\n${setup}\n${load}\n${replacement}\n${toggle}\n${vote}\n${deletion}\nreturn {handleVote,loadVideos,executeDelete,toggleHideDislikedVideos,setVideos,videos,pendingVotesRef,setDeleteConfirmId,setPreviewVideoId};\n};\nCommunityVideoSelector;`,ctx);
  const render=({deleteId=null,current='a'}={})=>{
    cursor=0;rendered=component({trackUri:'spotify:track:synthetic',currentVideoId:current,onVideoSelect});
    if(deleteId!==null){rendered.setDeleteConfirmId(deleteId);cursor=0;rendered=component({trackUri:'spotify:track:synthetic',currentVideoId:current,onVideoSelect});}
    return rendered;
  };
  const flush=()=>{for(const value of updates.splice(0))slots[0].value=typeof value==='function'?value(slots[0].value):value;};
  render().setVideos(initial);flush();render();
  const settle=async(i,{score=-1,likes=0,dislikes=1}={})=>{requests[i].resolve({data:{score,likes,dislikes}});await tick();};
  return {render,settle,flush,requests,loads,deletes,selected,events,errors,preferences,selectGate,
    publish:value=>rendered.setVideos(value),setPublishHook(fn){publishHook=fn;},get videos(){return slots[0].value;},get pendingVotesRef(){return rendered.pendingVotesRef;},get updates(){return updates;}};
}
const selected = h => h.selected.map(v=>v?.youtubeVideoId ?? null);
test('completed overlapping dislike excludes B when hiding current A',async()=>{
 const h=harness(); const fn=h.render().handleVote;fn('b',null,-1);fn('a',null,-1);await h.settle(0);await h.settle(1);assert.deepEqual(selected(h),['c']);
});
test('acknowledged cancellation makes captured disliked B eligible again',async()=>{
 const initial=rows();initial[1]={...initial[1],userVote:-1,score:8};
 const h=harness({initial});const fn=h.render().handleVote;fn('b',-1,-1);fn('a',null,-1);await h.settle(0,{score:10,likes:10,dislikes:0});await h.settle(1);assert.equal(h.requests[0].type,0);assert.deepEqual(selected(h),['b']);
});
test('failed dislike leaves B eligible',async()=>{
 const h=harness();const fn=h.render().handleVote;fn('b',null,-1);fn('a',null,-1);h.requests[0].reject(new Error('inert failure'));await tick();await h.settle(1);assert.deepEqual(selected(h),['b']);assert.equal(h.errors.length,1);
});
test('null vote result leaves B eligible',async()=>{
 const h=harness();const fn=h.render().handleVote;fn('b',null,-1);fn('a',null,-1);h.requests[0].resolve(null);await tick();await h.settle(1);assert.deepEqual(selected(h),['b']);
});
test('queued React publication retains completed B acknowledgment across request groups',async()=>{
 const h=harness({queue:true});const fn=h.render().handleVote;fn('b',null,-1);await h.settle(0);assert.equal(h.pendingVotesRef.current.size,0);fn('a',null,-1);await h.settle(1);assert.deepEqual(selected(h),['c']);h.flush();assert.equal(h.videos.find(v=>v.id==='b').userVote,-1);
});
test('acknowledged actual delete excludes B from pending A replacement',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render({deleteId:'b'}).executeDelete();h.deletes[0].resolve({success:true});await tick();await h.settle(0);assert.deepEqual(selected(h),['c']);assert.deepEqual(Array.from(h.videos,v=>v.id).sort(),['a','c']);
});
test('accepted refresh order and metadata reach replacement selection',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render().loadVideos(true);
 const refreshed=rows().map(v=>v.id==='c'?{...v,score:20,youtubeTitle:'Current C',startTime:7}:v);
 h.loads[0].resolve({videos:refreshed});await tick();await h.settle(0);assert.deepEqual(selected(h),['c']);assert.equal(h.selected[0].youtubeTitle,'Current C');assert.equal(h.selected[0].captionStartTime,7);
});
test('accepted list removal of every candidate produces null replacement',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render().loadVideos(true);h.loads[0].resolve({videos:[rows()[0]]});await tick();await h.settle(0);assert.deepEqual(selected(h),[null]);
});
test('reentrant publication sees latest accepted list before React commits',async()=>{
 const h=harness({queue:true});const fn=h.render().handleVote;fn('b',null,-1);h.setPublishHook(()=>fn('a',null,-1));await h.settle(0);assert.equal(h.requests.length,2);await h.settle(1);assert.deepEqual(selected(h),['c']);
});
test('queued list updates preserve both votes and have no side effects when replayed',async()=>{
 const h=harness({queue:true});const fn=h.render().handleVote;fn('b',null,1);fn('c',null,1);await h.settle(0,{score:1,likes:1,dislikes:0});await h.settle(1,{score:2,likes:2,dislikes:0});
 const queued=h.updates.slice();let replay=rows();for(let round=0;round<2;round++)for(const v of queued)replay=typeof v==='function'?v(replay):v;
 h.flush();assert.equal(h.videos.find(v=>v.id==='b').userVote,1);assert.equal(h.videos.find(v=>v.id==='c').userVote,1);assert.equal(h.requests.length,2);assert.equal(h.selected.length,0);assert.deepEqual(JSON.parse(JSON.stringify(replay)),JSON.parse(JSON.stringify(h.videos)));
});
test('replacement await retains same-row admission until completion',async()=>{
 const h=harness({selectWait:true});const fn=h.render().handleVote;fn('a',null,-1);await h.settle(0);assert.equal(h.pendingVotesRef.current.has('a'),true);fn('a',-1,-1);assert.equal(h.requests.length,1);h.selectGate.resolve();await tick();assert.equal(h.pendingVotesRef.current.has('a'),false);
});
test('random mode retains the event route without direct selection',async()=>{
 const h=harness({random:true});h.render().handleVote('a',null,-1);await h.settle(0);assert.equal(h.selected.length,0);assert.equal(h.events.length,1);assert.equal(h.events[0].type,'ivLyrics:communityVideoCurrentHidden');assert.equal(h.events[0].detail.videoId,'a');
});
test('accepted list updater preserves previous immutable snapshot',async()=>{
 const initial=rows();const before=JSON.stringify(initial);const h=harness({initial});h.render().handleVote('b',null,1);await h.settle(0,{score:1,likes:1,dislikes:0});assert.equal(JSON.stringify(initial),before);assert.notEqual(h.videos,initial);
});
test('a lagging rerender cannot reset the latest accepted list',async()=>{
 const h=harness({queue:true});h.render().handleVote('b',null,-1);await h.settle(0);
 assert.equal(h.videos.find(v=>v.id==='b').userVote,null);
 h.render().handleVote('a',null,-1);await h.settle(1);assert.deepEqual(selected(h),['c']);
 h.flush();assert.equal(h.videos.find(v=>v.id==='b').userVote,-1);
});
test('nested list publication stays current after the outer publisher returns',async()=>{
 const h=harness({queue:true});h.render().handleVote('a',null,-1);
 h.setPublishHook(()=>h.publish([rows()[2]]));h.publish(rows().slice(0,2));
 await h.settle(0);assert.deepEqual(selected(h),['c']);h.flush();assert.deepEqual(Array.from(h.videos,v=>v.id),['c']);
});
test('the latest list is visible to a reentrant hide action before React publication returns',async()=>{
 const h=harness({queue:true,hide:false}),frame=h.render({current:'b'});
 frame.handleVote('b',null,-1);h.setPublishHook(()=>frame.toggleHideDislikedVideos());await h.settle(0);
 assert.deepEqual(selected(h),['a']);assert.equal(h.preferences.length,1);
});
test('hide-disliked toggle uses acknowledged votes before their queued render',async()=>{
 const h=harness({queue:true,hide:false}),frame=h.render();
 frame.handleVote('b',null,-1);await h.settle(0);frame.handleVote('a',null,-1);await h.settle(1);
 await frame.toggleHideDislikedVideos();assert.deepEqual(selected(h),['c']);
});
test('hide-disliked toggle uses accepted removals rather than its older rendered candidates',async()=>{
 const initial=rows();initial[0]={...initial[0],userVote:-1};
 const h=harness({initial,queue:true,hide:false}),frame=h.render();h.publish([initial[0],initial[2]]);
 await frame.toggleHideDislikedVideos();assert.deepEqual(selected(h),['c']);
});
test('the acknowledged voted entry keeps its identity after its row is removed',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render().loadVideos(true);
 h.loads[0].resolve({videos:[rows()[2]]});await tick();await h.settle(0);assert.deepEqual(selected(h),['c']);
});
test('an accepted empty community response produces no replacement candidate',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render().loadVideos(true);
 h.loads[0].resolve(null);await tick();await h.settle(0);assert.deepEqual(selected(h),[null]);
});
test('a failed community load leaves the accepted list available for replacement',async()=>{
 const h=harness();h.render().handleVote('a',null,-1);h.render().loadVideos(true);
 h.loads[0].reject(new Error('Inert load failure'));await tick();await h.settle(0);assert.deepEqual(selected(h),['b']);
});
test('a throwing pure updater leaves the accepted list unchanged',async()=>{
 const h=harness(),failure=new Error('Inert updater failure');
 assert.throws(()=>h.publish(()=>{throw failure;}),error=>error===failure);
 h.render().handleVote('a',null,-1);await h.settle(0);assert.deepEqual(selected(h),['b']);
});
test('instance-local publications cannot alter another selector candidate list',async()=>{
 const a=harness(),b=harness();a.render().handleVote('b',null,-1);await a.settle(0);
 b.render().handleVote('a',null,-1);await b.settle(0);assert.deepEqual(selected(b),['b']);
});
test('a failed replacement releases only the completed row',async()=>{
 const h=harness({selectWait:true});h.render().handleVote('a',null,-1);h.render().handleVote('b',null,1);
 await h.settle(0);assert.equal(h.pendingVotesRef.current.has('a'),true);
 h.selectGate.reject(new Error('Inert selection failure'));await tick();
 assert.equal(h.pendingVotesRef.current.has('a'),false);assert.equal(h.pendingVotesRef.current.has('b'),true);assert.equal(h.errors.length,1);
 await h.settle(1,{score:1,likes:1,dislikes:0});assert.equal(h.pendingVotesRef.current.size,0);
});
test('local list reads and removal retain their existing publication and selection behavior',async()=>{
 const h=harness({local:true,queue:true,initial:[]});h.render().loadVideos();
 h.loads[0].resolve({youtubeVideoId:'local-fixture',youtubeTitle:'Local title',captionStartTime:8,skipSegments:[{start:1,end:2}]});await tick();h.flush();
 assert.equal(h.videos[0].id,'local');assert.equal(h.videos[0].youtubeTitle,'Local title');assert.equal(h.videos[0].startTime,8);assert.equal(h.videos[0].isLocalOnly,true);
 h.render({deleteId:'local'}).executeDelete();h.deletes[0].resolve();await tick();h.flush();
 assert.equal(h.videos.length,0);assert.deepEqual(selected(h),[null]);assert.equal(h.requests.length,0);
});
test('missing local selection publishes an empty list',async()=>{
 const h=harness({local:true,queue:true,initial:[{...rows()[0],id:'local',isLocalOnly:true}]});h.render().loadVideos();h.loads[0].resolve(null);await tick();h.flush();assert.equal(h.videos.length,0);
});
