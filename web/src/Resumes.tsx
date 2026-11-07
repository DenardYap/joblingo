import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Resume } from '../../shared/workspace';
import { api, displayDate } from './lib/api';
import { Icon } from './Icons';

export function Resumes({ resumes, refresh, leaveRef, onRemoved, onRestored }: { resumes: Resume[]; onRemoved: (id:string) => void; onRestored: (resume:Resume) => void; refresh: () => void; leaveRef: RefObject<(() => Promise<boolean>) | null> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removedId,setRemovedId]=useState<string|null>(null);
  const [selected, setSelected] = useState<Resume | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const dirty = Boolean(selected && editing && (name !== selected.name || text !== selected.text));
  async function save() {
    if (busy) return false;
    if (!dirty || !selected) return true;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await api<Resume>(`/resumes/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name, text, revision: selected.revision ?? 1 }) });
      setSelected(updated); setName(updated.name); setText(updated.text); setEditing(false);
      setMessage('Resume saved. Future searches and tailored drafts will use these changes.'); refresh(); return true;
    } catch (error) { setError((error as Error).message); return false; } finally { setBusy(false); }
  }
  useEffect(() => { leaveRef.current = save; return () => { leaveRef.current = null; }; });
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  async function open(resume: Resume) {
    if (!await save()) return;
    setSelected(selected?.id === resume.id ? null : resume); setEditing(false); setError(''); setMessage('');
  }
  function edit() { if (!selected) return; setName(selected.name); setText(selected.text); setEditing(true); setError(''); setMessage(''); }
  async function upload(file?: File) {
    if (!file || !await save()) return;
    setBusy(true); setError(''); setMessage(''); const data = new FormData(); data.append('resume', file);
    try { const resume = await api<Resume>('/resumes', { method: 'POST', body: data }); setSelected(resume); setEditing(false); setMessage('Resume uploaded.'); refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function remove() {
    if (!selected || busy) return;
    const id=selected.id; setBusy(true); setError(''); setMessage('');
    try {
      const result=await api<{canRestore:boolean}>(`/resumes/${id}`,{method:'DELETE'});
      setSelected(null); setEditing(false); setRemovedId(result.canRestore ? id : null);
      onRemoved(id); setMessage('Resume removed.'); refresh();
    } catch(error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!removedId || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const resume=await api<Resume>(`/resumes/${removedId}/restore`,{method:'POST'});
      onRestored(resume); setRemovedId(null); setSelected(resume); setMessage('Resume restored.'); refresh();
    } catch(error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="resumes-page"><div className="section-top"><div><h2>Your base resumes</h2><p>Choose the matching resume in Search settings. Edit the working copy here; the uploaded text stays preserved.</p></div><button className="button primary" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16} />Upload resume</button><input hidden ref={input} type="file" accept=".pdf,.docx,.txt" onChange={(e) => void upload(e.target.files?.[0])} /></div><p className="muted small">PDF, DOCX, or TXT · up to 5 MB. Resume text goes to OpenAI for matching and tailoring. Only extracted skill keywords go to Exa search.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}<p className="small muted" role="status">{message}{removedId&&<button type="button" className="text-button" disabled={busy} onClick={()=>void restore()}>Undo</button>}</p>
    {resumes.length ? <div className="resume-list">{resumes.map((resume) => <button key={resume.id} disabled={busy} className="resume-row" aria-expanded={selected?.id === resume.id} onClick={() => void open(resume)}><Icon name="file" /><span><strong>{resume.name}</strong><small>{resume.updatedAt ? 'Edited' : 'Added'} {displayDate(resume.updatedAt ?? resume.createdAt)} · Version {resume.revision ?? 1}</small></span><Icon name="chevron" size={14} /></button>)}</div> : <div className="empty-state"><Icon name="file" size={28} /><h2>Add your first resume</h2><p>Upload a base resume to match jobs and create tailored versions.</p></div>}
    {selected && <div className="resume-text">{editing ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label htmlFor="base-resume-name">Resume name</label><input id="base-resume-name" required maxLength={160} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /><label htmlFor="base-resume-text">Resume content</label><textarea id="base-resume-text" className="base-resume-editor" required minLength={50} maxLength={50000} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} /><div className="draft-actions"><button className="button primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save resume'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</button><span className="small muted">{dirty ? 'Unsaved changes · saved when you close' : 'No changes'}</span></div></form> : <><div className="section-top"><h3>{selected.name}</h3><div className="draft-actions"><a className="button secondary" href={`/api/resumes/${selected.id}/original`} target="_blank" rel="noreferrer">View original</a><button className="button secondary" onClick={edit}>Edit resume</button><button className="button secondary" disabled={busy} onClick={()=>void remove()}>{busy ? 'Removing…' : 'Remove resume'}</button></div></div><pre>{selected.text}</pre>{selected.originalText && selected.originalText !== selected.text && <details><summary>Original uploaded text</summary><pre>{selected.originalText}</pre></details>}</>}</div>}
  </section>;
}
