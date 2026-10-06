import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
const root=process.env.IVLYRICS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'index.js'),'utf8');
const options=readFileSync(resolve(root,'OptionsMenu.js'),'utf8');
const start=source.indexOf('                onVideoSelect: async (newVideoInfo');
const end=source.indexOf('\n                },\n              }),',start);
assert.ok(start>=0&&end>start);
const callback=source.slice(start,end+'\n                }'.length).trim().slice('onVideoSelect: '.length);
const hostStart=options.indexOf('function openCommunityVideoSelector(');
const hostEnd=options.indexOf('\n// Community Video Selector Button',hostStart);
assert.ok(hostStart>=0&&hostEnd>hostStart);
const host=options.slice(hostStart,hostEnd);
function harness(origin='spotify:track:A',pending=false){
  const writes=[],stateWrites=[],closes=[];let resolveWrite,rejectWrite,props;
  const container={currentTrackUri:origin,setState:value=>stateWrites.push(value)};
  const Utils={
    saveSelectedVideo(uri,info){writes.push(['save',uri,info]);return pending?new Promise((a,b)=>{resolveWrite=a;rejectWrite=b;}):Promise.resolve(true);},
    removeSelectedVideo(uri){writes.push(['remove',uri]);return pending?new Promise((a,b)=>{resolveWrite=a;rejectWrite=b;}):Promise.resolve(true);},
  };
  const onVideoSelect=vm.runInNewContext(`(function(){return (${callback});}).call(container)`,{container,Utils});
  const open=vm.runInNewContext(`${host}\nopenCommunityVideoSelector;`,{
    document:{getElementById:()=>null},CommunityVideoSelector:'inert selector',
    react:{createElement:(_type,value)=>{props=value;return {}; }},
    openFluentReactModal:settings=>settings.render(()=>closes.push(true)),
  });
  open(origin,null,onVideoSelect,0);
  return{container,writes,stateWrites,closes,select:info=>props.onVideoSelect(info),finish:(value=true)=>resolveWrite(value),reject:error=>rejectWrite(error)};
}
for(const info of [{youtubeVideoId:'fixture'},null])test(`chooser opened for A targets A after playback becomes B (${info?'save':'remove'})`,async()=>{
  const h=harness();h.container.currentTrackUri='spotify:track:B';await h.select(info);
  assert.equal(h.writes[0][1],'spotify:track:A');assert.equal(h.stateWrites.length,0);assert.equal(h.closes.length,1);
});
test('local chooser retains its complete original URI',async()=>{
  const uri='spotify:local:artist:album:title:20',h=harness(uri);h.container.currentTrackUri='spotify:track:B';await h.select({youtubeVideoId:'fixture'});
  assert.equal(h.writes[0][1],uri);assert.equal(h.stateWrites.length,0);
});
test('empty chooser origin does not mutate the later playback track',async()=>{
  const h=harness(null);h.container.currentTrackUri='spotify:track:B';await h.select({youtubeVideoId:'fixture'});assert.equal(h.writes.length,0);
});
test('current origin applies the saved selection and closes',async()=>{
  const h=harness();await h.select({youtubeVideoId:'fixture'});assert.equal(h.writes[0][1],'spotify:track:A');assert.equal(h.stateWrites[0].videoInfo.youtubeVideoId,'fixture');assert.equal(h.closes.length,1);
});
test('playback switch while a save is pending suppresses only the display update',async()=>{
  const h=harness('spotify:track:A',true);const p=h.select({youtubeVideoId:'fixture'});h.container.currentTrackUri='spotify:track:B';h.finish();await p;
  assert.equal(h.writes[0][1],'spotify:track:A');assert.equal(h.stateWrites.length,0);assert.equal(h.closes.length,1);
});
test('current origin removal retains video-background suppression',async()=>{
  const h=harness();await h.select(null);assert.equal(h.writes[0][0],'remove');assert.equal(h.stateWrites[0].videoInfo.suppressVideoBackground,true);
});
for(const info of [{youtubeVideoId:'fixture'},null])test(`playback disappearance keeps the chooser origin (${info?'save':'remove'})`,async()=>{
  const h=harness();h.container.currentTrackUri=null;await h.select(info);
  assert.equal(h.writes[0]?.[1],'spotify:track:A');assert.equal(h.stateWrites.length,0);assert.equal(h.closes.length,1);
});
test('returning to the chooser track retains the normal display update',async()=>{
  const h=harness();h.container.currentTrackUri='spotify:track:B';h.container.currentTrackUri='spotify:track:A';
  await h.select({youtubeVideoId:'fixture'});assert.equal(h.writes[0][1],'spotify:track:A');assert.equal(h.stateWrites.length,1);
});
test('track change during a pending removal keeps the new background untouched',async()=>{
  const h=harness('spotify:track:A',true);const p=h.select(null);h.container.currentTrackUri='spotify:track:B';h.finish();await p;
  assert.equal(h.writes[0][1],'spotify:track:A');assert.equal(h.stateWrites.length,0);
});
for(const info of [{youtubeVideoId:'fixture'},null])test(`storage rejection still closes and propagates (${info?'save':'remove'})`,async()=>{
  const h=harness('spotify:track:A',true);const p=h.select(info),failure=new Error('fixture storage rejection');h.reject(failure);
  await assert.rejects(p,error=>error===failure);assert.equal(h.closes.length,1);assert.equal(h.stateWrites.length,0);
});
test('empty video selection removes only the chooser origin',async()=>{
  const h=harness();h.container.currentTrackUri='spotify:track:B';await h.select({youtubeVideoId:''});
  assert.deepEqual(h.writes[0],['remove','spotify:track:A']);assert.equal(h.stateWrites.length,0);
});
test('selected video information passes through without reconstruction',async()=>{
  const h=harness(),info=Object.freeze({youtubeVideoId:'fixture',captionStartTime:12.3,skipSegments:[{start:5,end:8}],custom:'retained'});
  await h.select(info);assert.equal(h.writes[0][2],info);assert.equal(h.stateWrites[0].videoInfo,info);
});
