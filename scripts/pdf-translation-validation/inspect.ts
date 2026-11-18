import fs from 'node:fs/promises';
import {parsePdfPage} from '../../apps/server/src/documents/translation/pdf-parser.js';
const names=['attention','bert','resnet','adam','gpt3','lora','diffusion','clip'];
for (const name of names) {
 const data=await fs.readFile(`scripts/pdf-translation-validation/samples/${name}.pdf`);
 const pages=[];
 for(let index=0;index<4;index++) pages.push(await parsePdfPage(data,index));
 await fs.writeFile(`scripts/pdf-translation-validation/output/${name}.json`,JSON.stringify(pages,null,2));
 console.log(name,pages.map(p=>p.segments.filter(s=>s.qualityState==='reliable').length));
}
