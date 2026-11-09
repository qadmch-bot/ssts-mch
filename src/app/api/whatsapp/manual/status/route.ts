import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { currentProfile } from "@/lib/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function equal(a:string,b:string) { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
export async function GET(req:Request) {
  const profile=await currentProfile().catch(()=>null);
  const role=profile && ["admin","quality_admin","quality","super_admin"].includes(String(profile.role).toLowerCase());
  const key=(process.env.MANUAL_WHATSAPP_SEND_KEY??"").trim();
  const provided=(req.headers.get("x-manual-send-key")??"").trim();
  if(!role && !(key.length>=24 && equal(key,provided))) return NextResponse.json({error:"غير مصرح"},{status:401});
  const sid=new URL(req.url).searchParams.get("sid")??"";
  if(!/^SM[a-fA-F0-9]{32}$/.test(sid)) return NextResponse.json({error:"معرف الرسالة غير صحيح"},{status:400});
  const account=process.env.TWILIO_ACCOUNT_SID; const token=process.env.TWILIO_AUTH_TOKEN;
  if(!account || !token) return NextResponse.json({error:"إعدادات Twilio ناقصة"},{status:503});
  try {
    const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages/${sid}.json`,{headers:{Authorization:`Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`},cache:"no-store",signal:AbortSignal.timeout(15000)});
    const data=await res.json();
    if(!res.ok) return NextResponse.json({error:data.message??"تعذر الاستعلام"},{status:502});
    return NextResponse.json({sid:data.sid,status:data.status,errorCode:data.error_code,errorMessage:data.error_message});
  } catch { return NextResponse.json({error:"تعذر الاتصال بـ Twilio"},{status:502}); }
}
