import { NextRequest,NextResponse } from 'next/server';
import {createClient} from '@supabase/supabase-js';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');const id=new URL(req.url).searchParams.get('id');
  if(!token||!id)return NextResponse.json({error:'Authentication and job ID required.'},{status:400});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!anon)return NextResponse.json({error:'Supabase is not configured.'},{status:503});
  const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user}}=await sb.auth.getUser(token);if(!user)return NextResponse.json({error:'Invalid session.'},{status:401});
  const {data:job,error}=await sb.from('generation_jobs').select('*').eq('id',id).eq('user_id',user.id).single();
  if(error||!job)return NextResponse.json({error:'Job not found.'},{status:404});
  if(job.status==='completed'||job.status==='failed')return NextResponse.json({job_id:id,status:job.status,result:job.output});
  const rid=job.output?.provider_request_id;if(!rid)return NextResponse.json({error:'Provider request ID missing.'},{status:409});
  let response:Response;
  if(job.provider==='gemini'){
   const apiKey=process.env.GEMINI_API_KEY;
   if(!apiKey)return NextResponse.json({error:'GEMINI_API_KEY is not configured.'},{status:503});
   response=await fetch('https://generativelanguage.googleapis.com/v1beta/openai/videos/'+encodeURIComponent(rid),{headers:{Authorization:'Bearer '+apiKey},cache:'no-store'});
  }else{
   const credentials=process.env.HF_CREDENTIALS||process.env.HF_API_KEY;
   if(!credentials)return NextResponse.json({error:'Higgsfield API credentials are not configured.'},{status:503});
   response=await fetch('https://api.higgsfield.ai/requests/'+encodeURIComponent(rid)+'/status',{headers:{Authorization:'Key '+credentials},cache:'no-store'});
  }
  const providerResult=await response.json();
  if(!response.ok)return NextResponse.json({error:providerResult?.error?.message||providerResult?.message||'Could not read provider status.',details:providerResult},{status:response.status});
  const rawState=String(providerResult.status||'processing').toLowerCase();
  const completed=['completed','succeeded','success'].includes(rawState);
  const failed=['failed','error','cancelled','canceled','nsfw'].includes(rawState);
  const status=completed?'completed':failed?'failed':'processing';
  const normalized=job.provider==='gemini'?{video:{url:providerResult.url||providerResult.video?.url||providerResult.output?.url||null},provider_result:providerResult}:{...providerResult};
  const updatedOutput={...job.output,...normalized};
  const {error:updateError}=await sb.from('generation_jobs').update({status,output:updatedOutput,error_message:failed?(providerResult.error?.message||providerResult.error||rawState):null,...((completed||failed)?{completed_at:new Date().toISOString()}:{})}).eq('id',id).eq('user_id',user.id);
  return NextResponse.json({job_id:id,status,result:updatedOutput,warning:updateError?.message||undefined});
 }catch(e:any){return NextResponse.json({error:e.message||'Status check failed.'},{status:500});}
}
