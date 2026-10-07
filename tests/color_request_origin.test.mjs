// Actual playback, color and style methods with inert transport/state collaborators.
// No Spotify, browser, React renderer, image download or storage engine executes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.js', root), 'utf8');
const service = readFileSync(new URL('LyricsService.js', root), 'utf8');
const utils = readFileSync(new URL('Utils.js', root), 'utf8');
const playback = createRequire(import.meta.url)('../PlaybackClock.js');
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const cut = (source, start, end) => {
  const a = source.indexOf(start); assert.ok(a >= 0, start);
  const b = source.indexOf(end, a + start.length); assert.ok(b > a, end);
  return source.slice(a,b);
};
const method = (source, name, indent = '  ') => {
  const a = source.search(new RegExp(`^${indent}(?:async )?${name}\\(`, 'm'));
  assert.ok(a >= 0, name);
  const tail = source.slice(a);
  // All selected production methods close at their declaration indentation.
  const end = tail.search(new RegExp(`^${indent}\\}[,]?\\s*$`, 'm'));
  assert.ok(end > 0, `end ${name}`);
  return tail.slice(0,end) + tail.slice(end).split('\n')[0];
};
const methods = ['getLyricsLayoutHasLyrics','getLoadingLyricsState','infoFromTrack','fetchLyrics',
  'resolveLyricsForMode','isPlaybackUriCurrent','beginPlaybackTrackTransition',
  'clearPlaybackTrackResolutionTimer','schedulePlaybackTrackResolution','commitResolvedPlaybackTrack',
  'getEffectiveBackgroundMode','fetchColors','selectBackgroundForCurrentTrack'];
