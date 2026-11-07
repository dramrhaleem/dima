# دِيمة — عقد الشاشات والتنقّل والتفاعل

الإصدار 1.0 — 31 أكتوبر 2026. مواصفات تنفيذ مقترحة للويب المتجاوب، وليست شاشات أو خدمة منشورة. لغة الواجهة English/LTR؛ العربية في المحتوى وأصل الشعار محفوظة دون قلبه.

المرجع الوظيفي [PRD](PRD_AR.md)، وعقد الروم والمؤقّت [ROOMS_AND_FOCUS](ROOMS_AND_FOCUS_SPEC_AR.md)، وقواعد الاستدراك والمشاركة [RECOVERY_AND_PROGRESS](RECOVERY_AND_PROGRESS_SPEC_AR.md). هذه الوثيقة تستبدل التنقل القديم في PAGE_MAP و UX_AND_MOTION؛ أصول التصميم الموجودة ومساراتها موضحة في [دليل الحزمة](README_AR.md). النموذج الحالي HTML محلي وبيانات تجريبية؛ لا يُعامل كمحرك خطة أو React/backend جاهز.

## 1. الغلاف والتنقّل المستمر

- Desktop: **Today / My Plan / My Courses / Focus / Progress / Library**. شريط الخدمات: البحث، الإشعارات، الحساب. لا نافذة إحصاءات قبل النشاط التالي.
- Mobile: **Today / Plan / Focus / Courses / More**. More: Progress، Library، Contributions، Settings، Help. العناوين المختصرة تربط بالمسارات نفسها، دون نسخة بيانات أخرى.
- Progress: **Overview / Activity / Circle / Leaderboards**. Focus: **Solo / Rooms**. الكورس: **Outline / Progress / People / Leaderboard**؛ People يحتوي الغرف أولًا ثم الزملاء الذين اختاروا الظهور.
- التبويبات والفلاتر ذات المعنى لها URL قابل للاستعادة؛ Back يعيد البحث والفترة والوحدة والتمرير. لا تُستعاد بيانات خاصة من كاش حساب آخر.
- لكل مهمة وجلسة وطلب نشر رابط مستقل. تفاصيل المهمة لوحة جانبية واسعة/صفحة موبايل، لكن نفس الهوية والعنوان والصلاحية؛ الوصول المباشر يعمل دون قائمة أم مفتوحة.
- قائمة Ctrl/Cmd+K اختصار له زر ظاهر، يعرض وجهات ونتائج مصرحًا بها فقط؛ لا يعتمد عليه أي مسار أساسي ولا ينفذ حذفًا أو اعتمادًا بمجرد البحث.
- شريط الجلسة لا يظهر قبل وجود Session؛ بعدها يظل أثناء التنقل مع View session و Pause/Resume و Finish بحسب الحالة. على الهاتف تُحجز له مساحة فوق التنقل والحافة الآمنة، ولا يحجب لوحة المفاتيح.
- تغيير المسار الصريح ينقل التركيز لعنوان المحتوى؛ تحديث حفظ أو رقم لا يسحب التركيز. النوافذ تعيد التركيز للمشغّل عند إغلاقها.
- الزائر يستكشف المكتبة ودليل الغرف والإسقاطات العامة المصرح بها؛ العضوية وقائمة أعضاء الروم والبيانات الشخصية لها صلاحيات مستقلة. كلمة Public لا تعني نشر الخطط.

## 2. الموقع العام والحساب وأول استخدام

الأعمدة التالية عقد كل شاشة: المحتوى بالترتيب ← فعل أساسي ← حالات خاصة ← الوجهة التالية. المسارات المقترحة ثابتة داخل هذا الإصدار؛ الغلاف العام/الخاص يعيد استخدام المكوّن نفسه حيث تتطابق البيانات.

