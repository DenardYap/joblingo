import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFParse } from 'pdf-parse';

export type ResumeBlock = { id: string; label: string; text: string };
export type BlockEdit = { id: string; text: string };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const decode = (xml: string) => new DOMParser().parseFromString(`<root xmlns:w="${W}">${xml}</root>`, 'text/xml');
const paragraphs = (xml: string) => [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
const paragraphText = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1]!).documentElement?.textContent??'').join('');
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function readTemplate(data: Uint8Array) {
  let size=0;
  const files=unzipSync(data,{filter:file=>{size+=file.originalSize;if(size>20_000_000)throw new Error('This DOCX is too large to process.');return true;}});
  if (!files['word/document.xml']) throw new Error('Upload a valid Word DOCX resume.');
  for(const [name,bytes] of Object.entries(files)) {
    if(/vbaProject|embeddings\//i.test(name))throw new Error('Use a DOCX without macros or embedded objects.');
    if(name.endsWith('.xml') || name.endsWith('.rels')) {
      const xml=strFromU8(bytes);
      if(/<!DOCTYPE|<!ENTITY|<w:altChunk/i.test(xml))throw new Error('This document contains unsupported embedded content.');
      if(name.endsWith('.rels') && /TargetMode="External"/.test(xml)) {
        const rels=Array.from(new DOMParser().parseFromString(xml,'text/xml').getElementsByTagName('Relationship'));
        if(rels.some(r=>r.getAttribute('TargetMode')==='External'&&!r.getAttribute('Type')?.endsWith('/hyperlink')))throw new Error('Remove linked external objects from the DOCX first.');
      }
    }
  }
  const xml=strFromU8(files['word/document.xml']);
  const blocks:ResumeBlock[]=[];
  let section='',context='',bullet=0;
  for(const [index,match] of paragraphs(xml).entries()) {
    const text=paragraphText(match[0]).trim();
    if(/^(?:WORK\s+|PROFESSIONAL\s+)?EXPERIENCE$/i.test(text)){section='work';context='Work experience';continue;}
    if(/^EDUCATION$/i.test(text)){section='education';continue;}
    if(/^(?:TECHNICAL\s+)?SKILLS$/i.test(text)){section='skills';continue;}
    if(section==='work' && /<w:numPr[ >]/.test(match[0]) && text){blocks.push({id:`p${index}`,label:`${context} · bullet ${++bullet}`,text});}
    else if(section==='skills' && text){blocks.push({id:`p${index}`,label:'Skills',text});}
    else if(section==='work' && text){context=text;bullet=0;}
  }
  if(!blocks.length)throw new Error('No editable experience bullets or skills were found in this DOCX.');
  return {files,xml,blocks};
}
export function patchTemplate(data:Uint8Array,edits:BlockEdit[]) {
  const {files,xml,blocks}=readTemplate(data);
  const allowed=new Set(blocks.map(b=>b.id)); const replacements=new Map<string,string>();
  for(const edit of edits){
    if(!allowed.has(edit.id)||replacements.has(edit.id))throw new Error('Only existing experience bullets and skills can be edited.');
    if(!edit.text.trim()||edit.text.length>2000||/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(edit.text))throw new Error('Each bullet must be a single nonempty paragraph under 2,000 characters.');
    replacements.set(edit.id,edit.text.trim().replace(/^[•]\s*/,''));
  }
  let index=0;
  files['word/document.xml']=strToU8(xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{
    const replacement=replacements.get(`p${index++}`); if(replacement===undefined)return p;
    let first=true;
    // Replace text only. Preserve paragraph/run properties, tabs, links and every other package part.
    return p.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/g,(_match,open:string,close:string)=>{const value=first?escape(replacement):'';first=false;return open+value+close;});
  }));
  return Buffer.from(zipSync(files));
}
export const PDF_LAYOUT_VERSION = 4;
// Normalize Word's redundant character-unit indents to its saved point values.
// Writer otherwise replaces a 30pt bullet indent with a one-character indent.
// These changes apply only to the conversion copy, never the saved Word file.
export function previewCompatibleDocx(data:Buffer){
  const {files,xml}=readTemplate(data);
  let normalized=xml.replace(/<w:ind\b[^>]*\/?>/g,ind=>{
    for(const unit of ['left','right','firstLine','hanging']){
      if(new RegExp(`\\bw:${unit}="`).test(ind))ind=ind.replace(new RegExp(`\\s+w:${unit}Chars="[^"]*"`,'g'),'');
    }return ind;
  });
  // Empty Word headers do not reserve body space in Word. Writer can allocate
  // their empty paragraph above a small top margin, moving the whole resume.
  const relations=files['word/_rels/document.xml.rels'];
  if(relations){
    const rels=Array.from(new DOMParser().parseFromString(strFromU8(relations),'text/xml').getElementsByTagName('Relationship'));
    normalized=normalized.replace(/<w:(?:headerReference|footerReference)\b[^>]*\/>/g,reference=>{
      const id=reference.match(/r:id="([^"]+)"/)?.[1];const target=rels.find(r=>r.getAttribute('Id')===id)?.getAttribute('Target');
      const part=target?files[`word/${target}`]:undefined;
      if(!part)return reference;
      const contents=strFromU8(part);
      return !paragraphText(contents).trim()&&!/<w:(?:drawing|pict|object|fldChar|instrText|sym|br|tbl)\b/.test(contents)?'':reference;
    });
  }
  // Latin-only runs marked as East Asian can acquire full-width fallback spaces
  // in Writer (including the candidate name and space-aligned dates).
  normalized=normalized.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g,run=>
    /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(paragraphText(run))?run:run.replace(/w:hint="eastAsia"/g,'w:hint="default"'));
  if(!/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(paragraphText(xml))){
    // Word's old East Asian compatibility flags make Writer double the width of
    // Latin spaces, shifting space-aligned dates and splitting the name/header.
    // English-only documents should use their existing Latin font metrics.
    const styles=files['word/styles.xml']?strFromU8(files['word/styles.xml']):'';
    const latinFont=styles.match(/<w:docDefaults>[\s\S]*?w:ascii="([^"]+)"/)?.[1];
    if(latinFont){
      const latinFonts=(value:string)=>value.replace(/<w:rFonts\b[^>]*\/?>/g,fonts=>fonts.replace(/w:eastAsia="[^"]*"/,`w:eastAsia="${fonts.match(/w:ascii="([^"]+)"/)?.[1]??latinFont}"`));
      normalized=latinFonts(normalized);
      files['word/styles.xml']=strToU8(latinFonts(styles));
    }
    if(files['word/settings.xml'])files['word/settings.xml']=strToU8(strFromU8(files['word/settings.xml']).replace(/<w:(?:balanceSingleByteDoubleByteWidth|useFELayout)\b[^>]*\/>/g,''));
  }
  files['word/document.xml']=strToU8(normalized.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,p=>{
    if(!/<w:tab w:val="right"/.test(p)||!/<w:tab w:val="left"/.test(p))return p;
    const count=[...p.matchAll(/<w:tab\s*\/>/g)].length;if(count<2)return p;
    let seen=0;
    // The date starts at the first left stop, followed by its original spaces.
    // Retaining only the right stop pulls it left by the width of the date.
    return p.replace(/<w:tabs>[\s\S]*?<\/w:tabs>/,tabs=>tabs.replace(/<w:tab w:val="right"[^>]*\/>/g,''))
      .replace(/<w:tab\s*\/>/g,tab=>++seen===1?tab:'');
  }));return Buffer.from(zipSync(files));
}
const exec=promisify(execFile);
export async function templatePdf(docx:Buffer):Promise<{pdf:Buffer;pages:number}> {
  const dir=await mkdtemp(join(tmpdir(),'job-resume-'));
  try {
    const profile=join(dir,'profile');await mkdir(profile);
    await writeFile(join(profile,'registrymodifications.xcu'),'<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    await writeFile(join(dir,'resume.docx'),previewCompatibleDocx(docx),{mode:0o600});
    const env={...process.env}; if(process.env.RESUME_FONTCONFIG)env.FONTCONFIG_FILE=process.env.RESUME_FONTCONFIG;
    try {await exec(process.env.LIBREOFFICE_BIN || 'soffice',[`-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf:writer_pdf_Export','--outdir',dir,join(dir,'resume.docx')],{timeout:60000,maxBuffer:1_000_000,env});}
    catch {throw new Error('The Word-to-PDF converter could not finish. Check the server LibreOffice configuration.');}
    const pdf=await readFile(join(dir,'resume.pdf'));
    const parser=new PDFParse({data:pdf});
    try{return {pdf,pages:(await parser.getInfo()).total};}finally{await parser.destroy();}
  } finally{await rm(dir,{recursive:true,force:true});}
}
