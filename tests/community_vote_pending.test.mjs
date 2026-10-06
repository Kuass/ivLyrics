import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const file = process.env.IVLYRICS_SOURCE_ROOT
  ? resolve(process.env.IVLYRICS_SOURCE_ROOT, 'CommunityVideoSelector.js')
  : new URL('../CommunityVideoSelector.js', import.meta.url);
const source = readFileSync(file, 'utf8');
function cut(start, end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a);
  return source.slice(a,b);
}
const setup=cut('const CommunityVideoSelector = ({','  // 현재 사용자 해시 ID');
const handler=cut('  const handleVote = async','\n  const applyVideoSelection');
const actions=cut('  const renderVideoActions =','\n  const renderVideoListItem');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

// Actual component state/ref initializers, vote handler and button factory.
// React state, provider responses and rendering are inert local collaborators.
function harness(options={}) {
  const slots=[], requests=[], errors=[], replacements=[], writes=[];
  let cursor=0, rendered;
  const react={
    useState(initial) {
      const index=cursor++;
      if (!(index in slots)) slots[index]=typeof initial==='function'?initial():initial;
      return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;writes.push({index,value:slots[index]});options.onWrite?.();}];
    },
    useRef(initial) {const index=cursor++;if (!(index in slots))slots[index]={current:initial};return slots[index];},
    useCallback: callback => callback,
    createElement:(type,props,...children)=>({type,props:props||{},children}),
  };
  const component=vm.runInNewContext(`${setup}\n${handler}\n${actions}\nreturn {handleVote,renderVideoActions,setVideos,videos};\n};\nCommunityVideoSelector;`,{
    react,CONFIG:{visual:{}},currentUserHash:'other',isLocalVideoMode:options.local??false,
    Utils:{voteCommunityVideo(...args){if(options.throwProvider)throw Error('provider sync failure');const d=deferred();requests.push({...d,args});return d.promise;}},
    replaceHiddenCurrentVideo:async(...args)=>{replacements.push(args);if(options.replacementFailure)throw Error('selection failed');},
    console:{error:(...args)=>errors.push(args)},I18n:{t:x=>x},
    togglePreview(){},handleApply(){},handleEdit(){},showDeleteConfirm(){},
  });
  const render=()=>{cursor=0;rendered=component({trackUri:'spotify:track:fixture',defaultStartTime:0});return rendered;};
  render().setVideos(['a','b','c'].map(id=>({id,youtubeVideoId:id,likes:0,dislikes:0,score:0,userVote:null})));
  render();
  const button=(id,kind='like')=>rendered.renderVideoActions(rendered.videos.find(v=>v.id===id)).children.find(x=>x?.props?.className?.startsWith(`vote-btn ${kind} `));
  const click=(id,kind='like')=>{const b=button(id,kind);assert.equal(b.props.disabled,false,`row ${id} must be enabled`);return b.props.onClick();};
  const settle=async(index,outcome='success')=>{
    if(outcome==='reject')requests[index].reject(Error('fixture rejected'));
    else requests[index].resolve(outcome==='null'?null:{data:{likes:1,dislikes:0,score:1}});
    await flush();render();
  };
  return {requests,errors,replacements,writes,render,button,click,settle};
}