| الشاشة والمسار | الغرض والمحتوى بالترتيب | الفعل الرئيسي | الحالة الخاصة والمسار التالي |
|---|---|---|---|
| Home `/` | الوعد → معاينة موسومة Example → كيف تعمل الخطة والاستدراك → الكورسان → الرفقة والخصوصية → بداية | Build your plan | العائد يرى Open workspace؛ المعاينة لا تغير حسابًا أو تبدأ مؤقتًا؛ إلى auth أو Today |
| Library `/library` و`/app/library` | بحث → فلاتر ذات نتائج فعلية → عروض معتمدة مع المصدر واللغة والنطاق | View course | صفر نتائج: Clear filters / Create private course؛ العودة تحفظ البحث؛ لا عرض منهج Pending |
| Offering `/library/:offeringId` ونظيره داخل app | عنوان/مصدر/نسخة → ماذا يشمل → Outline → حدود التتبع → رومات مرتبطة عامة دون أعضاء | Join and plan | المنضم: Open my course؛ المصدر الخارجي لا يعني تسجيلًا عند المزوّد؛ Auth ثم Scope أو مساحته الشخصية |
| Room directory `/rooms` و`/app/rooms` | بحث/كورس/موضوع/لغة → غرف حقيقية بمرحلتها وعددها → قواعد المشاركة | View room | لا أسماء أشخاص للزائر؛ Empty: Start solo / Create room بعد الدخول؛ إلى lobby |
| Public rankings `/leaderboards` | المقياس والفترة وقواعد النشر → نتائج أصحاب الإذن العام فقط | Explore rules / Join | عدم وجود بيانات مصرح بها حالة فارغة؛ لا نستنتج consent من مشاركة داخل الكورس؛ إلى نسخة Progress |
| Public profile `/u/:handle` | اسم وصورة اختيارية ووصف اختار صاحبه نشره فقط | Request to follow بعد الدخول | لا ملخص وقت/إيقاع عام في الملف في v1؛ الملخصات للمتابعين المقبولين وفق الإذن، واللوحات العامة بإذن مستقل؛ الملف الخاص/المسحوب: Profile unavailable |
| Help `/help` | بدء الاستخدام → شرح الوقت/الإكمال → الاستدراك والغرف → قناة الدعم التشغيلية | Open relevant guide | يحتفظ بسياق الرجوع؛ لا Live chat أو زر مراسلة لا يوجد تشغيل فعلي له |
| Privacy / Terms | الجهة المشغلة وتاريخ النسخة → السياسات التي تطابق التشغيل → وسائل الطلبات | Read / Return | متاحتان دون حساب؛ النص النهائي المطلوب قبل النشر لا يُستبدل بوعد خصوصية تسويقي |
| Sign in / Sign up | سبب الدخول والوجهة التالية → Google أو Email OTP → شروط/خصوصية | Continue with Google / Send code | الطريقتان وفق عقد البنية؛ لا Password reset؛ خطأ لا يمحو المقصد، وحالة فشل إرسال OTP تتيح Retry دون ادعاء وصول البريد |
| Auth callback / Verify | حالة التحقق → رمز/إعادة إرسال/تغيير بريد عند الحاجة → نتيجة | Verify / Retry | expired/invalid/rate limited/provider cancelled؛ عودة إلى مسار داخلي مسموح، لا redirect خارجي حر |
| Onboarding `/onboarding` | اسم العرض → timezone مؤكدة → Plan learning / Track work | Continue | draft قابل للاستئناف؛ رابط الروم يتجاوز بناء الخطة بعد الحد الأدنى؛ لا تحويل الاستخدام لنوع حساب دائم |
| Course entry `/app/courses/add` | Search existing courses → Create my own | Choose course | الكورس المختار قبل الدخول يبقى مختارًا؛ يستطيع Work-only العودة لـ Focus دون إنشاء كورس |
| Scope & prior progress ضمن `/app/plan/setup` | نسخة المنهج → النطاق المطلوب/الاختياري → ما أُنجز سابقًا → ملخص الأثر | Continue | لا يُعلّم Module 2 مكتملًا لكل المستخدمين؛ تحديد السابق صريح، لا يولد ساعات، وتظهر أثره على النسبة |
| Rhythm & target ضمن setup | الأيام/السعة المشتركة → الراحة والاحتياطي → الموعد/الأولوية → التقديرات الناقصة | Preview plan | تعبئة السعة السابقة عند إضافة كورس؛ المجهول ليس صفرًا؛ يمكن ترك المسودة والعودة |
| Plan preview `/app/plan/previews/:previewId` | Target date مقابل Estimated finish → نشاط يومي مقترح → حمل كل الكورسات → تعارضات/غير موزع | Use this plan | لا اعتماد نتيجة تتجاوز السعة أو توهم توزيع كل العمل؛ التغيير الخارجي: Refresh preview؛ القبول إلى Today ولا يبدأ جلسة |

**عقد الرابط العميق:** نحفظ المقصد الداخلي ومعرّف العرض/الروم والتبويب، ثم نتحقق مجددًا بعد الدخول. الرابط المنتهي أو الروم المغلق يعرض بديلًا؛ رابط خاص بحساب مختلف يعرض عدم الإتاحة دون اسم المورد. لا يبدأ المؤقّت ولا يُعتمد طلب متابعة أو نشر بمجرد فتح رابط إشعار أو دعوة.

