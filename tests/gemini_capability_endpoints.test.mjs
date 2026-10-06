import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root=process.env.IVLYRICS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'Addon_AI_Gemini.js'),'utf8');
assert.equal(source.split('    registerAddon();').length,2);
// Test-only access to the private catalog loader. All provider functions, the
// capability Map and the actual public research/stream request path are intact.
const instrumented=source.replace('    registerAddon();','    window.__probe = {fetchAvailableModels};\n    registerAddon();');
const catalog=(model,limit)=>({models:[{name:`models/${model}`,displayName:model,supportedGenerationMethods:['generateContent'],inputTokenLimit:100000,outputTokenLimit:limit}]});
function harness(){
  const settings=new Map(Object.entries({'api-keys':'inert-fixture-key','base-url':'https://fixture-b.invalid/v1beta',model:'gemini-fixture','adv-maxOutputTokens-value':32768}));
  const requests=[];let addon;
  const fakeFetch=(url,options={})=>{
    if(options.method==='POST'){
      requests.push({kind:'stream',url,body:JSON.parse(options.body)});
      const payload={candidates:[{finishReason:'STOP',content:{parts:[{text:'{"metadata":{"title":"fixture"}}'}]}}]};
      let done=false;
      return Promise.resolve({ok:true,status:200,body:{getReader:()=>({read:async()=>{
        if(done)return {done:true};done=true;return {done:false,value:new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)};
      }})}});
    }
    let resolveResponse;
    const promise=new Promise(r=>{resolveResponse=r;});
    requests.push({kind:'models',url,resolve:(model,limit)=>resolveResponse({ok:true,json:async()=>catalog(model,limit)}),resolveData:data=>resolveResponse({ok:true,json:async()=>data})});
    return promise;
  };
  const window={ivLyricsFetch:fakeFetch,AIAddonManager:{
    register(value){addon=value;},
    getAddonSetting(_provider,key,fallback){return settings.get(key)??fallback;},
    setAddonSetting(_provider,key,value){settings.set(key,value);},
  }};
  vm.runInNewContext(instrumented,{window,TextDecoder,TextEncoder,console},{filename:'Addon_AI_Gemini.js'});
  const load=(base)=>window.__probe.fetchAvailableModels('inert-fixture-key',base);
  const research=()=>addon.generateTMI({title:'Fixture song',artist:'Fixture artist',tmiPrompt:'Fixture prompt',webSearch:false});
  const stream=()=>requests.filter(r=>r.kind==='stream').at(-1);
  return{settings,requests,load,research,stream};
}
test('late catalog from endpoint A must not change endpoint B research output capacity',async()=>{
  const h=harness();const a=h.load('https://fixture-a.invalid/v1beta'),b=h.load('https://fixture-b.invalid/v1beta');
  h.requests[1].resolve('gemini-fixture',65536);await b;
  h.requests[0].resolve('gemini-fixture',1024);await a;
  const result=await h.research();assert.equal(result.metadata.title,'fixture');
  assert.ok(h.stream().url.startsWith('https://fixture-b.invalid/v1beta/'));
  assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('latest B completion produces B capacity through the full research request',async()=>{
  const h=harness();const a=h.load('https://fixture-a.invalid/v1beta'),b=h.load('https://fixture-b.invalid/v1beta');
  h.requests[0].resolve('gemini-fixture',1024);await a;
  h.requests[1].resolve('gemini-fixture',65536);await b;await h.research();
  assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('different model IDs preserve independent output capacities',async()=>{
  const h=harness();const a=h.load('https://fixture-a.invalid/v1beta'),b=h.load('https://fixture-b.invalid/v1beta');
  h.requests[1].resolve('gemini-fixture',65536);await b;
  h.requests[0].resolve('gemini-unrelated',1024);await a;await h.research();
  assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('research without cached metadata loads the current endpoint catalog',async()=>{
  const h=harness();const pending=h.research();assert.equal(h.requests.length,1);
  assert.ok(h.requests[0].url.startsWith('https://fixture-b.invalid/v1beta/'));
  h.requests[0].resolve('gemini-fixture',65536);await pending;
  assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('cached A metadata cannot suppress the initial catalog read for B',async()=>{
  const h=harness();const a=h.load('https://fixture-a.invalid/v1beta');h.requests[0].resolve('gemini-fixture',1024);await a;
  const pending=h.research();await Promise.resolve();
  assert.equal(h.requests[1].kind,'models');assert.ok(h.requests[1].url.startsWith('https://fixture-b.invalid/v1beta/'));
  h.requests[1].resolve('gemini-fixture',65536);await pending;assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('returning to a cached endpoint retains its own advertised capacity',async()=>{
  const h=harness();const a=h.load('https://fixture-a.invalid/v1beta');h.requests[0].resolve('gemini-fixture',1024);await a;
  const b=h.load('https://fixture-b.invalid/v1beta');h.requests[1].resolve('gemini-fixture',65536);await b;
  h.settings.set('base-url','https://fixture-a.invalid/v1beta');await h.research();assert.equal(h.stream().body.generationConfig.maxOutputTokens,1024);
  h.settings.set('base-url','https://fixture-b.invalid/v1beta');await h.research();assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
  assert.equal(h.requests.filter(r=>r.kind==='models').length,2);
});
test('one trailing slash shares the same effective endpoint cache',async()=>{
  const h=harness();const pending=h.load('https://fixture-b.invalid/v1beta/');h.requests[0].resolve('gemini-fixture',65536);await pending;
  await h.research();assert.equal(h.requests.filter(r=>r.kind==='models').length,1);assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
test('omitted loader endpoint and empty configured endpoint retain the default',async()=>{
  const h=harness();h.settings.set('base-url','');const pending=h.load(undefined);h.requests[0].resolve('gemini-fixture',65536);await pending;
  await h.research();assert.equal(h.requests.filter(r=>r.kind==='models').length,1);assert.ok(h.stream().url.startsWith('https://generativelanguage.googleapis.com/v1beta/'));
});
for(const configured of [4096,64000])test(`missing advertised capacity preserves configured/default policy (${configured})`,async()=>{
  const h=harness();h.settings.set('adv-maxOutputTokens-value',configured);const pending=h.research();h.requests[0].resolveData({models:[]});await pending;
  assert.equal(h.stream().body.generationConfig.maxOutputTokens,Math.max(configured,32768));
});
test('different proxy paths on the same host retain separate capacities',async()=>{
  const h=harness(),aUrl='https://fixture.invalid/proxy-a',bUrl='https://fixture.invalid/proxy-b';h.settings.set('base-url',bUrl);
  const a=h.load(aUrl),b=h.load(bUrl);h.requests[1].resolve('gemini-fixture',65536);await b;h.requests[0].resolve('gemini-fixture',1024);await a;
  await h.research();assert.ok(h.stream().url.startsWith(`${bUrl}/models/`));assert.equal(h.stream().body.generationConfig.maxOutputTokens,65536);
});
