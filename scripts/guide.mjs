import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Map([['/', ['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/evidence.json',['evidence.json','application/json']]]);
const server=createServer(async(req,res)=>{
 const file=files.get(req.url);if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
 try{const body=await readFile(new URL('../docs/site/'+file[0],import.meta.url));res.writeHead(200,{'content-type':file[1],'cache-control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end();}
});
server.listen(8765,'127.0.0.1',()=>console.log('Private local guide: http://127.0.0.1:8765'));
