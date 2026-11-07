import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,type RenderTask} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=worker;
export function PdfPreview({url,text}:{url:string;text:string}){
 const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  let disposed=false,render:RenderTask|undefined,observer:ResizeObserver|undefined,width=0;
  setLoading(true);setError('');
  const document=getDocument({url,withCredentials:true});
  void document.promise.then(async pdf=>{
   const page=await pdf.getPage(1);
   async function paint(){
    if(disposed||!host.current||!canvas.current)return;
    const next=host.current.clientWidth;if(!next||width===next)return;width=next;
    render?.cancel();if(render)await render.promise.catch(()=>{});
    if(disposed)return;
    const viewport=page.getViewport({scale:next/page.getViewport({scale:1}).width});
    const density=Math.min(window.devicePixelRatio||1,2),element=canvas.current!,context=element.getContext('2d');if(!context)throw new Error('PDF preview is unavailable. Download the PDF to review it.');
    element.width=Math.ceil(viewport.width*density);element.height=Math.ceil(viewport.height*density);element.style.width=`${viewport.width}px`;element.style.height=`${viewport.height}px`;
    render=page.render({canvas:element,canvasContext:context,viewport,transform:density===1?undefined:[density,0,0,density,0,0]});
    await render.promise;if(!disposed)setLoading(false);
   }
   const update=()=>{void paint().catch(e=>{if(!disposed&&e.name!=='RenderingCancelledException'){setError('PDF preview could not load. Use the PDF download to review it.');setLoading(false);}});};
   observer=new ResizeObserver(update);if(host.current)observer.observe(host.current);update();
  }).catch(()=>{if(!disposed){setError('PDF preview could not load. Use the PDF download to review it.');setLoading(false);}});
  return()=>{disposed=true;observer?.disconnect();render?.cancel();void document.destroy();};
 },[url]);
 return <div ref={host} className="resume-pdf pdf-preview" role="region" aria-label="Tailored resume PDF" aria-busy={loading}>{loading&&<p className="pdf-loading" role="status">Loading PDF…</p>}{error&&<p className="inline-error" role="alert">{error}</p>}<canvas ref={canvas} role="img" aria-label="One-page tailored resume"/><span className="sr-only">{text}</span></div>;
}
