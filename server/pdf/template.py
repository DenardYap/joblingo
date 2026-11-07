"""Edit only original PDF bullet/skills regions; preserve all other page content."""
import json, re, sys, math
from pathlib import Path
import pymupdf as fitz
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT

fitz.TOOLS.set_small_glyph_heights(True)
def lines_of(page):
    lines=[]
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines',[]):
            text=''.join(s['text'] for s in line['spans']).strip()
            if text: lines.append({**line,'text':text})
    return sorted(lines,key=lambda l:(round(l['bbox'][1],1),l['bbox'][0]))
def slots_of(doc):
    if len(doc)!=1: raise ValueError('Upload a one-page PDF resume for layout-preserving tailoring.')
    lines=lines_of(doc[0]);slots=[];section='';context='Work experience';current=None;index=0
    for i,line in enumerate(lines):
        text=line['text'];y=line['spans'][0]['origin'][1]
        if re.fullmatch(r'(?:WORK |PROFESSIONAL )?EXPERIENCE',text,re.I):section='work';current=None;continue
        if text.upper()=='EDUCATION':section='education';current=None;continue
        if re.fullmatch(r'(?:TECHNICAL )?SKILLS',text,re.I):section='skills';current=None;continue
        if section=='work':
            if text in ['•','\u00b7','\uf0b7']:
                current={'id':f'b{index}','label':context+' · bullet','lines':[]};slots.append(current);index+=1;continue
            if current is not None and (not current['lines'] or abs(line['bbox'][0]-current['lines'][0]['bbox'][0])<1) and not (line['spans'][0]['flags']&18):
                current['lines'].append(line)
            else:
                current=None
                if line['spans'][0]['flags']&2:context=text
        elif section=='skills':
            slots.append({'id':f'b{index}','label':'Skills','lines':[line]});index+=1
    slots=[s for s in slots if s['lines']]
    if len(slots)<2:raise ValueError('Could not identify editable work bullets and skills in this PDF.')
    for slot in slots:
        ls=slot['lines'];span=ls[0]['spans'][0]
        slot.update(text=' '.join(l['text'] for l in ls),x=ls[0]['bbox'][0],baseline=span['origin'][1],size=span['size'],font=span['font'],lineHeight=(ls[1]['spans'][0]['origin'][1]-span['origin'][1])if len(ls)>1 else 13.25,maxLines=len(ls),right=doc[0].rect.width-36)
    return slots

def font_for(doc,page,slot,text):
    # Reuse the actual embedded font, including its original glyph metrics.
    # A similarly named system font or Liberation replacement is insufficient
    # for a PDF whose uploaded typography is the layout contract.
    for entry in page.get_fonts(full=True):
        if entry[3].split('+')[-1]!=slot['font'].split('+')[-1]:continue
        raw=doc.extract_font(entry[0])[3]
        if not raw:continue
        font=fitz.Font(fontbuffer=raw)
        missing=sorted({c for c in text if not font.has_glyph(ord(c))})
        if missing:raise ValueError('The original embedded font cannot render '+repr(''.join(missing))+'. Reword using characters already present in the resume; the font cannot be substituted.')
        return font,raw
    raise ValueError('This PDF does not embed its editable text font. Upload a PDF with embedded fonts to preserve its exact typography.')

def wrap(text,font,size,width):
    result=[];line=''
    for word in text.split():
        if font.text_length(word,fontsize=size)>width:raise ValueError('A word is wider than its original PDF text area.')
        candidate=f'{line} {word}'.strip()
        if line and font.text_length(candidate,fontsize=size)>width:result.append(line);line=word
        else:line=candidate
    if line:result.append(line)
    return result

def verify_unchanged_pixels(before,after,regions,scale=2):
    """All visible content outside the approved text areas must be identical."""
    if (before.width,before.height,before.n)!=(after.width,after.height,after.n):raise ValueError('PDF page geometry changed during editing.')
    old=before.samples;new=after.samples;stride=before.stride;channels=before.n
    boxes=[(max(0,math.floor(r.x0*scale)),max(0,math.floor(r.y0*scale)),min(before.width,math.ceil(r.x1*scale)),min(before.height,math.ceil(r.y1*scale)))for r in regions]
    for y in range(before.height):
        intervals=sorted((x0,x1)for x0,y0,x1,y1 in boxes if y0<=y<y1);cursor=0;row=y*stride
        for left,right in intervals+[(before.width,before.width)]:
            if left>cursor and old[row+cursor*channels:row+left*channels]!=new[row+cursor*channels:row+left*channels]:raise ValueError('The PDF edit changed content outside its original text area. The previous PDF is unchanged.')
            cursor=max(cursor,right)

