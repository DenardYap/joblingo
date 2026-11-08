import Exa, { type AgentRun } from 'exa-js';
import { bindExaReservation, budgetDay, reserveExa, settleExa, settleExaRun } from './exa-budget.js';

type Client=Pick<Exa,'search'|'getContents'> & {agent:{runs:Pick<Exa['agent']['runs'],'create'|'get'|'pollUntilFinished'|'cancel'>}};
const terminal=(run:AgentRun)=>['completed','failed','cancelled'].includes(run.status);
// All paid Exa entry points pass through the same durable budget. Uncertain
// failures keep their reservation: retries cannot buy the same request for free.
export function meteredExa(raw:Exa):Client {
  const bootstrap=async()=>{
    let total=0,cursor:string|undefined;
    for(let page=0;page<100;page++){
      const result=await raw.agent.runs.list({limit:100,...(cursor?{cursor}:{})});
      for(const run of result.data)if(run.createdAt && budgetDay(new Date(run.createdAt))===budgetDay())total+=terminal(run)?run.costDollars?.total ?? 1:(run.request?.budget as {maxCostDollars?:number}|undefined)?.maxCostDollars ?? 1;
      if(!result.hasMore || !result.nextCursor || result.data.some(run=>run.createdAt && budgetDay(new Date(run.createdAt))<budgetDay()))return total;
      cursor=result.nextCursor;
    }
    throw new Error('Cannot verify existing Exa usage. Spending is blocked.');
  };
  const paid=async(maximum:number,request:()=>Promise<any>)=>{
    const reservation=await reserveExa(maximum,bootstrap);
    const result=await request();
    await settleExa(reservation,result.costDollars?.total);
    return result;
  };
  const runs=new Proxy(raw.agent.runs,{get(target,key){
    const method=Reflect.get(target,key);
    if(key==='create')return async(...args:any[])=>{
      const options=args[0];
      if(options.stream)throw new Error('Streaming research is not supported by the budget guard.');
      const fixed:Record<string,number>={minimal:0.012,low:0.025,medium:0.10,high:0.50,xhigh:1};
      const maximum=options.effort==='auto'||options.effort==='ultra' ? options.budget?.maxCostDollars : fixed[options.effort];
      if(!maximum || options.dataSources?.length)throw new Error('Research requires a bounded budget and no paid enrichment sources.');
      const reservation=await reserveExa(maximum+0.01,bootstrap);
      const run=await Reflect.apply(method,target,args) as AgentRun;
      await bindExaReservation(reservation,run.id);
      if(terminal(run))await settleExa(reservation,run.costDollars?.total);
      return run;
    };
    if(['get','pollUntilFinished','cancel'].includes(String(key)))return async(...args:any[])=>{
      try {const run=await Reflect.apply(method,target,args) as AgentRun;if(terminal(run))await settleExaRun(run.id,run.costDollars?.total);return run;}
      catch(error){const run=(error as {run?:AgentRun}).run;if(run && terminal(run))await settleExaRun(run.id,run.costDollars?.total);throw error;}
    };
    return undefined;
  }});
  return new Proxy(raw,{get(target,key){
    if(key==='agent')return {runs};
    if(key==='search')return (...args:any[])=>{
      const options=args[1] ?? {};if(options.stream || !['auto','lite',undefined].includes(options.type))throw new Error('Unsupported search mode for the budget guard.');
      const count=options.numResults ?? 10;if(!Number.isInteger(count)||count<1||count>100)throw new Error('Search count must be 1–100.');
      return paid(0.1+count*0.005,()=>Reflect.apply(target.search,target,args));
    };
    if(key==='getContents')return (...args:any[])=>paid(Math.max(1,args[0].length)*0.02,()=>Reflect.apply(target.getContents,target,args));
    return undefined;
  }}) as Client;
}
export function exaClient(){if(!process.env.EXA_API_KEY)throw new Error('Configure EXA_API_KEY on the server.');return meteredExa(new Exa(process.env.EXA_API_KEY,undefined,{timeout:90000}));}
