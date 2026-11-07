# B0 — عقد الواجهة والمصادقة وحدود التجربة

واجهة تقنية محلية مؤقتة، ليست حسابات B1 أو سجل إنجاز B2. جدول `foundation_checks` يثبت المرور من Auth إلى API إلى PostgreSQL بسياسة ملكية فعلية. لا بيانات شخصية حقيقية ولا أسرار كنف.

## عقد التجربة

| المسار | المدخل | النتيجة |
|---|---|---|
| `GET /api/v1/health` | لا شيء | status=ok، stage=B0، serverTime بصيغة ISO؛ لا يزعم سلامة DB |
| `GET /api/v1/foundation/checks` | Bearer JWT صالح من Auth | آخر 20 سجلًا يملكها المستخدم؛ no-store |
| `POST /api/v1/foundation/checks` | Bearer JWT وJSON `{label}`، 1–120 حرفًا بعد trim | سجل واحد مع id وowner_id وcreated_at؛ المالك يؤخذ من الهوية المتحقق منها |
| `OPTIONS /api/v1/foundation/checks` | Origin محدد بالقائمة | preflight للأفعال والـheaders المطلوبة فقط |

الأخطاء لها `{error:{code}}`: 400 JSON معطوب، 401 هوية مفقودة/غير صالحة، 403 Origin غير مسموح، 404 التجربة معطلة، 413 body فوق 2048 byte، 415 نوع محتوى خاطئ، 422 مدخل غير صالح، 503 إعداد/خدمة غير متاحة. لا تفاصيل DB أو credentials في الرد.

المخططات التنفيذية في `packages/contracts/src/index.ts`. تجارب POST هنا لا تدّعي idempotency أو سجل أحداث المنتج؛ هذا API مؤقت لا يُستخدم لحفظ التقدم. أوامر المنتج في B1/B2 تتبع عقود operationId/revision في ARCHITECTURE_AND_DATA.

## الهوية والصلاحيات

- B0 يستخدم حسابات اختبار email/password على GoTrue حقيقي مع autoconfirm محلي فقط. هذا لا يثبت Google OAuth أو Email OTP/SMTP أو session persistence المطلوبة لاحقًا.
- الواجهة تحتفظ بالجلسة في الذاكرة؛ reload يحتاج تسجيل الدخول مجددًا بينما السجل محفوظ في DB. لا tokens في localStorage أو URLs أو logs.
- API يتحقق من JWT عبر Auth getUser، ثم يمرر JWT نفسه إلى PostgREST؛ RLS يتحقق من auth.uid(). لا service-role key في التطبيق.
- `owner_id` إضافي من العميل يُرفض؛ READ/INSERT فقط، وتحديث/حذف السجل غير ممنوحين. Sign out يمسح بيانات العرض حتى عند فشل الشبكة.
- Origin allowlist للموبايل/واجهة منفصلة؛ ليست بديلًا للمصادقة. لا cookies في proof client، ولذلك لا يوجد ambient cookie-auth mutation في هذه التجربة.

## ما يجب تنفيذه في B1/M0

- ويب: Supabase SSR cookie session وتجديده وفق SDK، مع HttpOnly حيث يلائم آلية SDK، وSameSite/Secure وحماية Origin/CSRF للأفعال التي تعتمد على cookies. لا نعد بأن كل cookie للـSDK HttpOnly قبل إثبات مسار التجديد.
- Android: OAuth في متصفح النظام بمسار مدعوم، PKCE وروابط عودة محصورة، تخزين جلسة عبر adapter مصان ومراجع؛ اختبار إلغاء/انتهاء/تبديل حساب. اختبار build الحالي لا يثبت هذه الوظائف.
- مراجعة origins حسب البيئة وعدم استخدام `*` مع بيانات خاصة. localhost origins تخص التجربة، لا قائمة إنتاج جاهزة.
- rate limits مشتركة، session lifecycle، outbox/idempotency وتدقيق RLS لكل ميزة وفق المعمارية.

## فصل التجربة عن الإطلاق

المسارات الحساسة والواجهة معطلة افتراضيًا ما لم يكن `DIMA_B0_ENABLED=true` في إعداد محلي. Workers config لا يحتوي أسرارًا ولا دومينًا أو نشرًا تلقائيًا. يلزم حذف probe endpoints والجدول وبياناته التجريبية عبر migration مراجعة قبل B7؛ تعطيل API وحده لا يغلق PostgREST إذا نُقل الجدول إلى بيئة عامة.

إعداد البيئة موجود في `.env.example` و`.dev.vars.example`. ملفات الإعداد الفعلية محلية تجاهلها Git؛ لا تُرفع إلى المستودع أو تسجل نتائج الاختبارات محتواها.
