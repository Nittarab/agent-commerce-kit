import type { Offer,Order } from '../core/index.ts';
export type PurchaseResult = {simulation:true;kind:string;order?:Order;decision?:{code:string;explanation:string}};
/** Token is host configuration, never passed to model messages. Local demo transport only. */
export class ControlClient {
 #base:string; #token:string;
 constructor(base:string,token:string){const url=new URL(base);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('This prototype client supports loopback control only');this.#base=url.origin;this.#token=token;}
 async #request(path:string,body?:unknown,signal?:AbortSignal):Promise<any>{const res=await fetch(this.#base+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{authorization:'Bearer '+this.#token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});const value=await res.json();if(res.status===401)throw new Error('Controller authentication failed');if(!res.ok&&!(value as any).decision&&!(value as any).order)throw new Error((value as any).error??'Controller request failed');return value;}
 purchase(offer:Offer,signal?:AbortSignal):Promise<PurchaseResult>{return this.#request('/purchase',{offer},signal);}
 recover(orderId:string,signal?:AbortSignal):Promise<{simulation:true;order:Order}>{return this.#request('/recover',{orderId},signal);}
 cancel(orderId:string,signal?:AbortSignal):Promise<{simulation:true;order:Order}>{return this.#request('/cancel',{orderId},signal);}
 budget():Promise<{jobCommittedAtomic:string;principalCommittedAtomic:string}>{return this.#request('/budget');}
}
export type Turn = {type:'tool';name:string;input:unknown}|{type:'done';output:unknown};
export type ModelAdapter = { next(history:readonly unknown[],signal:AbortSignal):Promise<Turn> };
export type Tool = (input:unknown,signal:AbortSignal)=>Promise<unknown>;
/** Model adapter boundary. Demo uses a script; a live Eve/model adapter is not yet integrated. */
export async function runAgent(model:ModelAdapter,tools:Readonly<Record<string,Tool>>,options:{maxSteps:number;timeoutMs:number}):Promise<{output:unknown;history:unknown[]}> {
 if(!Number.isInteger(options.maxSteps)||options.maxSteps<1||options.maxSteps>100||!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>300000)throw new Error('Invalid runtime limits');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Agent deadline exceeded')),options.timeoutMs),history:unknown[]=[];
 async function bounded<T>(task:()=>Promise<T>):Promise<T>{if(controller.signal.aborted)throw controller.signal.reason;return new Promise<T>((resolve,reject)=>{const abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(task).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));});}
 try{for(let step=0;step<options.maxSteps;step++){
  const turn=await bounded(()=>model.next(structuredClone(history),controller.signal));
  if(turn?.type==='done')return {output:turn.output,history};
  if(turn?.type!=='tool'||typeof turn.name!=='string'||!Object.hasOwn(tools,turn.name))throw new Error('Tool is not allowed');
  const result=await bounded(()=>tools[turn.name](turn.input,controller.signal));history.push({tool:turn.name,result});
 }throw new Error('Agent step limit exceeded');}finally{clearTimeout(timer);controller.abort();}
}
