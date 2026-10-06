import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=process.env.IVLYRICS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url));
const source=name=>readFileSync(resolve(root,name),'utf8');
const doc=JSON.stringify({metadata:{title:'Inert research fixture'},fixture:true});
const catalog=(entries=[['fixture-a',65536],['fixture-b',1024]])=>({data:entries.map(([id,limit])=>({id,type:'model',max_tokens:limit,max_completion_tokens:limit}))});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function response(provider){
 const packets=provider==='Claude'
  ?[{type:'content_block_delta',delta:{type:'text_delta',text:doc}},{type:'message_delta',delta:{stop_reason:'end_turn'}}]
  :[{choices:[{delta:{content:doc},finish_reason:'stop'}]}];
 return{ok:true,status:200,json:async()=>provider==='Claude'?{content:[{type:'text',text:doc}],stop_reason:'end_turn'}:{choices:[{message:{content:doc},finish_reason:'stop'}]},body:new ReadableStream({start(controller){for(const packet of packets)controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet)}\n\n`));controller.close();}})};
}
function harness(provider,{initial={},postHandler=null}={}){
 const settings=new Map(Object.entries({'api-keys':['synthetic-A1'],model:'fixture-a','adv-maxTokens-value':16000,...initial}));
 const requests=[],progress=[],timers=[];let addon;
 const window={AIAddonManager:{register(value){addon=value;},getAddonSetting(_id,key,fallback){return settings.get(key)??fallback;},createResearchStreamProgressParser(callback){return{push:chunk=>callback({raw:chunk})};}},ivLyricsFetch(url,options={},timeoutMs){
  if(options.method==='POST'){const request={kind:'stream',url,body:JSON.parse(options.body),headers:options.headers,timeoutMs};requests.push(request);return Promise.resolve(postHandler?postHandler(request,requests.filter(r=>r.kind==='stream').length):response(provider));}
  let resolveResponse,rejectResponse,resolveBody,rejectBody;const pending=new Promise((r,j)=>{resolveResponse=r;rejectResponse=j;}),body=new Promise((r,j)=>{resolveBody=r;rejectBody=j;});
  requests.push({kind:'models',url,headers:options.headers,headersReady(){resolveResponse({ok:true,status:200,json:()=>body});},bodyReady(entries){resolveBody(catalog(entries));},reject:rejectResponse,rejectBody});return pending;
 }};
 const context=vm.createContext({window,TextDecoder,TextEncoder,console,setTimeout(fn,delay){timers.push(delay);queueMicrotask(fn);}});
 vm.runInContext(source('AIStreamReader.js'),context);
 const providerSource=source(`Addon_AI_${provider}.js`);
 assert.equal(providerSource.split('    registerAddon();').length,2);
 vm.runInContext(providerSource.replace('    registerAddon();',`    window.__probe={raw:call${provider}APIRaw,stream:call${provider}APIStream};\n    registerAddon();`),context);
 const models=()=>requests.filter(r=>r.kind==='models'),streams=()=>requests.filter(r=>r.kind==='stream');
 return{settings,requests,models,streams,progress,timers,addon,helper:window.__probe,begin:(extra={})=>addon.generateTMI({title:'Fixture title',artist:'Fixture artist',tmiPrompt:{systemPrompt:'Fixture system',userPrompt:'Fixture user'},webSearch:false,requestTimeoutMs:4567,onResearchProgress:(...args)=>progress.push(args),...extra}),settle(index=0,entries){models()[index].headersReady();models()[index].bodyReady(entries);}};
}
const max=(provider,request)=>request.body[provider==='Groq'?'max_completion_tokens':'max_tokens'];
const coherent=(provider,request)=>assert.equal(max(provider,request),request.body.model==='fixture-a'?65536:1024,'advertised capacity must belong to the model actually sent');
for(const provider of ['Claude','Groq','OpenRouter']){
 for(const phase of ['headers','body'])test(`${provider}: model change during catalog ${phase} must keep request capacity coherent`,async()=>{
  const h=harness(provider),pending=h.begin();
  if(phase==='body'){h.models()[0].headersReady();await flush();}
  h.settings.set('model','fixture-b');h.settle();assert.equal((await pending).fixture,true);coherent(provider,h.streams()[0]);
 });
 test(`${provider}: unchanged cold request uses the advertised limit and parses actual SSE`,async()=>{
  const h=harness(provider),pending=h.begin();h.settle();assert.equal((await pending).fixture,true);
  assert.equal(h.streams()[0].body.model,'fixture-a');coherent(provider,h.streams()[0]);
 });
 test(`${provider}: later invocation uses a newly selected cached model coherently`,async()=>{
  const h=harness(provider),first=h.begin();h.settle();await first;h.settings.set('model','fixture-b');await h.begin();
  assert.equal(h.models().length,1);assert.equal(h.streams()[1].body.model,'fixture-b');coherent(provider,h.streams()[1]);
 });
 test(`${provider}: warm-cache await must keep a synchronous model edit coherent`,async()=>{
  const h=harness(provider),first=h.begin();h.settle();await first;
  const next=h.begin();h.settings.set('model','fixture-b');await next;coherent(provider,h.streams()[1]);
 });
}

const keyOf=(provider,request)=>provider==='Claude'?request.headers['x-api-key']:request.headers.Authorization.replace(/^Bearer /,'');
const fail=(status=500)=>({ok:false,status,json:async()=>({error:{message:'Inert request failure'}})});
const change=h=>{h.settings.set('model','fixture-b');h.settings.set('api-keys',['synthetic-B1']);h.settings.set('adv-maxTokens-value',64000);h.settings.set('adv-temperature-value',0.9);};
for(const provider of ['Claude','Groq','OpenRouter']){
 test(`${provider}: metadata and generation retain their original keys and advanced fields`,async()=>{
  const h=harness(provider),pending=h.begin();change(h);h.settle();await pending;
  const request=h.streams()[0];assert.equal(request.body.model,'fixture-a');assert.equal(keyOf(provider,request),'synthetic-A1');coherent(provider,request);
  assert.equal(request.body.temperature,provider==='Claude'?undefined:0.3);
  const next=h.begin();await next;const current=h.streams()[1];assert.equal(current.body.model,'fixture-b');assert.equal(keyOf(provider,current),'synthetic-B1');coherent(provider,current);
  assert.equal(current.body.temperature,provider==='Claude'?undefined:0.9);
 });
 test(`${provider}: the sanitized key array is detached from later settings mutation`,async()=>{
  const h=harness(provider,{initial:{'api-keys':[' synthetic-A1 ','','synthetic-A2',null]}}),pending=h.begin();
  h.settings.get('api-keys')[0]='synthetic-B1';h.settle();await pending;
  assert.equal(keyOf(provider,h.streams()[0]),'synthetic-A1');
 });
 for(const status of [403,429])test(`${provider}: research ${status} fallback retains the accepted key list and model`,async()=>{
  const h=harness(provider,{initial:{'api-keys':['synthetic-A1','synthetic-A2']},postHandler:(_request,index)=>index===1?fail(status):response(provider)}),pending=h.begin();
  change(h);h.settle();await pending;
  assert.equal(h.streams().length,2);assert.deepEqual(h.streams().map(request=>keyOf(provider,request)),['synthetic-A1','synthetic-A2']);
  h.streams().forEach(request=>{assert.equal(request.body.model,'fixture-a');coherent(provider,request);});assert.equal(h.timers.length,0);
 });
 for(const phase of ['request','body'])test(`${provider}: failed catalog ${phase} keeps fallback configuration with the accepted model`,async()=>{
  const h=harness(provider),pending=h.begin();change(h);
  if(phase==='body'){h.models()[0].headersReady();await flush();h.models()[0].rejectBody(new Error('Inert catalog body failure'));}
  else h.models()[0].reject(new Error('Inert catalog failure'));
  await pending;const request=h.streams()[0];assert.equal(request.body.model,'fixture-a');assert.equal(max(provider,request),16000);assert.equal(keyOf(provider,request),'synthetic-A1');
 });
 for(const enabled of [true,false])test(`${provider}: missing metadata preserves configured/default fallback (${enabled})`,async()=>{
  const h=harness(provider,{initial:{'adv-maxTokens-value':24000,'adv-maxTokens-enabled':enabled}}),pending=h.begin();h.settle(0,[]);await pending;
  assert.equal(max(provider,h.streams()[0]),enabled?24000:16000);
 });
 test(`${provider}: initially missing keys reject without metadata or generation requests`,async()=>{
  const h=harness(provider,{initial:{'api-keys':[]}});await assert.rejects(h.begin(),/API key is required/);assert.equal(h.requests.length,0);
 });
 test(`${provider}: filling initially absent keys affects the next call`,async()=>{
  const h=harness(provider,{initial:{'api-keys':[]}}),pending=h.begin(),rejection=assert.rejects(pending,/API key is required/);
  h.settings.set('api-keys',['synthetic-B1']);await rejection;assert.equal(h.requests.length,0);
 });
 test(`${provider}: clearing keys during metadata preserves the accepted call and rejects the next`,async()=>{
  const h=harness(provider),pending=h.begin();h.settings.set('api-keys',[]);h.settle();await pending;
  assert.equal(keyOf(provider,h.streams()[0]),'synthetic-A1');await assert.rejects(h.begin(),/API key is required/);assert.equal(h.streams().length,1);
 });
 for(const field of ['title','artist','tmiPrompt'])test(`${provider}: missing ${field} fails before request work`,async()=>{
  const h=harness(provider);await assert.rejects(h.begin({[field]:''}));assert.equal(h.requests.length,0);
 });
 test(`${provider}: ordinary research retains progress, timeout, prompt and disabled web-tool behavior`,async()=>{
  const h=harness(provider),pending=h.begin();h.settle();await pending;const request=h.streams()[0];
  assert.equal(request.timeoutMs,4567);assert.ok(h.progress.some(([partial])=>partial?.raw?.includes('Inert research fixture')));
  assert.equal(request.body.messages.at(-1).content,'Fixture user');
  if(provider==='Claude'){assert.equal(request.body.system,'Fixture system');assert.equal(request.body.tools,undefined);}
  else assert.equal(request.body.messages[0].content,'Fixture system');
  if(provider==='OpenRouter'){assert.deepEqual(request.body.tools,[]);assert.deepEqual(request.body.plugins,[{id:'web',enabled:false}]);}
  if(provider==='Groq'){assert.equal(request.body.max_tokens,undefined);assert.equal(request.body.compound_custom,undefined);}
 });
 test(`${provider}: ordinary raw JSON calls retain their model/key and result handling`,async()=>{
  const h=harness(provider);const result=await h.addon.completeJson({prompt:'Ordinary fixture prompt'});
  assert.equal(result.fixture,true);assert.equal(h.models().length,0);assert.equal(h.streams()[0].body.model,'fixture-a');assert.equal(keyOf(provider,h.streams()[0]),'synthetic-A1');
 });
 test(`${provider}: ordinary stream overrides still take precedence without a research context`,async()=>{
  const h=harness(provider),overrides=provider==='Groq'?{model:'fixture-override',body:{max_tokens:1234}}:{model:'fixture-override',max_tokens:1234};
  await h.helper.stream('Ordinary stream prompt',null,null,1,null,90000,null,overrides);
  assert.equal(h.models().length,0);assert.equal(h.streams()[0].body.model,'fixture-override');assert.equal(h.streams()[0].body.max_tokens,1234);
 });
 test(`${provider}: ordinary helper retry behavior remains unchanged`,async()=>{
  const h=harness(provider,{postHandler:(_request,index)=>index===1?fail():response(provider)});
  const pending=h.helper.stream('Ordinary stream prompt',null,null,2);change(h);await pending;
  assert.equal(h.streams().length,2);assert.equal(h.streams()[1].body.model,'fixture-a');assert.equal(keyOf(provider,h.streams()[1]),'synthetic-A1');
  assert.equal(h.streams()[1].body.max_tokens,64000);assert.deepEqual(h.timers,[1000]);
 });
}
test('Claude web-search tool version follows the context model during metadata changes',async()=>{
 const h=harness('Claude',{initial:{model:'claude-sonnet-4-6'}}),pending=h.begin({webSearch:true});
 change(h);h.settle(0,[['claude-sonnet-4-6',65536],['fixture-b',1024]]);await pending;
 const request=h.streams()[0];assert.equal(request.body.model,'claude-sonnet-4-6');assert.equal(request.body.tools[0].type,'web_search_20260318');assert.deepEqual(request.body.tools[0].allowed_callers,['direct']);
});
test('OpenRouter keeps its enabled web-search request fields',async()=>{
 const h=harness('OpenRouter'),pending=h.begin({webSearch:true});change(h);h.settle();await pending;
 const request=h.streams()[0];assert.equal(request.body.model,'fixture-a');assert.equal(request.body.tools[0].type,'openrouter:web_search');assert.equal(request.body.tool_choice,'required');assert.equal(request.body.tools[0].parameters.max_total_results,16);
});
test('Groq compound final pass retains its no-web tool allowance with the captured model',async()=>{
 const h=harness('Groq',{initial:{model:'groq/compound-mini'}}),pending=h.begin();change(h);h.settle(0,[['groq/compound-mini',65536],['fixture-b',1024]]);await pending;
 const request=h.streams()[0];assert.equal(request.body.model,'groq/compound-mini');assert.deepEqual(request.body.compound_custom.tools.enabled_tools,['code_interpreter']);assert.equal(request.body.max_tokens,undefined);
});
test('Groq captures final-generation settings after the existing web-research prelude',async()=>{
 let release;const prelude=new Promise(r=>{release=r;});
 const h=harness('Groq',{postHandler:(_request,index)=>index===1?prelude:response('Groq')}),pending=h.begin({webSearch:true});
 assert.equal(h.models().length,0);assert.equal(h.streams()[0].body.model,'groq/compound');
 assert.deepEqual(h.streams()[0].body.compound_custom.tools.enabled_tools,['web_search','visit_website']);
 change(h);release(response('Groq'));await flush();assert.equal(h.models().length,1);
 h.settings.set('model','fixture-a');h.settings.set('api-keys',['synthetic-C1']);h.settle();await pending;
 const request=h.streams()[1];assert.equal(request.body.model,'fixture-b');assert.equal(keyOf('Groq',request),'synthetic-B1');coherent('Groq',request);
 assert.equal(request.body.temperature,0.9);assert.equal(request.body.compound_custom,undefined);assert.match(request.body.messages.at(-1).content,/Inert research fixture/);
});
