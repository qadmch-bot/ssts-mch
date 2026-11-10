# تفعيل إشعارات Sepsis التلقائية

1. ارفعي ملفات هذا المشروع إلى مستودع GitHub الصحيح (محتويات ZIP مباشرة في جذر المستودع).
2. في Vercel > Settings > Environment Variables ضعي القيم الحقيقية: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (مثال: `+17722962666`), `TWILIO_SEPSIS_CONTENT_SID` (معرّف القالب المعتمد). لا تضعي الأسرار في GitHub.
3. أعيدي النشر Redeploy.
4. في Settings > Notifications/Recipients: فعّلي الأشخاص المطلوبين، اختاري WhatsApp وحدث `New Sepsis Case / case_registered`، ثم فعّلي قاعدة WhatsApp لنفس الحدث.
5. سجّلي حالة تجريبية **غير حقيقية** في بيئة اختبار، وتأكدي من سجل التسليم. لا تنشئي حالة وهمية في قاعدة الإنتاج.

**مهم:** هذا التعديل يرسل تلقائيًا بعد حفظ الحالة باستخدام `register_case` في جدول `cases` فقط، ولا يرسل عند إضافة صفوف إلى `sepsis_excel_import`. لا يوجد رمز إرسال يدوي في هذا المسار. الإرسال للمستلمين المفعّلين فقط، وبدون معلومات المريض.

**تنبيه:** يجب ضبط CRON_SECRET وتشغيل `/api/cron/reminders` دوريًا لاسترداد الرسائل التي فشل إرسالها لحظيًا. قبول Twilio للرسالة لا يعني تأكيد وصولها للهاتف؛ راجعي سجلات Twilio وحالة التسليم.