## 3. Today والخطة والاستدراك

| الشاشة | المحتوى بالترتيب | الفعل الرئيسي | الحالات الخاصة والربط |
|---|---|---|---|
| Today `/app/today` | اليوم وحالة الحفظ → تعارض واحد قابل للتصرف إن وجد → Next task → بقية اليوم → نظرة أسبوعية صغيرة | Continue task | Open resource وفعل الإكمال داخل المهمة؛ Start focus اختياري؛ ينتقل للمهمة أو Focus مع الاحتفاظ بسياقها |
| Today: Work-only | عنوان اليوم → Start work session → آخر جلسة/إجمالي موضح النوع → Add learning اختياري | Start work session | لا كورس وهمي أو رسالة حساب ناقص؛ Focus Work ثم بدء صريح |
| Today: Rest / All done | No study planned today أو إنجاز اليوم الحقيقي → الخطوة القادمة → تركيز اختياري | View next planned day | لا مهام إضافية مصطنعة أو فشل سلسلة؛ الدخول للغرفة لا يغير يوم الراحة تلقائيًا |
| Today: Return | Your progress is saved → نشاط صغير متاح → مقدار المتبقي الذي يحتاج توزيعًا | Review plan | Start small now بديل لا يطبق خطة جديدة؛ لا وصم أو تصفير للتاريخ بعد يومين |
| My Plan `/app/plan` | الأسبوع → الحمل لكل يوم/الراحة → أجندة مرتبة لكل الكورسات → الهدف والتوقع | Adjust plan | لا تقويم ساعات إجباري؛ نقل مهمة عبر أزرار أيضًا، لا drag فقط؛ الأسبوع محفوظ عند الرجوع |
| Adjust plan | سبب/مدخلات التعديل → السعة المشتركة → الأولوية/الأيام المثبتة → معاينة الأثر | Preview changes | تعديل المؤثرات لا يحفظ جدولًا نهائيًا مباشرة؛ إلغاء يرجع للخطة القائمة |
| Recovery `/app/plan/recovery` | ما بقي → Current مقابل Proposed → الأيام/المهام المتأثرة → الحمل/التاريخ/الغير موزع | Apply revised plan | خيارات حماية الحمل/إضافة سعة صريحة؛ إذا لا حل يظهر السبب، لا زر نجاح مضلل؛ إلى Today أو Plan |
| Task `/app/courses/:enrollmentId/tasks/:taskId` | الكورس والوحدة → المطلوب والمصدر → Required/Optional → الحالة والمتبقي → ملاحظات خاصة | Open resource أو Continue بحسب الحالة | Worked on لا يساوي Complete؛ Complete و Undo/Reopen صريحان؛ المصدر المعطّل لا يكمل المهمة |

تفاصيل قرار الاستدراك في عرضه: مقدار العمل الذي انتقل، أيام الراحة التي ستتغير إن وافق المستخدم، أثر الكورسات الأخرى، الموعد الأصلي والتوقع الجديد كلٌّ باسمه. لا نخبئ العجز في لون واحد أو نحول العمل غير الموزع إلى مهام محذوفة. التطبيق يقبل المعاينة ذات الإصدار المعروض فقط.

تعرض الخطة حالتها بالنص: Fits estimated workload / Provisional / Capacity conflict / No schedule found under these rules. Provisional لا تُعرض كوعد بالموعد؛ تبقى التقديرات المفقودة والعمل غير الموزع ظاهرين، وفشل قاعدة التوزيع لا يُصاغ كإثبات أن الوصول للموعد مستحيل.

إذا أمكن توزيع جزء صحيح فقط، يظهر Apply feasible part مع إقرار صريح بالعمل غير الموزع وبقاء الحالة Needs attention؛ backlog ظاهر في Today/Plan. لا يقبل مثبتات متناقضة أو تجاوز سعة. عند عدم توزيع أي عمل يكون الفعل Save draft، وفق عقد الاستدراك.

التأجيل Later today يغيّر ترتيب الاقتراح داخل اليوم ولا يمحو المطلوب؛ Move to another day يفتح معاينة. Pause course يحفظ الإنجاز ويُخرج متبقيه من التوزيع المستقبلي بمعاينة، و Resume course يعيد حساب الحمل المشترك؛ ليس أي منهما إكمالًا.

## 4. الكورسات والتحرير والمساهمة والنُّسخ

