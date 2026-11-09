"use client";

import { useEffect, useState } from "react";

export default function WhatsAppManualSettings() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("يوجد حالة Sepsis جديدة، يرجى المتابعة.");
  const [accessKey, setAccessKey] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [messageSid, setMessageSid] = useState("");
  const [delivery, setDelivery] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => { try { setPhone(localStorage.getItem("ssts-manual-whatsapp-phone") ?? ""); } catch {} }, []);
  function savePhone() {
    if (!/^\+?\d{8,15}$/.test(phone.replace(/\s/g, ""))) { setNotice("أدخلي رقمًا صحيحًا مع مفتاح الدولة"); return; }
    try { localStorage.setItem("ssts-manual-whatsapp-phone", phone.trim()); setNotice("تم حفظ الرقم على هذا المتصفح"); }
    catch { setNotice("تعذر حفظ الرقم على هذا المتصفح"); }
  }
  async function send() {
    if (!confirm("هل تريدين إرسال الرسالة الآن عبر Twilio إلى الرقم المحدد؟")) return;
    setBusy(true); setMessageSid(""); setDelivery(""); setNotice("جارٍ إرسال الرسالة...");
    try {
      const res = await fetch("/api/whatsapp/manual", { method: "POST", headers: { "Content-Type": "application/json", "x-manual-send-key": accessKey }, body: JSON.stringify({ to: phone, message }) });
      const data = await res.json();
      if (res.ok) {
        setMessageSid(data.sid ?? "");
        setDelivery(data.status ?? "queued");
        setNotice("قبل Twilio طلب الإرسال. اضغطي تحقق من التسليم لمعرفة النتيجة.");
      } else setNotice(data.error ?? "فشل الإرسال");
    } catch { setNotice("تعذر الاتصال بالخادم"); } finally { setBusy(false); }
  }
  async function checkDelivery() {
    if (!messageSid) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/whatsapp/manual?sid=${encodeURIComponent(messageSid)}`, { headers: { "x-manual-send-key": accessKey }, cache: "no-store" });
      const data = await res.json();
      if (!res.ok) setNotice(data.error ?? "تعذر التحقق من التسليم");
      else { setDelivery(data.status ?? "unknown"); if (data.errorCode) setNotice(`فشل التسليم من Twilio (${data.errorCode}): ${data.errorMessage ?? "راجعي سجل Twilio"}`); }
    } catch { setNotice("تعذر التحقق من التسليم"); }
    finally { setChecking(false); }
  }
  const inputStyle = { width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, background: "white" };
  return <section dir="rtl" style={{ maxWidth: 750, padding: 24, margin: 24, border: "1px solid #dbe3ee", borderRadius: 14, background: "white" }}>
    <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>إرسال واتساب يدويًا من Twilio</h1>
    <p style={{ color: "#475569", marginBottom: 20 }}>اكتبي أي رسالة تجريبية وأرسليها عبر رقم Twilio WhatsApp المحدد في إعدادات Vercel.</p>
    <label htmlFor="manual-phone" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>رقم المستلم مع مفتاح الدولة</label>
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}><input id="manual-phone" type="tel" dir="ltr" placeholder="+9665XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle}/><button type="button" onClick={savePhone} style={{ whiteSpace: "nowrap", padding: "8px 16px", borderRadius: 8, background: "#0b2a55", color: "white" }}>حفظ الرقم</button></div>
    <label htmlFor="manual-message" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>نص الرسالة</label>
    <textarea id="manual-message" rows={6} maxLength={1200} value={message} onChange={e => setMessage(e.target.value)} style={{ ...inputStyle, lineHeight: 1.8, marginBottom: 16 }}/>
    <label htmlFor="manual-key" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>رمز الإرسال الخاص (عند عدم تسجيل الدخول كمسؤول)</label>
    <input id="manual-key" type="password" autoComplete="off" value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="رمز الإرسال المحدد في Vercel" style={{ ...inputStyle, marginBottom: 16 }}/>
    <button type="button" disabled={busy || !phone.trim() || !message.trim()} onClick={send} style={{ background: "#047857", color: "white", border: 0, borderRadius: 8, padding: "12px 20px", fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "جارٍ الإرسال..." : "إرسال عبر Twilio"}</button>
    {messageSid && <div style={{ marginTop: 14, padding: 12, background: "#f1f5f9", borderRadius: 8 }}>
      <p>حالة الرسالة: <strong>{delivery === "delivered" || delivery === "read" ? "تم التسليم" : delivery === "failed" || delivery === "undelivered" ? "فشل التسليم" : delivery === "sent" ? "تم الإرسال ولم يتأكد التسليم" : "قيد المعالجة"}</strong> ({delivery})</p>
      <button type="button" onClick={checkDelivery} disabled={checking} style={{ padding: "9px 14px", borderRadius: 8, background: "#0b2a55", color: "white" }}>{checking ? "جارٍ التحقق..." : "تحقق من التسليم"}</button>
    </div>}
    {notice && <p role="status" style={{ marginTop: 14, color: notice.includes("فشل") || notice.includes("غير") || notice.includes("تعذر") ? "#b91c1c" : "#0f5132", overflowWrap: "anywhere" }}>{notice}</p>}
    <p style={{ fontSize: 12, color: "#64748b", marginTop: 16 }}>لإرسال نص حر يجب أن تكون نافذة خدمة العملاء (24 ساعة من آخر رسالة واردة) مفتوحة. Sandbox يتطلب انضمام المستلم، أما رقم المستشفى المعتمد فلا يتطلب الانضمام إلى Sandbox. لا تدرجي بيانات المرضى. حفظ الرقم محلي على هذا المتصفح فقط.</p>
  </section>;
}
