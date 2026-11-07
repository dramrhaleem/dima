# اقتراح سجل الخصوصية الخارجي — B6/B7

**الحالة: بحث الخيارات السابق محفوظ للمصادر، 1 نوفمبر 2026.** حُسمت الاختيارات في [ملحق معتمد غير منفذ](PRIVACY_LEDGER_CONTRACT_AR.md)، وهو المرجع الأعلى عند اختلاف صياغة اقتراح أو شرط موافقة أدناه. يكمّل §7 في [عقد B6](B6_API_AND_DATA_AR.md)، ولا يضيف خدمة أو يغيّر تطبيقًا أو SQL أو حساب استضافة. هدفه منع استعادة بيانات محذوفة أو منح مسحوبة عند استرجاع نسخة Supabase قديمة. البنية الأساسية وAuth وRealtime تبقى في Supabase؛ B5 وقنواته لا تتغير.

## الاختيار المقترح وحد القرار

**الاختيار بعد فحص إعادة الاستخدام:** adapter D1 واحدة مع binding محلية في Wrangler/Miniflare وAEAD، ثم D1 مستقلة صغيرة مستضافة للسجل فقط على Workers Free. استُبعد journal المحلي المخصص الوارد في المقارنة أدناه لصالح المحاكي القائم؛ التفاصيل في §1.1 من [الملحق المعتمد](PRIVACY_LEDGER_CONTRACT_AR.md). الاستثناء المعماري الضيق مثبت، ولا يعني إنشاء خدمة أو إثبات تشغيل إنتاجي.