const A = 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA';
const B = 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB';
const track = (uri, cover = uri === A ? 'cover-A' : 'cover-B') => ({ uri, type:'track', metadata: {
  title: uri === A ? 'Track A' : 'Track B', artist_name:'Fixture artist', album_title:'Fixture album',
  duration:'200000', image_xlarge_url:cover,
} });
const flush = async () => { for (let i=0;i<35;i++) await Promise.resolve(); };
const deferred = (kind, args) => {
  let yes, no;
  const gate = { kind, args, settled:false, promise:new Promise((resolve,reject)=>{yes=resolve;no=reject;}) };
  gate.resolve = value => { assert.equal(gate.settled,false); gate.settled=true; yes(value); };
  gate.reject = value => { assert.equal(gate.settled,false); gate.settled=true; no(value); };
  return gate;
};
const base = (hex = '#112233') => ({data:{trackUnion:{albumOfTrack:{coverArt:{extractedColors:{colorDark:{hex}}}}}}});
const dynamic = (cover='cover-A') => {
  const v = cover.includes('B') ? {red:0,green:1,blue:0} : cover.includes('new') ? {red:0,green:0,blue:1} : {red:1,green:0,blue:0};
  return {data:{getDynamicColorsByUris:[{minContrast:{backgroundBase:v},highContrast:{backgroundBase:v},higherContrast:{backgroundBase:v}}]}};
};
function harness({mode='blur-gradient-background', queuedState=false, noDynamicDefinition=false}={}) {
  const queries=[], cosmos=[], palettes=[], colorTasks=[], lyricTasks=[], publications=[], warnings=[], errors=[], stateQueue=[], storage=[], timers=new Map();
  let now=0, timerId=0;
  const config={modes:['karaoke','synced','unsynced'],visual:{[mode]:true,'background-brightness':100}};
  const spicetify={Player:{data:{item:null}},Platform:{PlayerAPI:{_state:{}}},GraphQL:{Definitions:{fetchExtractedColorForTrackEntity:'base',...(!noDynamicDefinition?{getDynamicColorsByUris:'dynamic'}:{})},Request(kind,args){const q=deferred(kind,plain(args)); queries.push(q);return q.promise;}},CosmosAsync:{get(url){const q=deferred('cosmos',{url});cosmos.push(q);return q.promise;}},colorExtractor(uri){const q=deferred('palette',{uri});palettes.push(q);return q.promise;}};
  const clock=playback.createSpotifyPlaybackClock(spicetify,{autoStart:false,now:()=>now,wallNow:()=>now,schedule(){throw Error('unexpected clock timer')},cancel(){}});
  const context=vm.createContext({console:{warn:(...v)=>warnings.push(v),error:(...v)=>errors.push(v)},Spicetify:spicetify,CONFIG:config,CACHE:{},SYNCED:1,
    getRememberedLyricsRenderModeLock:()=>-1,getRememberedIvLyricsFullscreenPresentation:()=> 'standard',
    IVLYRICS_BACKGROUND_MODE_IDS:['none','colorful','gradient-background','blur-gradient-background','solid-background','video-background'],
    getLyricsDataMode:mode=>mode,getLyricsModeTypeKey:mode=>config.modes[mode],isLyricsRenderCacheCurrent:()=>true,
    hasInstrumentalMarker:()=>false,getCurrentTranslationTargetLanguage:()=> 'ko',getCurrentLyricsPronunciationNotation:()=> 'translation',
    getNonSectionLyricsText:lyrics=>lyrics.map(l=>l.text).join('\n'),TrackBackgroundDB:{getOverride:async()=>null,setOverride(uri,value){const q=deferred('save',{uri,value});storage.push(q);return q.promise;},clearOverride(uri){const q=deferred('clear',{uri});storage.push(q);return q.promise;}},
    I18n:{t:key=>key},Toast:{success(){},error(){}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},Date:{now:()=>now},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
    ensurePlaybackProgressGuard:()=>({getSnapshot:()=>clock.getSnapshot(),clearCorrection:()=>clock.invalidate()}),
    window:{dispatchEvent(){},ivLyricsPlaybackClock:playback,Translator:{clearInflightRequests(){}},LyricsService:{
      getTrackLanguageOverride:async()=>null,getTrackLyricsProviderOverride:async()=>null,
      getLyricsFromProviders:async info=>({uri:info.uri,provider:'inert',synced:[{text:`Lyric ${info.title}`,startTime:0}]}),
      publishLyricsSnapshot(){},
    }},
  });
  vm.runInContext(`const Utils={_colorCache:new Map(),${method(utils,'convertIntToRGB')}\nextractTrackId:uri=>uri?.startsWith('spotify:track:')?uri.slice(14):null,detectLanguage:()=> 'en'};globalThis.Utils=Utils;\n`+
    `window.Utils={${['getPlayerPlaybackSnapshot','resolveStablePlaybackTrack','clearSafePlayerProgressCorrection'].map(n=>method(service,n,'        ')).join('\n')}};\n`+
    cut(index,'function getIvLyricsGlobalBackgroundMode(', 'window.ivLyricsBackgroundFlagIds')+'\n'+
    cut(index,'const computeLyricsBackgroundStyle = (','// Builds the initial LyricsContainer')+'\n'+
    cut(index,'const emptyState = {','\nconst getPlainLyricsLineText')+'\n'+
    cut(index,'const createInitialLyricsContainerState = () => ({','\n// note/placeholder-only line')+'\n'+
    `class Container {${methods.map(n=>method(index,n)).join('\n')}};globalThis.Container=Container;globalThis.empty=emptyState;globalThis.initial=createInitialLyricsContainerState;\n`+
    'globalThis.computeLyricsBackgroundStyle=computeLyricsBackgroundStyle;globalThis.buildAmbientGradientColorVars=buildAmbientGradientColorVars;globalThis.getAlbumAmbientColors=getAlbumAmbientColors;',context);
  const c=new context.Container();
  Object.assign(c,{state:{...context.initial(),currentLyrics:[],uri:'',lyricsDisplayUri:null},currentTrackUri:'',
    _lyricsFetchSeq:0,_activeLyricsFetchSeq:0,_lyricsTransitionSeq:0,_playbackTrackResolutionSeq:0,_isComponentMounted:true,
    clearPendingLyricsUpdates(){},closeLyricsEditModal(){},lyricsSaved:()=>false,getSavedLocalLyrics:()=>null,updateVisualOnConfigChange(){},forceUpdate(){},fetchMetadataTranslation(){},fetchTempo(){},resetDelay(){},loadSavedVideoForTrack(){},
    startLyricsLoading:()=>1,clearLyricsLoading(){},getCurrentMode:()=>1,isModeAvailable:()=>false,getAutomaticMode:()=>1,applyTranslationStates:()=>({}),refineLanguageWithAI(){},
    setState(patch,callback){const job=()=>{const p=typeof patch==='function'?patch(this.state):patch;this.state={...this.state,...p};if(Object.hasOwn(p,'colorsUri')&&p.colorsUri)publications.push(plain({current:this.currentTrackUri,stateUri:this.state.uri,displayUri:this.state.lyricsDisplayUri,coverUrl:this.state.coverUrl,...p}));callback?.();};if(queuedState)stateQueue.push(job);else job();},
  });
  const originalColors=c.fetchColors,originalLyrics=c.fetchLyrics;
  c.fetchColors=function(...args){const p=originalColors.apply(this,args);const t={uri:args[0],promise:p,done:false};colorTasks.push(t);p.then(()=>t.done=true);return p;};
  c.fetchLyrics=function(...args){const p=originalLyrics.apply(this,args);const t={uri:args[0]?.uri,promise:p,done:false};lyricTasks.push(t);p.then(()=>t.done=true);return p;};
  const h={c,context,spicetify,clock,queries,cosmos,palettes,colorTasks,lyricTasks,publications,warnings,errors,timers,stateQueue,config,storage,
    async advance(ms){now+=ms;const jobs=[...timers.values()];timers.clear();for(const job of jobs)job();await this.settleState();},
    async settleState(){for(let i=0;i<6;i++){while(stateQueue.length)stateQueue.shift()();await flush();}},
    async play(accepted,publicItem=accepted){spicetify.Player.data.item=publicItem;spicetify.Platform.PlayerAPI._state={item:accepted,playbackId:`play-${lyricTasks.length}`,isPaused:false};c.schedulePlaybackTrackResolution(accepted);await this.settleState();assert.equal(c.currentTrackUri,accepted.uri);assert.equal(c.state.uri,accepted.uri);assert.equal(c.state.lyricsDisplayUri,accepted.uri);assert.equal(c.state.isLoading,false);assert.equal(timers.size,0);},
    async refresh(item){spicetify.Player.data.item=item;spicetify.Platform.PlayerAPI._state.item=item;c.fetchLyrics(item,-1,true);await this.settleState();},
    pending(kind,uri){return queries.find(q=>!q.settled&&q.kind===kind&&(!uri||q.args.uri===uri||q.args.imageUris?.[0]===uri));},
    async resolve(q,response){assert.ok(q,'pending query exists');q.resolve(response);await this.settleState();},
    async reject(q){assert.ok(q);q.reject(Error('inert rejection'));await this.settleState();},
    render(){return plain(context.computeLyricsBackgroundStyle({isSyncCreatorActive:false,isFADMode:false,effectiveBackgroundMode:c.getEffectiveBackgroundMode(),dynamicColors:c.state.dynamicColors,colors:c.state.colors}));},
    async finish(){for(let i=0;i<12;i++){for(const q of storage.filter(q=>!q.settled))q.resolve();for(const q of queries.filter(q=>!q.settled))q.resolve(q.kind==='base'?base(q.args.uri===B?'#445566':'#112233'):dynamic(q.args.imageUris[0]));for(const q of cosmos.filter(q=>!q.settled))q.resolve({entries:[{color_swatches:[{preset:'VIBRANT_NON_ALARMING',color:0x112233}]}]});for(const q of palettes.filter(q=>!q.settled))q.resolve(null);await this.settleState();if([...queries,...cosmos,...palettes,...storage].every(q=>q.settled)&&colorTasks.every(t=>t.done)&&lyricTasks.every(t=>t.done))break;}await Promise.all([...colorTasks,...lyricTasks].map(t=>t.promise));assert.ok([...queries,...cosmos,...palettes,...storage].every(q=>q.settled),'all inert I/O settled');assert.ok([...colorTasks,...lyricTasks].every(t=>t.done),'all unchanged-method promises completed');assert.equal(timers.size,0,'no resolution timers remain');assert.equal(stateQueue.length,0);assert.deepEqual(errors,[]);clock.destroy();},
  };return h;
}
async function finishTrackColors(h,uri,cover){await h.resolve(h.pending('base',uri),base(uri===B?'#445566':'#112233'));const q=h.pending('dynamic',cover);if(q)await h.resolve(q,dynamic(cover));}

