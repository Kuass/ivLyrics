import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { resolve } from 'node:path';
const file = process.env.IVLYRICS_SOURCE_ROOT
  ? resolve(process.env.IVLYRICS_SOURCE_ROOT, 'CommunityVideoSelector.js')
  : new URL('../CommunityVideoSelector.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const cut = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a,b); };
const vote = cut('  const handleVote = async', '\n  const applyVideoSelection');
const actions = cut('  const renderVideoActions =', '\n  const renderVideoListItem');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const initial = () => ['a','b','c'].map(id => ({id, youtubeVideoId:id, youtubeTitle:id, likes:0, dislikes:0, score:0, userVote:null}));
// The real handler and button factory run with inert React/provider boundaries.
// Functional setters can be queued to model React batching without executing React.
function harness(options = {}) {
  const state = {videos:initial(), votingId:null, preview:options.preview ?? null};
  const requests=[], errors=[], replacements=[], updates=[];
  const apply = value => { state.videos = typeof value === 'function' ? value(state.videos) : value; };
  const render = () => {
    const ctx = { videos:state.videos, votingId:state.votingId, isLocalVideoMode:options.local ?? false,
      trackUri:'spotify:track:fixture', hideDislikedVideos:options.hide ?? true, previewVideoId:state.preview, deletingId:null, currentUserHash:'other',
      setVideos(value) { updates.push(value); if (!options.queued) apply(value); },
      setVotingId(value) { state.votingId = value; }, setPreviewVideoId(value) { state.preview = value; },
      replaceHiddenCurrentVideo: async (...args) => replacements.push(args),
      Utils:{voteCommunityVideo(...args) {const d=deferred();requests.push({...d,args});return d.promise;}},
      console:{error:(...args)=>errors.push(args)}, I18n:{t:x=>x},
      react:{createElement:(type,props,...children)=>({type,props:props||{},children})},
      togglePreview(){},handleApply(){},handleEdit(){},showDeleteConfirm(){},
    };
    return vm.runInNewContext(`${vote}\n${actions}\n({handleVote,renderVideoActions})`,ctx);
  };
  const settle = async (i,likes=1,dislikes=0) => { requests[i].resolve({data:{likes,dislikes,score:likes-dislikes}}); await new Promise(r=>setImmediate(r)); };
  const button = (rendered,id) => rendered.renderVideoActions(state.videos.find(v=>v.id===id)).children.find(x=>x?.props?.className?.startsWith('vote-btn like'));
  const flushUpdates = () => { for (const value of updates.splice(0)) apply(value); };
  return {state,requests,errors,replacements,updates,render,settle,button,flushUpdates};
}
for (const order of [[0,1],[1,0]]) test(`independent votes survive completion order ${order}`,async()=>{
  const h=harness(); let r=h.render(); const first=h.button(r,'a'); assert.equal(first.props.disabled,false); first.props.onClick();
  r=h.render(); assert.equal(h.button(r,'a').props.disabled,true); const second=h.button(r,'b'); assert.equal(second.props.disabled,false); second.props.onClick();
  await h.settle(order[0]); await h.settle(order[1]);
  assert.equal(h.state.videos.find(v=>v.id==='a').userVote,1);
  assert.equal(h.state.videos.find(v=>v.id==='b').userVote,1);
});
test('vote completion preserves a later removal',async()=>{const h=harness();h.button(h.render(),'a').props.onClick();h.state.videos=h.state.videos.filter(v=>v.id!=='b');await h.settle(0);assert.equal(h.state.videos.some(v=>v.id==='b'),false);});
test('vote completion preserves later metadata',async()=>{const h=harness();h.button(h.render(),'a').props.onClick();h.state.videos=h.state.videos.map(v=>v.id==='a'?{...v,youtubeTitle:'updated'}:v);await h.settle(0);assert.equal(h.state.videos.find(v=>v.id==='a').youtubeTitle,'updated');});
test('single vote sets and sorts response counts',async()=>{const h=harness();h.button(h.render(),'b').props.onClick();await h.settle(0,3);assert.equal(h.state.videos[0].id,'b');assert.equal(h.state.videos[0].likes,3);assert.equal(h.state.votingId,null);});
test('serial votes after render preserve both responses',async()=>{const h=harness();h.button(h.render(),'a').props.onClick();await h.settle(0);h.button(h.render(),'b').props.onClick();await h.settle(1);assert.equal(h.state.videos.filter(v=>v.userVote===1).length,2);});
test('null result leaves list untouched',async()=>{const h=harness();const old=h.state.videos;h.button(h.render(),'a').props.onClick();h.requests[0].resolve(null);await new Promise(r=>setImmediate(r));assert.equal(h.state.videos,old);assert.equal(h.state.votingId,null);});
test('rejected result preserves list and reports failure',async()=>{const h=harness();const old=h.state.videos;h.button(h.render(),'a').props.onClick();h.requests[0].reject(new Error('fixture'));await new Promise(r=>setImmediate(r));assert.equal(h.state.videos,old);assert.equal(h.errors.length,1);assert.equal(h.state.votingId,null);});

for (const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
  test(`three queued vote updates compose in completion order ${order}`, async () => {
    const h = harness({queued:true});
    for (const id of ['a','b','c']) h.button(h.render(),id).props.onClick();
    for (const index of order) await h.settle(index,index+1);
    h.flushUpdates();
    assert.deepEqual(Array.from(h.state.videos, v => [v.id,v.likes,v.userVote]), [['c',3,1],['b',2,1],['a',1,1]]);
  });
}
test('removed vote target is not reinserted on completion', async () => {
  const h=harness(); h.button(h.render(),'a').props.onClick();
  h.state.videos=h.state.videos.filter(v=>v.id!=='a'); await h.settle(0);
  assert.equal(h.state.videos.some(v=>v.id==='a'),false);
});
test('new rows added while voting survive completion', async () => {
  const h=harness(); h.button(h.render(),'a').props.onClick();
  h.state.videos=[...h.state.videos,{id:'new',score:10}]; await h.settle(0);
  assert.equal(h.state.videos[0].id,'new');
});
test('same-button click keeps existing vote cancellation mapping', async () => {
  const h=harness(); h.state.videos=h.state.videos.map(v=>({...v,userVote:1,likes:1,score:1}));
  h.button(h.render(),'a').props.onClick(); assert.equal(h.requests[0].args[1],0);
  await h.settle(0,0); assert.equal(h.state.videos.find(v=>v.id==='a').userVote,null);
});
test('dislike retains preview hiding and current-video replacement input', async () => {
  const h=harness({preview:'a'}); h.render().handleVote('a',null,-1); await h.settle(0,0,1);
  assert.equal(h.state.preview,null); assert.equal(h.replacements.length,1);
  assert.equal(h.replacements[0][1],'a');
  assert.equal(h.replacements[0][0].find(v=>v.id==='a').userVote,-1);
});
test('disabled hide-disliked preference keeps preview and replacement untouched', async () => {
  const h=harness({preview:'a',hide:false}); h.render().handleVote('a',null,-1); await h.settle(0,0,1);
  assert.equal(h.state.preview,'a'); assert.equal(h.replacements.length,0);
  assert.equal(h.state.videos.find(v=>v.id==='a').userVote,-1);
});
test('local mode does not dispatch a vote', async () => {
  const h=harness({local:true}); await h.render().handleVote('a',null,1);
  assert.equal(h.requests.length,0); assert.equal(h.state.votingId,null);
});
test('frozen previous state remains unchanged', async () => {
  const h=harness(); h.state.videos=Object.freeze(h.state.videos.map(Object.freeze));
  const before=h.state.videos; h.button(h.render(),'a').props.onClick(); await h.settle(0);
  assert.equal(before[0].likes,0); assert.notEqual(h.state.videos,before); assert.equal(h.state.videos[0].likes,1);
});
test('state updater replay is pure and triggers no duplicate side effects', async () => {
  const h=harness({queued:true,preview:'a'}); h.render().handleVote('a',null,-1); await h.settle(0,0,1);
  const before=h.state.videos, update=h.updates[0];
  const applyUpdate = previous => typeof update === 'function' ? update(previous) : update;
  assert.deepEqual(applyUpdate(before),applyUpdate(before));
  assert.equal(h.requests.length,1); assert.equal(h.replacements.length,1); assert.equal(before[0].userVote,null);
});
test('malformed response is caught before a queued state update', async () => {
  const h=harness({queued:true}); const before=h.state.videos;
  h.button(h.render(),'a').props.onClick(); h.requests[0].resolve({data:null});
  await new Promise(r=>setImmediate(r)); h.flushUpdates();
  assert.equal(h.state.videos,before); assert.equal(h.errors.length,1); assert.equal(h.state.votingId,null);
});
test('queued updater retains the counts observed at successful completion', async () => {
  const h=harness({queued:true}); const data={likes:4,dislikes:1,score:3};
  h.button(h.render(),'a').props.onClick(); h.requests[0].resolve({data});
  await new Promise(r=>setImmediate(r)); Object.assign(data,{likes:999,score:999}); h.flushUpdates();
  assert.equal(h.state.videos[0].likes,4); assert.equal(h.state.videos[0].score,3);
});
