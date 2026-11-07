# B6 — عقد الدمج المقترح للبيانات والواجهات

> أولوية التنفيذ الحالية: [مسار الإطلاق المختصر](WEB_RELEASE_FAST_TRACK_AR.md). التفصيلات الموسعة أدناه مرجع تصميم؛ لا تجعل اختبارات التحمل أو سجل D1 المستقل أو تصدير الأحجام الضخمة شرط إطلاق. التنفيذ الفعلي وحدوده في STATUS_AR.md.
**الحالة: تصميم فقط، 1 نوفمبر 2026. لا يبدأ التنفيذ قبل إغلاق B5.** لا يثبت هذا الملف وجود endpoints أو جداول جديدة. يكمل [ملاحظات الدمج](B6_INTEGRATION_NOTES_AR.md)، ويضبط تنفيذ [نطاق B6](IMPLEMENTATION_PLAN_AR.md) وفق [القبول](DELIVERY_AND_ACCEPTANCE_AR.md)، [قواعد التقدم](RECOVERY_AND_PROGRESS_SPEC_AR.md)، [الشاشات](SCREEN_SPEC_AR.md)، و[عقد البنية](ARCHITECTURE_AND_DATA_AR.md). الويب الفاتح فقط؛ لا تطبيق هاتف ولا خدمة مدفوعة جديدة.

## 1. حدود التنفيذ وإعادة الاستخدام

- يبقى `learning_workspaces.state` مصدر الخطة والمنهج الشخصي، و`commit_learning_command` نقطة حفظه الذرية. لا إعادة كتابة B2/B3 إلى مخطط ضخم قبل الحاجة؛ نضيف فهارس هوية واحتساب علائقية حيث يلزم منع الازدواج.
- يبقى `time_sessions / time_intervals / time_corrections` سجل الوقت الوحيد. لا جدول «ساعات اجتماعية» قابل للكتابة من العميل، ولا تحويل Estimated effort إلى وقت.
- يبقى `user_blocks` مصدر الحظر الوحيد، و`account_roles` مصدر الأدوار. ربط العضوية بالبروفايل في هجرة 028 يظل محفوظًا؛ لا إعادة FK إلى `auth.users` على نحو يعيد انتظار الأقفال الذي عالجته B5.
- يبدأ الكتالوج العام بترحيل البذرتين المراجعتين إلى نفس مصدر القراءة الذي سيحمل النشر الجديد. لا fallback ثابت يعيد إظهار إصدار سحبه المشرف. المنهج الشخصي المثبت يبقى للتاريخ وفق سياسة حقوق المحتوى.
- الحسابات الجديدة خاصة. الانضمام للكورس أو الروم لا يفعّل People أو Follow أو أي لوحة.
- تقسيم الملفات عند التنفيذ: `contracts/{progress,social,publication,operations}`، وظائف حساب خالصة في `domain`، وحدات server حسب المجال، ومكونات UI منفصلة تُحمّل عند وجهتها. لا تضخيم مكوّن الحساب أو تحميل الإدارة ضمن حزمة صفحة الدخول.

## 2. عقد النقل والهوية

كل المسارات التالية تحت `/api/v1`، وهي تصميم الدمج المقترح؛ المسارات القائمة تبقى متوافقة. يستخدم التعديل `operationId` و`expectedRevision` على الكيان المعني، مع `X-Dima-Account-Id` وحماية Origin الحالية. هوية المالك من جلسة الخادم، لا من جسم الطلب. يعاد فحص الوصول قبل replay؛ receipt يحتفظ بمعرّف النتيجة وحالتها، لا بملخص خاص يصبح قابلًا للاسترجاع بعد السحب.

قراءات المالك عبر JWT وRLS؛ أوامر SQL محددة و`SECURITY DEFINER` عند الحاجة فقط، بصلاحيات ضيقة و`search_path` ثابت. لا وصول service-role عام لكل شاشات المجتمع. APIs الخاصة `private, no-store`؛ القوائم cursor ثابت وحد أقصى معلن، لا تحميل كل المستخدمين أو سجل السنوات.

