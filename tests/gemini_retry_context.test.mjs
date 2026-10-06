import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
const root=process.env.IVLYRICS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'Addon_AI_Gemini.js'),'utf8');
assert.equal(source.split('    registerAddon();').length,2);
const instrumented=source.replace('    registerAddon();','    window.__probe = {callGeminiAPIRaw, callGeminiAPIStream};\n    registerAddon();');
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const payload=(text='{"fixture":true}')=>({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
function harness(){
  const settings=new Map(Object.entries({'api-keys':'["fixture-A1","fixture-A2"]','base-url':'https://fixture-a.invalid/v1beta',model:'gemini-3-pro-preview','adv-maxOutputTokens-value':32768}));
  const requests=[],timers=[];let addon;
  const window={AIAddonManager:{register(value){addon=value;},getAddonSetting(_provider,key,fallback){return settings.get(key)??fallback;},getProviderRequestAttempts:()=>2},
    ivLyricsFetch(url,options){let resolveResponse,reject;const promise=new Promise((a,b)=>{resolveResponse=a;reject=b;});requests.push({url,body:JSON.parse(options.body),resolve:resolveResponse,reject});return promise;}};
  vm.runInNewContext(instrumented,{window,TextDecoder,TextEncoder,console,setTimeout(fn,delay){timers.push({fn,delay});return timers.length;}},{filename:'Addon_AI_Gemini.js'});
  const begin=(mode,overrides={})=>mode==='raw'?window.__probe.callGeminiAPIRaw('fixture prompt',2):window.__probe.callGeminiAPIStream('fixture prompt',null,null,2,null,90000,null,overrides);
  const change=()=>{settings.set('api-keys','["fixture-B1","fixture-B2"]');settings.set('base-url','https://fixture-b.invalid/v1beta');settings.set('model','gemini-2.5-pro');settings.set('adv-maxOutputTokens-value',8192);};
  const fail=async(index,status)=>{requests[index].resolve({ok:false,status,json:async()=>({error:{message:'fixture failure'}})});await flush();};
  const success=async(index,mode,text)=>{
    let done=false;const data=payload(text);
    requests[index].resolve({ok:true,status:200,json:async()=>data,body:{getReader:()=>({read:async()=>{
      if(done)return{done:true};done=true;return{done:false,value:new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)};
    }})}});await flush();
  };
  return {settings,requests,timers,begin,change,fail,success,addon,async retry(){const next=timers.shift();assert.equal(next.delay,1000);next.fn();await flush();}};
}
for(const mode of ['raw','stream']){
  for(const status of [500,403,429])test(`${mode}: ${status} continuation retains the endpoint and parameters associated with captured keys/model`,async()=>{
    const h=harness(),pending=h.begin(mode);const first=h.requests[0];h.change();await h.fail(0,status);
    if(status===500)await h.retry();else assert.equal(h.timers.length,0);
    const next=h.requests[1];assert.ok(next);await h.success(1,mode);await pending;
    assert.ok(next.url.startsWith('https://fixture-a.invalid/v1beta/'),next.url);
    assert.ok(new URL(next.url).pathname.includes('gemini-3-pro-preview'));
    assert.equal(new URL(next.url).searchParams.get('key'),status===500?'fixture-A1':'fixture-A2');
    assert.deepEqual(next.body.generationConfig,first.body.generationConfig);
  });
  test(`${mode}: stable configuration retains ordinary retries and key rotation`,async()=>{
    const h=harness(),pending=h.begin(mode);await h.fail(0,403);await h.success(1,mode);assert.equal(await pending,'{"fixture":true}');
    assert.equal(h.requests.length,2);assert.equal(new URL(h.requests[1].url).searchParams.get('key'),'fixture-A2');
  });
  test(`${mode}: a later invocation uses newly configured values`,async()=>{
    const h=harness(),first=h.begin(mode);await h.success(0,mode);await first;h.change();const second=h.begin(mode);await h.success(1,mode);await second;
    assert.ok(h.requests[1].url.startsWith('https://fixture-b.invalid/v1beta/'));assert.equal(new URL(h.requests[1].url).searchParams.get('key'),'fixture-B1');
    assert.ok(new URL(h.requests[1].url).pathname.includes('gemini-2.5-pro'));assert.equal(h.requests[1].body.generationConfig.maxOutputTokens,8192);
  });
  test(`${mode}: parameter edits alone cannot change an accepted retry`,async()=>{
    const h=harness(),pending=h.begin(mode),initial=h.requests[0].body.generationConfig;
    h.settings.set('model','gemini-2.5-pro');h.settings.set('adv-maxOutputTokens-value',8192);
    await h.fail(0,500);await h.retry();await h.success(1,mode);await pending;
    assert.deepEqual(h.requests[1].body.generationConfig,initial);
  });
  test(`${mode}: rejected transport retains the same retry context`,async()=>{
    const h=harness(),pending=h.begin(mode),initial=h.requests[0].body.generationConfig;h.change();
    h.requests[0].reject(new Error('inert transport rejection'));await flush();await h.retry();await h.success(1,mode);await pending;
    assert.ok(h.requests[1].url.startsWith('https://fixture-a.invalid/v1beta/'));assert.deepEqual(h.requests[1].body.generationConfig,initial);
  });
  for(const field of ['api-keys','model'])test(`${mode}: missing ${field} still fails before dispatch`,async()=>{
    const h=harness();h.settings.set(field,'');await assert.rejects(h.begin(mode),field==='model'?/Model is not selected/:/API key is required/);
    assert.equal(h.requests.length,0);assert.equal(h.timers.length,0);
  });
  test(`${mode}: retry budget and per-key ordering remain bounded`,async()=>{
    const h=harness(),pending=h.begin(mode),rejected=assert.rejects(pending,/fixture failure/);
    await h.fail(0,500);await h.retry();await h.fail(1,500);
    await h.fail(2,500);await h.retry();await h.fail(3,500);await rejected;
    assert.equal(h.requests.length,4);assert.equal(h.timers.length,0);
    assert.deepEqual(h.requests.map(r=>new URL(r.url).searchParams.get('key')),['fixture-A1','fixture-A1','fixture-A2','fixture-A2']);
  });
}
test('stream request overrides retain precedence across retries',async()=>{
  const h=harness(),overrides={generationConfig:{maxOutputTokens:1234,fixture:'override'},tools:[{fixture:true}]};
  const pending=h.begin('stream',overrides);h.change();await h.fail(0,500);await h.retry();await h.success(1,'stream');await pending;
  for(const request of h.requests){assert.deepEqual(request.body.generationConfig,overrides.generationConfig);assert.deepEqual(request.body.tools,overrides.tools);}
});
test('public completeJson path retains its accepted retry configuration',async()=>{
  const h=harness(),pending=h.addon.completeJson({prompt:'fixture prompt'}),initial=h.requests[0].body.generationConfig;
  h.change();await h.fail(0,500);await h.retry();await h.success(1,'raw');const result=await pending;
  assert.equal(result.fixture,true);assert.ok(h.requests[1].url.startsWith('https://fixture-a.invalid/v1beta/'));assert.deepEqual(h.requests[1].body.generationConfig,initial);
});
test('public streamed translation retains retry context and line output',async()=>{
  const h=harness(),lines=[],pending=h.addon.translateLyrics({text:'source fixture',translationPrompt:'fixture prompt',onLine:(index,line)=>lines.push([index,line])});
  const initial=h.requests[0].body.generationConfig;h.change();await h.fail(0,500);await h.retry();await h.success(1,'stream','translated fixture');const result=await pending;
  assert.deepEqual(Array.from(result.translation),['translated fixture']);assert.deepEqual(lines,[[0,'translated fixture']]);
  assert.ok(h.requests[1].url.startsWith('https://fixture-a.invalid/v1beta/'));assert.deepEqual(h.requests[1].body.generationConfig,initial);
});
