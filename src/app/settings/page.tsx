"use client";

import { useState } from "react";

const DEFAULT_MESSAGE = `🚨 *تنبيه حالة Sepsis جديدة*

مستشفى الولادة والأطفال بحفر الباطن
إدارة الجودة وسلامة المرضى

نفيدكم بأنه تم تسجيل حالة جديدة مشتبه بها أو مؤكدة للإنتان (Sepsis).

يرجى من الفريق المختص متابعة الحالة والتأكد من تطبيق حزمة الساعة الأولى (Sepsis Hour-1 Bundle) وفق البروتوكول المعتمد.

*هذه رسالة تنبيه من نظام متابعة حالات Sepsis.*`;

export default function WhatsAppAlertButton() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [error, setError] = useState("");

  function openWhatsApp() {
    const normalized = phone.replace(/[^\d]/g, "").replace(/^00/, "");
    if (!/^\d{8,15}$/.test(normalized)) {
      setError("أدخلي رقم المستلم مع مفتاح الدولة، مثل 9665XXXXXXXX.");
      return;
    }
    if (!message.trim()) {
      setError("اكتبي نص الرسالة أولًا.");
      return;
    }
    setError("");
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section dir="rtl" style={{ maxWidth: 700, padding: 24, border: "1px solid #dbe3ee", borderRadius: 14, background: "white" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>إرسال تنبيه Sepsis عبر واتساب</h2>
      <p style={{ color: "#475569", marginBottom: 20 }}>اكتبي الرسالة واختاري المستلم، ثم افتحي واتساب لإرسالها يدويًا.</p>
      <label htmlFor="sepsis-wa-phone" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>رقم المستلم مع مفتاح الدولة</label>
      <input id="sepsis-wa-phone" type="tel" inputMode="tel" dir="ltr" placeholder="9665XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 16 }} />
      <label htmlFor="sepsis-wa-message" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>نص التنبيه (قابل للتعديل)</label>
      <textarea id="sepsis-wa-message" rows={12} value={message} onChange={e => setMessage(e.target.value)} style={{ width: "100%", padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, lineHeight: 1.8 }} />
      {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
      <button type="button" onClick={openWhatsApp} style={{ background: "#047857", color: "white", border: 0, borderRadius: 8, padding: "12px 20px", fontWeight: 700, marginTop: 16, cursor: "pointer" }}>فتح واتساب وإرسال التنبيه</button>
      <p style={{ fontSize: 12, color: "#64748b", marginTop: 12 }}>لا تدرجي اسم المريض أو رقم ملفه الطبي أو أي معلومات تحدد هويته. لا يرسل هذا الزر أي رسالة تلقائيًا.</p>
    </section>
  );
}
