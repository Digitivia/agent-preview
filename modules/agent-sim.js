// AgentSim — the Simulation mode engine for Test Chat.
//
// Simulation answers with SAFE, PREDEFINED text. It never calls an AI provider,
// never touches the network, never writes anything, and never creates an order,
// a lead, a booking or any other business action. The point is to let a merchant
// see how the agent behaves under the configuration they just wrote without
// spending a coin or touching a customer.
//
// The reply is derived from the agent's own configuration (role, capabilities,
// style, knowledge), so changing a capability visibly changes the behaviour.
// That is what makes it useful as a preview of the layered prompt.
//
// This module is the single source for the simulation engine. The standalone
// /demo/ page loads it too (demo/index.html) so there is exactly one copy.
(function () {
    'use strict';

    // The catalogue the demo business sells. Prices are list prices; `sale` is
    // the current offer price; `out` means the product is unavailable.
    const CATALOG = {
        business: { en: 'Nile Fish', ar: 'نيل فيش' },
        customer: { en: 'Mona', ar: 'منى' },
        tilapia: { en: 'Fresh Nile tilapia (1 kg)', ar: 'بلطي نيلي طازج (1 كيلو)', price: 120 },
        shrimp: { en: 'Jumbo shrimp, peeled (1 kg)', ar: 'جمبري جامبو مقشر (1 كيلو)', price: 450, sale: 399 },
        salmon: { en: 'Salmon fillet (500 g)', ar: 'سلمون فيليه (500 جم)', price: 520, out: true },
    };

    // Keyword matchers. Bilingual on purpose: the agent replies in the language
    // the customer writes in, so it has to understand both.
    const RX = {
        greet: /\b(hello|hi|hey|good (morning|evening|afternoon))\b|مرحب|اهلا|أهلا|السلام|ازيك|إزيك|صباح|مساء/i,
        price: /price|how much|cost|بكام|سعر|كام\b|ثمن/i,
        shrimp: /shrimp|prawn|جمبري/i,
        salmon: /salmon|سلمون/i,
        tilapia: /tilapia|fish|بلطي|سمك/i,
        discount: /discount|offer|deal|cheaper|خصم|عرض|تخفيض|أرخص|ارخص/i,
        order: /order|buy|checkout|purchase|اطلب|أطلب|اشتري|أشتري|احجز|عايز.*(اخد|آخد)/i,
        delivery: /deliver|shipping|توصيل|شحن|يوصل/i,
        late: /late|delay|where is my|متأخر|اتأخر|فين طلبي|طلبي/i,
        refund: /refund|return|money back|استرجاع|ارجاع|إرجاع|استرداد|فلوسي/i,
        damaged: /damaged|broken|wrong|missing|تالف|ناقص|بايظ|غلط|مكسور|وصل.*مش/i,
        thanks: /thanks|thank you|شكرا|شكراً|متشكر|تسلم/i,
        human: /human|person|manager|real agent|موظف|مدير|حد بشري|حد من الفريق/i,
        lead: /interested|how much for|looking for|want to buy|مهتم|عايز اشتري|بكام لل/i,
        book: /book|booking|appointment|reserv|احجز|ميعاد|موعد|حجز/i,
        faq: /return policy|shipping time|open|hours|policy|سياسة الاسترجاع|مواعيد|مفتوح/i,
        orderNo: /#?\b(\d{3,8})\b/,
    };

    const nameOf = (item, lang) => item[lang];
    const money = (n, lang) => (lang === 'ar' ? `${n} جنيه` : `${n} EGP`);

    // ---- capability catalogue (mirrors public.agent_capability_catalog) ----
    // `booking` is deliberately absent from the selectable set unless the
    // merchant has actually connected a calendar; the server enforces this too.
    const CAPABILITIES = [
        { key: 'sales', label: { en: 'Sales', ar: 'المبيعات' }, desc: { en: 'Help customers choose and buy.', ar: 'مساعدة العملاء في الاختيار والشراء.' } },
        { key: 'support', label: { en: 'Customer service', ar: 'خدمة العملاء' }, desc: { en: 'Resolve problems and order questions.', ar: 'حل المشاكل واستفسارات الطلبات.' } },
        { key: 'recommend', label: { en: 'Product recommendations', ar: 'توصية بالمنتجات' }, desc: { en: 'Suggest the right product for the need.', ar: 'اقتراح المنتج المناسب للحاجة.' } },
        { key: 'lead', label: { en: 'Lead qualification', ar: 'تأهيل العملاء المحتملين' }, desc: { en: 'Collect contact details and qualify.', ar: 'جمع بيانات العميل المحتمل وتأهيله.' } },
        { key: 'faq', label: { en: 'FAQs & knowledge', ar: 'الأسئلة الشائعة والمعرفة' }, desc: { en: 'Answer from your business knowledge.', ar: 'الإجابة من معرفة نشاطك.' } },
        { key: 'booking', label: { en: 'Appointment booking', ar: 'حجز المواعيد' }, desc: { en: 'Needs a connected calendar.', ar: 'يحتاج تقويم متصل.' }, needs: 'calendar' },
    ];

    // ---- style presets (mirrors the server's allowed style.preset values) ----
    const PRESETS = [
        { key: 'consultative', label: { en: 'Consultative', ar: 'استشاري' }, desc: { en: 'Asks first, then recommends.', ar: 'يسأل أولًا ثم يقترح.' } },
        { key: 'friendly', label: { en: 'Friendly & conversational', ar: 'ودود ومحادث' }, desc: { en: 'Warm, easy, natural.', ar: 'دافئ وسهل وطبيعي.' } },
        { key: 'professional', label: { en: 'Professional', ar: 'مهني' }, desc: { en: 'Polished and to the point.', ar: 'أنيق ومباشر.' } },
        { key: 'persuasive', label: { en: 'Persuasive but natural', ar: 'مقنع وطبيعي' }, desc: { en: 'Confident without pressure.', ar: 'واثق بلا ضغط.' } },
        { key: 'luxury', label: { en: 'Premium / luxury', ar: 'فاخر' }, desc: { en: 'Refined, high-touch service.', ar: 'خدمة راقية ومميزة.' } },
    ];

    const LENGTHS = [
        { key: 'short', label: { en: 'Short', ar: 'مختصر' } },
        { key: 'medium', label: { en: 'Medium', ar: 'متوسط' } },
        { key: 'detailed', label: { en: 'Detailed', ar: 'مفصّل' } },
    ];

    const INITIATIVES = [
        { key: 'low', label: { en: 'Reactive', ar: 'متفاعل' } },
        { key: 'balanced', label: { en: 'Balanced', ar: 'متوازن' } },
        { key: 'high', label: { en: 'Proactive', ar: 'مبادر' } },
    ];

    const FOLLOWUPS = [
        { key: 'light', label: { en: 'Light', ar: 'خفيف' } },
        { key: 'balanced', label: { en: 'Balanced', ar: 'متوازن' } },
        { key: 'persistent', label: { en: 'Persistent', ar: 'مثابر' } },
    ];

    function toneTail(tone, lang) {
        const t = String(tone || '');
        if (/friendly/i.test(t)) return lang === 'ar' ? ' 🙂' : ' 🙂';
        if (/professional|formal/i.test(t)) return lang === 'ar' ? ' — تحت أمرك.' : ' — at your service.';
        return '';
    }

    function opener(tone, lang) {
        const t = String(tone || '');
        if (/professional|formal/i.test(t)) return lang === 'ar' ? 'أهلاً بحضرتك. ' : 'Good day. ';
        if (/empathetic|support/i.test(t)) return lang === 'ar' ? 'أكيد، أنا معاك. ' : "Of course, I'm here with you. ";
        return '';
    }

    // Preset changes how the agent opens and closes.
    function presetOpener(preset, lang) {
        switch (preset) {
            case 'consultative': return lang === 'ar' ? 'خليني أفهم طلبك الأول. ' : 'Let me understand what you need first. ';
            case 'friendly': return lang === 'ar' ? 'أهلاً بيك! ' : 'Hey there! ';
            case 'professional': return lang === 'ar' ? 'أهلاً بحضرتك. ' : 'Good day. ';
            case 'persuasive': return lang === 'ar' ? 'أكيد، عندي اللي يناسبك. ' : 'I have just the thing for you. ';
            case 'luxury': return lang === 'ar' ? 'أهلاً بك، وخدمتك لي تميزك. ' : 'Welcome — let us take care of you. ';
            default: return '';
        }
    }

    // Reply length controls how much the agent says.
    function lengthTail(key, lang) {
        if (key === 'short') return lang === 'ar' ? 'تحب أضيفلك تفاصيل؟' : 'Want the details?';
        if (key === 'detailed') return lang === 'ar' ? 'قولّي لو عايز أشرحلك أكتر عن السعر والتوصيل.' : 'Tell me if you would like me to go through the price and delivery in more detail.';
        return lang === 'ar' ? 'تحب أكمل؟' : 'Would you like me to continue?';
    }

    function detectLang(text) {
        return /[؀-ۿ]/.test(String(text || '')) ? 'ar' : 'en';
    }

    /**
     * Build the simulation context from a saved agent configuration.
     * cfg: { role, name, tone, capabilities[], style:{preset,length,initiative,followup}, knowledge:{policies} }
     */
    function context(cfg) {
        const c = cfg || {};
        const caps = Array.isArray(c.capabilities) && c.capabilities.length ? c.capabilities.slice() : ['sales'];
        const style = c.style || {};
        return {
            role: c.role === 'support' ? 'support' : 'sales',
            name: (c.name || '').trim(),
            tone: c.tone || '',
            capabilities: caps,
            has: (k) => caps.indexOf(k) !== -1,
            preset: style.preset || null,
            length: style.length || 'short',
            initiative: style.initiative || 'balanced',
            followup: style.followup || 'balanced',
            policies: (c.knowledge && c.knowledge.policies) || '',
        };
    }

    function greeting(ctx, lang) {
        const biz = CATALOG.business[lang];
        const who = ctx.name ? (lang === 'ar' ? ` أنا ${ctx.name}.` : ` I'm ${ctx.name}.`) : '';
        if (ctx.role === 'support' || ctx.has('support')) {
            return (lang === 'ar' ? `أهلاً بك${who} — معاك خدمة عملاء ${biz}.` : `Hi${who} — customer service here at ${biz}.`) +
                (lang === 'ar' ? ' قولي المشكلة وأنا هتابعها معاك.' : ' Tell me what went wrong and I will stay on it.');
        }
        return (lang === 'ar' ? `أهلاً بك${who} — أنا مساعد ${biz}.` : `Hi${who} — the ${biz} assistant here.`) +
            (lang === 'ar' ? ' قولي إيه اللي محتاجه؟' : ' What are you looking for?');
    }

    function supportReply(ctx, lang, text) {
        if (RX.refund.test(text)) {
            return lang === 'ar'
                ? 'أقدر أرجّع لك المبلغ حسب سياسة الاسترجاع. بس محتاج رقم الطلب الأول، تحب تديهولي؟'
                : 'I can handle a refund under our returns policy. I need the order number first — shall I take it?';
        }
        if (RX.damaged.test(text)) {
            return lang === 'ar'
                ? 'آسف على اللي حصل، هنبعت لك واحد يتحرك فوراً. ممكن تبعتلي صورة أو رقم الطلب؟'
                : 'Sorry about that — I will get someone onto it right away. Could you send a photo or the order number?';
        }
        if (RX.late.test(text)) {
            return lang === 'ar'
                ? 'هتابع حالة الطلب مع الفريق وأرد عليك. ممكن رقم الطلب؟ (في الوضع التجريبي مش هراجع طلبات حقيقية.)'
                : 'I will check the order with the team and come back to you. Can I take the order number? (In simulation mode no real orders are looked up.)';
        }
        if (RX.delivery.test(text)) {
            return lang === 'ar'
                ? 'التوصيل بيتم حسب المنطقة. تحب أعرفك区域的 التوصيل المتاح؟'
                : 'Delivery depends on the area. Would you like me to check what is available for you?';
        }
        return lang === 'ar'
            ? 'أنا معاك في خدمة العملاء. قولي المشكلة بالتفصيل وأنا هتابعها خطوة بخطوة.'
            : 'I am here with you on support. Tell me the details and I will work through it with you.';
    }

    function salesReply(ctx, lang, text) {
        if (RX.discount.test(text)) {
            return lang === 'ar'
                ? 'العروض الحالية موجودة في بيانات المنتجات نفسها، فمش هقدر أخصم من نفسي. تحب أشوف السعر المتاح دلوقتي؟'
                : 'Current offers come straight from the product data, so I will not invent a discount. Shall I check the live price?';
        }
        if (RX.shrimp.test(text) && RX.price.test(text)) {
            return lang === 'ar'
                ? `${CATALOG.shrimp.ar} بـ ${money(CATALOG.shrimp.sale, lang)} بدل ${money(CATALOG.shrimp.price, lang)}.`
                : `${CATALOG.shrimp.en} is ${money(CATALOG.shrimp.sale, lang)} (${money(CATALOG.shrimp.price, lang)} list).`;
        }
        if (RX.shrimp.test(text)) {
            return lang === 'ar'
                ? `عندنا ${CATALOG.shrimp.ar} بـ ${money(CATALOG.shrimp.sale, lang)}.`
                : `We have ${CATALOG.shrimp.en} at ${money(CATALOG.shrimp.sale, lang)}.`;
        }
        if (RX.salmon.test(text)) {
            return lang === 'ar'
                ? `سلمون خلص من المخزن دلوقتي. المتاح ${CATALOG.tilapia.ar} بـ ${money(CATALOG.tilapia.price, lang)}.`
                : `The salmon is out of stock right now. We have ${CATALOG.tilapia.en} at ${money(CATALOG.tilapia.price, lang)}.`;
        }
        if (RX.tilapia.test(text)) {
            return lang === 'ar'
                ? `${CATALOG.tilapia.ar} بـ ${money(CATALOG.tilapia.price, lang)}.`
                : `${CATALOG.tilapia.en} is ${money(CATALOG.tilapia.price, lang)}.`;
        }
        if (RX.order.test(text)) {
            return lang === 'ar'
                ? 'تمام، أسجّل الطلب. محتاج اسمك وتليفونك والعنوان والكمية. (في الوضع التجريبي مش هيتعمل طلب حقيقي.)'
                : 'Perfect, let us take the order. I need your name, phone, address and quantity. (In simulation mode no real order is created.)';
        }
        if (RX.delivery.test(text)) {
            return lang === 'ar'
                ? 'التوصيل بيتم حسب المنطقة، وأنا مش هعطيك تاريخ مضمون قبل ما الفريق يؤكد.'
                : 'Delivery is by area, and I will not promise a date before the team confirms it.';
        }
        if (RX.price.test(text)) {
            return lang === 'ar'
                ? 'أسعارنا من بيانات المنتجات. تحب تقولي إيه اللي بتدور عليه؟'
                : 'Prices come from the product data. Tell me what you are after and I will give you the real one.';
        }
        return lang === 'ar'
            ? 'تحب أساعدك تختار الأنسب؟ قولي إيه اللي محتاجه.'
            : 'I can help you pick the right one — what do you need it for?';
    }

    function faqReply(ctx, lang) {
        if (!ctx.policies) {
            return lang === 'ar'
                ? 'لسه ما كتبتش سياسات النشاط في «معرفة النشاط». اكتبها هناك وأنا هجيب منها الإجابة.'
                : 'Your business policies are not written yet. Add them under Business knowledge and I will answer from there.';
        }
        return lang === 'ar'
            ? `ده من سياسات نشاطك: ${ctx.policies.slice(0, 160)}`
            : `From your business policies: ${ctx.policies.slice(0, 160)}`;
    }

    function leadReply(ctx, lang) {
        return lang === 'ar'
            ? 'تمام، أنا مهتم بمجرد ما أعرف إيه اللي محتاجه. ممكن اسمك وتليفونك؟ (مش هرسل حاجة لحد في الوضع التجريبي.)'
            : 'Great — I just need a couple of details to help. May I take your name and phone? (Nothing is sent to anyone in simulation mode.)';
    }

    function bookingReply(ctx, lang) {
        return lang === 'ar'
            ? 'الحجز محتاج تقويم متصل. لو فعّلته أقدر أحدد معاد.'
            : 'Booking needs a connected calendar. Once it is connected I can set a time.';
    }

    /**
     * Produce a simulated reply.
     * Returns { text, lang, intent, capability, simulated_actions: [] }
     */
    function reply(cfg, text) {
        const ctx = context(cfg);
        const lang = detectLang(text);
        const s = String(text || '');
        let body, intent = 'general', capability = null;

        if (RX.human.test(s)) {
            intent = 'handoff';
            body = lang === 'ar'
                ? 'تمام، هحولك لفريق بشري. (في الوضع التجريبي التحويل ده متعملش فعلياً.)'
                : 'I will hand you over to a human teammate. (In simulation mode that hand-over is not really performed.)';
        } else if (RX.thanks.test(s)) {
            intent = 'thanks';
            body = lang === 'ar' ? 'العفو! تحت أمرك في أي وقت.' : 'Happy to help — any time.';
        } else if (ctx.role === 'support' && (RX.refund.test(s) || RX.damaged.test(s) || RX.late.test(s))) {
            intent = 'support';
            capability = 'support';
            body = supportReply(ctx, lang, s);
        } else if (ctx.has('faq') && RX.faq.test(s)) {
            intent = 'faq';
            capability = 'faq';
            body = faqReply(ctx, lang);
        } else if (ctx.has('booking') && RX.book.test(s)) {
            intent = 'booking';
            capability = 'booking';
            body = bookingReply(ctx, lang);
        } else if (ctx.has('lead') && RX.lead.test(s) && !RX.price.test(s)) {
            intent = 'lead';
            capability = 'lead';
            body = leadReply(ctx, lang);
        } else if (ctx.has('support') && (RX.refund.test(s) || RX.damaged.test(s) || RX.late.test(s))) {
            intent = 'support';
            capability = 'support';
            body = supportReply(ctx, lang, s);
        } else {
            intent = 'sales';
            capability = 'sales';
            body = salesReply(ctx, lang, s);
        }

        const head = presetOpener(ctx.preset, lang) + opener(ctx.tone, lang);
        const tail = lengthTail(ctx.length, lang) + toneTail(ctx.tone, lang);
        const next = ctx.initiative === 'high'
            ? (lang === 'ar' ? ' تحب أجهّز الطلب؟' : ' Shall I get that ready?')
            : ctx.initiative === 'low' ? '' : (lang === 'ar' ? ' تحب أكمّل؟' : ' Want me to continue?');

        return {
            // The parts are joined with a space so two sentences never run into
            // each other, then the double spaces are cleaned up.
            text: [head, body, next, tail]
                .map((p) => String(p || '').trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim(),
            lang,
            intent,
            capability,
            simulated_actions: [],
        };
    }

    /**
     * A sample AI-written follow-up for the current agent. Scripted, never generated.
     * Mirrors what the server would return for the same goal, for layout review.
     */
    function followupPreview(cfg, goal, lang) {
        const ctx = context(cfg);
        const L = lang || 'en';
        const g = String(goal || '').toLowerCase();
        const who = CATALOG.customer[L];
        let body;
        if (/discount|offer|خصم|عرض/i.test(g)) {
            body = L === 'ar'
                ? `${who}، وصلتك لخصم على الجمبري بس هو ساري حسب الكمية. تحب أأكدلك التفاصيل؟`
                : `${who}, there is an offer on the shrimp that depends on the quantity. Shall I confirm the details?`;
        } else if (/deliver|توصيل|شحن/i.test(g)) {
            body = L === 'ar'
                ? `${who}، عايز أعرفك إن التوصيل بيتم حسب المنطقة. تحب أأكدلك الموعد؟`
                : `${who}, just to let you know delivery is by area. Shall I confirm the timing?`;
        } else if (ctx.role === 'support') {
            body = L === 'ar'
                ? `${who}، لسه فاكر طلبك. تحب أكمّل معاك؟`
                : `${who}, I am still on your request. Want to pick it up where we left off?`;
        } else {
            body = L === 'ar'
                ? `${who}، فاكر إنك كنت مهتم بالسمك. تحب أبعتهولك؟`
                : `${who}, I remember you were interested in the fish. Shall I set it aside for you?`;
        }
        return body;
    }

    window.AgentSim = {
        CATALOG, RX, CAPABILITIES, PRESETS, LENGTHS, INITIATIVES, FOLLOWUPS,
        context, reply, followupPreview, detectLang, nameOf, money,
    };
})();