| المسار | العقد المختصر والمالك |
|---|---|
| `GET /progress?period=week|month&anchor=…` | للمالك: `CourseProgress[]`, `TimeSummary`, `RhythmSummary`, `PlanHealth`، مع window/timezone/source revisions. الأربعة مستقلة. |
| `GET /time` وقراءة Session القائمة | تمديد متوافق لفترة العرض وcursor؛ سجل الوقت والتصحيح B4 نفسهما. إجماليات الفترة لا تُحسب من الصفحة الحالية للقائمة. |
| `GET/POST /progress/goals` | هدف أيام الإيقاع وتاريخ سريانه؛ الافتراضي الأسبوع القادم، وتعديل الحالي يتطلب اختيارًا ويظهر `goalRevised`. يمكن تخطي الهدف. |
| `GET /sharing`; `POST /sharing/preview`; `POST /sharing` | سياسة المالك، ثم معاينة الجمهور والحقول المتأثرة، ثم حفظ revision صريح. Preview لا تمنح إذنًا. |
| `GET /profiles/:id/shared`; `GET /profiles/public/:handle` | الأول DTO مصفى للمشاهد؛ الثاني اسم/avatar/bio المختارة فقط. خاص/محظور/مسحوب = Unavailable بلا تمييز يكشف البيانات. |
| `GET /offerings/:id/people`; `POST /people/visibility` | أعضاء اختاروا جمهور الكورس؛ يقبل القراءة عضو الكورس وفق السياسة. opt-in مستقل لكل offering؛ اختلاف النسخة لا يمنع الرفقة. |
| `GET /circle`; `POST /follow-requests`; `POST /follow-requests/:id/accept|decline|cancel`; `POST /relationships/:id/revoke` | علاقة اتجاهية؛ recipient فقط يقبل/يرفض، requester فقط يلغي، وأي طرف يسحب علاقته المسموحة. لا منح ضمنية عند القبول. |
| `POST /blocks`; `POST /blocks/:id/revoke`; `GET /blocks` | نفس `user_blocks`؛ إضافة الحظر من المجتمع والروم لها الأثر نفسه، وإلغاء الحظر لا يعيد المتابعة/المشاركة السابقة. |
| `POST /shared-milestones/preview`; `POST /shared-milestones`; `POST /shared-milestones/:id/revoke|encourage` | نشر صريح من إكمال كورس عام صالح، وموافقة جمهور المقبولين؛ التشجيع لا يولد نقاطًا. |
| `GET /leaderboards/time?period=week|month&category=all|learning|work`; `GET /leaderboards/course/:scopeId?period=week|overall` | الصفوف المنشورة بإذنها فقط؛ القواعد/window/calculatedAt/generation/correctedAt جزء من الرد. النسخة العامة تستخدم DTO نفسه بلا بيانات خام. |
| `POST /leaderboards/participation/preview`; `POST /leaderboards/participation` | opt-in/out مستقل للوحة الوقت ولكل ComparisonScope؛ preview يوضح ما سيظهر ومقام النطاق الكامل، مع revision لا يعتمد تلقائيًا إن تغيرت المعطيات. |
| `GET/POST /publication-requests`; `GET /publication-requests/:id`; `POST /publication-requests/:id/resubmit` | للمالك: snapshots ومراجعات طلبه فقط. كل إعادة إرسال snapshot جديدة، ولا تعديل السابقة. |
| `POST /learning` بأمري `previewUpgrade` و`applyUpgrade` | نفس تجميعة التعلم وreceipt الحالية. preview مرتبط بالمراجعات والإصدار والـmapping، وapply يحفظ نفس Enrollment ومعرّفات الأولوية والتاريخ. |
| `GET /notifications`; `POST /notifications/read`; `GET/POST /notifications/preferences` | للمالك فقط؛ read لا يعني accepted. target يقرأ بصلاحية حالية، والنص لا يحتفظ بعنوان خاص مسحوب. |
| `POST /reports`; `GET /admin/reports`; `POST /admin/reports/:id/decision` | بلاغات المجتمع/اللوحات مع إعادة استخدام مسار بلاغات الغرف؛ المبلّغ لا يُكشف للطرف الآخر. |
| `GET /admin/reviews`; `GET /admin/reviews/:id`; `POST /admin/reviews/:id/decision`; `POST /admin/catalog/:id/publish|unpublish` | دور محمي، سبب إلزامي، snapshot محددة، audit وidempotency؛ لا تقدم خاص لصاحب الطلب. |
| `GET /admin/operations`; `POST /admin/operations/:jobId/retry` | حالات منقحة، ونوع job مسموح ومعلوم؛ لا SQL حر أو تعديل ساعات أو أسرار أو اختيار actor تعسفي. |
| `POST /exports`; `GET /exports/:id`; `POST /exports/:id/retry`; `POST /exports/:id/download-link`; `GET /exports/:id/download` | الطلب/الحالة/الملف لصاحبه فقط، Processing/Ready/Expired/Failed؛ download يحتاج جلسة حالية ورمزًا قصير العمر مرتبطًا بالمالك والملف. |
| `POST /account/deletion`; `GET /account/deletion/:id` | تحقق حديث مستقل عن وجود جلسة قديمة، cutoff خادمي، Pending/Done/Failed وreceipt خاص محدود؛ لا Done قبل انتهاء purge وAuth cleanup. |

أخطاء المعاني القائمة تُعاد استخدامًا: `AUTH_REQUIRED`, `NOT_FOUND`, `REVISION_CONFLICT`, `PREVIEW_STALE`, `IDEMPOTENCY_MISMATCH`, `RATE_LIMITED`. لا يكشف اختلاف الخطأ وجود ملف خاص. حدود الإدخال والقوائم والمعدل تُثبت في عقود مشتركة وتُختبر، لا أرقام سحرية مختلفة بين SQL وUI.