| الشاشة | المحتوى بالترتيب | الفعل الرئيسي | الحالات الخاصة والربط |
|---|---|---|---|
| My Courses `/app/courses` | Active / Paused / Completed → اسم/نسخة/نطاق → تقدّم بعدد صريح → نشاط تالٍ | Continue / Add course | Archived في فلتر ثانوي؛ صفر كورسات يسمح Work؛ الكورس الخاص لا يحمل علامة منشور |
| Course / Outline | المصدر والنسخة والنطاق → الوحدة الحالية → بقية الهيكل بترتيب المصدر → المطلوبة والاختيارية | Continue task | لا flatten يخلط شهادة بكورس؛ الوحدات قابلة للطي والبحث؛ فتح/انتهاء المؤقت لا يكمل درسًا |
| Course / Progress | المكتمل من المقام الشخصي → المطلوب المتبقي → الإيقاع والوقت منفصلان → الهدف والتوقع | Review plan | نطاق جزئي يقال صراحة؛ صفر مهام في المقام لا يظهر 100%؛ لا ادعاء إتقان |
| Course / People | غرف هذا offering مع المرحلة → زملاء وافقوا على جمهور الكورس → شرح الخصوصية | Join a room | الاختلاف في النسخة لا يمنع الرفقة؛ لا يكشف خططهم؛ Join course مستقل عن Join room |
| Course / Leaderboard | النسخة/النطاق والمقياس → الفترة والقواعد → الصفوف وترتيبي إن كنت مشاركًا | Join leaderboard / Manage visibility | اختلاف النطاق يفتح المقارنة المناسبة بدل دمجها؛ نتائج مستقرة مع Last updated؛ لا عرض غير المصرح |
| Private editor `/app/courses/new` أو `/:enrollmentId/edit` | العنوان/المصدر → Modules/Tasks مرتبة → مطلوب/اختياري وروابط/تقديرات → معاينة | Save course / Use in plan | مسودة خاصة قابلة للاستئناف؛ paste outline له معاينة؛ نقل بعناصر كيبورد؛ حذف مؤثر يشرح أثره على التقدم قبل الإقرار |
| Publication preview | النسخة المراد إرسالها → كل حقل سيصبح عامًا → المصدر/حقوق الوصف → ملاحظات للمراجع | Submit for review | لا تقدم شخصي/ملاحظات/جدول داخل snapshot؛ الإرسال لا ينشر؛ التعديلات اللاحقة لا تغير اللقطة المرسلة |
| Contributions `/app/contributions` | الطلبات وحالتها وتاريخها → الإجراء المطلوب من صاحبها | Open request | Draft / Pending / Changes requested / Approved / Rejected؛ استخدام الخاص مستمر أثناء المراجعة |
| Request `/app/contributions/:requestId` | snapshot المرسلة → قرار/ملاحظات على الحقول → سجل النسخ | Revise and resubmit عند الطلب | Approved يربط بالعرض العام؛ لا يحول الاشتراك الخاص تلقائيًا؛ رفض مع سبب دون فقد المنهج |
| Version review `/:enrollmentId/version-review` | النسخة الحالية والمقترحة → Added/Changed/Removed → خريطة المهام → أثر المقام والتقدم والخطة | Apply course update | غير المطابق يحتاج قرارًا؛ القديم محفوظ؛ Cancel يبقى على النسخة الحالية؛ stale يعيد المعاينة |

النشر والترحيل عمليتان منفصلتان: نشر نسخة لا يغير حساب صاحبها أو بقية المتعلمين خفية. الترحيل لا يورّث Completed اعتمادًا على تشابه عنوان فقط؛ يعرض المطابقة والأثر، ويمنع الإقرار إذا بقي تعارض لا يملك قاعدة حسم. التحرير الخاص بعد وجود تقدم يستخدم نفس معاينة الأثر للعمليات البنيوية المؤثرة.

## 5. التركيز الفردي والغرف

