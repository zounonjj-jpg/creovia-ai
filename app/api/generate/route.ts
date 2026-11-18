import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const runtime='nodejs';

export async function POST(req:NextRequest){
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return NextResponse.json({error:'Authentication required.'},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!anon)return NextResponse.json({error:'Supabase is not configured.'},{status:503});
  const supabase=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  if(userError||!user)return NextResponse.json({error:'Invalid session.'},{status:401});
  const body=await req.json();
  const prompt=String(body.prompt||'').trim();
  if(!prompt)return NextResponse.json({error:'A prompt is required.'},{status:400});
  const kind=body.type==='image'?'image':body.type==='video'?'video':null;
  if(!kind)return NextResponse.json({error:'Choose either image or video generation.'},{status:400});
  const provider=body.provider==='gemini'?'gemini':'higgsfield';
  const ratio=['16:9','4:3','1:1','3:4','9:16','21:9'].includes(body.aspect_ratio)?body.aspect_ratio:'16:9';
  const duration=kind==='video'?Math.max(4,Math.min(30,Number(body.duration)||5)):null;
  let model='',requestId:string|null=null,statusUrl:string|null=null,output:any={},jobStatus:'processing'|'completed'='processing';

  if(provider==='gemini'){
   const apiKey=process.env.GEMINI_API_KEY;
   if(!apiKey)return NextResponse.json({error:'GEMINI_API_KEY is not configured in Vercel Production environment.'},{status:503});
   if(kind==='image'){
    model='gemini-3.1-flash-image';
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
     method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
     body:JSON.stringify({contents:[{parts:[{text:prompt+' Create the image in '+ratio+' aspect ratio.'}]}]}),cache:'no-store'
    });
    const result=await response.json();
    if(!response.ok){
     const providerMessage=String(result?.error?.message||'Gemini image generation failed.');
     const quotaHit=response.status===429||/quota exceeded|free.?tier.*limit|requests per day/i.test(providerMessage);
     if(quotaHit)return NextResponse.json({code:'GEMINI_IMAGE_QUOTA_EXCEEDED',error:'Google Gemini Image has no available quota for this API project. The response reports a free-tier limit of 0. Check Google AI Studio billing and model limits, or switch the provider to Higgsfield. Waiting alone may not restore a quota whose limit is 0.'},{status:429});
     return NextResponse.json({error:providerMessage,details:result},{status:response.status});
    }
    const parts=result?.candidates?.[0]?.content?.parts||[];
    const imagePart=parts.find((part:any)=>part.inlineData?.data);
    if(!imagePart)return NextResponse.json({error:'Gemini responded but did not return an image. Try a more specific prompt.',details:parts.filter((part:any)=>part.text).map((part:any)=>part.text)},{status:502});
    const mimeType=imagePart.inlineData.mimeType||'image/png';
    const extension=mimeType.includes('jpeg')?'jpg':mimeType.includes('webp')?'webp':'png';
    const path=user.id+'/gemini-'+Date.now()+'.'+extension;
    const bytes=Buffer.from(imagePart.inlineData.data,'base64');
    const uploaded=await supabase.storage.from('creovia-assets').upload(path,bytes,{contentType:mimeType,upsert:false});
    if(uploaded.error)return NextResponse.json({error:'Gemini created the image, but saving it failed: '+uploaded.error.message},{status:500});
    const signed=await supabase.storage.from('creovia-assets').createSignedUrl(path,60*60*24*7);
    if(signed.error)return NextResponse.json({error:'Image created but its preview link could not be prepared.'},{status:500});
    output={images:[{url:signed.data.signedUrl}],provider_result:{model,finishReason:result?.candidates?.[0]?.finishReason||null}};
    jobStatus='completed';
   }else{
    if(body.image_url)return NextResponse.json({error:'Gemini video currently accepts text prompts in this CREOVIA test. Remove the reference image or choose Higgsfield for image-to-video.'},{status:400});
    model='veo-3.1-fast-generate-preview';
    const form=new FormData();
    form.set('model',model);form.set('prompt',prompt);
    form.set('extra_body',JSON.stringify({duration_seconds:8,aspect_ratio:ratio}));
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/openai/videos',{method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,cache:'no-store'});
    const result=await response.json();
    if(!response.ok)return NextResponse.json({error:result?.error?.message||'Gemini video generation failed.',details:result},{status:response.status});
    requestId=result.id||result.operation_id||null;
    if(!requestId)return NextResponse.json({error:'Gemini did not return a video operation ID.',details:result},{status:502});
    output={provider_request_id:requestId,provider_result:result};
   }
  }else{
   const credentials=process.env.HF_CREDENTIALS||process.env.HF_API_KEY;
   if(!credentials)return NextResponse.json({error:'Higgsfield API credentials are not configured in Vercel Production.'},{status:503});
   const imageRatio=['auto','1:1','3:2','2:3','4:3','3:4','16:9','9:16','21:9'].includes(ratio)?ratio:'16:9';
   model=kind==='image'?'marketing-studio/image':(body.image_url?'bytedance/seedance-2.5/image-to-video':'bytedance/seedance-2.5/text-to-video');
   const input:any=kind==='image'?{prompt,resolution:'2k',aspect_ratio:imageRatio,enhance_prompt:false}:{prompt,duration,resolution:['480p','720p','1080p'].includes(body.resolution)?body.resolution:'720p',output_format:'mp4',generate_audio:body.generate_audio!==false};
   if(body.image_url){if(kind==='image')input.image_urls=[String(body.image_url)];else input.image_url=String(body.image_url);}
   else if(kind==='video')input.aspect_ratio=ratio;
   if(kind==='image'){
    input.quality='high';
    input.moderation='auto';
   }
   const response=await fetch('https://api.higgsfield.ai/'+model,{method:'POST',headers:{Authorization:'Key '+credentials,'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store'});
   const rawResponse=await response.text();
   let result:any;
   try{result=rawResponse?JSON.parse(rawResponse):{};}catch{result={raw_response:rawResponse.slice(0,2000)};}
   if(!response.ok){
    const providerError=result?.error;
    const providerMessage=typeof providerError==='string'?providerError:providerError?.message||result?.message||result?.detail||'Higgsfield rejected the request.';
    const code=providerError?.code||result?.code||providerError?.type||null;
    const guidance=response.status===401?'Higgsfield API key is invalid. Check that HF_CREDENTIALS contains the complete API key copied from Open Higgsfield.':response.status===403?'Higgsfield denied this request. Check API account access, permissions and prepaid API balance.':response.status===402?'Higgsfield API balance may be empty. The website subscription and API balance are separate.':response.status===400||response.status===422?'Higgsfield rejected one or more request parameters. The provider details are included below.':'Check the Higgsfield API account, model availability and prepaid balance.';
    return NextResponse.json({error:providerMessage,provider:'higgsfield',provider_status:response.status,provider_code:code,request_id:result?.request_id||null,guidance,details:result},{status:response.status});
   }
   requestId=result.request_id||result.id||null;statusUrl=result.status_url||null;
   if(!requestId)return NextResponse.json({error:'Higgsfield did not return a request ID.',details:result},{status:502});
   output={provider_request_id:requestId,status_url:statusUrl,provider_result:null};
  }

  const insert={user_id:user.id,job_type:kind,provider,model,prompt,input:{aspect_ratio:ratio,...(kind==='video'?{duration}:{}),provider},output,status:jobStatus,...(jobStatus==='completed'?{completed_at:new Date().toISOString()}:{})};
  const {data:job,error:dbError}=await supabase.from('generation_jobs').insert(insert).select('id,status,created_at,output,provider,model').single();
  if(dbError)return NextResponse.json({error:'Generation was accepted but could not be saved to your history: '+dbError.message,request_id:requestId},{status:500});
  return NextResponse.json({job,request_id:requestId,status_url:statusUrl});
 }catch(e:any){return NextResponse.json({error:e.message||'Unexpected generation error.'},{status:500});}
}