## 3. DTOs التي تمنع اختلاط الخصوصية

| DTO | الحقول المسموحة |
|---|---|
| `CourseProgress` الخاص | enrollment، النسخة والنطاق الشخصي، requiredWeight/completedWeight، prior/new منفصلان، عدد الخطوات، `percentage: null` عند المقام صفر، تحديث المصدر. |
| `TimeSummary` الخاص | window، Learning/Work، Timer/Manual/Pending منفصلة؛ التوقيت والرصيد المؤهل موضحان. لا نشر تلقائي لهذه البيانات. |
| `RhythmSummary` الخاص | أيام النشاط/الراحة/غير النشطة، goal الفعال وتاريخ سريانه، مصدر المعنى؛ لا تحويل فتح التطبيق إلى يوم نشط. |
| `PlanHealth` الخاص | target/forecast، حالة السعة والتقديرات المفقودة/المؤقتة، needsReview ووقت حساب؛ يعيد استخدام محرك الخطة. |
| `PublicProfile` | `profileId`, `handle`, `displayName`, avatar اختياري معتمد، bio اختيارية. لا email/timezone/role/lastSeen. |
| `SharedSummary` | هوية مسموحة، `visibilityRevision`, `verifiedAt`، والحقول الممنوحة فقط؛ الغائب omitted لا قيمة صفر موحية. لا raw sessions أو عناوين خاصة أو خطة أو أيام تعثر. |
| `RankingSnapshot` | scope/scoringVersion/window/calculatedAt/generation/correctedAt، rows `{rank, profileId, displayName, score}` مع وحدة واضحة؛ لا مصادر الدقائق أو المهام الخاصة. |
| `PublicationReview` | snapshot المنهج وsource/rights/checks/mapping/decisions فقط؛ لا workspace أو completions أو مقاييس صاحبه. |
| `Notification` | نوع عام، target ID، state/readAt؛ تفاصيل العرض تعاد من مصدر مصرح. عند السحب `Item unavailable` بلا عنوان قديم في الرد. |

`ShareGrant` يتبع مصفوفة العقد: `AcceptedFollowers` يسمح بـ WeeklyTime/WeeklyRhythm/PublicCourseProgress/PublishedCourseMilestone؛ `CoursePeers` يسمح بتقدم/مرحلة الكورس العام المختار فقط. Public profile وboards موافقات منفصلة، وليس Public جمهورًا لملخص الوقت التفصيلي.

قبول طلب متابعة دون إضافة حقول جديدة **لا يلغي تلقائيًا** حقول `AcceptedFollowers` المفعلة من قبل. معاينة القبول تعرض المنح الموجودة. إذا أراد المالك صفر مقاييس للجميع يسحب المنح؛ لا نخترع استثناءات per-person غير موجودة في العقد.

## 4. المخطط الأدنى المقترح

أسماء الجداول التالية مقترحة، وليست هجرات منفذة. كل جدول جديد مكشوف له RLS، وكتابة مباشرة ممنوعة عندما تكون أوامر المجال لازمة.

| المجموعة | التخزين والقيود اللازمة |
|---|---|
| حالة الحساب والخصوصية | `account_lifecycle` لحالة active/deleting والتوقف؛ `social_settings` مع visibility revision وموافقة المتابعة والتحفيز؛ `share_grants` بفريد owner/audience/metric/offering؛ توسيع `public_profiles` بـ handle فريد قابل للتغيير وحقول العرض المختارة. |
| المجتمع | `follow_relationships` بفريد follower/subject ومنع self-follow وحالة/revision؛ `people_visibility` بفريد owner/offering؛ `user_blocks` الموجود، دون بديل اجتماعي موازٍ. |
| المعالم | `shared_milestones` مرتبط بإكمال وoffering عام صالح؛ `milestone_encouragements` بفريد actor/milestone وعداد معدل ذري 20/يوم وفق السياسة. سحب المنحة/المصدر يحجب القراءة والتفاعل حتى قبل تنظيف الصف. |
| المنهج العام | `curriculum_versions` snapshots غير قابلة للتعديل؛ `catalog_offerings` مع current reviewed version/status؛ `comparison_scopes` وscoring policy ثابتة؛ projection `room_public_offerings` تُحدّث ذريًا مع حالة الاعتماد. |
| النشر | `publication_requests`, `publication_snapshots`, `review_decisions`؛ snapshot hash، source/rights، سبب القرار ومراجعه؛ approval الفريد يمنع نشر النسخة مرتين. |
| الهوية والاحتساب | `task_lineages`, `version_mappings` المعتمدة؛ `enrollment_lineages` فريد user/lineage للانضمامات النشطة؛ `first_credit_claims` فريد user/lineage مع original acceptedAt وbaseline وأصل الحدث وactive. الحفاظ على الأصل بعد Undo. |
| الترتيب والإيقاع | `ranking_participation` لكل لوحة/نطاق وموافقتها؛ `rhythm_goals` بإصدارات/سريان. في البداية aggregates محدودة فوق السجل مع indexes؛ إذا احتجنا projection فنسختها مشتقة قابلة لإعادة البناء، وصلاحية العرض لا تُستمد منها. |
| الإشعارات والبلاغات | notifications/preferences خاصة، dedupe_key للأحداث؛ تقارير اجتماعية typed target مع audit، وربط شاشة الإدارة ببلاغات الغرف الموجودة؛ لا دمج صلاحيات قراءة كل المصادر في select عام. |
| التشغيل | operations receipts/outbox/jobs بنمط المشروع؛ export requests/chunks، deletion requests، privacy tombstones بلا محتوى شخصي زائد. تُعاد استخدام آلية dispatcher والـlease/fenced ACK، لا scheduler ثانٍ. |