| الشاشة | المحتوى بالترتيب | الفعل الرئيسي | الحالات الخاصة والربط |
|---|---|---|---|
| Focus / Solo `/app/focus` | Work/Learning → مهمة اختيارية خاصة → Open/Pomodoro → preset وإعدادات → مراجعة موجزة | Start focus | Work لا يحتاج مهمة؛ Session أخرى: View active session لا Start ثانٍ؛ Offline يعطل بدء وقت مؤهل |
| Focus / Rooms `/app/rooms` | بحث/كورس/موضوع/لغة → بطاقات المرحلة/المتبقي/عدد الحاضرين → غرف مشابهة | View room / Create room | نفس المصدر العام مع أفعال العضو؛ فشل التحديث لا يجعل الأعداد الحالية مزعومة؛ لا غرف وهمية |
| Create room `/app/rooms/new` | Topic أو offering معتمد → عنوان/لغة/وصف → preset → معاينة حقول عامة | Create room | حدود السعة/الإنشاء ورسائلها من عقد الروم؛ لا روابط/ملفات/منهج خاص مسرب؛ الإنشاء لا يبدأ Run |
| Lobby `/app/rooms/:roomId` قبل العضوية | عنوان/لغة/موضوع → المرحلة/المتبقي → من سيشاهد حضوري → قواعد | Join room | الحساب موثّق؛ رفض الظهور يتيح Solo؛ full/closed/archived لها بدائل؛ لا قائمة أعضاء قبل الإذن |
| Lobby بعد العضوية | حالة Run → الحاضرون المسموح عرضهم → مهمتي الخاصة → الاستعداد | Host: Start run؛ Guest: Join this round عند البدء | بدء المضيف لا يبدأ وقت الجميع؛ هدف القائمة المحايد اختياري، اسم المهمة خاص |
| Room: Focus | عنوان الجولة → Room clock → My counted time وحالته → المهمة → المشاركون/دور المضيف | Join remaining time أو Pause/Resume/Finish | التأخر يعرض Remaining بالضبط؛ Wait for next round بديل؛ شخصي Pause لا يوقف الجماعة |
| Room: Break | مدة الاستراحة/بداية التالية → ملخص الجولة → Ready guidance → تفاعل محدود | Join this round عند بداية التالية | لا وقت تركيز أثناء الراحة ولا حجز تلقائي للمشاركة؛ لا تشجيع متحرك وسط التركيز |
| Session summary | مدة محفوظة ونوعها → أهلية/تصحيح إن وجد → المهمة الاختيارية → نتيجة | Return to task / Today | Worked on و Mark complete منفصلان وغير مختارين؛ يمكن غلق الملخص دون إكمال المهمة |
| Room control / reporting | صلاحية الدور الحالي → Transfer/Take host أو Remove بحسب الدور → أثر/سبب القرار | Confirm named action | دور المضيف لا يغير وقت الآخرين؛ المغادرة لا توقف Run؛ Report لا يكشف هوية المبلغ للطرف الآخر |

المؤقّت يستخدم حالات العقد المركزي لا حسابًا جديدًا لكل شاشة. في الروم نميز **مرحلة المجموعة** و**حالة مشاركتي**: قد تكون المجموعة Focusing وأنا Watching أو Paused؛ عبارة My time لا تعرض ساعة الروم كأنها رصيدي. التنقل داخل ديمة لا يساوي Leave room.

عند انقطاع realtime يظهر Reconnecting مع آخر تزامن؛ إذا HTTP متاح نستعيد snapshot. عند offline كامل يصبح العداد تقديريًا؛ لا Start/Resume/Join round جديد، و Stop يحفظ قصد التصحيح وفق العقد. نهاية الجولة المعروفة لا تتحول إلى جولات تلقائية، وتستعاد الحقيقة عند العودة دون إعادة تشغيل جلسة منتهية.

العضو المحظور/المزال لا يحصل على قائمة أعضاء جديدة من واجهة قديمة. Block يوقف الظهور والتفاعل المسموح وفق السياسة، ولا يعد بإخراج الطرف الآخر من روم عامة؛ يعرض Leave أو Choose another room. الأهداف الحرة والملاحظات والروابط الشخصية ليست broadcast جماعيًا.

## 6. التقدّم والدائرة واللوحات والملفات