for (const queuedState of [false, true]) {
  test(`accepted A metadata supplies colors while public item lags at B (queued=${queuedState})`, async () => {
    const h = harness({ queuedState });
    await h.play(track(A), track(B));
    assert.equal(h.clock.getSnapshot().item.uri, A);
    assert.equal(h.c.state.coverUrl, 'cover-A');
    await h.finish();
    assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), [['cover-A']]);
    assert.equal(h.c.state.colorsUri, A);
    assert.equal(h.render()['--ivLyrics-c1'], '255, 0, 0');
  });

  test(`A→B→A keeps the old A request associated with A art (queued=${queuedState})`, async () => {
    const h = harness({ queuedState });
    await h.play(track(A));
    const oldBase = h.pending('base', A);
    await h.play(track(B));
    await h.resolve(oldBase, base());
    const oldDynamic = h.pending('dynamic');
    await h.play(track(A));
    await h.resolve(h.pending('base', A), base());
    const newDynamic = h.queries.find(q => q !== oldDynamic && q.kind === 'dynamic' && !q.settled);
    await h.resolve(newDynamic, dynamic(newDynamic.args.imageUris[0]));
    await h.resolve(oldDynamic, dynamic(oldDynamic.args.imageUris[0]));
    const result = h.render()['--ivLyrics-c1'];
    await h.finish();
    assert.equal(oldDynamic.args.imageUris[0], 'cover-A');
    assert.equal(result, '255, 0, 0');
  });
}

