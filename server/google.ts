import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { google } from 'googleapis';
import { database, get, put, rootDatabase } from './store.js';
import { accountById, accountForGoogle, establishSession, type Account } from './auth.js';
import { inWorkspace, workspaceId } from './workspace-context.js';

const scope='https://www.googleapis.com/auth/drive.file';
const key=()=>createHash('sha256').update(process.env.SESSION_SECRET ?? '').digest();
export function seal(value:unknown){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;}
export function unseal<T>(value:string):T{const [iv,tag,body]=value.split('.');const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv!,'base64'));decipher.setAuthTag(Buffer.from(tag!,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body!,'base64')),decipher.final()]).toString('utf8'));}
export const appOrigin=()=>new URL(process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:5173').origin;
export const redirectUri=()=>`${appOrigin()}/api/google/callback`;
export const googleConfigured=()=>Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const client=()=>{if(!googleConfigured())throw new Error('Set the Google OAuth client ID and secret on the server first.');return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,redirectUri());};
export async function googleConnected(){return googleConfigured()&&Boolean(await get('private','google-token')||(workspaceId()==='legacy'&&process.env.GOOGLE_REFRESH_TOKEN));}
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/api/google/callback',maxAge:10*60*1000};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type State={binding:string;codeVerifier:string;nonce:string;expiresAt:number;accountId?:string};
function start(connect:boolean):RequestHandler{return async(_req,res)=>{
  const account=connect?res.locals.account as Account:undefined;
  const auth=client(),state=randomBytes(32).toString('hex'),binding=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex');
  const {codeVerifier,codeChallenge}=await auth.generateCodeVerifierAsync();
  const db=await rootDatabase();await db.query("DELETE FROM oauth_states WHERE (data->>'expiresAt')::bigint<$1",[Date.now()]);
  await db.query('INSERT INTO oauth_states(id,data) VALUES($1,$2)',[state,JSON.stringify({binding:hash(binding),codeVerifier,nonce,expiresAt:Date.now()+600000,accountId:account?.id})]);
  res.cookie('google_oauth',binding,cookieOptions).json({url:auth.generateAuthUrl({scope:['openid','email','profile',scope],access_type:'offline',prompt:connect?'consent':'consent select_account',include_granted_scopes:true,login_hint:account?.email,state,nonce,code_challenge:codeChallenge,code_challenge_method:'S256' as never})});
};}
export const googleSignIn=start(false);
export const googleStart=start(true);
export const googleCallback:RequestHandler=async(req,res)=>{
  res.set('Cache-Control','no-store');
  const state=typeof req.query.state==='string'?req.query.state:'';
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('google_oauth='))?.slice(13)??'';
  if(!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(cookie)){res.status(400).send('Google connection expired. Return to the workspace and try again.');return;}
  const db=await rootDatabase();const record=await db.query("DELETE FROM oauth_states WHERE id=$1 AND data->>'binding'=$2 AND (data->>'expiresAt')::bigint>$3 RETURNING data",[state,hash(cookie),Date.now()]);
  res.clearCookie('google_oauth',cookieOptions);
  if(!record.rows.length){res.status(400).send('Google connection expired or was already used. Start again from the workspace.');return;}
  if(req.query.error){res.redirect(`${appOrigin()}/?google=cancelled`);return;}
  try{
    const auth=client(),data=record.rows[0]!.data as State;
    if(typeof req.query.code!=='string')throw new Error('Missing code');
    const {tokens}=await auth.getToken({code:req.query.code,codeVerifier:data.codeVerifier,redirect_uri:redirectUri()});
    if(!tokens.id_token)throw new Error('Missing Google identity');
    const ticket=await auth.verifyIdToken({idToken:tokens.id_token,audience:process.env.GOOGLE_CLIENT_ID});const profile=ticket.getPayload();
    if(!profile?.sub||!profile.email||!profile.email_verified||profile.nonce!==data.nonce)throw new Error('Invalid Google identity');
    let account:Account;
    if(data.accountId){
      const existing=await accountById(data.accountId);
      if(!existing||existing.google_sub!==profile.sub){res.redirect(`${appOrigin()}/?google=wrong-account`);return;}
      account=existing;
    }else account=await accountForGoogle({sub:profile.sub,email:profile.email,name:profile.name||profile.email,authoritativeEmail:profile.email.endsWith('@gmail.com')||Boolean(profile.hd)});
    await inWorkspace(account.workspace_id,async()=>{
      if(tokens.refresh_token&&tokens.scope?.split(' ').includes(scope))await put('private','google-token',{encrypted:seal({refresh_token:tokens.refresh_token}),connectedAt:new Date().toISOString(),email:profile.email});
    });
    establishSession(res,account);res.redirect(`${appOrigin()}/?google=${data.accountId?'connected':'signed-in'}`);
  }catch{res.redirect(`${appOrigin()}/?google=failed`);}
};
export async function googleAuth(){
  const auth=client();const stored=await get<{encrypted:string}>('private','google-token');
  const refresh_token=stored?unseal<{refresh_token:string}>(stored.encrypted).refresh_token:workspaceId()==='legacy'?process.env.GOOGLE_REFRESH_TOKEN:undefined;
  if(!refresh_token)throw new Error('Connect your Google account before creating a document.');
  auth.setCredentials({refresh_token});return auth;
}
export const googleDisconnect:RequestHandler=async(_req,res)=>{
  const stored=await get<{encrypted:string}>('private','google-token');
  if(stored){const auth=await googleAuth();await auth.revokeCredentials();await(await database()).query("DELETE FROM workspace_records WHERE workspace_id=$1 AND kind='private' AND id='google-token'",[workspaceId()]);}
  res.json({ok:true});
};
// Resolve ownership from the previously authorized Google account, never from
// whichever new visitor happens to be first to sign in after the upgrade.
export async function bootstrapLegacyOwner(){
  const db=await rootDatabase();if((await db.query("SELECT id FROM app_metadata WHERE id='legacy-owner'")).rows.length||!googleConfigured())return;
  await inWorkspace('legacy',async()=>{
    if(!await googleConnected())return;
    const auth=await googleAuth();const response=await google.drive({version:'v3',auth}).about.get({fields:'user(emailAddress)'});
    const email=response.data.user?.emailAddress;if(!email)throw new Error('Could not identify the existing workspace owner.');
    await db.query("INSERT INTO app_metadata(id,data) VALUES('legacy-owner',$1) ON CONFLICT DO NOTHING",[JSON.stringify({email})]);
  });
}