| الشاشة | المحتوى بالترتيب | الفعل الرئيسي | الحالات الخاصة والربط |
|---|---|---|---|
| Progress / Overview `/app/progress` | اختيار الفترة → إنجاز المنهج → وقت Work/Learning → إيقاع الأيام → توقع الخطة | Continue / Review plan | أربعة معانٍ لا Score واحد؛ النص يشرح المقام والنافذة؛ لا نسبة تحسن قبل وجود أساس مقارنة |
| Progress / Activity | الفترة والنوع → Sessions/Manual مع حالة الحفظ والأهلية → المجموع المفصل | Open session / Add manual time | الوقت اليدوي خارج الترتيب؛ pending لا يبدو مؤكدًا؛ فلاتر محفوظة ورقمنة للقائمة الطويلة |
| Session detail `/app/progress/activity/:sessionId` | المصدر/الفترات → pause/حدود الإغلاق → التصحيحات → تفسير الأهلية | Review / Correct personal record | التصحيح يعرض الأثر قبل الإقرار ولا يجعل اليدوي مؤهلًا؛ غير المحسوم يمنع تشغيل جلسة متعارضة |
| Progress / Circle | طلبات تحتاج ردًا → ملخصات من وافقوا على المتابعة → البحث في زملاء متاحين | Request to follow / Open summary | قبول اتجاهي، لا متابعة متبادلة آلية؛ Pending لا يمنح بيانات؛ لا feed لا نهائي أو سجل حضور |
| Follow request detail | هوية مسموحة → ما يمنحه قبول الطلب من حقول مختارة → جمهور المتابعين | Accept / Decline | القبول لا يختار كل حقول المشاركة؛ Withdraw/Remove follower/Revoke متاحة؛ المرفوض لا يرى أسبابًا خاصة |
| Member summary `/app/people/:profileId` | الاسم المصرح → الحقول/الفترة المسموحان → ملخص كورسات عامة اختارها صاحبها | Follow / Manage relationship | لا يدّعي أنه الملف الشخصي الكامل؛ private/blocked/revoked تصير Unavailable، لا نسخة كاش قديمة |
| Progress / Leaderboards | Time ranking → All/Work/Learning → الفترة والقواعد → ترتيبي والصفوف → روابط course rankings | Participate / Manage visibility | لا دمج نسب كورسات مختلفة؛ No eligible activity شرح مفيد؛ Last updated و New results available قبل إعادة ترتيب |
| Sharing controls داخل Profile/Settings | الجمهور الحالي → الحقول المتاحة → Preview as viewer → أثر الحفظ | Save sharing preferences | Public / Course members / Accepted followers خيارات مستقلة؛ لا تمكين تلقائي لكل الجمهور عند قبول متابعة |

Circle بطاقات ملخصات محدودة مع وقت التحديث وزر عرض المزيد عند الحاجة، وليست timeline مستمرة. الوقت والإيقاع وتقدم كورس عام تظهر حسب المنح المختارة؛ المعلم يحتاج نشرًا صريحًا ومنحة مستقلة، وعدد الجلسات خارج مشاركة v1. لا عنوان كورس خاص أوخطة يومية أوأيام تعثر أو ملاحظات مهما كان وضع المتابعة. سحب الإذن يزيل البيانات من العرض والكاش المصرح، ولا يرسل تفاصيل قديمة في إشعار جديد.

Public فيإعدادات المشاركة يخص الملف المختصر واللوحات فقط؛ ملخصات التقدم التفصيلية للمقبولين أوالزملاء بحسب نوع الحقل. لا يُعرض زر نشر ملخص الوقت/الإيقاع لكل الإنترنت في v1.

اللوحات تبدأ بـ This week؛ فترتها الاثنين 00:00 UTC ونهايتها موضحة محليًا، بخلاف أيام الخطة المحلية. تعادل المراكز يظهر كتعادل حقيقي. التاريخ السابق baseline لا يبدو إنجاز هذا الأسبوع، و Credited on يشرح فرق قبول الخادم عن تاريخ الإنجاز الشخصي عند المزامنة المتأخرة. عند المشاركة العامة نوضح أن حظر حساب لا يحجب محتوى الإنترنت العام عن زائر غير مسجل.

## 7. الإشعارات والإعدادات والعمليات الإدارية