for (const primary of ['GraphQL', 'Cosmos']) {
  for (const queuedState of [false, true]) {
    for (const coverless of [false, true]) {
      test(`matching live A metadata remains authoritative during ${primary} (queued=${queuedState}, empty=${coverless})`, async () => {
        const h = harness({ queuedState });
        await h.play(track(A, 'cover-A-old'));
        if (primary === 'Cosmos') await h.reject(h.pending('base', A));
        const updated = track(A, coverless ? '' : 'cover-A-new');
        h.spicetify.Player.data.item = updated;
        h.spicetify.Platform.PlayerAPI._state.item = updated;
        h.c.schedulePlaybackTrackResolution(updated);
        await h.settleState();
        assert.equal(h.colorTasks.length, 1);
        await h.advance(4000);
        await h.finish();
        assert.equal(h.c.state.coverUrl, 'cover-A-old');
        assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), coverless ? [] : [['cover-A-new']]);
        assert.equal(h.render()['--ivLyrics-c1'], coverless ? '17, 34, 51' : '0, 0, 255');
      });
    }
  }
}

for (const foreign of [false, true]) {
  for (const level of ['xlarge', 'large', 'metadata', 'album-only']) {
    test(`metadata-only cover precedence: ${level}, public foreign=${foreign}`, async () => {
      const h = harness();
      const accepted = track(A, '');
      accepted.album = { images: [{ url: 'cover-A-album' }] };
      if (level !== 'album-only') accepted.metadata.image_url = 'cover-A-metadata';
      if (['xlarge', 'large'].includes(level)) accepted.metadata.image_large_url = 'cover-A-large';
      if (level === 'xlarge') accepted.metadata.image_xlarge_url = 'cover-A-xlarge';
      await h.play(accepted, foreign ? track(B) : accepted);
      await h.finish();
      const expected = level === 'album-only' ? [] : [[`cover-A-${level}`]];
      assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), expected);
      assert.equal(h.render()['--ivLyrics-c1'], level === 'album-only' ? '17, 34, 51' : '255, 0, 0');
    });
  }
}

for (const uri of ['spotify:local:Artist:Album:Title:123', 'custom:track:alpha']) {
  test(`accepted cover association preserves non-Spotify-track URI ${uri}`, async () => {
    const h = harness();
    await h.play(track(uri, 'cover-A'), track(B));
    await h.finish();
    assert.equal(h.c.state.colorsUri, uri);
    assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), [['cover-A']]);
  });
}

