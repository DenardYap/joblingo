import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { rootDatabase } from './store.js';
import { inWorkspace } from './workspace-context.js';
export type Account={id:string;google_sub:string;email:string;name:string;workspace_id:string};
const secure = process.env.NODE_ENV === 'production';
const SESSION_AGE = 30 * 86400000;
const cookieOptions = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/',maxAge:SESSION_AGE };
function equal(a: string, b: string) { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
function signature(value: string) {return createHmac('sha256', process.env.SESSION_SECRET!).update(`${value}:${process.env.APP_PASSWORD}`).digest('hex');}
const cookie=(req:Request,name:string)=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)??'';
function valid(value:string,version:string){const parts=value.split('.');const sig=parts.pop()??'';const expiry=parts[1]??'';return parts[0]===version&&/^\d+$/.test(expiry)&&Number(expiry)>Date.now()&&Number(expiry)<=Date.now()+SESSION_AGE&&/^[a-f0-9]{64}$/.test(sig)&&equal(sig,signature(parts.join('.')))?parts:null;}
export function gateAccepted(req:Request){const value=valid(cookie(req,'workspace_gate')||cookie(req,'workspace_session'),'v1');return Boolean(value?.length===3&&/^[a-f0-9]{48}$/.test(value[2]!));}
function setGate(res:Response){const payload=`v1.${Date.now()+SESSION_AGE}.${randomBytes(24).toString('hex')}`;res.cookie('workspace_gate',`${payload}.${signature(payload)}`,cookieOptions);}
export function establishSession(res:Response,account:Account){
  const payload=`v2.${Date.now()+SESSION_AGE}.${account.id}.${randomBytes(24).toString('hex')}`;
  setGate(res);res.cookie('workspace_session',`${payload}.${signature(payload)}`,cookieOptions);
}
export async function sessionAccount(req:Request):Promise<Account|null>{
  if(!gateAccepted(req))return null;
  const value=valid(cookie(req,'workspace_session'),'v2');
  if(value?.length!==4||!/^[a-f0-9-]{36}$/.test(value[2]!)||!/^[a-f0-9]{48}$/.test(value[3]!))return null;
  const result=await(await rootDatabase()).query('SELECT * FROM workspace_accounts WHERE id=$1',[value[2]]);
  return result.rows[0] as Account??null;
}
export async function accountById(id:string){const r=await(await rootDatabase()).query('SELECT * FROM workspace_accounts WHERE id=$1',[id]);return r.rows[0] as Account??null;}
export async function accountForGoogle(profile:{sub:string;email:string;name:string;authoritativeEmail:boolean}):Promise<Account>{
  const db=await rootDatabase();
  const legacy=await db.query("SELECT data FROM app_metadata WHERE id='legacy-owner'");
  const owner=(legacy.rows[0]?.data as {email?:string}|undefined)?.email;
  const claimLegacy=profile.authoritativeEmail&&owner?.toLowerCase()===profile.email.toLowerCase();
  const id=randomUUID();
  const result=await db.query(`INSERT INTO workspace_accounts(id,google_sub,email,name,workspace_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,name=excluded.name RETURNING *`,[id,profile.sub,profile.email,profile.name,claimLegacy?'legacy':`user-${id}`]);
  return result.rows[0] as Account;
}
export function validateProduction() {
  if (!process.env.APP_PASSWORD) throw new Error('Configure APP_PASSWORD to protect this workspace.');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('Configure a random SESSION_SECRET of at least 32 characters.');
}
const attempts = new Map<string, { count: number; until: number }>();
export const login: RequestHandler = (req, res) => {
  const key = req.ip ?? 'local'; const now = Date.now();
  for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
  const current = attempts.get(key);
  if (current && current.count >= 10) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  if (!current && attempts.size >= 10000) { res.status(429).json({error:'Too many attempts. Try again later.'}); return; }
  const attempt = current ?? { count: 0, until: now + 900000 };
  attempt.count++; attempts.set(key, attempt);
  if (typeof req.body?.password !== 'string' || !equal(req.body.password, process.env.APP_PASSWORD!)) { res.status(401).json({ error: 'Incorrect password.' }); return; }
  attempts.delete(key);setGate(res);res.set('Cache-Control','no-store').json({ok:true});
};
export const logout:RequestHandler=(_req,res)=>{res.set('Cache-Control','no-store').clearCookie('workspace_session',cookieOptions).clearCookie('workspace_gate',cookieOptions).json({ok:true});};
export const requireGate:RequestHandler=(req,res,next)=>{res.set('Cache-Control','no-store');if(gateAccepted(req))next();else res.status(401).json({error:'Enter the site password first.'});};
export const authStatus:RequestHandler=async(req,res)=>{const account=await sessionAccount(req);res.set('Cache-Control','no-store').json({passwordAccepted:gateAccepted(req),googleConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),account:account?{id:account.id,email:account.email,name:account.name}:null});};
export const protect:RequestHandler=async(req,res,next)=>{
  res.set('Cache-Control','no-store');const account=await sessionAccount(req);
  if(!account){res.status(401).json({error:'Sign in with Google to open your private workspace.'});return;}
  res.locals.account=account;inWorkspace(account.workspace_id,next);
};
export const sameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
    const configured = process.env.APP_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
    const allowed = configured ? [configured.replace(/\/$/, '')] : secure ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001'];
    if (!allowed.includes(origin)) { res.status(403).json({ error: 'Request origin is not allowed.' }); return; }
  }next();
};