| الشاشة | المحتوى بالترتيب | الفعل الرئيسي | الحالات الخاصة والربط |
|---|---|---|---|
| Notifications `/app/notifications` | طلبات متابعة/مراجعة تحتاج قرارًا → نتائج نشر/ترحيل متاح → حالات مزامنة ذات صلة | Open related item | read لا يعني accepted؛ تجميع المتكرر؛ رابط مسحوب الصلاحية لا يكشف عنوانًا قديمًا؛ لا إشعارات عقاب يومي |
| Settings `/app/settings` | Profile → Timezone → Appearance/Motion → Notifications → Sharing/Blocked → Account | Save changes | تغيير timezone يوضح أثر الأيام/الخطة ويذهب لمعاينة عند اللزوم، ولا يعيد كتابة التاريخ بصمت |
| Notification preferences | أنواع إشعارات داخلية → email إن كانت مفعلة → وضع الراحة | Save preferences | صلاحيات المتصفح اختيارية بعد إجراء مفهوم، لا popup أول زيارة؛ لا وعد push/email قبل تشغيلهما |
| Data `/app/settings/data` | أنواع بيانات التصدير → حالة الطلب → تنزيل → حذف الحساب منفصل | Request export | Processing/Ready/Expired/Failed مع Retry؛ رابط التنزيل مصرح؛ لا تصدير ملاحظات أشخاص آخرين |
| Delete account | أثر الحساب والوقت والمشاركات → البيانات التي تُحذف/تبقى وفق السياسة → إعادة تحقق | Delete my account | لا حوار مبهم Are you sure؛ تشرح انقضاء الجلسة ودور المضيف؛ Pending/Done/Failed صريحة |
| Admin reviews `/admin/reviews` و`/:requestId` | Queue/age/status → snapshot/source/checks → feedback/decision | Approve / Request changes / Reject | من يراجع المحتوى لا يفتح الخطط الخاصة؛ كل قرار ذو سبب ونسخة؛ إعادة الضغط لا تنشر مرتين |
| Admin catalog `/admin/catalog` | offering/version/status → تغييرات ومراجع → أثر النشر/الإيقاف | Publish reviewed version | النشر لا يرقي المتعلمين؛ Unpublish لا يمحو إنجازهم أو تاريخهم؛ لا زر تجاوز اعتماد خفي |
| Admin reports `/admin/reports` و`/:reportId` | بلاغ/نوع/حالة → المحتوى المبلغ عنه بقدر الحاجة → إجراءات/أثر/سجل | Resolve / Apply action | أدوار محددة؛ لا كشف للمبلغ للمخالف؛ الغلق يحفظ السابق الصالح وفق العقد |
| Admin operations `/admin/operations` | أخطاء مزامنة/سعة → مهام فاشلة → حالة استعادة/تدقيق | Inspect / Retry permitted job | لا كشف مفاتيح أو نصوص خاصة في dashboard؛ إعادة التشغيل idempotent؛ ليس UI لتعديل ساعات الناس مباشرة |

## 8. أربع تخطيطات نصية أساسية

**Today — Desktop**
```text
[Sidebar]  Today                              [Search] [Notifications] [Account]
           [Actionable status, only if needed]
           [Next task: course > module > title]    [This week: exact counts]
           [Open resource] [Start focus]           [Target / Estimated finish]
           [Today's ordered tasks + state]         [View plan]
           [Active session rail only while a session exists]
```
**Plan / Recovery — المقارنة على الواسع تتحول لتتابع رأسي على الهاتف**
```text
Plan review                           [Back to current plan]
Reason + remaining work + capacity     [What will stay unchanged]
[Current schedule]       →             [Proposed schedule]
[Moved tasks / rest days / target / estimated finish / unscheduled work]
[Edit assumptions]                     [Apply revised plan]
```
**Focus room — الشخصية منفصلة عن المجموعة**
```text
[Back to rooms]   Room title / Course / Rules             [Room menu]
[Group phase + remaining round time]   [My participation + counted time]
[Private task / neutral optional intent]                 [Pause] [Finish]
[Participants: permitted names + declared states]        [Host state]
[Next round requires joining]                           [Leave room]
```
**Progress / Circle — نفس الوظيفة على الموبايل دون جدار بطاقات**
```text
Progress    [Overview] [Activity] [Circle] [Leaderboards]
[Follow requests needing response]                  [Sharing preferences]
[Person A | selected summary | updated at]           [View]
[Person B | selected summary | updated at]           [View]
[Load more, when needed]       [No infinite scroll / no private course titles]
```

## 9. حالات مشتركة ملزمة

| الحالة | عرض الواجهة | السلوك |
|---|---|---|
| Loading / Refreshing | skeleton ثابت أو Updating… مع إبقاء المحتوى | لا إحصاءات/أشخاص وهميون؛ يفصل التحميل الأول عن التحديث |
| Empty / No matches | تفسير خاص بالسياق وإجراء واحد مناسب | لا onboarding زائد داخل Work-only؛ تحتفظ الفلاتر مع Clear |
| Saving / Saved | حالة قرب العنصر | Saved بعد إقرار الخادم فقط؛ نجاح العرض المؤقت ليس نجاح الحفظ |
| Offline queued | Saved on this device. Waiting to sync. | فقط إذا ثبت الحفظ المحلي؛ الأفعال الحساسة غير القابلة للطابور تعطل مع سبب |
| Local save failed | Changes are not saved مع Copy/Export | تحتفظ الشاشة بالنص؛ لا وعد باستعادة بعد إغلاقها |
| Error / Retry | سبب مفهوم وفعل Retry أو بديل | لا مسح المدخلات، لا تكرار وقت/نشر عند إعادة الطلب |
| Stale preview / Conflict | This changed elsewhere + Review changes | لا overwrite صامت؛ إعادة معاينة الخطة/النشر/الترحيل قبل الالتزام |
| Cross-device session | Active on another device + View/Take control | نقل صريح حسب العقد؛ الجهاز القديم لا يستمر بأوامر ذات صلاحية قديمة |
| Auth expired / Forbidden | Sign in to continue أو Unavailable | يحتفظ بالمقصد والمسودة ضمن حسابها؛ لا كشف اسم مورد خاص |
| Stale public data | Last updated + Refresh | لا أرقام حية مزعومة؛ انتظار إقرار لتغييرات الترتيب بدلاً من قفز الصفوف |

