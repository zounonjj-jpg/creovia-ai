import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return NextResponse.json({error:'Authentication required.'},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, credentials=process.env.HF_CREDENTIALS;
  if(!url||!anon)return NextResponse.json({error:'Supabase is not configured.'},{status:503});
  if(!credentials)return NextResponse.json({error:'Higgsfield API credentials are not configured yet.'},{status:503});
  const supabase=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user)return NextResponse.json({error:'Invalid session.'},{status:401});
  const body=await req.json();const prompt=String(body.prompt||'').trim();const duration=Math.max(4,Math.min(30,Number(body.duration)||5));
  const ratio=['16:9','4:3','1:1','3:4','9:16','21:9'].includes(body.aspect_ratio)?body.aspect_ratio:'16:9';
  if(!prompt)return NextResponse.json({error:'A prompt is required.'},{status:400});
  const kind=body.type==='image'?'image':'video';
  const imageRatio=['auto','1:1','3:2','2:3','4:3','3:4','16:9','9:16','21:9'].includes(ratio)?ratio:'16:9';
  const model=kind==='image'?'marketing-studio/image':(body.image_url?'bytedance/seedance-2.5/image-to-video':'bytedance/seedance-2.5/text-to-video');
  const input:any=kind==='image'?{prompt,resolution:'2k',aspect_ratio:imageRatio,enhance_prompt:false}:{prompt,duration,resolution:['480p','720p','1080p'].includes(body.resolution)?body.resolution:'720p',output_format:'mp4',generate_audio:body.generate_audio!==false};
  if(body.image_url){if(kind==='image')input.image_urls=[String(body.image_url)];else input.image_url=String(body.image_url);}
  else if(kind==='video')input.aspect_ratio=ratio;
  const response=await fetch('https://api.higgsfield.ai/'+model,{method:'POST',headers:{Authorization:'Key '+credentials,'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store'});
  const result=await response.json();
  if(!response.ok)return NextResponse.json({error:result?.message||result?.error||'Higgsfield rejected the request.',details:result},{status:response.status});
  const requestId=result.request_id||result.id;
  if(!requestId)return NextResponse.json({error:'Provider did not return a request ID.',details:result},{status:502});
  const {data:job,error:dbError}=await supabase.from('generation_jobs').insert({user_id:user.id,job_type:kind,provider:'higgsfield',model,prompt,input:{...input,aspect_ratio:ratio},output:{provider_request_id:requestId,status_url:result.status_url||null},status:'processing'}).select('id,status,created_at').single();
  if(dbError)return NextResponse.json({error:'Generation submitted but job tracking failed.',request_id:requestId},{status:500});
  return NextResponse.json({job,request_id:requestId,status_url:result.status_url||null});
 }catch(e:any){return NextResponse.json({error:e.message||'Unexpected generation error.'},{status:500});}
}
