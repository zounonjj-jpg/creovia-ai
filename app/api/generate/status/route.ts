import { NextRequest,NextResponse } from 'next/server';
import {createClient} from '@supabase/supabase-js';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\\s+/i,'');const id=new URL(req.url).searchParams.get('id');
  if(!token||!id)return NextResponse.json({error:'Authentication and job ID required.'},{status:400});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,credentials=process.env.HF_CREDENTIALS;
  if(!url||!anon||!credentials)return NextResponse.json({error:'Provider is not configured.'},{status:503});
  const sb=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user}}=await sb.auth.getUser(token);if(!user)return NextResponse.json({error:'Invalid session.'},{status:401});
  const {data:job,error}=await sb.from('generation_jobs').select('*').eq('id',id).eq('user_id',user.id).single();
  if(error||!job)return NextResponse.json({error:'Job not found.'},{status:404});
  const rid=job.output?.provider_request_id;if(!rid)return NextResponse.json({error:'Provider request ID missing.'},{status:409});
  const response=await fetch('https://api.higgsfield.ai/requests/'+encodeURIComponent(rid)+'/status',{headers:{Authorization:'Key '+credentials},cache:'no-store'});
  const result=await response.json();if(!response.ok)return NextResponse.json({error:'Could not read provider status.',details:result},{status:response.status});
  const state=String(result.status||'processing').toLowerCase();const terminal=['completed','failed','nsfw','canceled','cancelled'].includes(state);
  const status=state==='completed'?'completed':(['failed','nsfw','canceled','cancelled'].includes(state)?'failed':'processing');
  await sb.from('generation_jobs').update({status,output:{...job.output,provider_result:result},error_message:status==='failed'?(result.error||state):null,...(terminal?{completed_at:new Date().toISOString()}:{})}).eq('id',id).eq('user_id',user.id);
  return NextResponse.json({job_id:id,status,result});
 }catch(e:any){return NextResponse.json({error:e.message||'Status check failed.'},{status:500});}
}
