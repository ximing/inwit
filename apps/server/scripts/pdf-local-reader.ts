/** Persistent local PDF reader. Real app + real queue/provider; one read-only sample object. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/index.js';
import { processDueJobs, recoverStuckJobs, drainJobs } from '../src/jobs/queue.js';
import { config } from '../src/config.js';
if (config.PG_HOST !== '127.0.0.1' || config.PG_PORT !== 55439 || config.PG_DATABASE !== 'inwit_pdf_local') throw new Error('Local-only database required');
const schemaCheck = await pool.query('select current_schema() as name');
if (schemaCheck.rows[0]?.name !== 'inwit_pdf_reading') throw new Error('Preserved local schema required');
const expectedKey = 'docs/1ac232f6-56c3-4ad6-bb54-22084cca102f/64971c80-ee75-44d9-ba1c-237a3bc59b3f/source.pdf';
const sample = await readFile(path.resolve('../../scripts/pdf-translation-validation/samples/bert.pdf'));
const storage = createServer((req,res) => {
 const url = new URL(req.url ?? '/', 'http://127.0.0.1:55440');
 res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5190');
 if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'*'});res.end();return; }
 let objectPath: string;
 try { objectPath = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
 if (!['GET','HEAD'].includes(req.method ?? '') || objectPath !== `/local-only/${expectedKey}`) {res.writeHead(404);res.end('Only the preserved BERT sample is available');return;}
 res.writeHead(200, {'Content-Type':'application/pdf','Content-Length':sample.length,'ETag':'"local-bert-original"'});res.end(req.method === 'HEAD' ? undefined : sample);
});
await new Promise<void>(resolve=>storage.listen(55440,'127.0.0.1',resolve));
const app=await buildApp();await app.listen({host:'127.0.0.1',port:3020});
let busy=false;
const timer=setInterval(()=>{if(busy)return;busy=true;void(async()=>{await recoverStuckJobs();await processDueJobs();})().catch(()=>app.log.error('Local worker tick failed')).finally(()=>{busy=false;});},500);
console.log('Persistent local PDF reader ready: real provider enabled; only preserved BERT object available. No automatic expiry.');
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{clearInterval(timer);void(async()=>{await drainJobs();await app.close();await new Promise<void>(r=>storage.close(()=>r()));await pool.end();process.exit(0);})();});
