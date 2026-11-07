# B0 — عقد واجهة الرحلة الأولى وحالاتها

31 أكتوبر 2026. وثيقة تنفيذ للحالات الأولى، مشتقة من PRD وSCREEN_SPEC؛ ليست بناءً لـB1/B2 ولا تصميمًا بصريًا جديدًا. الواجهة بالإنجليزية؛ هوية ديمة واللاندنج المقبولة محفوظتان. نمط صفحات العضو **Operate**، واللاندنج **Persuade**.

## المهمة والحدود

يدخل المتعلم، يختار كورسًا أو يضيفه، يحدد السابق والتوفر، يفهم معاينة خطة، ثم يحفظ أول إنجاز ويسترجعه من جهاز آخر. الخطوة التالية هي مركز الشاشة. مسار Work-only يتجاوز الكورس؛ رابط روم محفوظ يعود إلى وجهته عندما تُبنى الغرف في B5.

الألوان والخطوط والتباعد من `assets/reference-ui/foundations/`، والشعار من `assets/reference-ui/assets/logo/`. لا تعني بيانات النموذج المحلي أن المستخدم الحقيقي يملك خطة أو ترتيبًا. لا أرقام نشاط أو حسابات تجريبية تظهر كحقيقة إنتاجية.

## عقد التنقل

| السياق | ترتيب الوجهات | سلوك |
|---|---|---|
| Desktop | Today / My Plan / My Courses / Focus / Progress / Library | قائمة جانبية واضحة، العنوان والفعل الرئيسي فوق المحتوى، الحساب والإعدادات في الخدمات |
| Mobile | Today / Plan / Focus / Courses / More | تنقل سفلي ثابت مع مساحة آمنة؛ More يجمع Progress وLibrary وContributions وSettings |
| الكورس | Outline / Progress / People / Leaderboard | لا يعرض People أوLeaderboard بيانات خاصة؛ حالات عدم المشاركة واضحة |
| رابط محمي | Sign in ثم الوجهة المسموحة الأصلية | احتفاظ بالنية دون open redirect؛ لا إعادة إجبار المستخدم على خطة |

لا نبني أزرارًا تبدو عاملة لميزات مراحل لاحقة. في بناء مرحلي داخلي نظهر فقط الوجهات المتاحة أو توضيحًا صريحًا للحالة. لا نعوض التنقل ببحث أو اختصار لوحة مفاتيح وحده.

## حالات كل خطوة

| الخطوة | الشكل والفعل الأساسي | الحالات المطلوبة |
|---|---|---|
| Sign in | خيارات الدخول ثم رسالة نتيجة/عودة | Sending / Check your email / Expired link / Retry؛ إلغاء OAuth يعود لنفس السياق؛ لا رسالة تكشف وجود حساب خاص |
| Onboarding | Name → Timezone → Learning or Work | تحقق بجانب الحقل، حفظ المدخلات عند الفشل، timezone قابلة للتصحيح؛ Work لا يحتاج Course |
| Library | بحث ثم عروض حقيقية مرتبة؛ Create private course متاح | Loading؛ No results مع Clear filters؛ فشل القائمة مع Retry؛ لا تحويل الخطأ إلى مكتبة فارغة |
| Course | ملخص ومنهج مرتب وRequired/Optional ثم Join | نسخة/نطاق محددان، إظهار السابق كBaseline منفصل؛ تفاصيل غير متاحة لا تُعرض من cache خاص لحساب آخر |
| Private course | Title ثم Modules/Tasks مرتبة ومصادر خارجية | Draft / Saving / Saved / Failed؛ فشل الحفظ يحتفظ بالنص؛ تغيير بنيوي مع تقدم لاحقًا يحتاج معاينة أثر |
| Plan setup | موعد وتوفر مشترك وأيام راحة ثم Preview | تقدير ناقص واضح؛ لا موعد متوقع مختلق؛ كورس ثانٍ يستخدم نفس السعة |
| Plan preview | Before/After، الحمل، الهدف والتوقع، غير الموزع | Fits / At risk / Incomplete estimates؛ Apply فقط وفق قواعد صلاحية الجزء الممكن وإقرار المستخدم |
| Today | النشاط التالي، مصدره، حمل اليوم، بقية الخطوات | أول استخدام، يوم راحة، قائمة مكتملة، يوم فائت، خطأ جزئي، Pending sync؛ لا إحصاء يطغى على الفعل |
| Complete / Undo | تحديث النشاط مع مؤشر الحفظ وUndo واضح | Saving ثم Saved بعد commit؛ Failed/Retry؛ تعارض من جهاز ثانٍ؛ لا توليد ساعات من Complete |

## مخططات ترتيب بسيطة