اقتراح صلاحيات المراجعة الأول: `admin` يعتمد/ينشر المناهج ويضبط سياساتها؛ `moderator` يراجع البلاغات ويستعمل إجراءات الإشراف المحددة؛ فحص/إعادة jobs حسب نوع يسمح به الدور. لا منح أدوار من UI العضو أو metadata، ولا تعديل RBAC الحالي لمجرد تسمية «مراجع» في التصميم.

## 5. الذرية والهوية والأقفال

1. تعديل التعلم يأخذ قفل الحساب الحالي ثم workspace. يحدّث حالة التعلم وclaims وlineage coverage وinvalidation/receipt في **نفس commit**. لا حفظ workspace ثم محاولة منفصلة لإضافة نقاط. يُرفض pending deletion حتى لو JWT القديم صالحًا.
2. مصدر `firstCreditClaim.acceptedAt` وقت الخادم عند أول commit، لا تاريخًا يرسله العميل. ترحيل السابق يستعمل الأصل الموثق الموجود في `firstCompletedAt` و`claimId`؛ baseline يظل baseline. إعادة النشر/الترقية تربط نفس lineage ولا تنشئ enrollment أو أول claim جديدًا.
3. mapping موثّق فقط ينقل التكافؤ. ambiguous = غير محسوم في preview، لا نقاط تلقائية. يشمل apply فحص version/scope/profile/learning revisions، وتغيّر المقام والخطة؛ stale يرفض العملية كاملة.
4. أوامر المتابعة والحظر تسلسل الحسابات المشاركة بترتيب UUID ثابت **قبل** كيان العلاقة؛ لا قفل حساب A ثم انتظار B في مسار وعكسه في مسار آخر. لا تحتاج قراءة aggregate إلى قفل كتابة في حساب كل مشاهد. FK الجديد يُراجع ضد أقفال Auth القائمة.
5. سحب منحة/حظر: policy + revision + receipt + invalidation/outbox في معاملة واحدة. كل قراءة/صف pagination/تفاعل/إشعار يفحص المنح والحظر والمصدر الحالي في نفس استعلام الإرجاع؛ لا check مبكر ثم select غير محمي بعده.
6. Room/Time/Delete يحافظ على Account → sorted Rooms → sorted Runs → entities. لا إمساك Room ثم قفل حسابات الأعضاء. إيقاف عام يثبت cutoff ثم تسوية الحسابات منفردة. حذف مالك/مضيف يفك مراجع Run/host المؤجلة قبل cascade ويترك سجل الآخرين صالحًا.
7. نشر منهج لا يقفل حساب المتعلم أو يرقّيه؛ اعتماد snapshot وlineage/scope/visibility يحدث ذريًا، والترقية طلب منفصل للمتعلم. وصول المراجع محدود بالطلب الذي يستطيع مراجعته.
8. تصحيح interval يغير أهلية الفترة وحدها. مجموع اللوحة يجمع eligible intervals من finalized sessions ويقصها إلى window UTC، ثم يقرب للعرض مرة واحدة. التصحيح/الانسحاب يُفحص عند القراءة فورًا، حتى لو generation الإسقاط قديمة.

## 6. السلوك المرئي والأداء

