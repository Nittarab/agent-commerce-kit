import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
/** Local CA applies only to this explicitly pinned HTTPS origin; redirects are never followed. */
export function localRequest(origin:string,ca:Buffer,url:string,headers:Record<string,string>={}):Promise<{status:number;headers:IncomingHttpHeaders;text:string;json:any}>{
 if(new URL(url).origin!==origin||new URL(origin).hostname!=='localhost'||new URL(origin).protocol!=='https:')throw new Error('Destination not pinned');
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'GET',ca,headers,agent:false,timeout:60000},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>1024*1024)req.destroy(new Error('Response too large'));});
   res.on('end',()=>{try{if((res.statusCode??0)>=300&&(res.statusCode??0)<400)throw new Error('Redirect refused');resolve({status:res.statusCode??0,headers:res.headers,text,json:text?JSON.parse(text):null});}catch(e){reject(e);}});
  });req.on('timeout',()=>req.destroy(new Error('HTTPS timeout; recover the saved attempt')));req.on('error',reject);req.end();
 });
}