for (const at of ['base', 'dynamic', 'palette']) {
  test(`ordinary A→B still rejects old A publication after ${at}`, async () => {
    const h = harness({ mode: at === 'palette' ? 'video-background' : 'blur-gradient-background' });
    await h.play(track(A));
    if (at !== 'base') await h.resolve(h.pending('base', A), base());
    if (at === 'palette') await h.resolve(h.pending('dynamic'), dynamic());
    await h.play(track(B));
    const before = h.publications.length;
    if (at === 'base') {
      await h.resolve(h.pending('base', A), base());
      const q = h.pending('dynamic');
      await h.resolve(q, dynamic(q.args.imageUris[0]));
    } else if (at === 'dynamic') await h.resolve(h.pending('dynamic'), dynamic());
    else await h.resolve(h.palettes.find(q => q.args.uri === A), null);
    assert.equal(h.publications.length, before);
    await h.finish();
    assert.equal(h.c.state.colorsUri, B);
  });
}

for (const [initial, later] of [['none', 'blur-gradient-background'], ['blur-gradient-background', 'none']]) {
  test(`background mode remains sampled after base await: ${initial}→${later}`, async () => {
    const h = harness({ mode: initial });
    await h.play(track(A));
    h.config.visual[initial] = false;
    h.config.visual[later] = true;
    await h.finish();
    assert.equal(h.queries.filter(q => q.kind === 'dynamic').length, later === 'none' ? 0 : 1);
  });
}

for (const outcome of ['dynamic-failure', 'missing-definition', 'both-base-failures', 'palette-failure']) {
  test(`existing color fallback completes after ${outcome}`, async () => {
    const h = harness({ noDynamicDefinition: outcome === 'missing-definition', mode: outcome === 'palette-failure' ? 'video-background' : 'blur-gradient-background' });
    await h.play(track(A));
    if (outcome === 'both-base-failures') {
      await h.reject(h.pending('base', A));
      assert.ok(h.cosmos[0].args.url.includes(`uri=${A}&`));
      await h.reject(h.cosmos[0]);
    } else await h.resolve(h.pending('base', A), base());
    const q = h.pending('dynamic');
    if (q) {
      if (outcome === 'dynamic-failure' || outcome === 'both-base-failures') await h.reject(q);
      else await h.resolve(q, dynamic());
    }
    if (outcome === 'palette-failure') await h.reject(h.palettes[0]);
    await h.finish();
    assert.equal(h.c.state.colorsUri, A);
    assert.equal(h.c.state.albumPalette, null);
    if (outcome !== 'palette-failure') assert.equal(h.c.state.dynamicColors.minContrast, h.c.state.colors.background);
  });
}

test('same-URI dynamic requests keep their existing completion order', async () => {
  const h = harness();
  await h.play(track(A));
  await h.resolve(h.pending('base', A), base());
  const old = h.pending('dynamic');
  await h.refresh(track(A, 'cover-A-new'));
  await finishTrackColors(h, A, 'cover-A-new');
  assert.equal(h.render()['--ivLyrics-c1'], '0, 0, 255');
  await h.resolve(old, dynamic());
  await h.finish();
  assert.equal(h.render()['--ivLyrics-c1'], '255, 0, 0');
});

test('captured origin cover is a value even when its item object later changes identity', async () => {
  const h = harness();
  const item = track(A);
  await h.play(item);
  item.uri = B;
  item.metadata.image_xlarge_url = 'cover-B';
  await h.finish();
  assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), [['cover-A']]);
});

for (const unavailable of [null, track(B)]) {
  test(`legacy one-argument caller captures matching origin before public identity becomes ${unavailable?.uri || 'absent'}`, async () => {
    const h = harness();
    await h.play(track(A));
    await finishTrackColors(h, A, 'cover-A');
    h.c.fetchColors(A);
    h.spicetify.Player.data.item = unavailable;
    await h.finish();
    assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').at(-1).args.imageUris, ['cover-A']);
    assert.equal(h.render()['--ivLyrics-c1'], '255, 0, 0');
  });
}

