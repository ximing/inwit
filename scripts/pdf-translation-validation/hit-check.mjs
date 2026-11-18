import fs from 'node:fs';
import {init} from '../../apps/web/node_modules/@embedpdf/pdfium/dist/index.js';
const m=await init({wasmBinary:fs.readFileSync('apps/web/node_modules/@embedpdf/pdfium/dist/pdfium.wasm')});m.FPDF_InitLibrary();
let lines=0,hits=0,overlap=0;const failures=[];
for(const sample of JSON.parse(fs.readFileSync('scripts/pdf-translation-validation/samples.json','utf8'))){
 const data=fs.readFileSync(`scripts/pdf-translation-validation/samples/${sample.name}.pdf`);const ptr=m.pdfium.wasmExports.malloc(data.length);m.pdfium.HEAPU8.set(data,ptr);const doc=m.FPDF_LoadMemDocument(ptr,data.length,'');
 const pages=JSON.parse(fs.readFileSync(`scripts/pdf-translation-validation/output/${sample.name}.json`,'utf8'));
 for(const p of pages){
  const page=m.FPDF_LoadPage(doc,p.pageIndex),text=m.FPDFText_LoadPage(page);const segments=p.segments.filter(s=>s.qualityState==='reliable');
  for(const s of segments)for(const q of s.rects){
   lines++;const y=(q[0].y+q[2].y)/2;let hit=false;
   for(const t of [.1,.2,.3,.4,.5,.6,.7,.8,.9]){const x=q[0].x+(q[1].x-q[0].x)*t;const rawX=x/p.geometry.userUnit+p.geometry.cropBox[0],rawY=y/p.geometry.userUnit+p.geometry.cropBox[1];if(m.FPDFText_GetCharIndexAtPos(text,rawX,rawY,2,2)>=0)hit=true;}
   if(hit)hits++;else failures.push({sample:sample.name,page:p.pageIndex,segment:s.ordinal,rect:q});
   const x=(q[0].x+q[2].x)/2;
   for(const other of segments)if(other.id!==s.id&&other.rects.some(r=>x>=r[0].x&&x<=r[1].x&&y>=r[0].y&&y<=r[2].y))overlap++;
  }
  m.FPDFText_ClosePage(text);m.FPDF_ClosePage(page);
 }
 m.FPDF_CloseDocument(doc);m.pdfium.wasmExports.free(ptr);
}
m.FPDF_DestroyLibrary();const result={lines,pdfiumTextHits:hits,hitRate:hits/lines,overlap,failures};fs.writeFileSync('scripts/pdf-translation-validation/output/hit-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({lines,pdfiumTextHits:hits,hitRate:hits/lines,overlap}));if(overlap||hits!==lines)process.exitCode=1;
