تعديل إشعارات واتساب لنظام Sepsis

ارفع الملفات الثلاثة التالية إلى مساراتها داخل المستودع (استبدال الموجود):
src/app/settings/page.tsx
src/app/api/whatsapp/manual/route.ts
src/app/api/whatsapp/manual/status/route.ts (ملف جديد)

إعدادات Vercel المطلوبة:
TWILIO_ACCOUNT_SID = قيمة الحساب الحالية
TWILIO_AUTH_TOKEN = رمز الحساب الحالي
TWILIO_WHATSAPP_FROM = whatsapp:+17722962666
MANUAL_WHATSAPP_SEND_KEY = مفتاحك السري الحالي
TWILIO_SEPSIS_CONTENT_SID = HX... (معرف Content Template معتمد لدى واتساب، يتضمن متغير النص {{1}})

إنشاء القالب:
Twilio Console > Messaging > Content Template Builder > Create new template.
استخدمي قالبًا من نوع WhatsApp-approved مناسبًا للإشعارات، ومثال نص ثابت:
تنبيه من مستشفى الولادة والأطفال: {{1}}
يجب تقديمه للمراجعة واعتماده قبل استخدامه خارج نافذة الـ24 ساعة.
لا ترسلي بيانات شخصية أو تفاصيل مرضى عبر نص المتغير.

بعد الحفظ: Redeploy من Vercel ثم افتحي /settings?tab=whatsapp.

ملاحظات:
- جهات الاتصال تحفظ محليًا في المتصفح، لا على قاعدة بيانات مشتركة.
- حالة queued لا تعني التسليم؛ استخدمي زر تحقق من التسليم.
- المتغير الحر في القالب يخضع لمراجعة وسياسات WhatsApp؛ لا يعني إمكانية إرسال أي نص دون قيود.
- لم يتم إجراء اختبار اتصال فعلي بحساب Twilio أو نشر إلى Vercel.
