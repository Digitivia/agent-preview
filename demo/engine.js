// UI Demo Mode: the SIMULATED replies. Pure functions, no DOM, no network, no storage.
// Nothing here is an AI. These are scripted examples chosen by keyword so the layout and the flow can be judged;
// they say nothing about the quality of the real agent.
(function () {
    'use strict';

    const CATALOG = {
        business: { en: 'Nile Fish', ar: 'نيل فيش' },
        customer: { en: 'Mona', ar: 'منى' },
        tilapia: { en: 'Fresh Nile tilapia (1 kg)', ar: 'بلطي نيلي طازج (1 كيلو)', price: 120 },
        shrimp: { en: 'Jumbo shrimp, peeled (1 kg)', ar: 'جمبري جامبو مقشر (1 كيلو)', price: 450, sale: 399 },
        salmon: { en: 'Salmon fillet (500 g)', ar: 'سلمون فيليه (500 جم)', price: 520, out: true },
    };

    const RX = {
        greet: /\b(hello|hi|hey|good (morning|evening))\b|مرحب|اهلا|أهلا|السلام|ازيك|إزيك|صباح|مساء/i,
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
        orderNo: /#?\b(\d{3,8})\b/,
    };

    const nameOf = (item, lang) => item[lang];
    const money = (n, lang) => (lang === 'ar' ? `${n} جنيه` : `${n} EGP`);

    function toneTail(tone, lang) {
        const t = String(tone || '');
        if (/Friendly/i.test(t)) return lang === 'ar' ? ' 🙂' : ' 🙂';
        if (/Witty/i.test(t)) return lang === 'ar' ? ' (وبوعد مفيش سمكة هتزعل منك)' : " (no fish will be harmed by this decision)";
        if (/Sales-Oriented/i.test(t)) return lang === 'ar' ? ' الكمية محدودة النهارده.' : ' Stock is limited today.';
        return '';
    }
    function opener(tone, lang) {
        const t = String(tone || '');
        if (/Professional|Formal/i.test(t)) return lang === 'ar' ? 'أهلاً بحضرتك. ' : 'Good day. ';
        if (/Empathetic/i.test(t)) return lang === 'ar' ? 'أكيد، أنا معاك. ' : "Of course, I'm here with you. ";
        return '';
    }

    function greeting(cfg, lang) {
        const biz = CATALOG.business[lang];
        const who = cfg.name
            ? (lang === 'ar' ? `أنا ${cfg.name} من ${biz}` : `I'm ${cfg.name} from ${biz}`)
            : (lang === 'ar' ? `أنا المساعد الافتراضي بتاع ${biz}` : `I'm the virtual assistant of ${biz}`);
        if (cfg.role === 'support') {
            return lang === 'ar' ? `أهلاً! ${who}. قولّي إيه المشكلة وأنا أساعدك.` : `Hi! ${who}. Tell me what went wrong and I'll help.`;
        }
        return lang === 'ar' ? `أهلاً! ${who}. بتدوّر على إيه النهارده؟` : `Hi! ${who}. What are you looking for today?`;
    }

    // One simulated reply. `cfg` is the channel's configuration (role, name, tone, sales{}, support{}).
    function chatReply(cfg, lang, text) {
        const role = cfg.role === 'support' ? 'support' : 'sales';
        const ar = lang === 'ar';
        const s = String(text || '');
        const o = opener(cfg.tone, lang);
        const tail = toneTail(cfg.tone, lang);
        const sales = cfg.sales || {};
        const sup = cfg.support || {};

        if (RX.human.test(s)) {
            return role === 'support' && sup.escalateAngry === false
                ? (ar ? 'أقدر أكمل معاك أنا الأول. احكيلي المشكلة.' : "I can keep helping first. Tell me what's wrong.")
                : (ar ? 'تمام، هحوّل المحادثة لحد من الفريق وهو يكمل معاك. (في العرض ده التحويل مجرّد محاكاة.)' : 'Sure, I will pass this conversation to a teammate. (In this demo the handover is only simulated.)');
        }
        if (RX.thanks.test(s)) return ar ? 'العفو! لو احتجت أي حاجة أنا هنا.' : "You're welcome! I'm here if you need anything else.";

        if (role === 'sales') {
            const wantsShrimp = RX.shrimp.test(s), wantsSalmon = RX.salmon.test(s), wantsTilapia = RX.tilapia.test(s);
            if (RX.discount.test(s)) {
                return sales.discount === 'catalogue'
                    ? (ar ? `${o}عندنا حالياً ${nameOf(CATALOG.shrimp, 'ar')} بسعر ${money(CATALOG.shrimp.sale, 'ar')} بدل ${money(CATALOG.shrimp.price, 'ar')}. ده الخصم المتاح حالياً.${tail}`
                          : `${o}Right now the ${nameOf(CATALOG.shrimp, 'en')} is ${money(CATALOG.shrimp.sale, 'en')} instead of ${money(CATALOG.shrimp.price, 'en')}. That is the discount available at the moment.${tail}`)
                    : (ar ? `${o}مقدرش أوعد بخصم إضافي. السعر الحالي للجمبري ${money(CATALOG.shrimp.sale, 'ar')} وهو بالفعل بعد التخفيض. تحب أجهزلك كيلو؟`
                          : `${o}I can't promise an extra discount. The shrimp is already ${money(CATALOG.shrimp.sale, 'en')} after the sale. Want me to prepare 1 kg?`);
            }
            if (wantsSalmon) {
                return ar ? `${o}السلمون خلصان حالياً. عندنا ${nameOf(CATALOG.tilapia, 'ar')} بـ${money(CATALOG.tilapia.price, 'ar')} ممكن يناسبك. تحب أحجزلك؟`
                          : `${o}The salmon is out of stock right now. We have ${nameOf(CATALOG.tilapia, 'en')} at ${money(CATALOG.tilapia.price, 'en')} that may suit you. Shall I reserve it?`;
            }
            if (wantsShrimp && (RX.price.test(s) || !RX.order.test(s))) {
                return ar ? `${o}${nameOf(CATALOG.shrimp, 'ar')} بـ${money(CATALOG.shrimp.sale, 'ar')} (كان ${money(CATALOG.shrimp.price, 'ar')}). تحب أجهزلك كيلو؟${tail}`
                          : `${o}${nameOf(CATALOG.shrimp, 'en')} is ${money(CATALOG.shrimp.sale, 'en')} (was ${money(CATALOG.shrimp.price, 'en')}). Shall I prepare 1 kg for you?${tail}`;
            }
            if (wantsTilapia && RX.price.test(s)) {
                return ar ? `${o}${nameOf(CATALOG.tilapia, 'ar')} بـ${money(CATALOG.tilapia.price, 'ar')}. محتاج كام كيلو؟${tail}`
                          : `${o}${nameOf(CATALOG.tilapia, 'en')} is ${money(CATALOG.tilapia.price, 'en')}. How many kilos do you need?${tail}`;
            }
            if (RX.order.test(s)) {
                const extra = sales.collectLead === false ? '' : (ar ? ' ابعتلي اسمك وعنوان التوصيل.' : ' Please send me your name and delivery address.');
                const note = ar ? ' (ده عرض شكل بس: مفيش طلب حقيقي بيتعمل.)' : ' (Demo only: no real order is created.)';
                return (ar ? `${o}تمام! هكمّل معاك الطلب.${extra}` : `${o}Great, let's complete your order.${extra}`) + note;
            }
            if (RX.delivery.test(s)) {
                return ar ? `${o}بنوصّل للقاهرة والجيزة. ابعتلي منطقتك وأنا أراجع معاك الميعاد.`
                          : `${o}We deliver in Cairo and Giza. Send me your area and I'll check the timing with you.`;
            }
            if (RX.price.test(s) || RX.tilapia.test(s)) {
                return ar ? `${o}عندنا: ${nameOf(CATALOG.tilapia, 'ar')} بـ${money(CATALOG.tilapia.price, 'ar')}، و${nameOf(CATALOG.shrimp, 'ar')} بـ${money(CATALOG.shrimp.sale, 'ar')}. تحب تعرف أكتر عن أي واحد؟`
                          : `${o}We have ${nameOf(CATALOG.tilapia, 'en')} at ${money(CATALOG.tilapia.price, 'en')} and ${nameOf(CATALOG.shrimp, 'en')} at ${money(CATALOG.shrimp.sale, 'en')}. Want details on either?`;
            }
            if (RX.greet.test(s)) return greeting(cfg, lang);
            return ar ? `${o}أقدر أساعدك في الأسماك والجمبري والأسعار والتوصيل. بتدوّر على إيه؟` : `${o}I can help with our fish, shrimp, prices and delivery. What are you looking for?`;
        }

        // Customer service
        if (RX.refund.test(s)) {
            const policy = String(sup.returnPolicy || '').trim();
            return policy
                ? (ar ? `${o}حسب سياسة الاسترجاع عندنا: ${policy}` : `${o}Per our return policy: ${policy}`)
                : (ar ? `${o}مش عندي سياسة استرجاع مسجّلة، فهسأل الفريق وأرجعلك بالتفاصيل بدل ما أخمّن.` : `${o}I don't have a return policy on file, so I'll check with the team and come back to you rather than guess.`);
        }
        if (RX.damaged.test(s)) {
            return ar ? `${o}آسف جداً على كده. ابعتلي ${sup.askOrderNumber === false ? 'صورة للمنتج' : 'رقم الطلب وصورة للمنتج'} وأنا أحوّل الموضوع للفريق المختص.`
                      : `${o}I'm really sorry about that. Please send ${sup.askOrderNumber === false ? 'a photo of the item' : 'your order number and a photo of the item'} and I'll pass it to the right team.`;
        }
        if (RX.late.test(s) || RX.orderNo.test(s)) {
            const m = s.match(RX.orderNo);
            if (m) {
                return ar ? `${o}شكراً. سجّلت رقم الطلب #${m[1]} وهحوّله للفريق يراجعه ويرد عليك. (العرض ده مفيهوش بحث حقيقي عن الطلبات.)`
                          : `${o}Thank you. I've noted order #${m[1]} and will pass it to the team to check. (This demo does not look up real orders.)`;
            }
            return sup.askOrderNumber === false
                ? (ar ? `${o}آسف على التأخير. احكيلي تفاصيل الطلب وأنا أتابع.` : `${o}Sorry about the delay. Tell me about the order and I'll follow up.`)
                : (ar ? `${o}آسف على التأخير. ممكن رقم الطلب أراجعه؟` : `${o}Sorry about the delay. Could you share your order number so I can check it?`);
        }
        if (RX.delivery.test(s)) return ar ? `${o}بنوصّل للقاهرة والجيزة. ابعتلي رقم الطلب وأتابع الشحنة مع الفريق.` : `${o}We deliver in Cairo and Giza. Send me the order number and I'll follow the shipment with the team.`;
        if (RX.greet.test(s)) return greeting(cfg, lang);
        return ar ? `${o}احكيلي إيه اللي حصل وأنا أساعدك أو أحوّل الموضوع للفريق.` : `${o}Tell me what happened and I'll help, or pass it to the team.`;
    }

    // The example text shown by "Preview AI message" (never generated).
    function aiPreview(role, lang, stepIndex, goal) {
        const ar = lang === 'ar';
        const r = role === 'support' ? 'support' : 'sales';
        const g = String(goal || '');
        const n = CATALOG.customer[lang];
        if (r === 'sales') {
            if (/discount|offer|خصم|عرض/i.test(g)) {
                return ar ? `${n}، لسه الجمبري الجامبو بسعر ${money(CATALOG.shrimp.sale, 'ar')} بدل ${money(CATALOG.shrimp.price, 'ar')}. تحب أجهزلك كيلو؟`
                          : `${n}, the jumbo shrimp is still ${money(CATALOG.shrimp.sale, 'en')} instead of ${money(CATALOG.shrimp.price, 'en')}. Shall I prepare 1 kg?`;
            }
            if (/deliver|توصيل|شحن/i.test(g)) {
                return ar ? `${n}، لو التوصيل هو اللي مأخرك، ابعتلي منطقتك وأراجعلك الميعاد.` : `${n}, if delivery is what's holding you back, send me your area and I'll check the timing.`;
            }
            if (stepIndex === 0) return ar ? `${n}، لسه مهتمة بالجمبري الجامبو؟ سعره ${money(CATALOG.shrimp.sale, 'ar')} للكيلو. أجهزلك كيلو؟` : `${n}, still thinking about the jumbo shrimp? It's ${money(CATALOG.shrimp.sale, 'en')} per kg. Shall I prepare 1 kg?`;
            if (stepIndex === 1) return ar ? 'لو عندك أي سؤال عن الحجم أو طريقة التحضير، اسألني وأنا معاكي.' : 'If you have any question about size or how to cook it, just ask and I will help.';
            return ar ? 'هسيب الموضوع هنا دلوقتي. أول ما تحبي تكملي، ابعتيلي وأنا موجود.' : "I'll leave it here for now. Whenever you're ready, message me and we'll continue.";
        }
        if (stepIndex === 0) return ar ? `${n}، حبيت أطمّن إن مشكلة الطلب اتحلت ولا لسه محتاجة مساعدة؟` : `${n}, I wanted to check whether your order issue is solved or you still need help.`;
        if (stepIndex === 1) return ar ? 'لو لسه محتاجة نتابع الموضوع، ابعتيلي رقم الطلب وأنا أحوّله للفريق.' : 'If you still need us to follow up, send me the order number and I will pass it to the team.';
        return ar ? 'هقفل المتابعة هنا. لو ظهرت أي حاجة، ابعتيلي في أي وقت.' : "I'll close this follow-up here. If anything comes up, message me any time.";
    }

    window.DemoEngine = { CATALOG, chatReply, aiPreview, greeting };
})();