- Overview يعرض أربعة معانٍ، وصف الحالة وزر متابعة مناسب؛ لا رقم score يجمع الوقت ونسبة المنهج. Activity يحتفظ بالفلاتر ويحمّل صفحات، والتصحيح يوضح الأثر قبل الحفظ.
- الأسبوع المحلي للإيقاع يختلف عن Monday 00:00 UTC للترتيب. المقارنة بنفس الجزء المنقضي أو أسبوعين كاملين، والتعادل `1,2,2,4`. النسبة الشخصية لا تحل محل مقام ComparisonScope العام.
- Current seeds: أنواع Required هي video/reading/assignment؛ exercise/resource فيها optional/supporting فقط، ولذلك خارج المقام. أي Required بنوع غير مصنف مستقبلًا يمنع اعتماد scoring قبل مراجعة النوع؛ لا fallback وزن خفي.
- Circle محدود مع Load more؛ قبول/رفض/سحب واضح، وPreview يسبق كشف البيانات. صفوف leaderboard لا تقفز أثناء الاستخدام؛ Refresh صريح مع `New results available` ووقت الحساب.
- cache الخاص keyed بـ account/viewer/scope/visibility revision، ويُمسح عند تغير الهوية أو إبطال الوصول. يرفض الرد القديم بعد تغيير الجمهور محليًا، و403/404 يخفي البيانات فورًا؛ reconnect/foreground يعيدان التفويض. لا تخزين SharedSummary في localStorage أو service-worker cache.
- لا نضيف 100 socket اجتماعي فوق B5 تلقائيًا. الاقتراح الأول HTTP محدد عند فتح/عودة السطح وتحديث محدود في وجوده؛ أي invalidation transport جديد يحتاج اختبار السعة والقنوات/الرموز. «كل قراءة لاحقة تحترم السحب» قابل للتحقق؛ لا وعد بمحو معلومة سبق وصولها لحظيًا عبر أجهزة غير متصلة.
- الإشعارات داخلية فقط في النطاق؛ حجب reminders الخارجية افتراضيًا. لا email/push تحفيزي أو نوافذ أذونات أول الزيارة. Motion بسيط وreduced motion من إعداد النظام/الحساب، بلا حركة تنافسية أثناء Focus.

### 6.1 اقتراح محدد لإبطال العرض الاجتماعي وحدوده

**اقتراح قبل التنفيذ؛ لا يغيّر قناة B5 أو يثبت اجتياز SC03.** الحالة القائمة: `signRoomRealtimeToken` يصدر `role=anon` بلا Auth `sub` وبصلاحية روم واحدة؛ adapter يفتح قناة واحدة، والمستأجر مضبوط على `max_channels_per_client=1`. لا يصلح هذا الرمز لقناة حساب خاصة، وإضافة رمز Auth إليه تكسر الفصل الأمني المقصود. تغيير الرمز/القنوات أو فتح socket آخر يعيد فتح اختبارات النقل والصلاحيات والسعة؛ لذلك الاختيار الأول لـB6 هو HTTP مصرح، مجمع للصفوف المرئية، دون بث بيانات اجتماعية على روم.

