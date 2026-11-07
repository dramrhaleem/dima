# B5 — إسقاط الأعضاء بالمجموعات: migration 031

**الحالة: مطبقة محليًا؛ التكافؤ الوظيفي مثبت، والحكم على أداء الحمل لم يُحسم بهذا الدليل.** التغيير في [migration 031](../../supabase/migrations/20261101031000_rooms_set_based_projection.sql)، SHA256: `917f90ee24c88911643f94884806d6d1640b96ce48947f9aa36da30e76b98ac0`. لا تنفيذ B6 ضمنه.

| الدالة | التغيير المقصود |
|---|---|
| `rooms_live_members(uuid,timestamptz)` | helper جديدة تعيد علاقة الأعضاء المؤهلين، بسياق Room/Run واحد وفحوص set-based للحظر من الروم وإيقاف الحساب. |
| `rooms_public_json(uuid,timestamptz)` | reserved/connected counts تستخدم العلاقة نفسها، مستقلة عن Block الخاص بالمشاهد. بقية DTO والتطبيع محفوظان. |
| `read_room_snapshot(uuid)` | roster تستخدم العلاقة، ثم تستبعد Block في الاتجاهين؛ ترتيب المشاهد أولًا ثم joinedAt/id وشكل profile/focus لم يتغيرا. |
| `rooms_emit_locked(uuid,timestamptz,boolean)` | تحسب phase-key والعددين فقط، دون بناء DTO عامة كاملة. حساب phase/effective status/counts في statement واحدة يحفظ snapshot مشتركة؛ no-op/force وتحديث outbox كما كانت. |

العلاقة تعكس `rooms_member_live`: active، visibility1، lease **أكبر بصرامة** من now−180s، وعدم وجود suspension/ban غير مسحوبة؛ الروم open أو closed مع current run active وdeadline أكبر من now. Connected يبقى أكبر بصرامة من now−90s. counts لا تُرشَّح بعلاقات المشاهد. التطبيع open/completed إلى `lobby::` لا يتجاوز effective archive status؛ cancelled/completed في الروم المغلقة يبقيان دلالتهما.

الـhelper `STABLE SECURITY INVOKER` مع `search_path=''`، غير متاحة لـPUBLIC/anon/authenticated، ومتاحة لـservice_role داخل الحد الموثوق القائم. مالك وصلاحيات وأوضاع الأمان للدوال الثلاث الموجودة محفوظة. فحوص actor scalar وonboarding، وأقفال Account→Rooms→Runs، وتسوية الوقت و`rooms_time_cutoff` بقيت دون تغيير. DTO المستخدمة بعد emission تقرأ hintVersion الجديدة؛ لا إعادة استعمال نسخة قبل الزيادة.

**الدليل:** [اختبار التكافؤ](B5_SET_BASED_PARITY_16d98329-4c3c-431d-8168-1c509ecac829.json) نجح في **46 حالة**: حواف90/180 الدقيقة، حالة الروم/الجولة، bans/suspensions وسحبها، Block في الاتجاهين، actor denials، جلسات running/paused وcontroller/cutoff، وno-op/forced hints. قورنت JSON وحالة الجداول كاملة ضمن fixtures؛ الاستثناء الوحيد للتطبيع UUID صف time_outbox الجديد، مع حفظ بقية حقوله وعدده ومفتاح dedupe. نجح رفض أدوار المستخدم للـhelper، وبقيت خصائص الدوال. بعد ROLLBACK تطابقت hashes **35 جدولًا ضمن نطاق fixture** وتعريفات/خصائص الدوال مع ما قبل الاختبار.

[إثبات التطبيق المحلي](B5_MIGRATION031_APPLIED.json) يسجل أربع دوال متغيرة فقط، دون حذف دوال، receipt جديدة031، وreceipts السابقة دون تغيير. التطبيق نفذه root بعد الاختبار؛ لا نشر مستضاف في هذا الدليل.

**حد الاستنتاج:** الاختبار يثبت التكافؤ الوظيفي بوقت snapshot مثبت داخل نسختي الاختبار وأقفال synthetic مسبقة؛ ليس HTTP/Auth/pool/Realtime أو قياس real-boundary متزامنًا. تشخيص030 التاريخي أشار إلى كلفة scalar predicates، لكنه لا ينسب كل التأخير إليها ولا يثبت تحسن031. `participantsOnly` في [التشخيص القديم](../../tests/integration/rooms-boundary-read-cost.mjs) يبقى legacy030 control دون تعديل workload؛ أدلته القديمة تاريخية. يلزم حمل فعلي لاحق قبل حكم الأداء أو إغلاق بوابة B5.
