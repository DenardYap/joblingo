import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readTemplate, patchTemplate, previewCompatibleDocx } from '../server/docx-template.js';
import { seal, unseal } from '../server/google.js';

const ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const protectedHeader='<w:p w14:paraId="1"><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Candidate Name</w:t></w:r></w:p>';
const p=(text:string)=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const make=()=>zipSync({'word/document.xml':strToU8(`<w:document ${ns}><w:body>${protectedHeader}${p('WORK EXPERIENCE')}${p('Employer and fixed dates')}<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Original </w:t></w:r><w:r><w:t>bullet</w:t></w:r></w:p>${p('EDUCATION')}${p('Degree 2023')}${p('SKILLS')}${p('Excel, SQL')}<w:sectPr><w:pgMar w:top="567"/></w:sectPr></w:body></w:document>`),'word/styles.xml':strToU8('<styles>opaque original styles</styles>'),'word/header1.xml':strToU8('original contact header'),'word/numbering.xml':strToU8('original numbering'),'customXml/item1.xml':strToU8('opaque metadata')});
test('edits only allowlisted text and keeps all other ZIP parts and protected paragraphs byte-identical',()=>{
  const source=make();const template=readTemplate(source);assert.deepEqual(template.blocks.map(b=>b.id),['p3','p7']);
  const out=patchTemplate(source,[{id:'p3',text:'Reviewed contracts & revenue <controls>.'},{id:'p7',text:'SQL, Excel'}]);
  const before=unzipSync(source),after=unzipSync(out);
  for(const key of Object.keys(before)){if(key!=='word/document.xml')assert.deepEqual(after[key],before[key]);}
  const xml=strFromU8(after['word/document.xml']!);assert.ok(xml.includes(protectedHeader));assert.ok(xml.includes(p('Degree 2023')));assert.ok(xml.includes('<w:sz w:val="22"/>'));assert.ok(xml.includes('<w:numId w:val="1"/>'));assert.equal(readTemplate(out).blocks[0]?.text,'Reviewed contracts & revenue <controls>.');
});
test('refuses protected paragraphs, duplicates, blank and multiline edits',()=>{
  for(const edits of [[{id:'p0',text:'new name'}],[{id:'p3',text:''}],[{id:'p3',text:'a\nb'}],[{id:'p3',text:'one'},{id:'p3',text:'two'}]])assert.throws(()=>patchTemplate(make(),edits));
});
test('rejects external embedded content before conversion',()=>{
  const files=unzipSync(make());files['word/_rels/document.xml.rels']=strToU8('<Relationships><Relationship Type="https://schemas/attachedTemplate" TargetMode="External" Target="https://example.com/evil"/></Relationships>');assert.throws(()=>readTemplate(zipSync(files)),/external/);
});
test('preview compatibility leaves a standard template unchanged',()=>assert.deepEqual(unzipSync(previewCompatibleDocx(Buffer.from(make()))),unzipSync(make())));
test('PDF conversion uses saved point indents and Latin metrics without changing the Word template',()=>{
  const files=unzipSync(make());
  const xml=strFromU8(files['word/document.xml']!).replace('<w:numPr>','<w:ind w:left="600" w:leftChars="100"/><w:numPr>');
  files['word/document.xml']=strToU8(xml);
  files['word/styles.xml']=strToU8(`<w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="PMingLiU"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
  files['word/settings.xml']=strToU8(`<w:settings ${ns}><w:compat><w:balanceSingleByteDoubleByteWidth/><w:useFELayout/></w:compat></w:settings>`);
  const original=Buffer.from(zipSync(files));const preview=unzipSync(previewCompatibleDocx(original));
  assert.match(strFromU8(preview['word/document.xml']!),/<w:ind w:left="600"\/>/);
  assert.match(strFromU8(preview['word/styles.xml']!),/w:eastAsia="Times New Roman"/);
  assert.doesNotMatch(strFromU8(preview['word/settings.xml']!),/balanceSingleByte|useFELayout/);
  assert.match(strFromU8(unzipSync(original)['word/document.xml']!),/w:leftChars="100"/);
  const mixed={...files,'word/document.xml':strToU8(xml.replace('Candidate Name','候選人 Name'))};
  const mixedPreview=unzipSync(previewCompatibleDocx(Buffer.from(zipSync(mixed))));
  assert.deepEqual(mixedPreview['word/styles.xml'],files['word/styles.xml']);
  assert.deepEqual(mixedPreview['word/settings.xml'],files['word/settings.xml']);
});
test('PDF conversion keeps the first date anchor and ignores only empty headers',()=>{
  const files=unzipSync(make());
  files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']!).replace('</w:body>',`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="8650"/><w:tab w:val="right" w:pos="9720"/></w:tabs></w:pPr><w:r><w:t>Role</w:t><w:tab/><w:tab/><w:t>September 2023</w:t></w:r></w:p><w:sectPr><w:headerReference r:id="empty"/><w:headerReference r:id="contact"/></w:sectPr></w:body>`));
  files['word/_rels/document.xml.rels']=strToU8('<Relationships><Relationship Id="empty" Target="header2.xml"/><Relationship Id="contact" Target="header3.xml"/></Relationships>');
  files['word/header2.xml']=strToU8(`<w:hdr ${ns}><w:p><w:pPr/></w:p></w:hdr>`);
  files['word/header3.xml']=strToU8(`<w:hdr ${ns}><w:p><w:r><w:t>Protected contact</w:t></w:r></w:p></w:hdr>`);
  const preview=unzipSync(previewCompatibleDocx(Buffer.from(zipSync(files))));const xml=strFromU8(preview['word/document.xml']!);
  assert.match(xml,/<w:tab w:val="left" w:pos="8650"\/>/);
  assert.doesNotMatch(xml,/<w:tab w:val="right" w:pos="9720"\/>/);
  assert.equal((xml.match(/<w:tab\/>/g)??[]).length,1);
  assert.doesNotMatch(xml,/r:id="empty"/);assert.match(xml,/r:id="contact"/);
});
test('Google token encryption authenticates ciphertext without storing plaintext',()=>{
  process.env.SESSION_SECRET='unit-test-key-with-at-least-32-characters';const token={refresh_token:'test-private-value'};const encrypted=seal(token);assert.ok(!encrypted.includes(token.refresh_token));assert.deepEqual(unseal(encrypted),token);const parts=encrypted.split('.');parts[2]=Buffer.from('tampered').toString('base64');assert.throws(()=>unseal(parts.join('.')));
});