- **حد صلاحية الخادم:** نقطة الفصل هي snapshot استعلام السياسة والبيانات في قاعدة البيانات. القراءة التي تبدأ بعد commit السحب تُحجب؛ القراءة المتزامنة التي اعتمدت سياسة قبله ليست قراءة مرخصة إلى الأبد. mutation أو notification delivery يعيد فحص السياسة وقت تنفيذه. لا يكفي حمل `visibilityRevision` قديمة في رد مخزن.
- **وصول رد قديم:** العميل لا ينشر SharedSummary جديدة فور وصولها. يرسل `POST /sharing/verify` بلا آثار جانبية، بحد أقصى 20 هدفًا ظاهرًا ونسخ السياسة التي حملتها snapshot. التحقق مرتبط بالمشاهد الحالي وtarget ونوع السطح ومجموعة الحقول ونطاق المصدر، فلا تُستخدم موافقة CoursePeers لتفويض ملخص AcceptedFollowers. الخادم يعيد `{target, allowed, policyVersion}` للهدف المسموح فقط؛ المرفوض وغير الموجود لهما نفس الرد العام دون policyVersion تكشف حالة مخفية. النسخة تشمل المنحة والعلاقة والحظر وحالة مصدر الكورس/المعلم وحالة الحساب، لا revision المالك وحدها. mismatch/denied = مسح البيانات وطلب snapshot جديدة إذا ظل المورد متاحًا. هذا يلتقط اختبار «رد حُجز، ثم سُحب الإذن، ثم أُطلق الرد»؛ verification مؤخر بعد إبطال أحدث لا يعيد المحتوى.
- **أسوار العميل:** scope هو account + viewer + surface + generation، وكل طلب يحمل epoch. logout/تبديل الحساب/سحب محلي/deny/انتهاء صلاحية العرض يرفع epoch، يلغي الطلبات قدر الإمكان، ويمسح cache الخاص. لا يستطيع رد أو verification من epoch أقدم إعادة البطاقة. hidden/offline يمسح المقاييس الاجتماعية الخاصة؛ `focus` و`pageshow` و`resume` حيث يدعمها المتصفح و`visibilitychange` تبطل lease/epoch وتعيد التحقق قبل رسم بيانات خاصة جديدة. عند عودة التنفيذ بعد freeze يُخفى المحتوى المنتهي أولًا، قبل معالجة refresh أو رد معلّق. اسم عام مصرح مستقلًا لا يلزم إخفاؤه معها.
- **ما سبق عرضه:** TTL مقترحة 15 ثانية وتجديد مجمع نحو 10 ثوانٍ مع jitter وsingle-flight؛ الأرقام غير معتمدة حتى قياس الحمل المشترك. عند **إرسال** verification تُلتقط `Date.now()` و`performance.now()` معًا؛ تنتهي lease إذا بلغ elapsed أيٍّ منهما TTL، أو كانت قراءة غير صالحة/سالبة، أو لوحظ تراجع أو انقطاع/قفزة ساعة. لا يُعاد بدء المدة عند استلام الرد، ولا يمنح الرد المتأخر مدة جديدة. قبل كل نشر خاص وعند تنفيذ timer مؤخر يُفحص الانتهاء ويُخفى أولًا إلى `Checking access`/`Reconnect to view`. لا يكفي monotonic وحده: توثّق [MDN اختلاف تقدم الساعة أثناء sleep](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#ticking_during_sleep) وقد تتوقف خارج Windows. هذا قيد freshness لعميل يعمل، لا تفويض قراءة جديدًا بعد السحب، ولا ضمان محو DOM خلال 15 ثانية wall-clock أثناء تجميد OS؛ لا يمكن سحب pixels/بيانات عُرضت سابقًا.
- **اختبار الفصل:** A يمنح B، وB يستلم snapshot مؤخرة؛ A يسحب ثم يصل الرد: verify يرفض ولا تظهر. بعدها اختبار رد verify قديم يصل بعد deny أحدث فلا يعيدها؛ واختبار السحب بعد اكتمال verify يثبت إخلاء العرض خلال الميزانية المرصودة في عميل عامل، ورفض أي قراءة/تفاعل جديد بعد commit. يضاف انقطاع كامل، تبويب مخفي، pagination وحسابان؛ وحالات sleep مع monotonic متوقف وwall متقدم، وتراجع/قفزة الساعة، وfreeze يؤخر timer، و`pageshow` من bfcache وfocus/resume. تُثبت أولوية hide قبل الرد المؤخر وعدم تمديد lease عند الاستلام؛ لا تعتبر لقطة شاشة أثناء freeze اختبارًا لمحو يمكن ضمانه. يُقاس معدل القراءة وطلبات batch بدل طلب لكل بطاقة.

**الفجوة التي لا نخفيها:** SC03 يذكر التزام «القراءة اللاحقة والتحديثات» فورًا، بينما خاتمة وثيقة البنية تقول «سحب رؤية فوري» بلا مدة أو تعريف للردود المتزامنة. HTTP لا يزيل DOM لدى مشاهد بعيد لحظة commit، وpush نفسه يتأخر أو ينقطع؛ كما أن revoke قد يحدث بين آخر verification والرسم. الاقتراح يحقق تفويضًا حاليًا للقراءة، يمنع إحياء cache بعد معرفة السحب، ويحد عمر العرض لدى العميل المتعاون؛ لا يثبت انعدام التأخير ولا يسحب ما وصل سابقًا. إذا اعتُمد التفسير الأشد «لا يبقى أو يصل أي محتوى بعد commit ولو كان مرخصًا قبله»، فالشرط غير قابل للضمان تقنيًا وتبقى بوابته غير محسومة، ولا تُغلق بتسمية polling فوريًا. قناة account invalidation مستقبلًا قد تقلل التأخير وتدعم الإبطال المبكر، لكنها تظل hint يعقبه تحقق، وتحتاج عقد رمز مستقلًا واختبار ميزانية جديدًا.

## 7. التصدير والحذف والاستعادة

**التصدير:** التخزين الأولي artifact خاص في PostgreSQL على chunks محدودة. عند بدء capture الفعلية ينسخ job البيانات المسموحة إلى export inputs ثابتة باستعلام مصدر واحد ذي MVCC snapshot، ثم تعالج jobs هذه المدخلات فقط وتُنزِّل BFF الـartifact streaming بعد التفويض؛ cursor وحده ليس snapshot للبيانات الحية. JSON كامل versioned مع provenance؛ CSV للوقت عند توفيره، وليس بديلًا يضيع بقية بيانات الطلب. لا احتفاظ بالملف في Worker memory بين الطلبات، ولا تنزيل عام بمجرّد UUID. artifact ينتهي بعد 24 ساعة ورمز تنزيله بعد 15 دقيقة وفق سياسة العقد؛ التنزيل يعيد فحص المالك وحالة الحذف والانتهاء. تُختبر أحجام واقعية وحدود الذاكرة قبل اعتماد هذا الاختيار؛ الانتقال إلى Storage خاص يكون عند الحاجة وبنفس API، لا اشتراك مفترض.

**الحذف:** إعادة تحقق حديثة موثقة من Auth ومرتبطة بالجلسة/تحدي الحذف نفسه؛ لا يكفي `iat` لرمز مجدد أو وقت دخول عام للحساب من جهاز آخر. اختيار proof المناسب واختبار رفض refresh بلا إعادة دخول جزء من التنفيذ. ثم Prepare تثبت intent/outbox وتحجب الكتابة والظهور والمشاركة احترازيًا بحالة Pending؛ acknowledgment خارجية مطابقة تسبق apply الدائمة وpurge وفق [الملحق المعتمد](PRIVACY_LEDGER_CONTRACT_AR.md). لا نجاح حفظ للسحب قبل ack وapply، ولا Done للحذف قبل بقية التسوية. dispatcher يسوّي الوقت والعضويات والمضيفين، يحذف private workspaces/exports/social data، يزيل نسبة المساهمة من المنهج العام المصرح بالاحتفاظ به، ثم يحذف Auth/session ويكمل الحالة. لا يحتفظ بعنوان خاص في audit أو notification كوسيلة تتبع. retry يستأنف من cursor ولا يعيد احتساب وقت. المعرف النهائي للحالة بعد زوال Auth يحتاج receipt محدودًا غير قابل لاستعراض بيانات الحساب.

**حد الاستعادة:** tombstone في قاعدة البيانات وحدها غير كافٍ. يلزم سجل مشفّر خارج نطاق snapshot المراد استعادته، مع acknowledgment من D1 ثم apply في PostgreSQL قبل إعلان نجاح حفظ السحب؛ Done للحذف بعد purge وAuth cleanup. checkpoint المستقلة دليل تاريخ معروف عند الاستعادة وفق §3 من ملحق السجل، وليست مرحلة commit مطلوبة لكل عملية. إعداد هذا المخزن ومن يستطيع فكّه وآلية تطبيقه قبل فتح الخدمة يجب أن يُثبت ضمن التشغيل؛ لا تُكتب عبارة «لن تعود البيانات» من غير ذلك. B6 يبني عقد التسجيل والحذف؛ B7 يختبر restore معزولًا يشمل Auth وبيانات التطبيق وartifact store المستخدم. سياسة 7 أيام للنسخ والحد الأدنى لـtombstones مرجع منتج يحتاج تطبيقًا فعليًا، لا مجرد مدة في الواجهة.

**الاختيار المعتمد غير المنفذ:** [ملحق سجل الخصوصية](PRIVACY_LEDGER_CONTRACT_AR.md) يحسم D1 مستقلة تقييدية + local adapter، وPrepare → external acknowledgment → apply/purge، وإعادة opt-in بعد restore. Supabase تبقى أصل المنصة. head لا تكشف rollback للسجل نفسه خلف عمليات أحدث مجهولة؛ checkpoint/inventory مستقلة تحدّ كشف الرجوع المعروف. [بحث الخيارات](B6_PRIVACY_LEDGER_PROPOSAL_AR.md) يحتفظ بالمصادر والمقارنة فقط. لا تهيئة خدمة أو إغلاق لبوابة مستضافة بهذا العقد.

### 7.1 اتساق التصدير وحدود السعة — عقد تصميم غير منفذ

- **حد الالتقاط:** `requestedAt` وقت الطلب؛ `capturedAt` وقت الخادم عند بدء خطوة الالتقاط الفعلية، مع captureId وschemaVersion وsource revisions، وليس وقت الطلب أو `now()` قديمة من claim. استعلام واحد يقرأ أعمدة owner المسموحة من profile/workspace وسجل الوقت وبيانات B6 الداخلة في نطاق التصدير، ويثبت input rows/manifest وعددها وحجمها ذريًا. لا استدعاء قراءات mutable متتابعة داخل PL/pgSQL ثم تسميتها snapshot واحدة؛ [PostgreSQL يتيح لكل قراءة لاحقة رؤية commits جديدة](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED). لا `SELECT *` من Auth أو audit/receipts التي قد تحمل بيانات طرف آخر؛ حقول الحساب العامة المختارة فقط عند دخول Auth في النطاق، بلا tokens/credentials. لا اتصالات خارجية لجلب صورة أو محتوى أثناء capture.
- **معالجة قصيرة قابلة للاستئناف:** تحقق lifecycle/المالك وfence الوظيفة ثم capture ذرية ضمن transaction قصيرة بميزانية زمن وحجم؛ commit قبل jobs التحويل/download. لا transaction أو `pg_export_snapshot` تبقى مفتوحة عبر HTTP أو بين الدفعات. بعد ذلك cursor فوق `(captureId, section, ordinal)` الثابتة، مع chunks ذات مفاتيح فريدة وchecksum؛ إعادة المحاولة لا تعيد قراءة المصادر أو تخلط capture أخرى. فقد الرد يُحسم من receipt/manifest. capture فاشلة تُلغى كاملة؛ المحاولة الجديدة تسجل capturedAt جديدة. Ready لا تظهر إلا بعد تطابق manifest/chunks وإقفال artifact.
- **السعة المتحققة من المصدر، لا من افتراض:** [learning API](../apps/web/src/server/learning.ts) يحد request إلى **600,000 bytes**؛ [domain](../packages/domain/src/learning.ts) يحد **30 drafts و20 enrollments و1,500 tasks لكل outline**. [account/auth](../apps/web/src/server/auth.ts) يستعمل **4,096 bytes** افتراضيًا، والاسم **80 حرفًا**؛ [time API](../apps/web/src/server/time.ts) يستعمل **12,000 bytes** وحد صفحة **50**، والعنوان **160 حرفًا**. لا تعني هذه الحدود سقفًا لحجم الحساب: workspace JSONB بلا byte cap في migration، workEvents والتاريخ يتراكمون، وصفوف sessions/intervals/corrections قابلة للتغيير. لا حقل session notes في العقد الحالي؛ أي إضافة مستقبلية تدخل نفس capture بعد قرار نطاق. لا يقتصر التصدير على أول صفحة وقت ولا تُحذف أحداث قديمة لتلائم سقفًا مفترضًا.
- **حجز وتنظيف:** operationId تزيل التكرار، ويوجد طلب Processing واحد للحساب؛ طلب مكرر أثناءه يعيد الجاري. حصة عالمية محجوزة ذريًا تشمل input bytes وartifact bytes وtemporary headroom، مع ميزانيات للطلب/الصف/chunk والمهلة تُثبت من قياس PostgreSQL/Workers وحصة المشروع الفعلية في B6/B7؛ لم تثبت أرقام آمنة بعد، وحدود payload السابقة ليست بديلًا. إعادة فحص الميزانية في capture نفسها تمنع race مع preflight. تجاوزها يعطي حالة صريحة قابلة للمراجعة/المحاولة بلا Ready أو ملف ناقص؛ لا giant JSON aggregate أو تحميل الحساب كله إلى Worker memory. cleanup بدفعات fenced تزيل inputs بعد إتمام artifact، وتزيل captures الفاشلة/المهجورة بمهلة معلنة؛ artifact بعد 24 ساعة ورمز الرابط بعد 15 دقيقة وفق العقد، وتنقص quota بعد حذف مثبت فقط. حذف الحساب يلغى الطلب والتنزيل وينظف جميع نسخ التصدير.
- **إثبات لازم:** تعديلات متزامنة على profile/workspace والتصحيح/الجلسة أثناء capture ثم بين chunks؛ الملف يمثل capture واحدة بما فيها الحالة غير النهائية وقتها. اختبارات lost ACK/retry، طلبان متزامنان لنفس الحساب، سباق حجز quota/cleanup، تجاوز الحجم/timeout بلا partial Ready، حذف أثناء التنزيل، وجرد counts/checksums. البوابة المتبقية فعلًا هي أن الالتقاط الكامل بأكبر حساب مدعوم يناسب مدة SQL ومساحة DB المقاسة؛ إن لم يناسب لا نعلن اتساقًا عبر قراءات متفرقة، بل تُعاد مراجعة استراتيجية الالتقاط قبل القبول.

## 8. بوابات قبول التنفيذ

| الدليل | حالات محددة |
|---|---|
| AC05، CM01–CM02 | تعديل الخاص بعد الإرسال لا يمس snapshot؛ reviewer لا يرى التقدم؛ اعتماد مكرر لا ينشر مرتين؛ ترقية بمقامات مختلفة وmapping غير محسوم؛ مساهم ذو تقدم يحتفظ بنفس enrollment/claim. |
| SC01–SC05 | حساب خاص ينضم لكورس/روم بلا نشر؛ قبول دون grants؛ matrix الجماهير؛ حظر من الروم يطبق في Circle والعكس؛ سحب أثناء رد مؤخر/pagination/cache وsleep/freeze أو تغير الساعة، مع hide قبل الرد وإبطال lease عند العودة وفق §6.1؛ عنوان خاص لا يدخل DTO أو إشعار؛ milestone يحتاج نشرًا ومنحة ثم يختفي بعد Undo/revoke. |
| LB01–LB04 | حدود الأسبوع/الشهر UTC وDST للعرض؛ baseline/Undo/Recomplete/offline وأصل claim؛ اختلاف النسخة/النطاق/صفر مقام؛ opt-in متأخر بمعاينة وopt-out فوري بالقراءة؛ استبعاد الفترة المصححة وحدها؛ ties ثابتة بلا كسر وهمي. |
| AC03–AC04، OP03 | تبديل حساب مع رد/export/notification معلقة؛ IDOR في كل مصدر وcursor/رابط تنزيل؛ تصدير لا يحتوي بيانات عضو روم/متابع آخر؛ capture واحدة رغم تغير المصادر بين chunks، وdedupe/quota/cleanup؛ انتهاء token/artifact وإعادة الطلب. |
| حذف وتشغيل | عضو/مضيف/مالك داخل Run مع أمر متزامن؛ cutoff يمنع JWT قديم؛ failed job/retry/lost response؛ فك FK صحيح؛ pending ≠ completed؛ replay tombstones في اختبار B7. |
| UX/أداء | Work-only، empty/loading/error/stale، keyboard و320px/zoom/reduced motion؛ لا full-page loader أثناء refresh؛ زمن queries وحجم payload والحزم، ولا fetch لكل بطاقات Circle بلا batching. |

تُحفظ أدلة التنفيذ لاحقًا في `docs/evidence/B6.md`. لا ينشئ هذا التصميم استثناءً من ترتيب Waterfall أو يغلق أي بوابة.