def patch(source,out,edits):
    doc=fitz.open(source);page=doc[0];slots=slots_of(doc);allowed={s['id']:s for s in slots};seen=set();changed=[];unicode_maps={};before=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False);regions=[]
    for edit in edits:
        ident=edit['id'];text=edit['text'].strip()
        if ident not in allowed or ident in seen:raise ValueError('Only existing PDF bullets and skills can be edited.')
        if not text or len(text)>2000 or '\n' in text or '\r' in text:raise ValueError('Each bullet must be one nonempty paragraph under 2,000 characters.')
        seen.add(ident);slot=allowed[ident]
        if text==slot['text']:continue
        slot['replacement']=text; font,raw=font_for(doc,page,slot,text)
        slot['wrapped']=wrap(text,font,slot['size'],slot['right']-slot['x']);slot['fontBytes']=raw;slot['fontObject']=font
        if len(slot['wrapped'])>slot['maxLines']:raise ValueError(f"{slot['label']} exceeds its original {slot['maxLines']}-line area. Shorten that bullet.")
        regions.append(fitz.Rect(slot['x']-.75,min(l['bbox'][1]for l in slot['lines'])-1,slot['right']+.75,max(l['bbox'][3]for l in slot['lines'])+1))
        for line in slot['lines']:
            for span in line['spans']:
                if span['text'].strip():page.add_redact_annot(fitz.Rect(span['bbox']),fill=False,cross_out=False)
        changed.append(slot)
    if changed:
        # Remove actual old text for ATS/export, retaining graphics, links outside
        # the edit regions, bullet markers, headers, dates, and every other block.
        page.apply_redactions(images=0,graphics=0,text=0)
        for i,slot in enumerate(changed):
            name=f'ResumeEdit{i}';xref=page.insert_font(fontname=name,fontbuffer=slot['fontBytes'])
            mapping=unicode_maps.setdefault(xref,{})
            for c in slot['replacement']:mapping[slot['fontObject'].has_glyph(ord(c))]=c
            for line,text in enumerate(slot['wrapped']):page.insert_text((slot['x'],slot['baseline']+line*slot['lineHeight']),text,fontname=name,fontsize=slot['size'],color=(0,0,0))
        # Font cmap aliases can otherwise extract ASCII spaces/hyphens as NBSP
        # and soft hyphens. Explicit mappings preserve the actual edited text.
        for xref,mapping in unicode_maps.items():
            entries=[f'<{gid:04X}> <{char.encode("utf-16-be").hex().upper()}>' for gid,char in mapping.items()]
            chunks=['\n'.join([f'{len(entries[i:i+100])} beginbfchar',*entries[i:i+100],'endbfchar'])for i in range(0,len(entries),100)]
            cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /ResumeUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange '+'\n'.join(chunks)+' endcmap CMapName currentdict /CMap defineresource pop end end'
            ref=doc.get_new_xref();doc.update_object(ref,'<<>>');doc.update_stream(ref,cmap.encode());doc.xref_set_key(xref,'ToUnicode',f'{ref} 0 R')
    doc.save(out,garbage=4,deflate=True)
    saved=fitz.open(out)
    verify_unchanged_pixels(before,saved[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False),regions)
    return slots_of(saved)