```text
Desktop / Today
┌Navigation────┬───────────────────────────────────────────┐
│ Today        │ Today                         Save status │
│ My Plan      │ Your next step                            │
│ My Courses   │ Course / Module / Activity                │
│ Focus        │ [Open resource]  [Mark complete]          │
│ Progress     │ Remaining today / planned effort          │
│ Library      │ Next activities in course order           │
│ Settings     │ Plan adjustment notice, only when needed  │
└──────────────┴───────────────────────────────────────────┘

Mobile / Today
┌─────────────────────────────────┐
│ Dima                  Account   │
│ Today                Save state │
│ Next activity                   │
│ Course and module context       │
│ [Open resource]                 │
│ [Mark complete]                 │
│ Remaining today                 │
│ Next activities                 │
│ ...space above fixed navigation │
├─────────────────────────────────┤
│ Today Plan Focus Courses More   │
└─────────────────────────────────┘

Plan preview
Current inputs → Proposed workload → Target / Forecast
               → Unallocated work and why
[Back to edit]                   [Apply plan]

Conflict
Your progress changed on another device.
Your current draft is still available.
[Review latest version]          [Keep editing draft]
```

Start focus يُضاف عندما تعمل خدمة الوقت B4؛ المخطط لا يبيح زرًا وهميًا أو timer محليًا بديلًا عن السجل المركزي. المقاييس اليومية في B2 تُسمى planned effort ولا تُعرض كوقت مسجل.

## نموذج حالة الحفظ والأخطاء

| الحالة | النص المقترح | ما يضمنه النظام وما يفعله المستخدم |
|---|---|---|
| Loading | “Loading your plan…” | skeleton بنفس بنية المحتوى؛ لا كشف آخر خطة لحساب مختلف |
| Empty | “Your first course starts here.” | فعل Add a course واضح؛ صفر بيانات حقيقي، لا خطأ شبكة |
| Saving | “Saving…” | الطلب جارٍ؛ منع إرسال مزدوج أو استخدام operationId نفسه |
| Saved | “Saved” | تأكيد الخادم فقط؛ تفاصيل الوقت عند الحاجة |
| Pending sync | “Saved on this device. Waiting to sync.” | حفظ محلي مثبت للعمل المسموح؛ لا يظهر قبل نجاح الكتابة المحلية |
| Failed | “Couldn’t save. Your changes are still here.” | المدخلات محفوظة إن ثبت ذلك؛ Retry يعيد نفس العملية عند فقد الرد |
| Local storage failed | “Couldn’t save on this device. Keep this page open and retry.” | لا وعد باسترجاع بعد الإغلاق؛ إتاحة نسخ المدخلات إن أمكن |
| Conflict | “Your plan changed. Review the latest version.” | الاحتفاظ بالمسودة؛ لا silent overwrite ولا Apply لمعاینة قديمة |
| Offline | “You’re offline.” | بيان الأفعال المتاحة والمعلقة؛ Start/Resume/Apply/Publish/Join تحتاج اتصالًا |
| Session expired | “Sign in to continue.” | إعادة مصادقة آمنة؛ عزل بيانات الحساب والطابور وعدم كشفها للتالي |

النجاح/الفشل ليسا لونًا فقط. `role=status` لتغير حالة الحفظ؛ تنبيه الخطأ الحاسم قابل للقراءة دون سرقة focus في كل تحديث. Inline validation مربوط بالحقل، مع ملخص أخطاء عند إرسال نموذج طويل. إعادة المحاولة لا تمسح المدخلات.

## الحركة والإتاحة والاستجابة

- نحتفظ بحركة اللاندنج كما في المرجع؛ داخل المنتج انتقال قصير يشرح إكمال نشاط أو تغيير خطة، ولا يحرك هدف اللمس أو يمنع القراءة.
- reduced motion يلغي الزخرفة والحركة غير اللازمة. لا إعلان عداد كل ثانية لقارئ الشاشة.
- التركيز ظاهر ويعود إلى العنصر الذي فتح dialog؛ Escape والغلق والرجوع لا يحذفان عملًا غير محفوظ دون بيان.
- نص طويل، عنوان كورس عربي داخل LTR، 320/375/768/1280px، تكبير 200% وإعادة تدفق 400%، ولوحة مفاتيح هاتف: حالات تحقق فعلية عند بناء الشاشة، لا ادعاء اكتمالها الآن.
- الأفعال الأساسية تستهدف 44×44 CSSpx؛ WCAG AA ليس معناه أن كل الأزرار ملزمة بـ44. ألوان النص تُراجع على الخلفية الفعلية، خاصة البرتقالي.
- شريط جلسة لاحقًا والتنقل السفلي لا يحجبان آخر عنصر أو focus، وsafe-area تدخل في حساب المسافات.

## مخرجات B0 وما يأتي بعده

المخرج هنا ترتيب وحالات وسلوك قابل للتنفيذ. B1 يختبر الدخول والعزل والـshell المتاح؛ B2 يختبر رحلة تعلم حقيقية وفتح جهاز ثانٍ. M0 يضيف الرجوع وروابط التطبيق وتخزين الجلسة على Android. لا يستبدل هذا العقد الحالات الأوسع أو الاختبارات الموجودة في SCREEN_SPEC وDELIVERY_AND_ACCEPTANCE.
