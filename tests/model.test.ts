import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatModel } from '../packages/agent/model.ts';
import { runAgent } from '../packages/agent/index.ts';
const credential='fixture-secret-outside-model-context';
const controller=new AbortController();
const reply=(decision:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}]}),{headers:{'content-type':'application/json'}});
const base={endpoint:'https://model.example/v1/chat/completions',model:'configured-model',apiKey:credential,task:'Obtain the approved research report',toolNames:['buy','inspect']};

test('model adapter drives the bounded harness, keeping credentials out of context',async()=>{
 let calls=0;
 const model=createChatModel({...base,fetch:async(_url,init)=>{
  assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+credential);
  assert.ok(!String(init?.body).includes(credential));
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'configured-model');assert.ok(body.messages[1].content.includes('research report'));
  return calls++===0?reply({type:'tool',name:'buy',input:{operation:'research'}}):reply({type:'done',output:'Report received'});
 }});
 const result=await runAgent(model,{buy:async(input)=>({simulation:true,input,delivered:true})},{maxSteps:3,timeoutMs:1000});
 assert.equal(result.output,'Report received');assert.equal(calls,2);assert.equal(result.history.length,1);
});

test('model cannot invent tools, extra fields or malformed decisions',async()=>{
 const invalid=[{type:'tool',name:'change_policy',input:{}},{type:'tool',name:'buy',input:{},approved:true},{type:'done',output:'ok',authority:'owner'},{type:'tool',name:'buy'},{type:'done'},[],null];
 for(const value of invalid){const model=createChatModel({...base,fetch:async()=>reply(value)});await assert.rejects(model.next([],controller.signal),/invalid decision/);}
 const invalidJson=createChatModel({...base,fetch:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'```json\n{}\n```'}}]}))});await assert.rejects(invalidJson.next([],controller.signal));
});

test('endpoint and tool configuration fail before network calls',()=>{
 for(const endpoint of ['http://outside.example/api','https://user:pass@model.example/api','https://model.example/api?key=secret','https://model.example/api#fragment'])assert.throws(()=>createChatModel({...base,endpoint}));
 for(const toolNames of [['buy','buy'],['__proto__'],['approve-policy']])assert.throws(()=>createChatModel({...base,toolNames}));
 assert.throws(()=>createChatModel({...base,task:credential}));
 assert.doesNotThrow(()=>createChatModel({...base,endpoint:'http://127.0.0.1:1234/completions'}));
});

test('history, response, and tool input size limits fail closed',async()=>{
 let requests=0;
 const model=createChatModel({...base,fetch:async()=>{requests++;return reply({type:'done',output:'ok'});}});
 await assert.rejects(model.next(['x'.repeat(65537)],controller.signal),/history/);assert.equal(requests,0);
 const oversizedInput=createChatModel({...base,fetch:async()=>reply({type:'tool',name:'buy',input:'x'.repeat(9000)})});await assert.rejects(oversizedInput.next([],controller.signal));
 let cancelled=false;
 const streaming=createChatModel({...base,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}}))});await assert.rejects(streaming.next([],controller.signal));assert.equal(cancelled,true);
});

test('provider errors and echoed secrets never escape through errors or decisions',async()=>{
 for(const response of [()=>Promise.reject(new Error('Provider echoed '+credential)),()=>Promise.resolve(new Response(credential,{status:401})),()=>Promise.resolve(reply({type:'done',output:credential}))]){
  const model=createChatModel({...base,fetch:response});await assert.rejects(model.next([],controller.signal),(error:unknown)=>error instanceof Error&&!error.message.includes(credential));
 }
 const model=createChatModel({...base,fetch:async()=>reply({type:'done',output:'ok'})});await assert.rejects(model.next([{token:credential}],controller.signal),/Credential/);
 const escaped=credential.split('').map(char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const escapedEcho=createChatModel({...base,fetch:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"type":"done","output":"'+escaped+'"}'}}]}))});
 await assert.rejects(escapedEcho.next([],controller.signal));
});

test('credentials containing JSON escapes or whitespace are rejected before requests',()=>{
 let requests=0;
 for(const apiKey of ['fixture"secret-123','fixture\\secret-123','fixture\tsecret-123','fixture\nsecret-123','fixture secret-123','fixture-é-secret']){
  assert.throws(()=>createChatModel({...base,apiKey,fetch:async()=>{requests++;return reply({type:'done',output:'unused'});}}),/Invalid model credential/);
 }
 assert.equal(requests,0);
});

test('abort stops an uncooperative fetch without exposing its reason',async()=>{
 const cancel=new AbortController();const model=createChatModel({...base,fetch:async()=>new Promise(()=>{})});
 const pending=model.next([],cancel.signal);cancel.abort(new Error(credential));await assert.rejects(pending,(error:unknown)=>error instanceof Error&&error.message==='Model request cancelled or timed out');
});

test('truncated completions and provider-native tool calls are not accepted',async()=>{
 for(const choices of [[{finish_reason:'length',message:{content:JSON.stringify({type:'done',output:'partial'})}}],[{finish_reason:'stop',message:{content:'{}',tool_calls:[{function:{name:'buy'}}]}}],[]]){
  const model=createChatModel({...base,fetch:async()=>new Response(JSON.stringify({choices}))});await assert.rejects(model.next([],controller.signal));
 }
});