Undo القصير لا يكون الطريق الوحيد لتصحيح إكمال؛ Reopen متاح من المهمة. Complete يعرض جهد المتبقي التخطيطي المقترح مع إمكان التعديل/Unknown؛ لا يدعي أنه وقت مسجل. Undo mistake يبطل جهده المشتق فقط؛ Reopen with recorded work يحفظ العمل الحقيقي ويطلب المتبقي. أخطاء تحتاج قرارًا لا تختفي في toast. خروج الحساب مع pending changes يعرض Sync/Export/Discard المتاح فعلًا ويعزل طابوره عن الحساب التالي؛ لا يجبر المستخدم على البقاء مسجلًا.

## 10. الاستجابة والحركة والمكوّنات وإثبات القبول

- تخطيط الشاشات من 320px وحتى الواسع، مع نصوص طويلة وتكبير 200%. الجداول تتحول إلى صفوف ذات labels أو بطاقات موجزة؛ لا تمرير أفقي للمقارنة الأساسية أو إخفاء عمود القرار.
- الهوية: الأصول SVG الأصلية بلا إعادة رسم/توهج؛ Manrope للإنجليزية و Noto Sans Arabic للمحتوى العربي. خلفية paper/ink ومساحات بيضاء وأزرق للفعل الأساسي وبرتقالي للتأكيد؛ النص البرتقالي يستخدم accent-text، وملء البرتقالي له نص ink.
- ألوان الحالة semantic ومعها نص/أيقونة؛ Light/Dark من tokens الحالية، مع اختبار التباين لا افتراضه. الأرقام tabular، وعناوين المهام تلتف، وأزواج النص العربي/الرابط تعزل اتجاهيًا.
- Path field و Product preview و Text reveal و Magnetic action تخص اللاندنج/التعريف؛ لا خلفية متحركة أثناء التركيز. Course explorer للإبراز، لا بديل عن مكتبة حقيقية قابلة للبحث.
- Progress ring يحتاج قيمة ومقامًا وتسميات حقيقية؛ Step indicator يعكس خطوات محفوظة فعليًا؛ Command navigation يقرأ وجهات مصرحًا بها. لا نقل sample data أو fixed recovery scenario إلى الإنتاج.
- المكوّنات الحالية native web، فتحويلها لـ React يحافظ على العقود والدلالات والترخيص؛ ليس نسخ ملفات واعتبارها backend. تُحفظ نسب المصادر، وما لم تثبت رخصته لا يُنسخ كودُه أو أصولُه.
- حركة مساحة العمل 120–220ms كهدف تصميم: حفظ/توسعة/انتقال يشرح التغير. التعافي يبرز فرقًا مرة واحدة؛ احتفال صغير لمعلم حقيقي، بلا confetti لكل نشاط أو عدادات مصطنعة.
- system reduced motion أولًا وإعداد حساب محفوظ؛ الزخارف تتوقف خارج الشاشة وفي التبويب المخفي. المحتوى ظاهر دون انتظار animation، والمساحة القابلة للنقر لا تتحرك.
- الكيبورد: كل الأفعال متاحة بلا drag/hover، ترتيب وتركيز ظاهر، Escape يعيد السياق، تبويبات Arrow/Home/End؛ قارئ الشاشة لا يسمع كل ثانية للعداد بل انتقال المرحلة فقط.
- أهداف لمس أساسية 44×44px، تسميات صريحة للأزرار، أخطاء بجانب الحقول وملخص قابل للتركيز؛ إعلان الحفظ polite دون تكرار الصفحة. الصوت اختياري وله بديل مرئي.
- قبل اعتماد كل رحلة: دخول/رجوع/إعادة تحميل، empty/loading/error/offline/stale، جهازان، viewport ضيق، كيبورد، قارئ شاشة، ومراجعة الجمهور لكل حقول عامة. لا زر أساسي ينتهي في placeholder.
- اختبار UX قبل الإطلاق يمر بوافد جديد، Work-only، متعثر يومين، منضم متأخر لروم، مضيف يغادر، ومستخدم يسحب إذن المتابعة. تُراجع نتيجة محفوظة وخصوصية وتفسير الحالة، لا جمال screenshot وحده.
