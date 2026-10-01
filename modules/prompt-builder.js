// prompt-builder.js — Guided System Prompt Builder + Model Picker cards +
// Multi-model Test Bench for the agent config tabs.
//
// Loaded as a classic script AFTER the main app script (same pattern as
// modules/meta-connect.js). It never renders on its own: a MutationObserver
// watches the dynamically-rendered agent tabs and ENHANCES three existing
// sections in place:
//   1. System Prompt  -> adds a Simple (guided) / Advanced (free text) switch.
//      Simple mode writes the generated prompt into the SAME textarea that
//      saveRole() reads, so persistence and the n8n gate need zero changes.
//   2. AI Personality -> replaces the bare AI-Model <select> with badge cards
//      (the hidden select keeps its id/value so saveRole() keeps working).
//   3. Test Chat      -> adds a "Compare models" mode that runs ONE message
//      against several models for real via the model-test edge function.
//
// Safety: additive only. Existing orgs with a non-empty prompt land in
// Advanced mode; their text is never rewritten without an explicit Apply.
// Builder selections persist in agent_configs.persona.prompt_builder (jsonb).
(function () {
    'use strict';

    // Flip to true once GEMINI_API_KEY is set as a Supabase edge secret.
    const GEMINI_ENABLED = false;

    const AGENT_IDS = ['whatsapp', 'page', 'instagram', 'telegram', 'website'];
    const SUPA = () => window.SUPABASE_URL || '';
    const MODEL_TEST_URL = () => `${SUPA()}/functions/v1/model-test`;
    const PROMPT_CHAT_URL = () => `${SUPA()}/functions/v1/prompt-builder-chat`;

    // Longest single Prompt Studio message. Pasting an existing system prompt to
    // be modified is the main thing the studio is for, so this has to comfortably
    // exceed a real one. It mirrors MAX_SINGLE_MSG_CHARS in the prompt-builder-chat
    // edge function, which is authoritative and reports its own value on `status`;
    // this is the value used before that first reply lands. The client checks it
    // only so a long paste is not spent against the plan and then bounced — the
    // server refuses oversize input on its own either way.
    const DEFAULT_MAX_MESSAGE_CHARS = 120000;
    let MAX_MESSAGE_CHARS = DEFAULT_MAX_MESSAGE_CHARS;

    const lang = () => (localStorage.getItem('app_language') || 'en');
    const isAr = () => lang() === 'ar';
    const L = (en, ar) => (isAr() ? ar : en);
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const toast = (msg, kind) => (typeof window.showToast === 'function'
        ? window.showToast(msg, kind) : console.log(`[toast:${kind}] ${msg}`));
    const unclipSection = (el) => {
        const sec = el && el.closest('.section-content');
        if (sec) sec.classList.add('pb-tall');
    };

    // Clipboard with iOS/Safari fallback (clipboard API needs a secure context
    // and can still reject inside some webviews).
    async function copyText(text, okMsg) {
        try { await navigator.clipboard.writeText(text); }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch (e2) { /* give up silently */ }
            ta.remove();
        }
        toast(okMsg || L('Copied', 'تم النسخ'), 'success');
    }

    // End-to-end persistence: every builder's Apply goes through the
    // prompt-assistant `apply` action, which upserts agent_configs.system_prompt
    // (the exact column the n8n AI gate reads) with version snapshot, lock and
    // permission checks. No more "generated a prompt, then nothing happened".
    // The studio must never DISPLAY or SAVE the builder's conversational
    // envelope as if it were the prompt.
    //
    // It reached a customer once: phase 2 on the server inherited the chat
    // system prompt, which demands strict JSON every turn, so the model
    // returned {"reply":"the prompt is ready...","done":true} and the server
    // stored those 152 characters as the document. The server-side cause is
    // fixed, but the edge function deploys separately from this file, so the
    // client refuses it independently — above all on "Save & activate", which
    // writes straight into the live agent's system prompt.
    function looksLikeEnvelope(text) {
        const t = String(text == null ? '' : text).trim();
        if (!t.startsWith('{') || !t.endsWith('}')) return false;
        let parsed;
        try { parsed = JSON.parse(t); } catch { return false; }
        if (!parsed || typeof parsed !== 'object') return false;
        return 'reply' in parsed || 'done' in parsed || 'final_prompt' in parsed;
    }

    // ============================================================
    //   DIFF ENGINE (for the AI Chat editor)
    // ============================================================
    // Line-level LCS with word-level refinement for 1:1 replaced lines.
    // Pure and exposed on window so it is unit-testable. Ops:
    //   {t:'eq'|'del'|'ins', s:'<line>', w?:[{t,s}...] word ops for paired lines}
    function lcsOps(a, b) {
        const n = a.length, m = b.length;
        const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = []; let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) { ops.push({ t: 'eq', s: a[i] }); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', s: a[i] }); i++; }
            else { ops.push({ t: 'ins', s: b[j] }); j++; }
        }
        while (i < n) ops.push({ t: 'del', s: a[i++] });
        while (j < m) ops.push({ t: 'ins', s: b[j++] });
        return ops;
    }
    function computeDiff(oldStr, newStr) {
        const a = String(oldStr == null ? '' : oldStr).split('\n');
        const b = String(newStr == null ? '' : newStr).split('\n');
        // Common prefix/suffix first: real edits touch a few lines of a long
        // prompt, so this keeps the LCS matrix tiny.
        let start = 0;
        while (start < a.length && start < b.length && a[start] === b[start]) start++;
        let endA = a.length, endB = b.length;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
        const midA = a.slice(start, endA), midB = b.slice(start, endB);
        let ops;
        if (midA.length * midB.length > 250000 || midA.length > 65000 || midB.length > 65000) {
            // Degenerate rewrite: an honest del/ins block beats an O(n·m) stall.
            ops = midA.map((s) => ({ t: 'del', s })).concat(midB.map((s) => ({ t: 'ins', s })));
        } else {
            ops = lcsOps(midA, midB);
        }
        // Word-level detail for the classic "one line tweaked" case: a single
        // del immediately followed by a single ins.
        for (let k = 0; k < ops.length - 1; k++) {
            if (ops[k].t === 'del' && ops[k + 1].t === 'ins'
                && (k + 2 >= ops.length || ops[k + 2].t !== 'ins')
                && (k === 0 || ops[k - 1].t !== 'del')) {
                const wa = ops[k].s.split(/(\s+)/).filter((x) => x !== '');
                const wb = ops[k + 1].s.split(/(\s+)/).filter((x) => x !== '');
                if (wa.length * wb.length <= 40000) {
                    const w = lcsOps(wa, wb);
                    ops[k].w = w.filter((o) => o.t !== 'ins');
                    ops[k + 1].w = w.filter((o) => o.t !== 'del');
                }
            }
        }
        return {
            ops: a.slice(0, start).map((s) => ({ t: 'eq', s }))
                .concat(ops, a.slice(endA).map((s) => ({ t: 'eq', s }))),
            added: ops.filter((o) => o.t === 'ins').length,
            removed: ops.filter((o) => o.t === 'del').length,
        };
    }
    window.pbComputeDiff = computeDiff;

    // Diff -> HTML, collapsing long unchanged runs to CONTEXT lines around each
    // change so a 200-line prompt reads as its edits, not as a wall.
    function diffToHtml(diff) {
        const CONTEXT = 2;
        const ops = diff.ops;
        const keep = new Array(ops.length).fill(false);
        ops.forEach((o, i) => {
            if (o.t !== 'eq') {
                for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) keep[k] = true;
            }
        });
        const lineHtml = (o) => {
            const body = o.w
                ? o.w.map((w) => w.t === 'eq' ? esc(w.s)
                    : `<mark class="pbe-w-${w.t}">${esc(w.s)}</mark>`).join('')
                : esc(o.s);
            return `<div class="pbe-line pbe-${o.t}" dir="auto">${body || '&nbsp;'}</div>`;
        };
        const out = [];
        let skipped = 0;
        const flushSkip = () => {
            if (skipped > 0) {
                out.push(`<div class="pbe-skip">⋯ ${skipped} ${skipped === 1 ? L('unchanged line', 'سطر بدون تغيير') : L('unchanged lines', 'أسطر بدون تغيير')} ⋯</div>`);
                skipped = 0;
            }
        };
        ops.forEach((o, i) => {
            if (o.t === 'eq' && !keep[i]) { skipped++; return; }
            flushSkip();
            out.push(lineHtml(o));
        });
        flushSkip();
        if (!diff.added && !diff.removed) {
            return `<div class="pbe-skip">${L('No changes — the texts are identical.', 'لا توجد تغييرات — النصان متطابقان.')}</div>`;
        }
        return out.join('');
    }

    async function persistPromptLive(agentId, promptText) {
        const session = (await window.supabaseClient.auth.getSession()).data.session;
        const headers = { 'Content-Type': 'application/json' };
        if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
        if (window.SUPABASE_KEY) headers['apikey'] = window.SUPABASE_KEY;
        const r = await fetch(`${SUPA()}/functions/v1/prompt-assistant`, {
            method: 'POST', headers,
            body: JSON.stringify({ action: 'apply', agent: agentId, suggested_prompt: promptText, apply_mode: 'replace' }),
        });
        const j = await r.json().catch(() => ({}));
        if (!j || j.ok !== true) {
            const code = j && j.error && j.error.code;
            const msg = (j && j.error && j.error.message) || `HTTP ${r.status}`;
            const err = new Error(msg); err.code = code; throw err;
        }
        return j;
    }

    // ============================================================
    //   MODEL REGISTRY (test-bench only; `value` is the ai_models
    //   catalog id, so "Use this model" writes something the
    //   resolver honours)
    // ============================================================
    // coins/reply estimate assumes a typical reply: ~1500 input + 200 output
    // tokens at ai_model_rates prices (coins = usd * 100).
    const EST_IN = 1500, EST_OUT = 200;
    const MODELS = [
        {
            value: '', testId: null,
            name: () => L('Auto (Recommended)', 'تلقائي (موصى به)'),
            badge: () => L('Smart default', 'الاختيار الذكي'),
            badgeKind: 'auto',
            desc: () => L('We pick the best model for your language and workload.', 'نختار أفضل نموذج تلقائيًا حسب لغتك وحجم العمل.'),
            inRate: null, outRate: null,
        },
        {
            value: 'anthropic/claude-haiku-4.5', testId: 'claude-haiku-4-5',
            name: () => 'Claude Haiku 4.5',
            badge: () => L('Best Arabic • Balanced', 'الأفضل للعربية • متوازن'),
            badgeKind: 'balanced',
            desc: () => L('Great quality with strong Arabic dialects, at a fair cost.', 'جودة عالية ولهجات عربية ممتازة بتكلفة معقولة.'),
            inRate: 1.0, outRate: 5.0,
        },
        {
            value: 'google/gemini-3-flash-preview', testId: 'gemini-2.5-flash',
            name: () => 'Gemini 3 Flash',
            badge: () => L('Fastest • Cheapest', 'الأسرع • الأوفر'),
            badgeKind: 'fast',
            desc: () => L('Very fast, very low cost. Good for high message volume.', 'سريع جدًا وتكلفة منخفضة جدًا. مناسب لحجم رسائل كبير.'),
            inRate: 0.30, outRate: 2.50,
            hidden: !GEMINI_ENABLED,
        },
        {
            value: 'openai/gpt-5-mini', testId: 'gpt-5-mini',
            name: () => 'GPT-5 Mini',
            badge: () => L('Budget', 'اقتصادي'),
            badgeKind: 'budget',
            desc: () => L('Low cost with solid general quality.', 'تكلفة منخفضة مع جودة جيدة بشكل عام.'),
            inRate: 0.25, outRate: 2.0,
        },
        {
            value: 'anthropic/claude-sonnet-4.6', testId: 'claude-sonnet-4-6',
            name: () => 'Claude Sonnet 4.6',
            badge: () => L('Premium quality', 'الجودة الأعلى'),
            badgeKind: 'premium',
            desc: () => L('The smartest replies for complex conversations. Costs more.', 'أذكى الردود للمحادثات المعقدة. تكلفته أعلى.'),
            inRate: 3.0, outRate: 15.0,
        },
        {
            value: 'anthropic/claude-sonnet-5', testId: 'claude-sonnet-5',
            name: () => 'Claude Sonnet 5',
            badge: () => L('New generation', 'الجيل الجديد'),
            badgeKind: 'premium',
            desc: () => L('The newest Claude generation — smarter than Sonnet 4.6 at a lower cost.', 'أحدث جيل من كلود — أذكى من سونيت 4.6 وبتكلفة أقل.'),
            inRate: 2.0, outRate: 10.0,
        },
        {
            value: 'anthropic/claude-opus-5', testId: 'claude-opus-5',
            name: () => 'Claude Opus 5',
            badge: () => L('Top quality', 'أعلى جودة'),
            badgeKind: 'premium',
            desc: () => L('The most capable model in the catalog. Costs the most.', 'أقوى نموذج في القائمة. التكلفة الأعلى.'),
            inRate: 5.0, outRate: 25.0,
        },
    ];
    const visibleModels = () => MODELS.filter((m) => !m.hidden);
    const coinsPerReply = (m) => (m.inRate == null ? null
        : Math.round(((EST_IN * m.inRate + EST_OUT * m.outRate) / 1e6) * 100 * 100) / 100);

    // ============================================================
    //   PROMPT TEMPLATES (the generated system prompt itself)
    // ============================================================
    const OPT = {
        business_type: [
            ['ecommerce', 'Online store', 'متجر إلكتروني'],
            ['restaurant', 'Restaurant / food', 'مطعم / أكل'],
            ['clinic', 'Clinic / medical', 'عيادة / طبي'],
            ['services', 'Services / bookings', 'خدمات / حجوزات'],
            ['other', 'Other business', 'نشاط آخر'],
        ],
        reply_goal: [
            ['sell_orders', 'Sell & take orders', 'البيع واستلام الطلبات'],
            ['capture_leads', 'Capture customer leads', 'تجميع بيانات العملاء المهتمين'],
            ['book_meetings', 'Book appointments', 'حجز المواعيد'],
            ['support', 'Answer & support', 'الرد والدعم'],
        ],
        greeting: [
            ['warm', 'Warm & friendly', 'ودود وقريب'],
            ['professional', 'Professional', 'رسمي واحترافي'],
            ['short', 'Short & direct', 'مختصر ومباشر'],
        ],
        never: [
            ['invent_prices', 'Invent prices or discounts', 'اختراع أسعار أو خصومات'],
            ['promise_dates', 'Promise exact delivery dates', 'الوعد بمواعيد تسليم مؤكدة'],
            ['off_topic', 'Chat outside the business topics', 'الكلام خارج نشاط البيزنس'],
            ['medical_legal', 'Give medical or legal advice', 'تقديم نصائح طبية أو قانونية'],
        ],
        escalate: [
            ['angry', 'Customer is angry or upset', 'العميل غاضب أو منزعج'],
            ['human_request', 'Customer asks for a human', 'العميل يطلب التحدث مع موظف'],
            ['complex', 'Complex problem or complaint', 'مشكلة أو شكوى معقدة'],
        ],
    };

    const GOAL_LINES = {
        en: {
            sell_orders: 'Your main goal: help the customer choose and BUY. Guide the chat toward completing an order. Ask for the details you need (product, quantity, address, phone) one step at a time.',
            capture_leads: "Your main goal: capture the customer's interest and contact details (name, phone, what they need) so the team can follow up. Be helpful first, then ask naturally.",
            book_meetings: 'Your main goal: book an appointment. Offer available options, confirm date and time clearly, and collect the customer name and phone number.',
            support: 'Your main goal: answer questions accurately and solve problems fast, using the knowledge base as your source of truth.',
        },
        ar: {
            sell_orders: 'هدفك الأساسي: مساعدة العميل يختار ويشتري. وجّه المحادثة نحو إتمام الطلب، واسأل عن التفاصيل المطلوبة (المنتج، الكمية، العنوان، رقم الهاتف) خطوة بخطوة.',
            capture_leads: 'هدفك الأساسي: معرفة اهتمام العميل وأخذ بياناته (الاسم، رقم الهاتف، احتياجه) ليتابع معه الفريق. ساعده أولًا ثم اطلب البيانات بشكل طبيعي.',
            book_meetings: 'هدفك الأساسي: حجز موعد. اعرض المواعيد المتاحة، وأكد التاريخ والوقت بوضوح، وخذ اسم العميل ورقم هاتفه.',
            support: 'هدفك الأساسي: الإجابة بدقة وحل المشاكل بسرعة، معتمدًا على قاعدة المعرفة كمصدر أساسي.',
        },
    };
    const TYPE_LINES = {
        en: {
            ecommerce: 'You are the sales assistant of an online store.',
            restaurant: 'You are the ordering assistant of a restaurant.',
            clinic: 'You are the reception assistant of a clinic.',
            services: 'You are the booking assistant of a services business.',
            other: 'You are the customer assistant of a business.',
        },
        ar: {
            ecommerce: 'أنت مساعد المبيعات لمتجر إلكتروني.',
            restaurant: 'أنت مساعد استقبال الطلبات لمطعم.',
            clinic: 'أنت مساعد الاستقبال لعيادة.',
            services: 'أنت مساعد الحجوزات لنشاط خدمي.',
            other: 'أنت مساعد خدمة العملاء لنشاط تجاري.',
        },
    };
    const GREET_LINES = {
        en: {
            warm: 'Style: warm, friendly and human. Short sentences. One emoji max per message.',
            professional: 'Style: professional and polite. Clear, well-structured answers. No emojis.',
            short: 'Style: short and direct. Answer in 1-3 sentences whenever possible.',
        },
        ar: {
            warm: 'الأسلوب: ودود وقريب وإنساني. جمل قصيرة. إيموجي واحد كحد أقصى في الرسالة.',
            professional: 'الأسلوب: احترافي ومهذب. إجابات واضحة ومنظمة. بدون إيموجي.',
            short: 'الأسلوب: مختصر ومباشر. أجب في ١-٣ جمل كلما أمكن.',
        },
    };
    const NEVER_LINES = {
        en: {
            invent_prices: 'Never invent prices, discounts or offers. Only state prices that exist in the knowledge base or product data. If unsure, say you will confirm with the team.',
            promise_dates: 'Never promise exact delivery or completion dates. Give ranges only if they exist in the knowledge base.',
            off_topic: 'Stay on the business topics. Politely decline unrelated conversations and bring the chat back to how you can help.',
            medical_legal: 'Never give medical or legal advice. Recommend consulting a professional.',
        },
        ar: {
            invent_prices: 'ممنوع اختراع أسعار أو خصومات أو عروض. اذكر فقط الأسعار الموجودة في قاعدة المعرفة أو بيانات المنتجات. لو مش متأكد قول إنك هتتأكد من الفريق.',
            promise_dates: 'ممنوع الوعد بمواعيد تسليم أو إنجاز مؤكدة. اذكر مدة تقريبية فقط لو موجودة في قاعدة المعرفة.',
            off_topic: 'التزم بمواضيع البيزنس فقط. اعتذر بلطف عن أي كلام خارجي وارجع بالمحادثة لكيفية المساعدة.',
            medical_legal: 'ممنوع تقديم نصائح طبية أو قانونية. انصح العميل باستشارة مختص.',
        },
    };
    const ESCALATE_LINES = {
        en: {
            angry: 'the customer is angry, upset or uses offensive language',
            human_request: 'the customer explicitly asks for a human',
            complex: 'the problem is complex or a formal complaint',
        },
        ar: {
            angry: 'العميل غاضب أو منزعج أو يستخدم ألفاظًا مسيئة',
            human_request: 'العميل يطلب صراحةً التحدث مع موظف',
            complex: 'المشكلة معقدة أو شكوى رسمية',
        },
    };

    // Pure function: builder state -> generated system prompt.
    // Exposed on window so it is unit-testable and reusable.
    function buildAgentSystemPrompt(state) {
        const pl = state.prompt_lang === 'ar' ? 'ar' : 'en';
        const parts = [];
        const name = (state.business_name || '').trim();
        const typeLine = TYPE_LINES[pl][state.business_type] || TYPE_LINES[pl].other;
        parts.push(name
            ? (pl === 'ar' ? `${typeLine} اسم النشاط: ${name}.` : `${typeLine} The business name is ${name}.`)
            : typeLine);

        parts.push(GOAL_LINES[pl][state.reply_goal] || GOAL_LINES[pl].support);
        parts.push(GREET_LINES[pl][state.greeting] || GREET_LINES[pl].warm);

        const nevers = (state.never || []).map((k) => NEVER_LINES[pl][k]).filter(Boolean);
        if (nevers.length) {
            parts.push((pl === 'ar' ? 'قواعد صارمة:' : 'HARD RULES:') + '\n- ' + nevers.join('\n- '));
        }

        const esc2 = (state.escalate || []).map((k) => ESCALATE_LINES[pl][k]).filter(Boolean);
        if (esc2.length) {
            parts.push(pl === 'ar'
                ? `حوّل المحادثة لموظف بشري فورًا إذا: ${esc2.join('، أو ')}. قل للعميل بأدب إن زميلًا من الفريق سيتابع معه.`
                : `Hand the conversation to a human immediately if: ${esc2.join(', or ')}. Politely tell the customer a teammate will follow up.`);
        }

        if ((state.extra_note || '').trim()) {
            parts.push((pl === 'ar' ? 'ملاحظات إضافية من صاحب النشاط:\n' : 'Extra notes from the business owner:\n') + state.extra_note.trim());
        }

        parts.push(pl === 'ar'
            ? 'اعتمد دائمًا على قاعدة المعرفة وبيانات المنتجات كمصدر للحقائق. لو الإجابة غير موجودة فيها، قل إنك ستتأكد من الفريق بدلًا من التخمين.'
            : 'Always use the knowledge base and product data as your source of facts. If the answer is not there, say you will check with the team instead of guessing.');
        return parts.join('\n\n');
    }
    window.buildAgentSystemPrompt = buildAgentSystemPrompt;

    const DEFAULT_STATE = {
        business_name: '', business_type: 'ecommerce', reply_goal: 'sell_orders',
        prompt_lang: 'ar', greeting: 'warm',
        never: ['invent_prices', 'promise_dates', 'off_topic'],
        escalate: ['angry', 'human_request'],
        extra_note: '',
    };

    // ============================================================
    //   STYLES (logical properties only — RTL/LTR safe)
    // ============================================================
    function injectStyles() {
        if (document.getElementById('pb-styles')) return;
        const st = document.createElement('style');
        st.id = 'pb-styles';
        st.textContent = `
/* The app's collapsible sections cap at max-height:1000px with overflow:hidden.
   The builder/cards/bench exceed that on phones, so everything past 1000px
   (preview, Apply button) was silently clipped. Uncap sections we grow. */
.section-content.pb-tall.open { max-height:none !important; }
.pb-modes { display:flex; gap:6px; margin-block-end:12px; }
.pb-mode { padding:6px 14px; border-radius:999px; font-size:0.8rem; cursor:pointer;
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:var(--text-secondary); }
.pb-mode.active { background:var(--theme-color); border-color:var(--theme-color); color:#fff; }
.pb-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
.pb-field label.pb-label { display:block; font-size:0.78rem; color:var(--text-secondary); margin-block-end:6px; }
.pb-field input[type=text], .pb-field select, .pb-field textarea { width:100%; padding:8px 12px; border-radius:8px;
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary); font-size:0.85rem; }
.pb-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pb-chip { padding:5px 12px; border-radius:999px; font-size:0.78rem; cursor:pointer; user-select:none;
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:var(--text-secondary); }
.pb-chip.on { background:rgba(109, 107, 217,0.18); border-color:var(--theme-color); color:var(--text-primary); }
.pb-preview { margin-block-start:14px; border:1px solid rgba(255,255,255,0.16); border-radius:10px;
  background:rgba(255,255,255,0.05); padding:12px; }
.pb-preview-title { font-size:0.75rem; color:var(--text-secondary); margin-block-end:8px; letter-spacing:0.04em; text-transform:uppercase; }
.pb-preview pre { white-space:pre-wrap; font-family:inherit; font-size:0.82rem; color:var(--text-primary);
  margin:0; max-height:220px; overflow-y:auto; }
.pb-apply-row { display:flex; align-items:center; gap:10px; margin-block:12px 8px; flex-wrap:wrap; }
.pb-models { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; }
.pb-model { position:relative; padding:12px; border-radius:10px; cursor:pointer;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); }
.pb-model.on { border-color:var(--theme-color); background:rgba(109, 107, 217,0.10); }
.pb-model-name { font-size:0.88rem; font-weight:600; color:var(--text-primary); }
.pb-model-badge { display:inline-block; margin-block-start:4px; padding:2px 8px; border-radius:999px; font-size:0.68rem; }
.pb-badge-auto { background:rgba(255,255,255,0.10); color:var(--text-primary); }
.pb-badge-balanced { background:rgba(109, 107, 217,0.20); color:#a5a3f0; }
.pb-badge-fast { background:rgba(52,211,153,0.16); color:#6ee7b7; }
.pb-badge-budget { background:rgba(251,191,36,0.14); color:#fcd34d; }
.pb-badge-premium { background:rgba(167,139,250,0.16); color:#c4b5fd; }
.pb-model-desc { font-size:0.75rem; color:var(--text-secondary); margin-block-start:6px; line-height:1.45; }
.pb-model-cost { font-size:0.7rem; color:var(--text-secondary); margin-block-start:6px; }
.pb-compare-toggle { margin-block-start:10px; display:flex; align-items:center; gap:8px; }
.pb-bench { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; margin-block:10px; }
.pb-bench-card { border:1px solid rgba(255,255,255,0.1); border-radius:10px; background:rgba(255,255,255,0.03); padding:10px; display:flex; flex-direction:column; }
.pb-bench-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-block-end:6px; }
.pb-bench-name { font-size:0.8rem; font-weight:600; color:var(--text-primary); }
.pb-bench-meta { font-size:0.68rem; color:var(--text-secondary); }
.pb-bench-reply { font-size:0.8rem; color:var(--text-primary); white-space:pre-wrap; flex:1; max-height:260px; overflow-y:auto; }
.pb-bench-err { font-size:0.75rem; color:#f87171; }
.pb-bench-use { margin-block-start:8px; align-self:flex-start; }
@media (max-width: 480px) { .pb-grid, .pb-models, .pb-bench { grid-template-columns:1fr; } }
/* ── Prompt Studio — flat, elegant design system (no gradients).
   Tokens carry both themes; every color resolves from a token with an
   explicit value, so contrast can never collapse (the old final-card bug). ── */
.pbc-shell, .pb-chat-body {
  --pbc-bg:#14161c; --pbc-panel:#1b1e26; --pbc-panel-2:#20242e;
  --pbc-line:#2a2e38; --pbc-ink:#e9edf3; --pbc-ink-2:#99a1ad;
  --pbc-accent:#6d6bd9; --pbc-accent-ink:#ffffff; --pbc-ok:#3fb27f; --pbc-err:#e5726f;
}
:root[data-theme="light"] .pbc-shell, :root[data-theme="light"] .pb-chat-body {
  --pbc-bg:#ffffff; --pbc-panel:#f5f7f9; --pbc-panel-2:#eef1f4;
  --pbc-line:#e3e7ec; --pbc-ink:#17202b; --pbc-ink-2:#5b6672;
  --pbc-accent:#4a48a8; --pbc-accent-ink:#ffffff; --pbc-ok:#2e9e6e; --pbc-err:#c4514e;
}
.pbc-shell { display:flex; flex-direction:column; border-radius:14px; overflow:hidden;
  background:var(--pbc-bg); border:1px solid var(--pbc-line);
  box-shadow:0 10px 32px rgba(0,0,0,0.22); }
.pbc-head { display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:12px 16px; background:var(--pbc-panel); border-block-end:1px solid var(--pbc-line); }
.pbc-brand { display:flex; align-items:center; gap:11px; min-width:0; }
.pbc-logo { flex-shrink:0; width:32px; height:32px; border-radius:9px; display:flex; align-items:center;
  justify-content:center; font-size:15px; color:#fff; background:var(--pbc-accent); }
.pbc-brand-txt { display:flex; flex-direction:column; min-width:0; }
.pbc-brand-txt b { font-size:0.9rem; font-weight:650; color:var(--pbc-ink); line-height:1.25; letter-spacing:0.01em; }
.pbc-brand-txt i { font-style:normal; font-size:0.7rem; color:var(--pbc-ink-2);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pbc-head-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.pbc-quota { display:inline-flex; align-items:center; gap:7px; font-size:0.7rem; font-weight:650;
  padding:5px 10px; border-radius:8px; color:var(--pbc-ink);
  background:var(--pbc-panel-2); border:1px solid var(--pbc-line); white-space:nowrap;
  font-variant-numeric:tabular-nums; }
.pbc-qbar { display:inline-block; width:42px; height:4px; border-radius:999px;
  background:var(--pbc-line); overflow:hidden; }
.pbc-qbar b { display:block; height:100%; border-radius:999px; background:var(--pbc-accent); }
.pbc-quota.low .pbc-qbar b { background:#d9a33c; }
.pbc-quota.out .pbc-qbar b { background:var(--pbc-err); }
.pbc-reset, .pbc-close { width:32px; height:32px; border:1px solid var(--pbc-line); border-radius:9px;
  cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:14px;
  background:var(--pbc-panel-2); color:var(--pbc-ink); }
.pbc-reset:hover, .pbc-close:hover { border-color:var(--pbc-accent); }
.pbc-close { display:none; }
.pbc-msgs { flex:1; min-height:220px; max-height:min(48vh, 460px); overflow-y:auto; padding:18px 16px;
  display:flex; flex-direction:column; gap:12px; overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch; overflow-anchor:none; background:var(--pbc-bg); }
/* A transcript scrolls; it never compresses what is in it.
   This container is a column flex box with a max-height, so every child is a
   flex item with the default flex-shrink:1. Message rows survive that only
   because their overflow stays visible, which gives them an automatic minimum
   size — the final-prompt card sets overflow:hidden to clip its own corners,
   which waives that protection. Measured in Chromium at 390px with six
   messages above it: the card rendered 2px tall with 304px of content inside,
   which is the "I click Write my prompt now and get a green line" report. The
   rule is on the container rather than on that one card so the next thing
   added here cannot rediscover it. */
.pbc-msgs > * { flex-shrink:0; }
.pbc-row { display:flex; align-items:flex-end; gap:9px; }
.pbc-row.user { justify-content:flex-end; }
.pbc-avatar { flex-shrink:0; width:26px; height:26px; border-radius:8px; display:flex; align-items:center;
  justify-content:center; font-size:12px; color:#fff; background:var(--pbc-accent); }
.pbc-msg { position:relative; max-inline-size:86%; padding:10px 14px; border-radius:13px; font-size:0.88rem;
  line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; unicode-bidi:plaintext; text-align:start; }
.pbc-msg.user { background:var(--pbc-accent); color:#fff; border-end-end-radius:4px; }
.pbc-msg.bot { background:var(--pbc-panel); color:var(--pbc-ink);
  border:1px solid var(--pbc-line); border-end-start-radius:4px; padding-inline-end:38px; }
.pbc-sender { display:block; font-size:0.64rem; font-weight:700; letter-spacing:0.09em; text-transform:uppercase;
  color:var(--pbc-accent); margin-block-end:4px; }
.pbc-copy-msg { position:absolute; inset-inline-end:7px; inset-block-start:7px; width:26px; height:26px;
  border:1px solid var(--pbc-line); border-radius:7px; background:var(--pbc-panel-2); color:var(--pbc-ink-2);
  font-size:12px; line-height:1; cursor:pointer; opacity:0.8; }
.pbc-copy-msg:hover { opacity:1; color:var(--pbc-ink); border-color:var(--pbc-accent); }
.pbc-msg.err { margin-inline:auto; background:transparent; border:1px solid var(--pbc-err);
  color:var(--pbc-err); font-size:0.8rem; }
/* Neither the assistant nor an error: the studio telling the merchant what it
   had to leave out, which used to happen silently. */
.pbc-msg.note { margin-inline:auto; background:transparent; border:1px dashed var(--pbc-line);
  color:var(--pbc-ink-2); font-size:0.76rem; }
.pbc-starters { display:flex; flex-wrap:wrap; gap:8px; padding-inline-start:35px; }
.pbc-starter { padding:9px 14px; border-radius:10px; cursor:pointer; font-size:0.8rem;
  color:var(--pbc-ink); background:var(--pbc-panel); border:1px solid var(--pbc-line); }
.pbc-starter:hover { border-color:var(--pbc-accent); }
.pbc-typing { display:flex; align-items:center; gap:4px; padding:9px 13px; align-self:flex-start;
  margin-inline-start:35px; background:var(--pbc-panel); border:1px solid var(--pbc-line); border-radius:12px; }
.pbc-typing i { width:5px; height:5px; border-radius:50%; background:var(--pbc-accent); animation:pbcB 1.2s infinite; }
.pbc-typing i:nth-child(2) { animation-delay:0.15s; }
.pbc-typing i:nth-child(3) { animation-delay:0.3s; }
@keyframes pbcB { 0%,60%,100% { opacity:0.35; } 30% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .pbc-typing i { animation:none; opacity:0.8; } }
.pbc-input-wrap { background:var(--pbc-panel); border-block-start:1px solid var(--pbc-line); }
.pbc-input-row { display:flex; align-items:flex-end; gap:9px; padding:12px 14px; }
.pbc-input-wrap .pbc-input-row { border-block-start:none; }
/* Pasting a whole prompt is the point of this box, so its size is shown rather
   than left to be discovered when the answer comes back short. */
.pbc-input-foot { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:0 15px 9px; }
.pbc-input-count { font-size:0.68rem; color:var(--pbc-ink-2); flex:1 1 120px; min-width:0; }
.pbc-input-count:empty { display:none; }
.pbc-input-count.over { color:var(--pbc-err); }
/* Always in reach once the conversation has started: the one control that
   guarantees the customer can get the document, whatever the model decided. */
.pbc-finalize { flex-shrink:0; padding:7px 13px; border-radius:9px; cursor:pointer;
  font-size:0.74rem; font-weight:600; color:var(--pbc-ok);
  background:transparent; border:1px solid var(--pbc-ok); }
.pbc-finalize:hover { background:color-mix(in srgb, var(--pbc-ok) 12%, transparent); }
.pbc-finalize:disabled { opacity:0.45; cursor:not-allowed; }
.pbc-input-row textarea { flex:1; resize:none; padding:11px 15px; border-radius:11px; min-height:44px; max-height:120px;
  background:var(--pbc-bg); border:1px solid var(--pbc-line);
  color:var(--pbc-ink); font-size:0.88rem; line-height:1.4; outline:none; }
.pbc-input-row textarea::placeholder { color:var(--pbc-ink-2); }
.pbc-input-row textarea:focus { border-color:var(--pbc-accent); }
.pbc-send { flex-shrink:0; width:44px; height:44px; border-radius:11px; border:none; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; color:#fff;
  background:var(--pbc-accent); }
.pbc-send:hover { filter:brightness(1.08); }
.pbc-send:disabled { opacity:0.5; cursor:not-allowed; }
[dir="rtl"] .pbc-send svg { transform:scaleX(-1); }
/* Final prompt — an in-flow, EDITABLE card inside the conversation. Never a
   fixed overlay (the old one blocked the composer). */
.pbc-final-card { align-self:stretch; margin-inline-start:35px; border-radius:13px;
  background:var(--pbc-panel); border:1px solid var(--pbc-ok); overflow:hidden; }
.pbc-final-head { display:flex; align-items:center; gap:8px; padding:10px 14px;
  font-size:0.78rem; font-weight:700; color:var(--pbc-ink);
  border-block-end:1px solid var(--pbc-line); }
.pbc-final-head .ok { width:20px; height:20px; border-radius:6px; flex-shrink:0; display:inline-flex;
  align-items:center; justify-content:center; font-size:11px; color:#fff; background:var(--pbc-ok); }
.pbc-final-count { margin-inline-start:auto; font-weight:500; font-size:0.7rem; color:var(--pbc-ink-2); }
/* The model stopped on length even after continuing: the card says so instead
   of presenting a possibly-clipped document as finished. */
.pbc-final-card.pbc-final-warn { border-color:var(--pbc-err); }
.pbc-final-card.pbc-final-warn .pbc-final-hint { color:var(--pbc-err); }
/* box-sizing explicitly, not inherited: this is the one element that holds the
   deliverable, and 100% + padding without it overflows the card's overflow:hidden
   and clips the prompt's right-hand edge. */
.pbc-final-edit { display:block; box-sizing:border-box; inline-size:100%; min-height:140px; max-height:260px; resize:vertical;
  padding:12px 14px; border:none; outline:none; background:var(--pbc-bg);
  color:var(--pbc-ink); font-family:inherit; font-size:0.84rem; line-height:1.65; }
.pbc-final-hint { padding:6px 14px; font-size:0.68rem; color:var(--pbc-ink-2);
  border-block-start:1px solid var(--pbc-line); }
.pbc-final-actions { display:flex; gap:8px; padding:10px 14px; flex-wrap:wrap;
  border-block-start:1px solid var(--pbc-line); background:var(--pbc-panel); }
.pbc-apply { flex:1; min-width:150px; padding:11px 16px; border:none; border-radius:10px; cursor:pointer;
  font-size:0.85rem; font-weight:700; color:#fff; background:var(--pbc-ok); }
.pbc-apply:hover { filter:brightness(1.06); }
.pbc-apply:disabled { opacity:0.6; }
.pbc-copy-final { padding:11px 16px; border-radius:10px; cursor:pointer; font-size:0.85rem; font-weight:600;
  color:var(--pbc-ink); background:var(--pbc-panel-2); border:1px solid var(--pbc-line); }
.pbc-copy-final:hover { border-color:var(--pbc-accent); }
/* Hide the floating support widget while Prompt Studio is open — it sat on
   top of the send button. */
body.pbc-open .aiw-root { display:none !important; }
body.pbc-open [class*="cookie"], body.pbc-open [id*="cookie"] { display:none !important; }
@media (max-width: 640px) {
  .pbc-msgs { max-height:56vh; min-height:240px; padding:10px 8px; }
  .pbc-msg { max-inline-size:96%; font-size:0.9rem; }
  .pbc-input-row { padding:8px; gap:6px; }
  .pbc-input-row textarea { font-size:16px; }  /* 16px stops iOS zoom-on-focus */
  .pbc-send { width:46px; height:46px; }       /* keep the circle, comfy target */
  .pbc-copy-msg { width:30px; height:30px; font-size:14px; }  /* touch target */
  .pbc-head { padding:8px 10px; }
  .pbc-quota { font-size:0.68rem; }
  .pbc-final .pb-apply-row .lp-btn { width:100%; text-align:center; min-height:44px; }
}
/* ── Phone: the chat builder takes over the whole screen (app-like), instead of
   being squeezed inside a config section. Activated by setMode() ≤768px. ── */
.pbc-close { display:none; width:34px; height:34px; border:none; border-radius:10px;
  background:rgba(255,255,255,0.08); color:var(--text-primary); font-size:16px; line-height:1; cursor:pointer; }
.pb-chat-body.pbc-fs { position:fixed; inset:0; width:100%; height:100dvh; z-index:100000;
  background:var(--pbc-bg, #14161c);
  display:flex !important; flex-direction:column;
  padding:0; overscroll-behavior:contain; }
.pb-chat-body.pbc-fs .pbc-shell { flex:1; min-height:0; border:none; border-radius:0; }
.pb-chat-body.pbc-fs .pbc-head { padding-block-start:calc(8px + env(safe-area-inset-top)); }
.pb-chat-body.pbc-fs .pbc-close { display:inline-flex; align-items:center; justify-content:center; }
.pb-chat-body.pbc-fs .pbc-msgs { flex:1; max-height:none; }
.pb-chat-body.pbc-fs .pbc-input-row { padding-block-end:calc(8px + env(safe-area-inset-bottom)); }
/* ── AI Chat editor: the diff card. Shares every pbc-* token so both themes
   and RTL come for free. ── */
.pbe-card { align-self:stretch; margin-inline-start:35px; border-radius:13px;
  background:var(--pbc-panel); border:1px solid var(--pbc-accent); overflow:hidden; }
.pbe-head { display:flex; align-items:center; gap:8px; padding:10px 14px; flex-wrap:wrap;
  font-size:0.78rem; font-weight:700; color:var(--pbc-ink);
  border-block-end:1px solid var(--pbc-line); }
.pbe-head .pbe-ic { width:20px; height:20px; border-radius:6px; flex-shrink:0; display:inline-flex;
  align-items:center; justify-content:center; font-size:11px; color:#fff; background:var(--pbc-accent); }
.pbe-stats { margin-inline-start:auto; font-weight:600; font-size:0.7rem; display:inline-flex; gap:8px;
  font-variant-numeric:tabular-nums; }
.pbe-stat-add { color:var(--pbc-ok); }
.pbe-stat-del { color:var(--pbc-err); }
.pbe-tabs { display:flex; gap:6px; padding:8px 14px 0; }
.pbe-tab { padding:5px 12px; border-radius:999px; font-size:0.74rem; cursor:pointer;
  background:var(--pbc-panel-2); border:1px solid var(--pbc-line); color:var(--pbc-ink-2); }
.pbe-tab.active { background:var(--pbc-accent); border-color:var(--pbc-accent); color:#fff; }
.pbe-diff { margin:10px 14px; border:1px solid var(--pbc-line); border-radius:9px; background:var(--pbc-bg);
  max-height:300px; overflow:auto; padding:8px 0; font-size:0.8rem; line-height:1.55; }
.pbe-line { padding:1px 12px; white-space:pre-wrap; overflow-wrap:anywhere; unicode-bidi:plaintext;
  text-align:start; color:var(--pbc-ink); }
.pbe-line.pbe-ins { background:color-mix(in srgb, var(--pbc-ok) 14%, transparent);
  border-inline-start:3px solid var(--pbc-ok); }
.pbe-line.pbe-del { background:color-mix(in srgb, var(--pbc-err) 12%, transparent);
  border-inline-start:3px solid var(--pbc-err); color:var(--pbc-ink-2); text-decoration:line-through;
  text-decoration-color:color-mix(in srgb, var(--pbc-err) 55%, transparent); }
.pbe-line mark { border-radius:3px; padding:0 1px; color:inherit; text-decoration:inherit; }
.pbe-line mark.pbe-w-ins { background:color-mix(in srgb, var(--pbc-ok) 32%, transparent); }
.pbe-line mark.pbe-w-del { background:color-mix(in srgb, var(--pbc-err) 30%, transparent); }
.pbe-skip { padding:3px 12px; font-size:0.7rem; color:var(--pbc-ink-2); text-align:center;
  user-select:none; }
.pbe-full { display:block; box-sizing:border-box; inline-size:calc(100% - 28px); margin:10px 14px;
  min-height:140px; max-height:300px; resize:vertical; padding:12px 14px; border-radius:9px;
  border:1px solid var(--pbc-line); outline:none; background:var(--pbc-bg);
  color:var(--pbc-ink); font-family:inherit; font-size:0.84rem; line-height:1.65; }
.pbe-hint { padding:0 14px 8px; font-size:0.68rem; color:var(--pbc-ink-2); }
.pbe-actions { display:flex; gap:8px; padding:10px 14px; flex-wrap:wrap;
  border-block-start:1px solid var(--pbc-line); background:var(--pbc-panel); }
.pbe-save { flex:1; min-width:150px; padding:11px 16px; border:none; border-radius:10px; cursor:pointer;
  font-size:0.85rem; font-weight:700; color:#fff; background:var(--pbc-ok); }
.pbe-save:hover { filter:brightness(1.06); }
.pbe-save:disabled { opacity:0.6; }
.pbe-btn { padding:11px 16px; border-radius:10px; cursor:pointer; font-size:0.85rem; font-weight:600;
  color:var(--pbc-ink); background:var(--pbc-panel-2); border:1px solid var(--pbc-line); }
.pbe-btn:hover { border-color:var(--pbc-accent); }
.pbe-btn.pbe-danger:hover { border-color:var(--pbc-err); color:var(--pbc-err); }
.pbe-card.pbe-saved { border-color:var(--pbc-ok); }
@media (max-width: 640px) {
  .pbe-card { margin-inline-start:0; }
  .pbe-diff, .pbe-full { max-height:44vh; }
  .pbe-actions button { min-height:44px; }
}
`;
        document.head.appendChild(st);
    }

    // ============================================================
    //   PERSONA PERSISTENCE (builder state lives in persona jsonb)
    // ============================================================
    // Read fresh, for a save: saveBuilderState writes back what it reads.
    async function loadPersona(agentId) {
        try {
            const { data } = await window.supabaseClient.from('agent_configs')
                .select('persona').eq('org_id', window.currentUserOrgId).eq('agent', agentId).maybeSingle();
            return (data && data.persona && typeof data.persona === 'object') ? data.persona : {};
        } catch (e) { return {}; }
    }

    // At boot the builder decorates all five agent tabs in the same instant,
    // and each read its own persona: five identical requests (Sentry
    // JAVASCRIPT-K, 2026-09-18). One request for all five answers them. It is
    // shared only while in flight, so a tab decorated later reads again.
    let personasInFlight = { orgId: null, promise: null };
    function loadPersonaForDisplay(agentId) {
        const orgId = window.currentUserOrgId;
        if (!(personasInFlight.promise && personasInFlight.orgId === orgId)) {
            const promise = (async () => {
                try {
                    const { data } = await window.supabaseClient.from('agent_configs')
                        .select('agent, persona').eq('org_id', orgId).in('agent', AGENT_IDS);
                    const byAgent = {};
                    (data || []).forEach((r) => { if (r && r.agent) byAgent[r.agent] = r.persona; });
                    return byAgent;
                } catch (e) { return {}; }
            })();
            personasInFlight = { orgId, promise };
            promise.finally(() => {
                if (personasInFlight.promise === promise) personasInFlight = { orgId: null, promise: null };
            });
        }
        return personasInFlight.promise.then((byAgent) => {
            const persona = byAgent && byAgent[agentId];
            return (persona && typeof persona === 'object') ? persona : {};
        });
    }
    async function saveBuilderState(agentId, state) {
        try {
            const persona = await loadPersona(agentId);
            persona.prompt_builder = state;
            await window.supabaseClient.from('agent_configs')
                .upsert({
                    org_id: window.currentUserOrgId, agent: agentId, persona,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'org_id, agent' });
        } catch (e) { console.warn('[prompt-builder] persist state', e); }
    }

    // ============================================================
    //   1) PROMPT BUILDER SECTION
    // ============================================================
    function chipRow(field, options, selected, multi) {
        return `<div class="pb-chips" data-pb-field="${field}" data-pb-multi="${multi ? 1 : 0}">` +
            options.map(([v, en, ar]) => {
                const on = multi ? (selected || []).includes(v) : selected === v;
                return `<span class="pb-chip ${on ? 'on' : ''}" data-pb-value="${v}" role="button" tabindex="0">${esc(L(en, ar))}</span>`;
            }).join('') + '</div>';
    }

    function builderMarkup(state) {
        return `
<div class="pb-grid">
  <div class="pb-field">
    <label class="pb-label">${L('Business name', 'اسم النشاط')}</label>
    <input type="text" data-pb-input="business_name" value="${esc(state.business_name)}" placeholder="${L('e.g. Cairo Sweets', 'مثال: حلويات القاهرة')}">
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('Business type', 'نوع النشاط')}</label>
    ${chipRow('business_type', OPT.business_type, state.business_type, false)}
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('What should the AI achieve?', 'ما هدف الذكاء الاصطناعي؟')}</label>
    ${chipRow('reply_goal', OPT.reply_goal, state.reply_goal, false)}
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('Prompt language (what the AI reads)', 'لغة التوجيه (التي يقرأها الذكاء الاصطناعي)')}</label>
    ${chipRow('prompt_lang', [['ar', 'Arabic', 'العربية'], ['en', 'English', 'الإنجليزية']], state.prompt_lang, false)}
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('Reply style', 'أسلوب الرد')}</label>
    ${chipRow('greeting', OPT.greeting, state.greeting, false)}
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('The AI must NEVER…', 'ممنوع على الذكاء الاصطناعي…')}</label>
    ${chipRow('never', OPT.never, state.never, true)}
  </div>
  <div class="pb-field">
    <label class="pb-label">${L('Hand off to a human when…', 'حوّل لموظف بشري عندما…')}</label>
    ${chipRow('escalate', OPT.escalate, state.escalate, true)}
  </div>
  <div class="pb-field" style="grid-column:1/-1;">
    <label class="pb-label">${L('Anything else the AI should know? (optional)', 'أي ملاحظات إضافية؟ (اختياري)')}</label>
    <textarea data-pb-input="extra_note" rows="2" placeholder="${L('e.g. We deliver inside Cairo only', 'مثال: التوصيل داخل القاهرة فقط')}">${esc(state.extra_note)}</textarea>
  </div>
</div>
<div class="pb-preview">
  <div class="pb-preview-title">${L('Generated prompt preview', 'معاينة التوجيه الناتج')}</div>
  <pre class="pb-preview-text" dir="auto"></pre>
</div>
<div class="pb-apply-row">
  <button type="button" class="lp-btn lp-btn-primary pb-apply" style="font-size:0.85rem;padding:8px 18px;">${L('Apply to prompt', 'اعتماد التوجيه')}</button>
  <span style="font-size:0.75rem;color:var(--text-secondary);">${L('Then press Save Role to go live.', 'ثم اضغط حفظ ليصبح فعّالًا.')}</span>
</div>`;
    }

    function enhancePromptSection(agentId) {
        const ta = document.getElementById(`prompt-${agentId}`);
        if (!ta || ta.dataset.pbEnhanced) return;
        ta.dataset.pbEnhanced = '1';
        unclipSection(ta);

        const wrap = document.createElement('div');
        wrap.id = `pb-wrap-${agentId}`;
        wrap.innerHTML = `
<div class="pb-modes" role="tablist">
  <span class="pb-mode pb-mode-simple" role="tab">${L('Simple builder', 'المُنشئ المبسّط')}</span>
  <span class="pb-mode pb-mode-chat" role="tab">${L('AI Chat builder', 'المُنشئ بالمحادثة')}</span>
  <span class="pb-mode pb-mode-editor" role="tab">${L('AI Chat editor', 'المُحرِّر بالمحادثة')}</span>
  <span class="pb-mode pb-mode-advanced" role="tab">${L('Advanced (free text)', 'متقدم (نص حر)')}</span>
</div>
<div class="pb-body" style="display:none;"></div>
<div class="pb-chat-body" style="display:none;"></div>
<div class="pb-chat-body pb-edit-body" style="display:none;"></div>`;
        ta.parentNode.insertBefore(wrap, ta);

        const body = wrap.querySelector('.pb-body');
        const chatBody = wrap.querySelector('.pb-chat-body:not(.pb-edit-body)');
        const editBody = wrap.querySelector('.pb-edit-body');
        const simpleBtn = wrap.querySelector('.pb-mode-simple');
        const chatBtn = wrap.querySelector('.pb-mode-chat');
        const editorBtn = wrap.querySelector('.pb-mode-editor');
        const advBtn = wrap.querySelector('.pb-mode-advanced');
        let state = { ...DEFAULT_STATE };

        function refreshPreview() {
            const pre = body.querySelector('.pb-preview-text');
            if (pre) pre.textContent = buildAgentSystemPrompt(state);
        }
        function renderBuilder() {
            body.innerHTML = builderMarkup(state);
            body.querySelectorAll('.pb-chips').forEach((row) => {
                row.addEventListener('click', (ev) => {
                    const chip = ev.target.closest('.pb-chip');
                    if (!chip) return;
                    const field = row.dataset.pbField;
                    const value = chip.dataset.pbValue;
                    if (row.dataset.pbMulti === '1') {
                        const cur = new Set(state[field] || []);
                        cur.has(value) ? cur.delete(value) : cur.add(value);
                        state[field] = Array.from(cur);
                        chip.classList.toggle('on');
                    } else {
                        state[field] = value;
                        row.querySelectorAll('.pb-chip').forEach((c) => c.classList.remove('on'));
                        chip.classList.add('on');
                    }
                    refreshPreview();
                });
            });
            body.querySelectorAll('[data-pb-input]').forEach((inp) => {
                inp.addEventListener('input', () => {
                    state[inp.dataset.pbInput] = inp.value;
                    refreshPreview();
                });
            });
            body.querySelector('.pb-apply').addEventListener('click', async (ev) => {
                const btn = ev.currentTarget;
                const prompt = buildAgentSystemPrompt(state);
                ta.value = prompt;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof window.checkDirty === 'function') window.checkDirty(agentId);
                await saveBuilderState(agentId, state);
                btn.disabled = true;
                try {
                    await persistPromptLive(agentId, prompt);
                    toast(L('Prompt saved — your AI agent is now using it. ✓', 'تم حفظ التوجيه — وكيلك الذكي يستخدمه الآن. ✓'), 'success');
                } catch (e) {
                    toast(e.code === 'locked'
                        ? L('Prompt is locked — unlock it first.', 'التوجيه مقفول — افتح القفل أولًا.')
                        : L('Applied to the editor, but saving failed: ', 'تم وضعه في المحرر لكن الحفظ فشل: ') + e.message, 'error');
                }
                btn.disabled = false;
            });
            refreshPreview();
        }
        // ── AI Chat builder (third mode) ─────────────────────────────
        // One "use" = one chat session (charged server-side on the first
        // message). The quota chip shows live "used / limit" from the
        // prompt-builder-chat edge function; the cap is enforced there.
        const chat = { msgs: [], sending: false, quota: null, finalPrompt: null, truncated: false };

        function quotaChipHTML() {
            const q = chat.quota;
            if (!q) return `<span class="pbc-quota"><span class="pbc-qbar"><b style="inline-size:0%"></b></span>…</span>`;
            const left = Math.max(0, (q.limit || 0) - (q.used || 0));
            const pct = q.limit > 0 ? Math.round((left / q.limit) * 100) : 0;
            const cls = left <= 0 ? 'out' : (left <= 3 ? 'low' : '');
            return `<span class="pbc-quota ${cls}" title="${L('Builder sessions left this month', 'الجلسات المتبقية هذا الشهر')}"><span class="pbc-qbar"><b style="inline-size:${pct}%"></b></span>${left}/${q.limit}</span>`;
        }

        function renderChat() {
            chatBody.innerHTML = `
<div class="pbc-shell">
  <div class="pbc-head">
    <div class="pbc-brand">
      <span class="pbc-logo" aria-hidden="true">✦</span>
      <span class="pbc-brand-txt">
        <b>${L('Prompt Studio', 'استوديو التوجيه')}</b>
        <i>${L('Chat about your business — get a ready-to-use agent prompt', 'احكِ عن نشاطك — واستلم توجيهًا جاهزًا لوكيلك')}</i>
      </span>
    </div>
    <span class="pbc-head-right">
      ${quotaChipHTML()}
      <button type="button" class="pbc-reset" title="${L('New session', 'جلسة جديدة')}" aria-label="${L('New session', 'جلسة جديدة')}">⟳</button>
      <button type="button" class="pbc-close" aria-label="${L('Close', 'إغلاق')}">✕</button>
    </span>
  </div>
  <div class="pbc-msgs" dir="auto"></div>
  <div class="pbc-input-wrap">
    <div class="pbc-input-row">
      <textarea rows="1" placeholder="${L('Tell me about your business — or paste your current prompt and say what to change…', 'احكِ لي عن نشاطك — أو الصق توجيهك الحالي وقل ما تريد تغييره…')}"></textarea>
      <button type="button" class="pbc-send" aria-label="${L('Send', 'إرسال')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.35.8-1.45 0-1.8L3.4 3.6c-.66-.28-1.4.2-1.4.9v5.05c0 .5.37.93.87 1L15 12 2.87 13.45c-.5.07-.87.5-.87 1v5.05c0 .7.74 1.18 1.4.9z"/></svg></button>
    </div>
    <div class="pbc-input-foot">
      <button type="button" class="pbc-finalize">${L('Write my prompt now', 'اكتب توجيهي الآن')}</button>
      <span class="pbc-input-count" aria-live="polite"></span>
    </div>
  </div>
</div>`;
            const msgsEl = chatBody.querySelector('.pbc-msgs');
            const inputEl = chatBody.querySelector('.pbc-input-row textarea');
            const sendBtn = chatBody.querySelector('.pbc-send');

            function paintMsgs() {
                msgsEl.innerHTML = chat.msgs.map((m, i) => {
                    if (m.role === 'user') {
                        return `<div class="pbc-row user"><div class="pbc-msg user" dir="auto">${esc(m.content)}</div></div>`;
                    }
                    if (m.err) {
                        return `<div class="pbc-row"><div class="pbc-msg err" dir="auto">${esc(m.content)}</div></div>`;
                    }
                    if (m.note) {
                        return `<div class="pbc-row"><div class="pbc-msg note" dir="auto">${esc(m.content)}</div></div>`;
                    }
                    return `<div class="pbc-row bot">
                        <span class="pbc-avatar" aria-hidden="true">✦</span>
                        <div class="pbc-msg bot" dir="auto">
                            <span class="pbc-sender">${L('Digitivia AI', 'ذكاء ديجيتيفيا')}</span>${esc(m.content)}
                            <button type="button" class="pbc-copy-msg" data-copy-idx="${i}" title="${L('Copy', 'نسخ')}" aria-label="${L('Copy message', 'نسخ الرسالة')}">⧉</button>
                        </div>
                    </div>`;
                }).join('')
                + (chat.sending ? `<div class="pbc-typing" aria-label="${L('Writing…', 'يكتب…')}"><i></i><i></i><i></i></div>` : '')
                + ((!chat.sending && !chat.msgs.some((m) => m.role === 'user')) ? `<div class="pbc-starters">${[
                        L('🛍️ I have an online store', '🛍️ عندي متجر إلكتروني'),
                        L('📅 I take bookings / appointments', '📅 أعمل بالحجوزات والمواعيد'),
                        L('🍽️ I run a restaurant / food business', '🍽️ عندي مطعم أو بيزنس أكل'),
                    ].map((s) => `<button type="button" class="pbc-starter">${s}</button>`).join('')}</div>` : '');
                msgsEl.querySelectorAll('.pbc-copy-msg').forEach((b) => {
                    b.addEventListener('click', () => {
                        const m = chat.msgs[Number(b.dataset.copyIdx)];
                        if (m) copyText(m.content);
                    });
                });
                msgsEl.querySelectorAll('.pbc-starter').forEach((b) => {
                    b.addEventListener('click', () => {
                        inputEl.value = b.textContent.replace(/^[^ ]+ /, '');
                        send();
                    });
                });
                // Final prompt: an in-flow, editable card inside the conversation.
                // The user can tweak the text right here, keep chatting below it,
                // copy it, or save it live — nothing is locked or overlaid.
                if (chat.finalPrompt) {
                    const card = document.createElement('div');
                    card.className = 'pbc-final-card';
                    card.innerHTML = `
                        <div class="pbc-final-head"><span class="ok">✓</span>${L('Your prompt is ready', 'توجيهك جاهز')}<span class="pbc-final-count"></span></div>
                        <textarea class="pbc-final-edit" dir="auto" spellcheck="false"></textarea>
                        <div class="pbc-final-hint">${chat.truncated
                            ? L('This prompt reached the model\'s maximum length and may be missing its last lines — check the ending before saving, or ask for a shorter version.', 'وصل هذا التوجيه إلى أقصى طول للنموذج وقد تنقصه أسطره الأخيرة — راجع النهاية قبل الحفظ، أو اطلب نسخة أقصر.')
                            : L('You can edit the text above before saving — or keep chatting to refine it.', 'يمكنك تعديل النص أعلاه قبل الحفظ — أو أكمل المحادثة لتحسينه.')}</div>
                        <div class="pbc-final-actions">
                            <button type="button" class="pbc-apply">${L('Save & activate', 'حفظ وتفعيل')}</button>
                            <button type="button" class="pbc-copy-final">${L('Copy', 'نسخ')}</button>
                        </div>`;
                    if (chat.truncated) card.classList.add('pbc-final-warn');
                    const edit = card.querySelector('.pbc-final-edit');
                    const count = card.querySelector('.pbc-final-count');
                    // The whole complaint this addresses was silent loss, so the
                    // size of what came back is on screen, not inferred.
                    const paintCount = () => {
                        count.textContent = L(
                            `${(chat.finalPrompt || '').length.toLocaleString('en-US')} characters`,
                            `${(chat.finalPrompt || '').length.toLocaleString('en-US')} حرف`);
                    };
                    edit.value = chat.finalPrompt;
                    paintCount();
                    edit.addEventListener('input', () => { chat.finalPrompt = edit.value; paintCount(); });
                    card.querySelector('.pbc-copy-final').addEventListener('click', () => {
                        copyText(chat.finalPrompt, L('Prompt copied', 'تم نسخ التوجيه'));
                    });
                    card.querySelector('.pbc-apply').addEventListener('click', async (ev) => {
                        const btn = ev.currentTarget;
                        const promptText = (chat.finalPrompt || '').trim();
                        if (!promptText) return;
                        // Whatever else happens, an envelope must never become
                        // an agent's live system prompt.
                        if (looksLikeEnvelope(promptText)) {
                            toast(L('That is a status message, not a prompt — it was not saved. Ask the builder to write the prompt again.',
                                    'هذه رسالة حالة وليست توجيهًا — لم يتم الحفظ. اطلب من المُنشئ كتابة التوجيه مرة أخرى.'), 'error');
                            return;
                        }
                        ta.value = promptText;
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        if (typeof window.checkDirty === 'function') window.checkDirty(agentId);
                        btn.disabled = true;
                        try {
                            await persistPromptLive(agentId, promptText);
                            toast(L('Prompt saved — your AI agent is now using it. ✓', 'تم حفظ التوجيه — وكيلك الذكي يستخدمه الآن. ✓'), 'success');
                        } catch (e) {
                            toast(e.code === 'locked'
                                ? L('Prompt is locked — unlock it first.', 'التوجيه مقفول — افتح القفل أولًا.')
                                : L('Saving failed: ', 'فشل الحفظ: ') + e.message, 'error');
                        }
                        btn.disabled = false;
                    });
                    msgsEl.appendChild(card);
                }
                // Land on the TOP of the finished prompt, not the bottom of the
                // transcript: the card is taller than the panel, so scrolling to
                // the end shows two buttons and none of the document — which
                // reads as "nothing was written" just as much as a green line
                // does. Everywhere else, the newest message belongs at the end.
                const finalCard = msgsEl.querySelector('.pbc-final-card');
                if (finalCard) msgsEl.scrollTop = Math.max(0, finalCard.offsetTop - msgsEl.offsetTop - 8);
                else msgsEl.scrollTop = msgsEl.scrollHeight;
                const fbtn = chatBody.querySelector('.pbc-finalize');
                if (fbtn) {
                    const started = chat.msgs.some((m) => m.role === 'user');
                    fbtn.style.display = started ? '' : 'none';
                    fbtn.disabled = !!chat.sending;
                }
                const chipHost = chatBody.querySelector('.pbc-head-right');
                if (chipHost) chipHost.querySelector('.pbc-quota').outerHTML = quotaChipHTML();
            }

            function greetIfEmpty() {
                if (!chat.msgs.length) {
                    chat.msgs.push({ role: 'assistant', content: L(
                        "Hi! Tell me about your business in your own words — what you sell, who your customers are, how you like to talk to them. I'll ask a couple of questions and then write a complete, ready-to-use prompt for your AI agent.",
                        'أهلًا! احكِ لي عن نشاطك بكلماتك — ماذا تبيع، من عملاؤك، وكيف تحب التحدث معهم. سأسألك سؤالًا أو سؤالين ثم أكتب لك توجيهًا كاملًا وجاهزًا لوكيلك الذكي.') });
                }
                paintMsgs();
            }

            async function callChat(action) {
                const session = (await window.supabaseClient.auth.getSession()).data.session;
                const headers = { 'Content-Type': 'application/json' };
                if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
                if (window.SUPABASE_KEY) headers['apikey'] = window.SUPABASE_KEY;
                // The greeting is local; only send real turns (user + AI replies from the server).
                const wire = chat.msgs.filter((m) => !m.local && !m.err && !m.note).map((m) => ({ role: m.role, content: m.content }));
                const r = await fetch(PROMPT_CHAT_URL(), {
                    method: 'POST', headers,
                    body: JSON.stringify({ action: action || 'chat', agent: agentId, locale: lang(), messages: wire }),
                });
                return { status: r.status, json: await r.json().catch(() => ({})) };
            }

            // The model can end a turn saying it is about to write the prompt
            // without actually asking for it to be written, which leaves the
            // customer with a promise and nothing else. This button removes the
            // model's discretion: it asks the server for the document directly.
            // It never costs a session.
            async function finalize() {
                if (chat.sending) return;
                if (!chat.msgs.some((m) => m.role === 'user')) return;
                chat.sending = true; sendBtn.disabled = true;
                paintMsgs();
                try {
                    const { status, json: j } = await callChat('finalize');
                    if (j && j.ok && j.data && j.data.finalPrompt && !looksLikeEnvelope(j.data.finalPrompt)) {
                        chat.finalPrompt = j.data.finalPrompt;
                        chat.truncated = j.data.truncated === true;
                        chat.quota = { limit: j.data.limit, used: j.data.used };
                    } else if (j && j.ok && j.data && looksLikeEnvelope(j.data.finalPrompt)) {
                        chat.msgs.push({ role: 'assistant', err: true, content: L(
                            'The builder replied with a status message instead of the prompt itself. Tap "Write my prompt now" again — it usually works on the second try.',
                            'ردّ المُنشئ برسالة حالة بدلًا من التوجيه نفسه. اضغط "اكتب توجيهي الآن" مرة أخرى — عادةً ما ينجح في المحاولة الثانية.') });
                    } else {
                        chat.msgs.push({ role: 'assistant', err: true, content:
                            (j && j.error && j.error.message)
                            || L('The prompt could not be written out. Please try again.',
                                 'تعذّر كتابة التوجيه. حاول مرة أخرى.') });
                    }
                } catch (e) {
                    chat.msgs.push({ role: 'assistant', err: true, content: L('Network error — please try again.', 'خطأ في الاتصال — حاول مرة أخرى.') });
                }
                chat.sending = false; sendBtn.disabled = false;
                paintMsgs();
            }

            async function send() {
                const text = (inputEl.value || '').trim();
                if (!text || chat.sending) return;
                // Refuse locally with the same rule the server enforces, so a
                // long paste is never spent against the plan only to bounce.
                if (text.length > MAX_MESSAGE_CHARS) {
                    toast(L(
                        `That message is ${text.length.toLocaleString('en-US')} characters — the limit for one message is ${MAX_MESSAGE_CHARS.toLocaleString('en-US')}. Split it into two messages.`,
                        `هذه الرسالة ${text.length.toLocaleString('en-US')} حرف — الحد للرسالة الواحدة ${MAX_MESSAGE_CHARS.toLocaleString('en-US')}. قسّمها إلى رسالتين.`), 'error');
                    return;
                }
                inputEl.value = '';
                paintInputCount();
                chat.msgs.push({ role: 'user', content: text });
                chat.sending = true; sendBtn.disabled = true;
                paintMsgs();
                try {
                    const { status, json: j } = await callChat();
                    if (j && j.ok && j.data) {
                        if (j.data.reply) chat.msgs.push({ role: 'assistant', content: j.data.reply });
                        // Same guard as finalize(): a status message is not a prompt.
                        if (j.data.finalPrompt && !looksLikeEnvelope(j.data.finalPrompt)) {
                            chat.finalPrompt = j.data.finalPrompt;
                        }
                        chat.truncated = j.data.truncated === true;
                        // The one lossy step left on the server is dropping the
                        // OLDEST turns to fit. Say it out loud rather than letting
                        // the builder quietly forget the start of the conversation.
                        if (j.data.droppedTurns > 0) {
                            chat.msgs.push({ role: 'assistant', local: true, note: true, content: L(
                                `This conversation got long, so the earliest ${j.data.droppedTurns} message(s) were left out of this answer. Start a new session if the builder starts losing the thread.`,
                                `طالت هذه المحادثة، لذا لم تُدرج أقدم ${j.data.droppedTurns} رسالة في هذه الإجابة. ابدأ جلسة جديدة إذا بدأ المُنشئ يفقد السياق.`) });
                        }
                        chat.quota = { limit: j.data.limit, used: j.data.used };
                    } else {
                        const code = j && j.error && j.error.code;
                        if (code === 'limit_reached') {
                            chat.quota = j.data ? { limit: j.data.limit, used: j.data.used } : chat.quota;
                            chat.msgs.push({ role: 'assistant', err: true, content: L(
                                'You have used all your Prompt Builder sessions for this month. Your plan limit resets next month — or upgrade your plan for more sessions.',
                                'لقد استهلكت كل جلسات مُنشئ التوجيه لهذا الشهر. يتجدد الحد الشهري مع بداية الشهر القادم — أو قم بترقية باقتك لجلسات أكثر.') });
                        } else if (code === 'not_configured') {
                            chat.msgs.push({ role: 'assistant', err: true, content: L(
                                'The AI builder is not configured yet. Please contact support.',
                                'مُنشئ التوجيه غير مُفعّل بعد. برجاء التواصل مع الدعم.') });
                        } else if (code === 'message_too_long' || code === 'input_too_long' || code === 'response_truncated') {
                            // The server now names exactly what did not fit and
                            // what to do about it; pass that through verbatim
                            // instead of a generic failure.
                            chat.msgs.push({ role: 'assistant', err: true, content: (j.error && j.error.message) || '' });
                        } else {
                            chat.msgs.push({ role: 'assistant', err: true, content: (j && j.error && j.error.message) || `HTTP ${status}` });
                        }
                    }
                } catch (e) {
                    chat.msgs.push({ role: 'assistant', err: true, content: L('Network error — please try again.', 'خطأ في الاتصال — حاول مرة أخرى.') });
                }
                chat.sending = false; sendBtn.disabled = false;
                paintMsgs();
                inputEl.focus();
            }

            const finalizeBtn = chatBody.querySelector('.pbc-finalize');
            finalizeBtn.addEventListener('click', finalize);
            sendBtn.addEventListener('click', send);
            inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
            });
            // Auto-grow composer up to 120px, then scroll internally.
            const countEl = chatBody.querySelector('.pbc-input-count');
            const paintInputCount = () => {
                if (!countEl) return;
                const n = (inputEl.value || '').length;
                if (n < 800) { countEl.textContent = ''; countEl.classList.remove('over'); return; }
                const over = n > MAX_MESSAGE_CHARS;
                countEl.classList.toggle('over', over);
                countEl.textContent = over
                    ? L(`${n.toLocaleString('en-US')} characters — over the ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} limit for one message. Split it in two.`,
                        `${n.toLocaleString('en-US')} حرف — أكبر من حد ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} حرف للرسالة الواحدة. قسّمها إلى رسالتين.`)
                    : L(`${n.toLocaleString('en-US')} characters — all of it will be read.`,
                        `${n.toLocaleString('en-US')} حرف — سيُقرأ بالكامل.`);
            };
            inputEl.addEventListener('input', () => {
                inputEl.style.height = 'auto';
                inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
                paintInputCount();
            });
            chatBody.querySelector('.pbc-reset').addEventListener('click', () => {
                chat.msgs = []; chat.finalPrompt = null; chat.truncated = false;
                inputEl.value = ''; paintInputCount();
                greetIfEmpty();
            });
            greetIfEmpty();

            // Live quota chip (status action never consumes a use).
            (async () => {
                try {
                    const session = (await window.supabaseClient.auth.getSession()).data.session;
                    const headers = { 'Content-Type': 'application/json' };
                    if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
                    if (window.SUPABASE_KEY) headers['apikey'] = window.SUPABASE_KEY;
                    const r = await fetch(PROMPT_CHAT_URL(), { method: 'POST', headers, body: JSON.stringify({ action: 'status' }) });
                    const j = await r.json().catch(() => ({}));
                    if (j && j.ok && j.data) {
                        chat.quota = { limit: j.data.limit, used: j.data.used };
                        // The server owns the limit; adopt whatever it reports so
                        // the two can never drift apart after a deploy.
                        if (Number(j.data.maxMessageChars) > 0) MAX_MESSAGE_CHARS = Number(j.data.maxMessageChars);
                        paintMsgs();
                    }
                } catch (e) { /* chip stays "…" */ }
            })();
        }

        // ── AI Chat editor (fourth mode) ─────────────────────────────
        // Edits the EXISTING live prompt instead of building a new one. Same
        // Prompt Studio backend (prompt-builder-chat), so the monthly session
        // quota — the builder's rate limit — applies to the editor identically.
        // The current prompt is seeded server-side into the first message; the
        // reply's full revised prompt is diffed against the base locally and
        // saved through the same prompt-assistant apply path as the builder.
        const ed = { base: '', msgs: [], sending: false, quota: null, revised: null,
                     truncated: false, view: 'diff', saved: false };

        function edSeededContent(text) {
            return [
                'Here is my current agent system prompt. EDIT it — do not rewrite it from scratch.',
                'Apply exactly the changes I ask for and keep every other line intact.',
                '',
                '----- CURRENT PROMPT START -----',
                ed.base,
                '----- CURRENT PROMPT END -----',
                '',
                `My request: ${text}`,
            ].join('\n');
        }

        function edQuotaChipHTML() {
            const q = ed.quota;
            if (!q) return `<span class="pbc-quota"><span class="pbc-qbar"><b style="inline-size:0%"></b></span>…</span>`;
            const left = Math.max(0, (q.limit || 0) - (q.used || 0));
            const pct = q.limit > 0 ? Math.round((left / q.limit) * 100) : 0;
            const cls = left <= 0 ? 'out' : (left <= 3 ? 'low' : '');
            return `<span class="pbc-quota ${cls}" title="${L('Builder sessions left this month (shared with the AI Chat builder)', 'الجلسات المتبقية هذا الشهر (مشتركة مع المُنشئ بالمحادثة)')}"><span class="pbc-qbar"><b style="inline-size:${pct}%"></b></span>${left}/${q.limit}</span>`;
        }

        function renderEditor() {
            editBody.innerHTML = `
<div class="pbc-shell">
  <div class="pbc-head">
    <div class="pbc-brand">
      <span class="pbc-logo" aria-hidden="true">✎</span>
      <span class="pbc-brand-txt">
        <b>${L('Prompt Editor', 'محرِّر التوجيه')}</b>
        <i>${L('Tell me what to change — see exactly what changed before you save', 'قل لي ما تريد تغييره — وشاهد ما تغيّر بالضبط قبل الحفظ')}</i>
      </span>
    </div>
    <span class="pbc-head-right">
      ${edQuotaChipHTML()}
      <button type="button" class="pbc-reset" title="${L('New session', 'جلسة جديدة')}" aria-label="${L('New session', 'جلسة جديدة')}">⟳</button>
      <button type="button" class="pbc-close" aria-label="${L('Close', 'إغلاق')}">✕</button>
    </span>
  </div>
  <div class="pbc-msgs" dir="auto"></div>
  <div class="pbc-input-wrap">
    <div class="pbc-input-row">
      <textarea rows="1" placeholder="${L('e.g. Make the tone friendlier and add free delivery over 500 EGP…', 'مثال: اجعل الأسلوب أكثر ودًا وأضف توصيلًا مجانيًا فوق ٥٠٠ جنيه…')}"></textarea>
      <button type="button" class="pbc-send" aria-label="${L('Send', 'إرسال')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.35.8-1.45 0-1.8L3.4 3.6c-.66-.28-1.4.2-1.4.9v5.05c0 .5.37.93.87 1L15 12 2.87 13.45c-.5.07-.87.5-.87 1v5.05c0 .7.74 1.18 1.4.9z"/></svg></button>
    </div>
    <div class="pbc-input-foot">
      <button type="button" class="pbc-finalize">${L('Apply my edits now', 'طبّق تعديلاتي الآن')}</button>
      <span class="pbc-input-count" aria-live="polite"></span>
    </div>
  </div>
</div>`;
            const msgsEl = editBody.querySelector('.pbc-msgs');
            const inputEl = editBody.querySelector('.pbc-input-row textarea');
            const sendBtn = editBody.querySelector('.pbc-send');

            function paintDiffCard() {
                const card = document.createElement('div');
                card.className = 'pbe-card' + (ed.saved ? ' pbe-saved' : '');
                const diff = computeDiff(ed.base, ed.revised);
                card.innerHTML = `
<div class="pbe-head"><span class="pbe-ic">±</span>${ed.saved
        ? L('Saved — this is now your live prompt', 'تم الحفظ — هذا هو توجيهك الفعّال الآن')
        : L('Proposed changes', 'التعديلات المقترحة')}
  <span class="pbe-stats"><span class="pbe-stat-add">+${diff.added}</span><span class="pbe-stat-del">−${diff.removed}</span></span>
</div>
<div class="pbe-tabs">
  <span class="pbe-tab ${ed.view === 'diff' ? 'active' : ''}" data-view="diff">${L('Changes', 'التغييرات')}</span>
  <span class="pbe-tab ${ed.view === 'full' ? 'active' : ''}" data-view="full">${L('Full text', 'النص الكامل')}</span>
</div>
<div class="pbe-body-host"></div>
<div class="pbe-hint">${ed.truncated
        ? L('This text reached the model\'s maximum length and may be missing its last lines — check the ending before saving.', 'وصل هذا النص إلى أقصى طول للنموذج وقد تنقصه أسطره الأخيرة — راجع النهاية قبل الحفظ.')
        : L('Keep chatting below to refine it — or edit the Full text directly before saving.', 'أكمل المحادثة بالأسفل لتحسينه — أو عدّل «النص الكامل» مباشرةً قبل الحفظ.')}</div>
<div class="pbe-actions">
  <button type="button" class="pbe-save">${L('Save & activate', 'حفظ وتفعيل')}</button>
  <button type="button" class="pbe-btn pbe-copy">${L('Copy', 'نسخ')}</button>
  <button type="button" class="pbe-btn pbe-danger pbe-discard">${L('Discard changes', 'تجاهل التعديلات')}</button>
</div>`;
                const host = card.querySelector('.pbe-body-host');
                const renderView = () => {
                    if (ed.view === 'diff') {
                        host.innerHTML = `<div class="pbe-diff" dir="auto">${diffToHtml(computeDiff(ed.base, ed.revised))}</div>`;
                    } else {
                        host.innerHTML = `<textarea class="pbe-full" dir="auto" spellcheck="false"></textarea>`;
                        const fullTa = host.querySelector('.pbe-full');
                        fullTa.value = ed.revised;
                        fullTa.addEventListener('input', () => { ed.revised = fullTa.value; ed.saved = false; });
                    }
                };
                renderView();
                card.querySelectorAll('.pbe-tab').forEach((t2) => t2.addEventListener('click', () => {
                    ed.view = t2.dataset.view;
                    card.querySelectorAll('.pbe-tab').forEach((x) => x.classList.toggle('active', x === t2));
                    renderView();
                }));
                card.querySelector('.pbe-copy').addEventListener('click', () => {
                    copyText(ed.revised, L('Edited prompt copied', 'تم نسخ التوجيه المعدَّل'));
                });
                card.querySelector('.pbe-discard').addEventListener('click', () => {
                    ed.revised = null; ed.saved = false;
                    ed.msgs.push({ role: 'assistant', local: true, note: true, content: L(
                        'Changes discarded — your live prompt is untouched. Tell me what to try instead.',
                        'تم تجاهل التعديلات — توجيهك الفعّال لم يتغيّر. قل لي ماذا نجرّب بدلًا منها.') });
                    paintMsgs();
                });
                card.querySelector('.pbe-save').addEventListener('click', async (ev) => {
                    const btn = ev.currentTarget;
                    const promptText = (ed.revised || '').trim();
                    if (!promptText) return;
                    if (looksLikeEnvelope(promptText)) {
                        toast(L('That is a status message, not a prompt — it was not saved.',
                                'هذه رسالة حالة وليست توجيهًا — لم يتم الحفظ.'), 'error');
                        return;
                    }
                    ta.value = promptText;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    if (typeof window.checkDirty === 'function') window.checkDirty(agentId);
                    btn.disabled = true;
                    try {
                        await persistPromptLive(agentId, promptText);
                        ed.base = promptText;   // future edits diff against what is now live
                        ed.saved = true;
                        toast(L('Prompt saved — your AI agent is now using the edited version. ✓', 'تم الحفظ — وكيلك الذكي يستخدم النسخة المعدَّلة الآن. ✓'), 'success');
                        paintMsgs();
                    } catch (e) {
                        toast(e.code === 'locked'
                            ? L('Prompt is locked — unlock it first.', 'التوجيه مقفول — افتح القفل أولًا.')
                            : L('Saving failed: ', 'فشل الحفظ: ') + e.message, 'error');
                    }
                    btn.disabled = false;
                });
                msgsEl.appendChild(card);
            }

            function paintMsgs() {
                msgsEl.innerHTML = ed.msgs.map((m, i) => {
                    if (m.role === 'user') return `<div class="pbc-row user"><div class="pbc-msg user" dir="auto">${esc(m.content)}</div></div>`;
                    if (m.err) return `<div class="pbc-row"><div class="pbc-msg err" dir="auto">${esc(m.content)}</div></div>`;
                    if (m.note) return `<div class="pbc-row"><div class="pbc-msg note" dir="auto">${esc(m.content)}</div></div>`;
                    return `<div class="pbc-row bot">
                        <span class="pbc-avatar" aria-hidden="true">✎</span>
                        <div class="pbc-msg bot" dir="auto">
                            <span class="pbc-sender">${L('Digitivia AI', 'ذكاء ديجيتيفيا')}</span>${esc(m.content)}
                            <button type="button" class="pbc-copy-msg" data-copy-idx="${i}" title="${L('Copy', 'نسخ')}" aria-label="${L('Copy message', 'نسخ الرسالة')}">⧉</button>
                        </div>
                    </div>`;
                }).join('')
                + (ed.sending ? `<div class="pbc-typing" aria-label="${L('Writing…', 'يكتب…')}"><i></i><i></i><i></i></div>` : '')
                + ((!ed.sending && !ed.msgs.some((m) => m.role === 'user')) ? `<div class="pbc-starters">${[
                        L('✂️ Make it shorter and tighter', '✂️ اجعله أقصر وأكثر تركيزًا'),
                        L('🛒 Push more toward closing the sale', '🛒 ركّز أكثر على إتمام البيع'),
                        L('🔍 Review it and suggest improvements', '🔍 راجعه واقترح تحسينات'),
                    ].map((s) => `<button type="button" class="pbc-starter">${s}</button>`).join('')}</div>` : '');
                msgsEl.querySelectorAll('.pbc-copy-msg').forEach((b) => {
                    b.addEventListener('click', () => {
                        const m = ed.msgs[Number(b.dataset.copyIdx)];
                        if (m) copyText(m.content);
                    });
                });
                msgsEl.querySelectorAll('.pbc-starter').forEach((b) => {
                    b.addEventListener('click', () => {
                        inputEl.value = b.textContent.replace(/^[^ ]+ /, '');
                        send();
                    });
                });
                if (ed.revised) paintDiffCard();
                // Same scroll rule as the builder: land on the TOP of the result
                // card (it is taller than the panel); otherwise newest at the end.
                const cardEl = msgsEl.querySelector('.pbe-card');
                if (cardEl) msgsEl.scrollTop = Math.max(0, cardEl.offsetTop - msgsEl.offsetTop - 8);
                else msgsEl.scrollTop = msgsEl.scrollHeight;
                const fbtn = editBody.querySelector('.pbc-finalize');
                if (fbtn) {
                    fbtn.style.display = ed.msgs.some((m) => m.role === 'user') ? '' : 'none';
                    fbtn.disabled = !!ed.sending;
                }
                const chipHost = editBody.querySelector('.pbc-head-right');
                if (chipHost) chipHost.querySelector('.pbc-quota').outerHTML = edQuotaChipHTML();
            }

            function greet() {
                ed.base = (ta.value || '').trim();
                ed.msgs = [];
                if (!ed.base) {
                    ed.msgs.push({ role: 'assistant', local: true, content: L(
                        "You don't have a prompt for this agent yet, so there is nothing to edit. Use the AI Chat builder (the tab next to this one) to create your first prompt — then come back here any time to refine it.",
                        'لا يوجد توجيه لهذا الوكيل بعد، فلا يوجد ما يمكن تعديله. استخدم «المُنشئ بالمحادثة» (التبويب المجاور) لإنشاء توجيهك الأول — ثم عد هنا في أي وقت لتحسينه.') });
                } else {
                    ed.msgs.push({ role: 'assistant', local: true, content: L(
                        `I've loaded your current prompt (${ed.base.length.toLocaleString('en-US')} characters). Tell me what you'd like to change — or ask me to review it and suggest improvements. I'll show you exactly what changed before anything is saved.`,
                        `قرأت توجيهك الحالي (${ed.base.length.toLocaleString('en-US')} حرف). قل لي ما الذي تريد تغييره — أو اطلب مني مراجعته واقتراح تحسينات. سأريك ما تغيّر بالضبط قبل حفظ أي شيء.`) });
                }
                paintMsgs();
            }

            async function edCall(action) {
                const session = (await window.supabaseClient.auth.getSession()).data.session;
                const headers = { 'Content-Type': 'application/json' };
                if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
                if (window.SUPABASE_KEY) headers['apikey'] = window.SUPABASE_KEY;
                // Wire = the real turns; the first user turn carries the seeded
                // current prompt (wireContent), while the bubble shows only the
                // customer's own words.
                const wire = ed.msgs.filter((m) => !m.local && !m.err && !m.note)
                    .map((m) => ({ role: m.role, content: m.wireContent || m.content }));
                const r = await fetch(PROMPT_CHAT_URL(), {
                    method: 'POST', headers,
                    body: JSON.stringify({ action: action || 'chat', agent: agentId, locale: lang(), messages: wire }),
                });
                return { status: r.status, json: await r.json().catch(() => ({})) };
            }

            function handleResult(j, status) {
                if (j && j.ok && j.data) {
                    if (j.data.reply) ed.msgs.push({ role: 'assistant', content: j.data.reply });
                    if (j.data.finalPrompt && !looksLikeEnvelope(j.data.finalPrompt)) {
                        ed.revised = j.data.finalPrompt;
                        ed.saved = false;
                        ed.view = 'diff';
                    }
                    ed.truncated = j.data.truncated === true;
                    if (j.data.droppedTurns > 0) {
                        ed.msgs.push({ role: 'assistant', local: true, note: true, content: L(
                            `This conversation got long, so the earliest ${j.data.droppedTurns} message(s) were left out of this answer. Start a new session if the editor starts losing the thread.`,
                            `طالت هذه المحادثة، لذا لم تُدرج أقدم ${j.data.droppedTurns} رسالة في هذه الإجابة. ابدأ جلسة جديدة إذا بدأ المحرِّر يفقد السياق.`) });
                    }
                    ed.quota = { limit: j.data.limit, used: j.data.used };
                    return;
                }
                const code = j && j.error && j.error.code;
                if (code === 'limit_reached') {
                    ed.quota = j.data ? { limit: j.data.limit, used: j.data.used } : ed.quota;
                    ed.msgs.push({ role: 'assistant', err: true, content: L(
                        'You have used all your Prompt Builder sessions for this month (the editor shares the same limit). It resets next month — or upgrade your plan for more.',
                        'لقد استهلكت كل جلسات مُنشئ التوجيه لهذا الشهر (المحرِّر يشارك نفس الحد). يتجدد الحد الشهري مع بداية الشهر القادم — أو قم بترقية باقتك.') });
                } else if (code === 'not_configured') {
                    ed.msgs.push({ role: 'assistant', err: true, content: L(
                        'The AI editor is not configured yet. Please contact support.',
                        'المحرِّر غير مُفعّل بعد. برجاء التواصل مع الدعم.') });
                } else {
                    ed.msgs.push({ role: 'assistant', err: true, content:
                        (j && j.error && j.error.message) || `HTTP ${status}` });
                }
            }

            async function finalize() {
                if (ed.sending || !ed.msgs.some((m) => m.role === 'user')) return;
                ed.sending = true; sendBtn.disabled = true;
                paintMsgs();
                try {
                    const { status, json: j } = await edCall('finalize');
                    if (j && j.ok && j.data && j.data.finalPrompt && !looksLikeEnvelope(j.data.finalPrompt)) {
                        ed.revised = j.data.finalPrompt;
                        ed.saved = false; ed.view = 'diff';
                        ed.truncated = j.data.truncated === true;
                        ed.quota = { limit: j.data.limit, used: j.data.used };
                    } else {
                        ed.msgs.push({ role: 'assistant', err: true, content:
                            (j && j.error && j.error.message)
                            || L('The edited prompt could not be written out. Please try again.', 'تعذّر كتابة التوجيه المعدَّل. حاول مرة أخرى.') });
                    }
                } catch (e) {
                    ed.msgs.push({ role: 'assistant', err: true, content: L('Network error — please try again.', 'خطأ في الاتصال — حاول مرة أخرى.') });
                }
                ed.sending = false; sendBtn.disabled = false;
                paintMsgs();
            }

            async function send() {
                const text = (inputEl.value || '').trim();
                if (!text || ed.sending) return;
                if (!ed.base) {
                    toast(L('Nothing to edit yet — build your first prompt with the AI Chat builder.',
                            'لا يوجد ما يمكن تعديله بعد — أنشئ توجيهك الأول عبر «المُنشئ بالمحادثة».'), 'info');
                    return;
                }
                const isFirst = !ed.msgs.some((m) => m.role === 'user');
                const wireContent = isFirst ? edSeededContent(text) : text;
                if (wireContent.length > MAX_MESSAGE_CHARS) {
                    toast(L(
                        `Your prompt plus this request is ${wireContent.length.toLocaleString('en-US')} characters — over the ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} limit for one message. Shorten the request.`,
                        `توجيهك مع هذا الطلب ${wireContent.length.toLocaleString('en-US')} حرف — أكبر من حد ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} حرف للرسالة الواحدة. اختصر الطلب.`), 'error');
                    return;
                }
                inputEl.value = '';
                paintInputCount();
                ed.msgs.push({ role: 'user', content: text, wireContent: isFirst ? wireContent : undefined });
                ed.sending = true; sendBtn.disabled = true;
                paintMsgs();
                try {
                    const { status, json: j } = await edCall();
                    handleResult(j, status);
                } catch (e) {
                    ed.msgs.push({ role: 'assistant', err: true, content: L('Network error — please try again.', 'خطأ في الاتصال — حاول مرة أخرى.') });
                }
                ed.sending = false; sendBtn.disabled = false;
                paintMsgs();
                inputEl.focus();
            }

            editBody.querySelector('.pbc-finalize').addEventListener('click', finalize);
            sendBtn.addEventListener('click', send);
            inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
            });
            const countEl = editBody.querySelector('.pbc-input-count');
            const paintInputCount = () => {
                if (!countEl) return;
                const n = (inputEl.value || '').length;
                if (n < 800) { countEl.textContent = ''; countEl.classList.remove('over'); return; }
                const over = n > MAX_MESSAGE_CHARS;
                countEl.classList.toggle('over', over);
                countEl.textContent = over
                    ? L(`${n.toLocaleString('en-US')} characters — over the limit for one message.`,
                        `${n.toLocaleString('en-US')} حرف — أكبر من الحد للرسالة الواحدة.`)
                    : L(`${n.toLocaleString('en-US')} characters — all of it will be read.`,
                        `${n.toLocaleString('en-US')} حرف — سيُقرأ بالكامل.`);
            };
            inputEl.addEventListener('input', () => {
                inputEl.style.height = 'auto';
                inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
                paintInputCount();
            });
            editBody.querySelector('.pbc-reset').addEventListener('click', () => {
                ed.revised = null; ed.truncated = false; ed.saved = false;
                inputEl.value = ''; paintInputCount();
                greet();
            });
            greet();

            // Live quota chip (status never consumes a use) — same endpoint,
            // same counter as the AI Chat builder.
            (async () => {
                try {
                    const session = (await window.supabaseClient.auth.getSession()).data.session;
                    const headers = { 'Content-Type': 'application/json' };
                    if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
                    if (window.SUPABASE_KEY) headers['apikey'] = window.SUPABASE_KEY;
                    const r = await fetch(PROMPT_CHAT_URL(), { method: 'POST', headers, body: JSON.stringify({ action: 'status' }) });
                    const j = await r.json().catch(() => ({}));
                    if (j && j.ok && j.data) {
                        ed.quota = { limit: j.data.limit, used: j.data.used };
                        if (Number(j.data.maxMessageChars) > 0) MAX_MESSAGE_CHARS = Number(j.data.maxMessageChars);
                        paintMsgs();
                    }
                } catch (e) { /* chip stays "…" */ }
            })();
        }

        function setMode(mode) {
            const simple = mode === 'simple';
            const isChat = mode === 'chat';
            const isEditor = mode === 'editor';
            simpleBtn.classList.toggle('active', simple);
            chatBtn.classList.toggle('active', isChat);
            editorBtn.classList.toggle('active', isEditor);
            advBtn.classList.toggle('active', !simple && !isChat && !isEditor);
            body.style.display = simple ? '' : 'none';
            chatBody.style.display = isChat ? '' : 'none';
            editBody.style.display = isEditor ? '' : 'none';
            ta.style.display = (simple || isChat || isEditor) ? 'none' : '';
            if (simple && !body.childElementCount) renderBuilder();
            if (isChat && !chatBody.childElementCount) renderChat();
            // The editor re-reads the live textarea every time it opens, so it
            // always edits what the agent is really using right now.
            if (isEditor) {
                if (!editBody.childElementCount) renderEditor();
                else if (!ed.msgs.some((m) => m.role === 'user') && ed.base !== (ta.value || '').trim()) {
                    // No session started and the live prompt changed since the
                    // editor was last painted (saved elsewhere, other mode) —
                    // rebuild so it always edits what the agent really uses now.
                    editBody.innerHTML = '';
                    renderEditor();
                }
            }
            // Phone: a chat-like mode takes over the screen (app-like). The node
            // is PORTALED to <body>: position:fixed is relative to the nearest
            // transformed/filtered ancestor, and the config sections have those,
            // so without the portal the "fullscreen" overlay stayed trapped inside
            // the section's overflow:hidden/max-height clip — unreachable input,
            // nothing scrollable. Moving the node preserves all listeners.
            const phone = window.matchMedia('(max-width: 768px)').matches;
            const applyFs = (el, active) => {
                const fs = active && phone;
                if (fs) {
                    if (!el._slot) {
                        el._slot = document.createComment('pbc-slot');
                        el.parentNode.insertBefore(el._slot, el);
                    }
                    if (el.parentNode !== document.body) document.body.appendChild(el);
                } else if (el._slot && el.parentNode === document.body) {
                    el._slot.parentNode.insertBefore(el, el._slot.nextSibling);
                }
                el.classList.toggle('pbc-fs', fs);
                // Keyboard-aware height: when the on-screen keyboard opens,
                // visualViewport shrinks but 100dvh does not. Track it so the
                // composer stays visible above the keyboard and the latest
                // messages stay in view.
                if (!el._vvBound && window.visualViewport) {
                    el._vvBound = true;
                    const vv = window.visualViewport;
                    el._vvFix = () => {
                        if (!el.classList.contains('pbc-fs')) { el.style.height = ''; return; }
                        el.style.height = Math.round(vv.height) + 'px';
                        const m = el.querySelector('.pbc-msgs');
                        if (m) m.scrollTop = m.scrollHeight;
                    };
                    vv.addEventListener('resize', el._vvFix);
                }
                if (el._vvFix) el._vvFix();
                if (fs) {
                    const closeBtn = el.querySelector('.pbc-close');
                    if (closeBtn && !closeBtn._bound) {
                        closeBtn._bound = true;
                        closeBtn.addEventListener('click', () => setMode('advanced'));
                    }
                    const inp = el.querySelector('.pbc-input-row textarea');
                    if (inp) setTimeout(() => inp.focus(), 150);
                }
                return fs;
            };
            const chatFs = applyFs(chatBody, isChat);
            const editFs = applyFs(editBody, isEditor);
            const anyChatOpen = isChat || isEditor;
            const anyFs = chatFs || editFs;
            // Chat open (any viewport): hide the floating support widget — it sat
            // exactly on top of the send button.
            document.body.classList.toggle('pbc-open', anyChatOpen);
            document.documentElement.style.overflow = anyFs ? 'hidden' : '';
            document.body.style.overflow = anyFs ? 'hidden' : '';
            // Desktop: the studio opens partly below the fold (composer hidden).
            // Bring the whole card into view.
            if (isChat && !chatFs) setTimeout(() => { try { chatBody.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }, 60);
            if (isEditor && !editFs) setTimeout(() => { try { editBody.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }, 60);
        }
        simpleBtn.addEventListener('click', () => setMode('simple'));
        chatBtn.addEventListener('click', () => setMode('chat'));
        editorBtn.addEventListener('click', () => setMode('editor'));
        advBtn.addEventListener('click', () => setMode('advanced'));

        // Default: existing customers with a prompt stay in Advanced; saved
        // builder state restores Simple; brand-new/empty prompts get Simple.
        loadPersonaForDisplay(agentId).then((persona) => {
            if (persona.prompt_builder && typeof persona.prompt_builder === 'object') {
                state = { ...DEFAULT_STATE, ...persona.prompt_builder };
                setMode('simple');
            } else if ((ta.value || '').trim()) {
                setMode('advanced');
            } else {
                setMode('simple');
            }
        }).catch(() => setMode((ta.value || '').trim() ? 'advanced' : 'simple'));
    }

    // ============================================================
    //   2) MODEL PICKER — owned by modules/model-picker.js now.
    //   The card UI this module used to render here hid the
    //   16-model catalog picker (persona-model-*) behind its own
    //   4 hardcoded cards, and wrote old-format ids nothing saves.
    //   Kept deliberately absent.
    // ============================================================

    // ============================================================
    //   3) MULTI-MODEL TEST BENCH (in the Test Chat Window)
    // ============================================================
    // A plan never asks the bench for a model it does not include (SPEC §8.7):
    // the free trial's default request carries none of the flagship models.
    // model-test refuses them on its own too; this keeps them off the screen.
    function planAllows(m) {
        const E = window.Entitlements;
        const rank = (E && E.data && typeof E.data.plan_rank === 'number') ? E.data.plan_rank : null;
        if (rank === null) return true;
        const cat = (window.DigitiviaModelPicker && window.DigitiviaModelPicker._catalog()) || [];
        const row = cat.find((c) => c.model_id === m.value);
        const need = row && row.min_plan_rank != null ? Number(row.min_plan_rank) : (m.badgeKind === 'premium' ? 1 : 0);
        return !(need > rank);
    }

    async function runBench(agentId, message, container) {
        const models = visibleModels().filter((m) => m.testId && planAllows(m)).map((m) => m.testId);
        const block = document.createElement('div');
        block.className = 'pb-bench';
        block.innerHTML = models.map((id) => `
<div class="pb-bench-card" data-bench-model="${id}">
  <div class="pb-bench-head"><span class="pb-bench-name">${esc((MODELS.find(m => m.testId === id) || {}).name ? MODELS.find(m => m.testId === id).name() : id)}</span>
  <span class="pb-bench-meta">${L('running…', 'جارٍ التنفيذ…')}</span></div>
  <div class="pb-bench-reply"></div>
</div>`).join('');
        container.appendChild(block);
        block.scrollIntoView({ block: 'nearest' });

        try {
            const session = (await window.supabaseClient.auth.getSession()).data.session;
            const headers = { 'Content-Type': 'application/json', 'apikey': window.SUPABASE_KEY };
            if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
            const ta = document.getElementById(`prompt-${agentId}`);
            const r = await fetch(MODEL_TEST_URL(), {
                method: 'POST', headers,
                body: JSON.stringify({
                    org_id: window.currentUserOrgId,
                    agent_id: agentId,
                    message,
                    system_prompt: ta ? ta.value : undefined,
                    models,
                }),
            });
            const j = await r.json();
            if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
            (j.results || []).forEach((res) => {
                const card = block.querySelector(`[data-bench-model="${res.model_id}"]`);
                if (!card) return;
                const meta = card.querySelector('.pb-bench-meta');
                const replyEl = card.querySelector('.pb-bench-reply');
                if (res.error === 'plan_locked') {
                    meta.textContent = L('Paid plans only', 'الخطط المدفوعة فقط');
                    replyEl.textContent = L('This model is available on paid plans.', 'الموديل ده متاح في الخطط المدفوعة.');
                    return;
                }
                if (res.error) {
                    meta.textContent = L('failed', 'فشل');
                    replyEl.innerHTML = `<span class="pb-bench-err">${esc(res.error)}</span>`;
                    return;
                }
                meta.textContent = `${(res.latency_ms / 1000).toFixed(1)}s · ${res.coins} ${L('coins', 'كوينز')}`;
                replyEl.setAttribute('dir', 'auto');
                replyEl.textContent = res.reply;
                const reg = MODELS.find((m) => m.testId === res.model_id);
                if (reg) {
                    const useBtn = document.createElement('button');
                    useBtn.type = 'button';
                    useBtn.className = 'lp-btn lp-btn-primary pb-bench-use';
                    useBtn.style.cssText = 'font-size:0.75rem;padding:5px 12px;';
                    useBtn.textContent = L('Use this model', 'استخدم هذا النموذج');
                    useBtn.addEventListener('click', () => {
                        if (window.DigitiviaModelPicker) {
                            window.DigitiviaModelPicker.setValue(`reply:${agentId}`, reg.value);
                            if (typeof window.checkDirty === 'function') window.checkDirty(agentId);
                            toast(L('Model selected. Press Save Role to publish.', 'تم اختيار النموذج. اضغط حفظ لنشره.'), 'success');
                        }
                    });
                    card.appendChild(useBtn);
                }
            });
        } catch (e) {
            block.querySelectorAll('.pb-bench-meta').forEach((m) => { m.textContent = L('failed', 'فشل'); });
            block.querySelectorAll('.pb-bench-reply').forEach((r2) => {
                r2.innerHTML = `<span class="pb-bench-err">${esc(e.message || e)}</span>`;
            });
        }
        block.scrollIntoView({ block: 'nearest' });
    }

    function enhanceTestChat(agentId) {
        const input = document.getElementById(`chat-input-${agentId}`);
        const history = document.getElementById(`chat-history-${agentId}`);
        if (!input || !history || input.dataset.pbEnhanced) return;
        input.dataset.pbEnhanced = '1';
        unclipSection(input);

        // The chat container is overflow:hidden with a fixed height — the
        // toggle must live BELOW it, never inside, or it gets clipped.
        const container = input.closest('.chat-container') || input.parentNode;
        const row = document.createElement('div');
        row.className = 'pb-compare-toggle';
        row.innerHTML = `
<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;min-width:0;">
  <input type="checkbox" id="pb-compare-${agentId}" style="accent-color:var(--theme-color);margin-block-start:2px;flex:none;">
  <span style="min-width:0;">
    <span style="display:block;font-size:0.82rem;color:var(--text-primary);">${L('Compare models', 'مقارنة النماذج')}</span>
    <span style="display:block;font-size:0.72rem;color:var(--text-secondary);">${L('One message, a real reply from each model with your data', 'رسالة واحدة ورد حقيقي من كل نموذج ببياناتك')}</span>
  </span>
</label>`;
        container.parentNode.insertBefore(row, container.nextSibling);
        const benchHost = document.createElement('div');
        benchHost.id = `pb-bench-host-${agentId}`;
        row.parentNode.insertBefore(benchHost, row.nextSibling);

        // Intercept Enter + the send path only when compare mode is ON.
        input.addEventListener('keypress', (ev) => {
            const cb = document.getElementById(`pb-compare-${agentId}`);
            if (!cb || !cb.checked) return;
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            const userDiv = document.createElement('div');
            userDiv.className = 'message msg-user';
            userDiv.setAttribute('dir', 'auto');
            userDiv.textContent = text;
            history.appendChild(userDiv);
            history.scrollTop = history.scrollHeight;
            // Results render BELOW the chat box in normal page flow — the
            // chat history is a small fixed-height scroll area on mobile.
            runBench(agentId, text, benchHost);
        }, true);
    }

    // ============================================================
    //   BOOT — observe the dynamically-rendered agent tabs
    // ============================================================
    function enhanceAll() {
        AGENT_IDS.forEach((id) => {
            if (!document.getElementById(id)) return;
            try { enhancePromptSection(id); } catch (e) { console.warn('[prompt-builder] prompt', id, e); }
            try { enhanceTestChat(id); } catch (e) { console.warn('[prompt-builder] bench', id, e); }
        });
    }
    function boot() {
        injectStyles();
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; enhanceAll(); }, 120);
        };
        (function attach() {
            const targets = AGENT_IDS.map((id) => document.getElementById(id)).filter(Boolean);
            if (!targets.length) return setTimeout(attach, 500);
            const obs = new MutationObserver(schedule);
            targets.forEach((t2) => obs.observe(t2, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] }));
            schedule();
        })();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