test('different pending rows remain disabled independently',async()=>{
  const h=harness();h.click('a');h.render();h.click('b');h.render();
  assert.equal(h.button('a').props.disabled,true);assert.equal(h.button('b').props.disabled,true);assert.equal(h.button('c').props.disabled,false);
  await h.settle(0);await h.settle(1);
});
for(const order of [[0,1],[1,0]])test(`completion order ${order} keeps the other pending row disabled`,async()=>{
  const h=harness();h.click('a');h.render();h.click('b');h.render();
  await h.settle(order[0]);const pending=order[1]===0?'a':'b',done=order[0]===0?'a':'b';
  assert.equal(h.button(pending).props.disabled,true);assert.equal(h.button(done).props.disabled,false);
  await h.settle(order[1]);assert.equal(h.button('a').props.disabled,false);assert.equal(h.button('b').props.disabled,false);
});
test('another row cannot reopen a pending row for a third ordinary click',async()=>{
  const h=harness();h.click('a');h.render();h.click('b');h.render();
  if(!h.button('a').props.disabled)h.click('a');assert.equal(h.requests.length,2);
  await h.settle(0);await h.settle(1);
});
test('repeat callback before rerender dispatches only once',async()=>{
  const h=harness();const callback=h.button('a').props.onClick;callback();callback();
  assert.equal(h.requests.length,1);await h.settle(0);
});
test('opposite vote callback is also suppressed while its row is pending',async()=>{
  const h=harness();const like=h.button('a').props.onClick,dislike=h.button('a','dislike').props.onClick;
  like();dislike();assert.equal(h.requests.length,1);assert.equal(h.requests[0].args[1],1);await h.settle(0);
});
for(const outcome of ['success','null','reject'])test(`${outcome} completion releases its row for retry`,async()=>{
  const h=harness();h.click('a');await h.settle(0,outcome);assert.equal(h.button('a').props.disabled,false);
  h.click('a');assert.equal(h.requests.length,2);await h.settle(1);
});
for(const outcome of ['null','reject'])test(`${outcome} completion cannot release a different pending row`,async()=>{
  const h=harness();h.click('a');h.render();h.click('b');await h.settle(0,outcome);
  assert.equal(h.button('b').props.disabled,true);await h.settle(1);
});
test('sync provider failure releases the row and reports the error',async()=>{
  const h=harness({throwProvider:true});await h.click('a');h.render();assert.equal(h.button('a').props.disabled,false);assert.equal(h.errors.length,1);
});
test('failed dislike replacement still releases the completed row',async()=>{
  const h=harness({replacementFailure:true});h.click('a','dislike');await h.settle(0);
  assert.equal(h.replacements.length,1);assert.equal(h.errors.length,1);assert.equal(h.button('a').props.disabled,false);
});
test('local mode dispatches no community request',async()=>{
  const h=harness({local:true});await h.click('a');h.render();assert.equal(h.requests.length,0);assert.equal(h.button('a').props.disabled,false);
});
test('component instances do not share admission state',async()=>{
  const a=harness(),b=harness();a.click('a');b.click('a');assert.equal(a.requests.length,1);assert.equal(b.requests.length,1);
  await a.settle(0);b.render();assert.equal(b.button('a').props.disabled,true);await b.settle(0);
});
test('pending-state writes do not mutate previously published Sets',async()=>{
  const h=harness();h.click('a');const snapshots=h.writes.filter(w=>Object.prototype.toString.call(w.value)==='[object Set]');
  h.render();h.click('b');await h.settle(0);await h.settle(1);
  for(const snapshot of snapshots)assert.deepEqual(Array.from(snapshot.value),['a']);
});
for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
  test(`three rows retain their own busy state through completion order ${order}`,async()=>{
    const h=harness(), ids=['a','b','c'], remaining=new Set(ids);
    for(const id of ids){h.click(id);h.render();}
    for(const index of order){
      await h.settle(index);remaining.delete(ids[index]);
      for(const id of ids)assert.equal(h.button(id).props.disabled,remaining.has(id));
    }
  });
}
test('admission is acquired before a state-listener reentry',async()=>{
  let reenter;
  const h=harness({onWrite(){const callback=reenter;reenter=null;callback?.();}});
  const callback=h.button('a').props.onClick;reenter=callback;callback();
  assert.equal(h.requests.length,1);await h.settle(0);
});
test('completion releases admission before a state-listener starts the next request',async()=>{
  let reenter;
  const h=harness({onWrite(){const callback=reenter;reenter=null;callback?.();}});
  h.click('a');h.render();
  h.requests[0].resolve(null);reenter=()=>h.render().handleVote('a',null,1);await flush();h.render();
  assert.equal(h.requests.length,2);assert.equal(h.button('a').props.disabled,true);
  await h.settle(1);assert.equal(h.button('a').props.disabled,false);
});
