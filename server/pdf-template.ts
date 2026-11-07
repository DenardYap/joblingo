import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {BlockEdit,ResumeBlock} from './docx-template.js';
const exec=promisify(execFile);
async function operation<T>(pdf:Buffer,action:(dir:string,run:(args:string[])=>Promise<string>)=>Promise<T>){
 const dir=await mkdtemp(join(tmpdir(),'resume-pdf-'));
 try{
  await writeFile(join(dir,'source.pdf'),pdf,{mode:0o600});
  const run=async(args:string[])=>{try{const result=await exec(process.env.RESUME_PDF_PYTHON||'python3',[resolve('server/pdf/template.py'),...args],{timeout:60000,maxBuffer:2_000_000});return result.stdout;}catch(error){const detail=(error as {stderr?:string}).stderr?.trim();throw new Error(detail?.split('\n').at(-1)||'PDF layout processing could not finish. Check the Python PDF runtime.');}};
  return await action(dir,run);
 }finally{await rm(dir,{recursive:true,force:true});}
}
export async function readPdfTemplate(pdf:Buffer):Promise<(ResumeBlock&{maxLines:number})[]>{return operation(pdf,async(dir,run)=>JSON.parse(await run(['inspect',join(dir,'source.pdf')])));}
export async function patchPdfTemplate(pdf:Buffer,edits:BlockEdit[]){return operation(pdf,async(dir,run)=>{
 const json=join(dir,'edits.json'),output=join(dir,'draft.pdf'),word=join(dir,'draft.docx');await writeFile(json,JSON.stringify(edits),{mode:0o600});
 const blocks:ResumeBlock[]=JSON.parse(await run(['patch',join(dir,'source.pdf'),output,json]));
 await run(['word',output,word]);return{pdf:await readFile(output),docx:await readFile(word),blocks,pages:1};
});}

export const WORD_LAYOUT_VERSION=3;
export async function pdfWordCompanion(pdf:Buffer){return operation(pdf,async(dir,run)=>{const word=join(dir,'draft.docx');await run(['word',join(dir,'source.pdf'),word]);return readFile(word);});}