| الخيار | القراءة والمتانة | التكلفة والقرار |
|---|---|---|
| Cloudflare KV | eventual consistency؛ التغيير والنتيجة السلبية المخزنة قد يتأخران 60 ثانية أو أكثر، وحتى نفس الموقع ليس مضمونًا دائمًا. لا يصلح لإثبات أن آخر revoke ظاهر عند بوابة restore. | لا نختاره سجلًا مرجعيًا مهما كان ضمن المجاني. [توثيق الاتساق](https://developers.cloudflare.com/kv/concepts/how-kv-works/). |
| D1 منفصلة | دون Sessions API تذهب الاستعلامات إلى primary، وهو المسار المقترح للـappend والتحقق وrestore. إذا استُعملت sessions لاحقًا يلزم `first-primary` لبدء قراءة أحدث حالة؛ `first-unconstrained` لا يحقق ذلك. لا نعمّم هذا الضمان على كل replica. | Free:‏ 5 ملايين صف مقروء و100 ألف مكتوب يوميًا، 5GB إجمالي، 500MB للقاعدة الواحدة؛ تجاوز المجاني يؤدي لأخطاء/منع الكتابة، لا ترقية تلقائية. هذا مناسب مبدئيًا لسجل صغير، مع مراقبة الاستخدام؛ لم تُفحص حصة حساب المستخدم. [القراءة](https://developers.cloudflare.com/d1/best-practices/read-replication/)، [السعر](https://developers.cloudflare.com/d1/platform/pricing/)، [الحدود](https://developers.cloudflare.com/d1/platform/limits/)، [تجاوز الحصة](https://developers.cloudflare.com/d1/reference/faq/). |
| R2 | واجهات التخزين المباشرة قوية الاتساق للكتابة والقراءة والقائمة والحذف. caching عبر custom domain قد يعيد نسخة قديمة؛ بوابة restore يجب أن تستخدم binding/API مباشرة. يصلح فنيًا لسجل objects immutable مع idempotency. | المجاني Standard يشمل 10GB شهريًا ومليون Class A وعشرة ملايين Class B، ثم فوترة استخدام. التفعيل يتطلب subscription/checkout، وسياسة الدفع تتضمن وسيلة دفع والتحقق منها؛ لم يُفتح checkout لهذا الحساب، فلا نزعم التحقق من متطلباته الخاصة. لا نختاره افتراضيًا تحت مطلب تجنب التزام فوترة جديد. [الاتساق](https://developers.cloudflare.com/r2/reference/consistency/)، [السعر](https://developers.cloudflare.com/r2/pricing/)، [التفعيل](https://developers.cloudflare.com/r2/get-started/)، [سياسة الفوترة](https://developers.cloudflare.com/billing/understand/billing-policy/). |
| ملف journal مشفّر محلي + adapter إنتاجي | append مُؤطَّر مع lock/single-writer وfsync، خارج مجلد snapshot ومفتاح خارج النسخة. يختبر استئناف crash والتحقق والتكرار؛ وجوده على نفس الجهاز لا يحمي من فقد الجهاز أو القرص. ليس filesystem دائمًا متاحًا داخل Worker. | بلا خدمة خارجية محليًا؛ لا يُقبل وحده دليلًا أن الخصوصية محفوظة عند استعادة الإنتاج. لا يوجد implementation لهذا الاقتراح الآن. |

D1 هنا خارج **حد استعادة Supabase**، وليست WORM أو حماية من حذف المشغّل أو استرجاع السجل نفسه للخلف. Time Travel على D1 Free سبعة أيام، وPaid ثلاثون يومًا؛ هذا أفق استعادة D1 لا TTL تلقائي لسجلاتنا. لا نعيد السجل للخلف مع Supabase. فقد مثبت أو غياب المفاتيح يبقي الخدمة مغلقة؛ head وحدها لا تثبت أن سجلًا أحدث غير معروف لم يُفقد. checkpoint/inventory موثوقة خارج المخزنين تكشف الرجوع خلف نقطة معروفة فقط، وفق الملحق المعتمد؛ لا ادعاء كشف سحري لذيل مجهول. [حدود Time Travel حسب الخطة](https://developers.cloudflare.com/d1/platform/limits/).

## أصغر عقد تخزين

واجهة adapter واحدة: `append(operationId, encryptedRecord) → durableReceipt`، و`readAfter(sequence, limit)`، و`head() → checkpoint`. لا HTTP عام لقراءة ledger أو مفاتيح في المتصفح. أذونات الإنتاج للـWorker/job المحددين فقط، مع إعداد يدوي موثق للمورد والمفتاح والـbinding والمراقبة قبل التشغيل.

الصف يحوي sequence وoperationId فريدًا وciphertext digest وkeyVersion وnonce/ciphertext. حمولة AEAD المشفرة: subjectId وaccountGeneration وaction وscope وeffectiveAt وpolicyVersion؛ لا email أو اسم أو تفاصيل كورس/جلسة. operationId وschemaVersion يدخلان authenticated associated data. مفتاح التشفير خارج نسخ Supabase مع نسخة استرداد مؤمنة وإصدارات مفاتيح؛ عدم توافر المفتاح أو اختلاف schema غير مفهوم يوقف restore بدل التخمين.

يُولّد ciphertext مرة واحدة لكل operation ويُثبّت في outbox، كي تعيد المحاولة نفس البايتات. duplicate بنفس operationId والـdigest يعيد receipt الأصلية؛ اختلافهما خطأ لا overwrite. يُثبَّت receipt من استجابة التخزين الناجحة/قراءة primary مطابقة، لا من مجرد إرسال request. timeout يعني نتيجة غير معروفة: قراءة/إعادة بنفس operationId، وليس Done ولا استنتاج أن الكتابة لم تقع. استخدام transaction محلية لكل إدخال/فحص ممكن؛ لا ننسب إلى D1 معاملة موزعة مع PostgreSQL. [معاملات D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## بروتوكول المخزنين وحالات الفشل

**الفجوة المادية في ترتيب المسودة:** cutoff ثم outbox داخل PostgreSQL ثم mirror خارجي يترك نافذة: استعادة نسخة أقدم من outbox تفقد revoke أو طلب الحذف قبل أن يصل للسجل. منع Done وحده لا يجعل كل revoke محلي ناجح مقاومًا للاستعادة. يلزم تعريف نقطة نجاح العملية ودمج الترتيب التالي صراحة في العقد قبل التنفيذ:

1. تتحقق معاملة PostgreSQL من الهوية وإعادة التحقق المطلوبة/revision، وتثبت `Prepared` intent وoutbox غير قابل لتبديل payload، وتحجز العملية ضد grant متعارضة لاحقة. لا يبدأ purge ولا تعلن الواجهة Saved/Done. لا قفل PostgreSQL مفتوح خلال الشبكة.
2. يرسل dispatcher الـintent المشفر للسجل الخارجي ويستلم durable acknowledgment مطابقًا. انقطاع أو نفاد حصة يبقي الحالة Pending قابلة لإعادة المحاولة، مع السبب التشغيلي. لا ندعي اكتمال سحب مقاوم للاستعادة في هذه الحالة.
3. معاملة PostgreSQL تثبت acknowledgment وتطبق cutoff/revoke وحالة الحذف؛ هذا commit هو نقطة السحب النهائي الفعال. يصبح أي وصول تالٍ خاضعًا للسياسة الجديدة. الحذف يظل Pending حتى تسوية المجال وpurge وAuth cleanup؛ فقط بعدها Done. لا irreversible purge قبل acknowledgment الخارجي.
4. crash بعد acknowledgment وقبل apply آمن قابل للاستئناف: إعادة بنفس operationId، ثم apply مرة واحدة. عند restore يعامل السجل intent التقييدية المكتوبة بعد تحقق صحيح كـrevoke/delete واجب التطبيق ولو لم يوجد receipt النهائية داخل النسخة. هذه سياسة تحفظية مقصودة؛ لا «نعكس» tombstone بحذفها.

هذا ليس distributed commit، بل prepared intent ثم acknowledgment ثم apply مع retry وحالات UI صادقة. كتابة السجل تأتي **بعد** prepare معتمد محفوظ، لا بناءً على command غير مثبت. أثناء Pending قد نغلق الظهور محليًا احترازيًا، لكن لا نسمي ذلك ضمان سحب نهائي بعد restore. إذا أُبقي ترتيب cutoff-first بدل المقترح، يجب التصريح بأن مقاومة الاستعادة تبدأ فقط عند acknowledgment؛ لا تبقى عبارة منع الرجوع مطلقة.

يشمل السجل account deletion وكل تغيّر يسحب وصولًا يلزم حفظه بعد restore: سحب grants/relationship، الحظر، opt-out للـPeople أو board، وإلغاء نشر milestone/source حيث ينطبق. لا نحفظ محتوى الشخص لتحقيق ذلك. إعادة opt-in أو unblock لا تمحو intent قديمة؛ تُدار حالة التطبيق الجديدة بصورة مستقلة.

## إعادة الاستعادة والاحتفاظ

- تُغلق بوابة التشغيل/auth/القراءة والكتابة خارج قاعدة البيانات المستعادة. تُوقف أو تُصرّف أوامر الخصوصية الجديدة أثناء cutover، ثم تؤخذ head أخيرة من primary؛ head أُخذت قبل وصول كتابات جديدة لا تثبت شمولها.
- تُقرأ كل السجلات المطلوبة حتى checkpoint وتُفحص الهوية وAEAD والـdigest/schema، وتُعاد عمليات التقييد idempotently، ثم تُبنى الإسقاطات وتُراجع الصلاحيات قبل الفتح. sequence يحدد ترتيب السجلات المثبتة، ولا يُفترض أن كل رقم صحيح موجود بلا فجوات.
- subject هو UUID الحساب وجيله، لا email. حساب جديد بنفس البريد لا يرث حذف الحساب السابق. سجل جيل غير مفهوم لا يُتجاهل بصمت. المراجع الباقية لبيانات الآخرين والمنهج المسموح بالاحتفاظ به تتبع عقد الحذف الأصلي.
- **اختيار الحد الأدنى:** ledger تقييدية فقط، وليست event store لكل grants. إذا احتوت النسخة المستعادة regrant أحدث من revoke قديمة، نطبق التقييد تحفظيًا ونطلب opt-in جديدة بعد restore مع تفسير للمستخدم. هذه خسارة إذن مقصودة تمنع إحياء إذن قديم؛ تحتاج قبولًا صريحًا في عقد المنتج. البديل حفظ جميع تغييرات الأذونات وترتيبها يزيد النطاق وغير مقترح الآن.
- احتفاظ النسخ سبعة أيام **لا يعني حذف tombstone بعد سبعة أيام من وقوع الحدث**. لا تنتهي قبل انتهاء آخر نسخة قابلة للاستعادة قد تعيد البيانات/الإذن، وانتهاء restore معلقة. retainUntil تحسب من inventory حقيقي للنسخ، بما فيه اليدوية؛ إن وُجدت نسخة أقدم غير محسومة أو غاب الجرد يستمر الاحتفاظ. حذف محتوى المستخدم من التطبيق مستقل عن حفظ الحد الأدنى المشفر لمنع إحيائه.

## المطلوب قبل أي ادعاء تشغيل

تحديث ضيق للبنية وسياسة السحب/Pending والـrestore؛ تهيئة D1 منفصلة ومفتاح recovery خارج Supabase؛ adapter واختبارات محلية؛ ثم إثبات remote append/read/retry/replay على المورد الحقيقي. الاختبارات المحلية تشمل crash عند كل حد، lost acknowledgment، duplicate/hash mismatch، ملفًا مقطوعًا، مفتاحًا مفقودًا، فشل الحصة، restore قبل prepare وبعد external acknowledgment، وregrant بعد revoke. لا تُستخدم هذه الاختبارات لإثبات متانة الخدمة البعيدة.

B7 يغلق بوابة الاستعادة فقط بعد تجربة معزولة تشمل Auth وبيانات التطبيق والـexports والـledger والبوابة خارج النسخة، وتحقيق سياسة السبعة أيام فعليًا. هذا المستند لا يثبت إعداد مورد أو purge أو نجاح استعادة ولا يرفع أي بوابة معلقة.