test('mismatched explicit origin cannot authorize foreign artwork', async () => {
  const h = harness();
  await h.play(track(A));
  await finishTrackColors(h, A, 'cover-A');
  h.spicetify.Player.data.item = track(B);
  const before = h.queries.length;
  h.c.fetchColors(A, track(B));
  await h.finish();
  assert.deepEqual(h.queries.slice(before).map(q => q.kind), ['base']);
  assert.equal(h.render()['--ivLyrics-c1'], '17, 34, 51');
});

for (const changeDuringStorage of [false, true]) {
  test(`actual background selection captures only owned art after storage (foreign=${changeDuringStorage})`, async () => {
    const h = harness();
    await h.play(track(A));
    await finishTrackColors(h, A, 'cover-A');
    const selected = h.c.selectBackgroundForCurrentTrack('blur-gradient-background');
    assert.equal(h.storage[0].args.uri, A);
    if (changeDuringStorage) h.spicetify.Player.data.item = track(B);
    await h.resolve(h.storage[0]);
    await selected;
    if (!changeDuringStorage) h.spicetify.Player.data.item = track(B);
    const before = h.queries.filter(q => q.kind === 'dynamic').length;
    await h.finish();
    const later = h.queries.filter(q => q.kind === 'dynamic').slice(before);
    assert.deepEqual(later.map(q => q.args.imageUris), changeDuringStorage ? [] : [['cover-A']]);
    assert.equal(h.render()['--ivLyrics-c1'], changeDuringStorage ? '17, 34, 51' : '255, 0, 0');
  });
}

test('actual fullscreen-exit callback keeps its one-argument origin before public item changes', async () => {
  const h = harness();
  await h.play(track(A));
  await finishTrackColors(h, A, 'cover-A');
  h.c.state.dynamicColors = null;
  const body = cut(index, '        // Fork: leaving fullscreen can switch', '\n      });');
  vm.runInContext(`(function () { const isEnabled = false; ${body} })`, h.context).call(h.c);
  assert.equal(h.colorTasks.length, 2);
  h.spicetify.Player.data.item = track(B);
  await h.finish();
  assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').at(-1).args.imageUris, ['cover-A']);
  assert.equal(h.render()['--ivLyrics-c1'], '255, 0, 0');
});

test('foreign public cover during the Cosmos fallback still uses accepted origin art', async () => {
  const h = harness();
  await h.play(track(A));
  await h.reject(h.pending('base', A));
  h.spicetify.Player.data.item = track(B);
  await h.finish();
  assert.ok(h.cosmos[0].args.url.includes(`uri=${A}&`));
  assert.deepEqual(h.queries.filter(q => q.kind === 'dynamic').map(q => q.args.imageUris), [['cover-A']]);
  assert.equal(h.render()['--ivLyrics-c1'], '255, 0, 0');
});

test('background selection storage crossing a committed track change keeps the existing final guard', async () => {
  const h = harness();
  await h.play(track(A));
  await finishTrackColors(h, A, 'cover-A');
  const selected = h.c.selectBackgroundForCurrentTrack('blur-gradient-background');
  await h.play(track(B));
  await finishTrackColors(h, B, 'cover-B');
  const before = h.publications.length;
  await h.resolve(h.storage[0]);
  await selected;
  await h.finish();
  assert.equal(h.publications.length, before);
  assert.equal(h.c.state.colorsUri, B);
  assert.equal(h.render()['--ivLyrics-c1'], '0, 255, 0');
});

test('fullscreen public-item lag keeps the existing final URI rejection', async () => {
  const h = harness();
  await h.play(track(A));
  await finishTrackColors(h, A, 'cover-A');
  h.c.state.dynamicColors = null;
  h.spicetify.Player.data.item = track(B);
  const before = h.publications.length;
  const body = cut(index, '        // Fork: leaving fullscreen can switch', '\n      });');
  vm.runInContext(`(function () { const isEnabled = false; ${body} })`, h.context).call(h.c);
  await h.finish();
  assert.equal(h.colorTasks.at(-1).uri, B);
  assert.equal(h.publications.length, before);
  assert.equal(h.c.state.colorsUri, A);
});