def word_copy(pdf,out):
    """Editable paragraphs with explicit anchors, never PDF space padding.

    PDF spans contain positioned whitespace (including half-size spaces). Those
    are not portable layout instructions: Word/Docs measure them differently.
    Preserve the meaningful text and styles, and express dates as right tabs.
    Keep PDF line breaks inside each bullet rather than separate paragraphs.
    """
    source=fitz.open(pdf);page=source[0];lines=lines_of(page);doc=Document();sec=doc.sections[0]
    sec.page_width=Pt(page.rect.width);sec.page_height=Pt(page.rect.height);sec.left_margin=Pt(36);sec.right_margin=Pt(30);sec.top_margin=Pt(48);sec.bottom_margin=Pt(12)
    style=doc.styles['Normal'];style.font.name='Times New Roman';style.font.size=Pt(11);style.paragraph_format.space_after=Pt(0)
    groups=[]
    for line in lines:
        if groups and abs(groups[-1][0]['spans'][0]['origin'][1]-line['spans'][0]['origin'][1])<1:groups[-1].append(line)
        else:groups.append([line])
    # Coalesce continuation lines into the same bullet paragraph. The physical
    # line breaks remain soft breaks, so changing a bullet is a normal edit.
    items=[]
    for group in groups:
        group.sort(key=lambda l:l['bbox'][0])
        marker=group[0]['text'] in ['•','\u00b7','\uf0b7']
        continuation=(len(group)==1 and items and items[-1]['bullet'] and
                      abs(group[0]['bbox'][0]-items[-1]['textX'])<1 and
                      not(group[0]['spans'][0]['flags']&18))
        if continuation:items[-1]['groups'].append(group)
        else:items.append({'groups':[group],'bullet':marker,'textX':group[-1]['bbox'][0]})
    date=re.compile(r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}(?:\s*[–—-]\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}|Present))?\s*$',re.I)
    def fragments(group):
        # Retain character style while collapsing positioning whitespace.
        chars=[]
        for line in group:
            if chars:chars.append((' ',11,0))
            for span in line['spans']:
                for char in span['text']:
                    if char.isspace():
                        if chars and chars[-1][0]!=' ':chars.append((' ',11,0))
                    else:chars.append((char,span['size'],span['flags']))
        while chars and chars[-1][0]==' ':chars.pop()
        while chars and chars[0][0]==' ':chars.pop(0)
        return chars
    def add_chars(p,chars):
        # Merge matching runs instead of a run per character.
        batches=[]
        for c,size,flags in chars:
            key=(round(size,2),flags&18)
            if batches and batches[-1][0]==key:batches[-1][1]+=c
            else:batches.append([key,c])
        for (size,flags),text in batches:
            r=p.add_run(text);r.font.name='Times New Roman';r.font.size=Pt(size);r.bold=bool(flags&16);r.italic=bool(flags&2)
    previous=None;previous_height=19.2
    for item in items:
        group=item['groups'][0];line=group[0];chars=fragments(group);text=''.join(c[0]for c in chars)
        size=max(c[1]for c in chars);baseline=line['spans'][0]['origin'][1];height=max(13.25,size*1.15)
        p=doc.add_paragraph();fmt=p.paragraph_format;fmt.line_spacing=Pt(height);fmt.space_before=Pt(max(0,baseline-previous-previous_height))if previous is not None else Pt(0)
        fmt.widow_control=False;fmt.left_indent=Pt(max(0,line['bbox'][0]-36));fmt.right_indent=Pt(4)
        centered=size>=15 or (line['bbox'][0]>70 and 'gmail.com' in text)
        if centered:p.alignment=WD_ALIGN_PARAGRAPH.CENTER;fmt.left_indent=Pt(0)
        match=None if item['bullet'] or centered else date.search(text)
        if match and match.start()>0:
            # One right-aligned stop for role and education date columns. Never
            # copy the long strings of spaces used to position them in the PDF.
            fmt.tab_stops.add_tab_stop(Pt(page.rect.width-70),WD_TAB_ALIGNMENT.RIGHT)
            left=chars[:match.start()]
            while left and left[-1][0]==' ':left.pop()
            add_chars(p,left);p.add_run('\t');add_chars(p,[(c,11,0)for c in match.group().strip()])
        elif item['bullet']:
            fmt.left_indent=Pt(item['textX']-36);fmt.first_line_indent=Pt(line['bbox'][0]-item['textX'])
            fmt.tab_stops.add_tab_stop(Pt(item['textX']-36))
            p.add_run('•\t').font.size=Pt(11)
            add_chars(p,fragments(group[1:]))
            for following in item['groups'][1:]:p.add_run().add_break();add_chars(p,fragments(following))
        else:add_chars(p,chars)
        if text in ['WORK EXPERIENCE','EDUCATION','SKILLS']:
            from docx.oxml import OxmlElement
            from docx.oxml.ns import qn
            border=OxmlElement('w:pBdr');bottom=OxmlElement('w:bottom');bottom.set(qn('w:val'),'single');bottom.set(qn('w:sz'),'8');bottom.set(qn('w:color'),'000000');border.append(bottom);p._p.get_or_add_pPr().append(border)
        previous=item['groups'][-1][0]['spans'][0]['origin'][1];previous_height=height
    doc.save(out)

try:
    action,source=sys.argv[1:3]
    if action=='inspect':result=slots_of(fitz.open(source))
    elif action=='patch':result=patch(source,sys.argv[3],json.loads(Path(sys.argv[4]).read_text()))
    elif action=='word':word_copy(source,sys.argv[3]);result=[]
    else:raise ValueError('Unknown PDF operation.')
    print(json.dumps([{'id':s['id'],'label':s['label'],'text':s['text'],'maxLines':s['maxLines']}for s in result]))
except Exception as error:
    print(str(error),file=sys.stderr);sys.exit(1)
