// followup-ai.js: "Fixed message / AI-written" for each follow-up step on the Follow-ups page.
//
// Loaded as a classic script AFTER the main app script (same pattern as modules/agent-role.js and modules/test-chat-v2.js).
// It adds one control per step card, wrapping the page's own fuRenderSteps, and stores two optional keys on the step:
//   mode: 'ai'      and      ai_goal: 'what the owner wants this follow-up to do'
// A step without `mode` is exactly what it was before (a fixed message). The keys are written by fuSaveSettings in index.html.
//
// Offered only to workspaces the backend says have AI follow-ups (rpc followup_ai_status). Everyone else sees no change.
// The preview asks the followup-ai edge function for a sample text. It writes nothing, sends nothing and is not charged
// to the workspace. Every piece of text from the server is rendered with textContent.
(function () {
    'use strict';

    const sb = () => window.supabaseClient;
    const orgId = () => window.currentUserOrgId;
    const isAr = () => (localStorage.getItem('app_language') || 'en') === 'ar';
    const supaUrl = () => (sb() && sb().supabaseUrl) || window.SUPABASE_URL || '';
    const supaKey = () => window.SUPABASE_KEY || (sb() && sb().supabaseKey) || '';
    const AI_PLATFORMS = ['whatsapp', 'page', 'instagram'];

    const TXT = {
        en: {
            fixed: 'Fixed message',
            ai: 'AI-written',
            group: 'How this follow-up is written',
            help: 'The AI writes this follow-up from the conversation, in your agent\'s voice and language. It only uses facts from the chat and your catalogue. Your fixed message below is the fallback if the AI is unavailable or its text does not pass the safety checks.',
            goal: 'What should it do? (optional)',
            goalPh: 'For example: remind them about the product they asked about',
            scenario: 'Example conversation',
            sales: 'Sales',
            support: 'Customer service',
            preview: 'Preview AI text',
            previewing: 'Writing...',
            notCharged: 'A preview is not sent to anyone and is not charged to you.',
            lang: 'Language',
            ar: 'Arabic',
            en: 'English',
            rejected: 'The AI draft did not pass the safety checks, so a real follow-up would send your fixed message instead.',
            reasons: {
                ai_skipped: 'The AI decided a follow-up is not appropriate here.',
                'ai_invalid:invented_number': 'It contained a number that is not in the chat or your catalogue.',
                'ai_invalid:invented_link': 'It contained a link that is not in the chat or your catalogue.',
                'ai_invalid:claims_action': 'It claimed an order or booking was completed.',
                'ai_invalid:language': 'It was not in the right language.',
                'ai_invalid:too_long': 'It was too long for this channel.',
                'ai_invalid:repeats_earlier_followup': 'It repeated an earlier follow-up.',
                'ai_invalid:repeats_last_message': 'It repeated the last message.',
            },
            needFallback: 'Write a fixed message for each AI-written follow-up. It is sent if the AI is unavailable.',
            aiLang: 'Language',
            aiLangAuto: 'Match the customer',
            aiLangAr: 'Arabic',
            aiLangEn: 'English',
            aiLangHelp: 'The follow-up speaks the customer\'s language unless you fix it here.',
            previewTitle: 'Preview only',
            previewNote: 'This is a sample. Nothing was scheduled, nothing was sent, and nothing was charged.',
            executionOff: 'AI-written follow-ups are not switched on for sending yet. You can design and save them now; they will not be delivered until the switch is turned on.',
            stops: 'The AI stops the sequence when the customer replies, opts out, the order or booking is done, the issue is solved, the chat goes quiet, or a human takes over.',
            stopsTitle: 'When the AI stops',
            deliveryPaused: 'Automatic follow-up delivery is currently paused. You can design, save and preview follow-ups here, but nothing will be sent to customers until the pause is lifted.',
            errors: {
                unauthorized: 'Please sign in again and retry.',
                forbidden: 'You do not have access to this workspace.',
                feature_off: 'AI follow-ups are not enabled for your workspace yet.',
                rate_limited: 'Too many previews. Please wait a moment.',
                ai_not_available: 'AI is not available for your plan right now.',
                agent_not_configured: 'Set up this channel\'s agent first.',
                model_error: 'The AI did not answer. Try again in a moment.',
                network: 'Could not reach the server.',
                generic: 'Could not make a preview.',
            },
            note: 'AI-written follow-ups are in testing. The fixed message is always the safe fallback.',
        },
        ar: {
            fixed: 'رسالة ثابتة',
            ai: 'يكتبها الذكاء الاصطناعي',
            group: 'إزاي بتتكتب المتابعة دي',
            help: 'الذكاء الاصطناعي بيكتب المتابعة من المحادثة نفسها، بنفس أسلوب ولغة الـ agent بتاعك، وبيستخدم بس المعلومات اللي في الشات أو الكتالوج. الرسالة الثابتة اللي تحت هي البديل لو الذكاء الاصطناعي مش متاح أو النص ما عداش فحوصات الأمان.',
            goal: 'عايزها تعمل إيه؟ (اختياري)',
            goalPh: 'مثلاً: فكّره بالمنتج اللي سأل عنه',
            scenario: 'محادثة مثال',
            sales: 'مبيعات',
            support: 'خدمة عملاء',
            preview: 'جرّب نص الذكاء الاصطناعي',
            previewing: 'بيكتب...',
            notCharged: 'المعاينة مش بتتبعت لأي حد ومش بتتحاسب عليها.',
            lang: 'اللغة',
            ar: 'العربية',
            en: 'الإنجليزية',
            rejected: 'مسودة الذكاء الاصطناعي ما عدّتش فحوصات الأمان، فالمتابعة الحقيقية هتبعت رسالتك الثابتة بدالها.',
            reasons: {
                ai_skipped: 'الذكاء الاصطناعي شاف إن المتابعة هنا مش مناسبة.',
                'ai_invalid:invented_number': 'فيها رقم مش موجود في الشات أو الكتالوج.',
                'ai_invalid:invented_link': 'فيها لينك مش موجود في الشات أو الكتالوج.',
                'ai_invalid:claims_action': 'ادّعت إن طلب أو حجز اتم.',
                'ai_invalid:language': 'مش باللغة الصح.',
                'ai_invalid:too_long': 'طويلة على القناة دي.',
                'ai_invalid:repeats_earlier_followup': 'كررت متابعة سابقة.',
                'ai_invalid:repeats_last_message': 'كررت آخر رسالة.',
            },
            needFallback: 'اكتب رسالة ثابتة لكل متابعة بيكتبها الذكاء الاصطناعي. بتتبعت لو الذكاء الاصطناعي مش متاح.',
            aiLang: 'اللغة',
            aiLangAuto: 'زي العميل',
            aiLangAr: 'العربية',
            aiLangEn: 'الإنجليزية',
            aiLangHelp: 'المتابعة بتتكلم بلغة العميل إلا لو ثبّتها هنا.',
            previewTitle: 'معاينة فقط',
            previewNote: 'دي عيّنة. مفيش حاجة اتجدولت، ومفيش حاجة اتبعتت، ومفيش حاجة اتحسبت.',
            executionOff: 'متابعات الذكاء الاصطناعي لسه مش متفعّلة للإرسال. تقدر تصمّمها وتحفظها دلوقتي، وهتتبعت لما المفتاح يتشغّل.',
            stops: 'الذكاء الاصطناعي بيوقف السلسلة لما العميل يرد، أو يوقف استقبال الرسايل، أو الطلب/الحجز يخلص، أو المشكلة تتحل، أو السكوت يطوّل، أو حد من الفريق يتسلّم.',
            stopsTitle: 'الذكاء الاصطناعي بيقف إمتى',
            deliveryPaused: 'إرسال المتابعات الآلية متوقف حالياً. تقدر تصمّم المتابعات وتحفظها وتعاينها هنا، بس مش هتتبعت للعميل لحد ما التشغيل يرجع.',
            errors: {
                unauthorized: 'سجّل دخول تاني وجرّب.',
                forbidden: 'مفيش عندك صلاحية على مساحة العمل دي.',
                feature_off: 'متابعات الذكاء الاصطناعي لسه مش متفعّلة لمساحة عملك.',
                rate_limited: 'معاينات كتير. استنى شوية.',
                ai_not_available: 'الذكاء الاصطناعي مش متاح لباقتك دلوقتي.',
                agent_not_configured: 'جهّز الـ agent بتاع القناة دي الأول.',
                model_error: 'الذكاء الاصطناعي ما ردّش. جرّب كمان شوية.',
                network: 'مقدرتش أوصل للسيرفر.',
                generic: 'مقدرتش أعمل معاينة.',
            },
            note: 'متابعات الذكاء الاصطناعي لسه تحت الاختبار. الرسالة الثابتة هي البديل الآمن دايماً.',
        },
    };
    const T = () => TXT[isAr() ? 'ar' : 'en'];

    // ---- who may see it ---------------------------------------------------------------------------------
    let enabledFor = null; // org id the answer is for
    let enabled = false;      // the configuration UI is offered here
    let executionOn = false;  // the AI is actually allowed to send
    async function loadStatus() {
        const org = orgId();
        if (!org || !sb()) return false;
        if (enabledFor === org) return enabled;
        let on = false;
        try {
            const { data, error } = await sb().rpc('followup_ai_status', { p_org_id: org });
            on = !error && !!data && data.enabled === true;
        } catch (_) { on = false; }
        executionOn = on;
        // The configuration is offered when the workspace may run AI follow-ups
        // OR when the reviewer account may see the unfinished surface. Sending
        // stays behind the server flag either way — executionOn is the only
        // thing that decides that, and this file never changes it.
        const reviewer = !!(window.AgentStudio && window.AgentStudio.enabled);
        enabledFor = org; enabled = on || reviewer;
        return enabled;
    }

    const getSteps = () => { try { return Array.isArray(fuSteps) ? fuSteps : null; } catch (_) { return null; } }; // eslint-disable-line no-undef
    const el = (tag, attrs, text) => {
        const n = document.createElement(tag);
        if (attrs) for (const [k, v] of Object.entries(attrs)) { if (v !== undefined && v !== null) n.setAttribute(k, String(v)); }
        if (text !== undefined) n.textContent = text;
        return n;
    };

    function activePlatform() {
        for (const p of AI_PLATFORMS) {
            const box = document.getElementById('fu-ch-' + (p === 'page' ? 'page' : p));
            if (box && box.checked) return p;
        }
        return 'whatsapp';
    }

    // ---- the control on one step ----------------------------------------------------------------------
    function buildBox(i, step) {
        const t = T();
        const isAi = step.mode === 'ai';
        const box = el('div', { class: 'fuai-box', 'data-fuai-step': i });
        const group = el('div', { class: 'fuai-modes', role: 'group', 'aria-label': t.group });
        const mk = (mode, label) => {
            const b = el('button', { type: 'button', class: 'fuai-mode' + ((mode === 'ai') === isAi ? ' active' : ''), 'aria-pressed': (mode === 'ai') === isAi ? 'true' : 'false', 'data-mode': mode }, label);
            if (mode === 'ai' && i === 0) b.setAttribute('data-feature', 'followup-ai');
            b.addEventListener('click', () => setMode(i, mode));
            return b;
        };
        group.append(mk('fixed', t.fixed), mk('ai', t.ai));
        box.appendChild(group);
        if (!isAi) return box;

        box.appendChild(el('p', { class: 'fuai-help' }, t.help));
        const goalId = 'fuai-goal-' + i;
        box.appendChild(el('label', { class: 'fuai-label', for: goalId }, t.goal));
        const goal = el('input', { type: 'text', id: goalId, class: 'fuai-goal', maxlength: 200, placeholder: t.goalPh });
        goal.value = String(step.ai_goal || '');
        goal.addEventListener('input', () => { const s = getSteps(); if (s && s[i]) s[i].ai_goal = goal.value.slice(0, 200); });
        box.appendChild(goal);

        // Which language the follow-up speaks. "Match the customer" is the
        // default: the AI writes in the language the customer used.
        const langId = 'fuai-lang-' + i;
        const langRow = el('div', { class: 'fuai-row' });
        langRow.appendChild(el('label', { class: 'fuai-label', for: langId }, t.aiLang));
        const langSel = el('select', { id: langId, class: 'fuai-scn' });
        langSel.append(
            el('option', { value: 'auto' }, t.aiLangAuto),
            el('option', { value: 'ar' }, t.aiLangAr),
            el('option', { value: 'en' }, t.aiLangEn),
        );
        langSel.value = ['auto', 'ar', 'en'].indexOf(String(step.ai_lang || 'auto')) >= 0 ? String(step.ai_lang || 'auto') : 'auto';
        langSel.addEventListener('change', () => {
            const s = getSteps();
            if (s && s[i]) s[i].ai_lang = langSel.value;
        });
        langRow.appendChild(langSel);
        box.appendChild(langRow);
        box.appendChild(el('p', { class: 'fuai-small' }, t.aiLangHelp));

        const row = el('div', { class: 'fuai-row' });
        const selId = 'fuai-scn-' + i;
        row.appendChild(el('label', { class: 'fuai-label', for: selId }, t.scenario));
        const sel = el('select', { id: selId, class: 'fuai-scn' });
        sel.append(el('option', { value: 'sales' }, t.sales), el('option', { value: 'support' }, t.support));
        row.appendChild(sel);
        const btn = el('button', { type: 'button', class: 'fuai-preview' }, t.preview);
        row.appendChild(btn);
        box.appendChild(row);
        const out = el('div', { class: 'fuai-out', 'aria-live': 'polite' });
        box.appendChild(out);
        box.appendChild(el('p', { class: 'fuai-small' }, t.notCharged));
        // The preview is a sample, never a scheduled message. Saying so here
        // keeps nobody from reading it as "this will be sent".
        box.appendChild(el('p', { class: 'fuai-small' }, t.previewNote));
        // The stopping rules are part of the behaviour the owner is buying.
        const stops = el('details', { class: 'fuai-stops' });
        stops.appendChild(el('summary', {}, t.stopsTitle));
        stops.appendChild(el('p', { class: 'fuai-small' }, t.stops));
        box.appendChild(stops);
        // The switch that decides whether an AI-written follow-up is actually
        // delivered lives on the server. It is off, so the owner is told
        // plainly that designing a step does not schedule it.
        if (!executionOn) {
            box.appendChild(el('p', { class: 'fuai-note' }, t.executionOff));
        }        btn.addEventListener('click', () => runPreview(i, sel.value, btn, out, langSel.value));
        return box;
    }

    function setMode(i, mode) {
        const steps = getSteps();
        if (!steps || !steps[i]) return;
        try { fuCaptureStepMessages(); } catch (_) { /* keep what was typed if the page can */ } // eslint-disable-line no-undef
        if (mode === 'ai') {
            steps[i].mode = 'ai';
            if (typeof steps[i].ai_goal !== 'string') steps[i].ai_goal = '';
            if (typeof steps[i].ai_lang !== 'string') steps[i].ai_lang = 'auto';
        } else {
            delete steps[i].mode; delete steps[i].ai_goal; delete steps[i].ai_lang;
        }
        try { window.fuRenderSteps(); } catch (_) { /* nothing to redraw */ }
    }

    function decorate() {
        const steps = getSteps();
        if (!steps) return;
        steps.forEach((step, i) => {
            const card = document.getElementById('fu-step-card-' + i);
            if (!card) return;
            card.querySelectorAll(':scope > .fuai-box').forEach((n) => n.remove());
            if (!enabled && step.mode !== 'ai') return; // not offered here: the card is exactly what it was
            const anchor = card.querySelector('.fu-step-cum') || card.querySelector('.fu-step-wait');
            const box = buildBox(i, step);
            if (anchor && anchor.parentNode === card) anchor.after(box); else card.appendChild(box);
        });
        ensureNotice();
        try { if (typeof paintFeatureBadges === 'function') paintFeatureBadges(); } catch (_) { /* cosmetic */ } // eslint-disable-line no-undef
    }

    // The page's beta sentence (the feature registry says this feature is still in testing), only where it exists.
    // During the review phase the state is explained where it matters — inside
    // the AI control, next to the step it belongs to — so the page does not
    // carry a banner about it.
    function ensureNotice() {
        const page = document.getElementById('followups');
        if (!page) return;
        const host = page.querySelector(':scope > [data-feature-notice="followup-ai"]');
        if (host) host.remove();
        paintDeliveryPausedNotice(page);
    }

    // Delivery is paused by a server-side switch, and the workspace's own
    // follow-up setting says so: followup_settings.enabled = false. The page
    // says it plainly, because a saved configuration that will not be sent is
    // the thing an owner most needs to know while the pause is in force.
    const PAUSE_NOTICE_ID = 'fuai-delivery-paused';
    async function paintDeliveryPausedNotice(page) {
        try {
            const org = orgId();
            if (!org || !sb()) return;
            const { data } = await sb().from('followup_settings')
                .select('enabled').eq('org_id', org).maybeSingle();
            const paused = !data || data.enabled !== true;
            let node = document.getElementById(PAUSE_NOTICE_ID);
            if (!paused) { if (node) node.remove(); return; }
            if (!node) {
                node = el('div', { id: PAUSE_NOTICE_ID, class: 'fuai-paused-notice', role: 'status' });
                page.insertBefore(node, page.firstChild);
            }
            node.textContent = T().deliveryPaused;
        } catch (_) { /* the page still works without the notice */ }
    }

    // ---- preview -------------------------------------------------------------------------------------
    async function runPreview(i, scenario, btn, out, lang) {
        const t = T();
        const steps = getSteps();
        if (!steps || !steps[i]) return;
        out.replaceChildren();
        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = t.previewing;
        try {
            const { data } = await sb().auth.getSession();
            const token = data && data.session && data.session.access_token;
            if (!token) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
            const res = await fetch(supaUrl() + '/functions/v1/followup-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: supaKey() },
                body: JSON.stringify({
                    action: 'preview', org_id: orgId(), platform: activePlatform(), scenario,
                    step_number: i + 1, ai_goal: String(steps[i].ai_goal || '').slice(0, 200),
                    language: lang || 'auto',
                }),
            });
            let body = null;
            try { body = await res.json(); } catch (_) { body = null; }
            if (!res.ok || !body || body.ok !== true) {
                const code = (body && body.error) || (res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 429 ? 'rate_limited' : 'generic');
                throw Object.assign(new Error(code), { code, retry: body && body.retry_after });
            }
            const bubble = el('div', { class: 'fuai-bubble', dir: body.language === 'ar' ? 'rtl' : 'ltr' });
            bubble.textContent = String(body.text || '');
            out.appendChild(bubble);
            out.appendChild(el('div', { class: 'fuai-small' }, t.lang + ': ' + (body.language === 'ar' ? t.ar : t.en)));
            // The sample is clearly a sample: not scheduled, not sent, not charged.
            out.appendChild(el('div', { class: 'fuai-preview-tag' }, t.previewTitle));
            if (body.valid === false) {
                const why = (t.reasons && t.reasons[body.reason]) || '';
                out.appendChild(el('div', { class: 'fuai-warn' }, t.rejected + (why ? ' ' + why : '')));
            }
        } catch (e) {
            const code = e && e.code ? e.code : (e instanceof TypeError ? 'network' : 'generic');
            let msg = (t.errors && t.errors[code]) || t.errors.generic;
            if (code === 'rate_limited' && e.retry) msg += ' (' + Math.ceil(Number(e.retry)) + 's)';
            out.appendChild(el('div', { class: 'fuai-warn', role: 'alert' }, msg));
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    }

    // ---- styles -------------------------------------------------------------------------------------
    function injectStyle() {
        if (document.getElementById('fuai-style')) return;
        const css = `
.fuai-box{margin:10px 0 4px;padding:10px 12px;border:1px solid var(--border-color,rgba(128,128,128,.3));border-radius:10px;background:var(--card-bg,transparent)}
.fuai-modes{display:inline-flex;flex-wrap:wrap;gap:6px}
.fuai-mode{min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:transparent;color:inherit;font:inherit;cursor:pointer}
.fuai-mode.active{background:var(--accent,#2f6bff);border-color:var(--accent,#2f6bff);color:#fff}
.fuai-help,.fuai-small{font-size:.78rem;opacity:.75;margin:8px 0 0;line-height:1.5}
.fuai-preview-tag{display:inline-block;margin-top:8px;font-size:.68rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);border:1px solid rgba(127,127,127,.3);opacity:.9}
.fuai-note{margin:10px 0 0;font-size:.76rem;line-height:1.55;padding:9px 11px;border-radius:10px;background:rgba(217,164,65,.12);border:1px solid rgba(217,164,65,.34);color:inherit}
.fuai-paused-notice{margin:0 0 14px;padding:11px 14px;border-radius:12px;font-size:.82rem;line-height:1.6;background:rgba(217,164,65,.12);border:1px solid rgba(217,164,65,.4);color:inherit}
.fuai-stops{margin:10px 0 0}
.fuai-stops>summary{cursor:pointer;list-style:none;font-size:.76rem;font-weight:600;opacity:.85;display:flex;align-items:center;gap:6px;user-select:none}
.fuai-stops>summary::-webkit-details-marker{display:none}
.fuai-stops>summary::before{content:"\\25B8";transition:transform .15s ease;font-size:.66rem}
.fuai-stops[open]>summary::before{transform:rotate(90deg)}
[dir="rtl"] .fuai-stops[open]>summary::before{transform:rotate(-90deg)}
.fuai-label{display:block;font-size:.8rem;margin:10px 0 4px;opacity:.85}
.fuai-goal{width:100%;box-sizing:border-box;min-height:38px;padding:6px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:transparent;color:inherit;font:inherit}
.fuai-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px}
.fuai-row .fuai-label{margin:0}
.fuai-scn{min-height:36px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:transparent;color:inherit;font:inherit;padding:0 8px}
.fuai-preview{min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid var(--accent,#2f6bff);background:transparent;color:inherit;font:inherit;cursor:pointer}
.fuai-preview:disabled{opacity:.6;cursor:progress}
.fuai-out{margin-top:8px}
.fuai-bubble{display:inline-block;max-width:100%;padding:8px 12px;border-radius:12px;background:var(--accent-soft,rgba(47,107,255,.12));line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.fuai-warn{margin-top:6px;font-size:.8rem;color:var(--warning,#b45309)}
@media (max-width:480px){.fuai-row{flex-direction:column;align-items:stretch}.fuai-modes{display:flex}.fuai-mode{flex:1 1 100%}}`;
        const s = el('style', { id: 'fuai-style' });
        s.textContent = css;
        document.head.appendChild(s);
    }

    // ---- stop reasons the page shows in its queue and log -----------------------------------------------
    function addStopReasons() {
        try {
            const r = FU_STOP_REASONS; // eslint-disable-line no-undef
            const add = (k, en, ar) => { if (!r[k]) r[k] = { en, ar }; };
            add('ai_skipped', 'the AI judged that a follow-up is not appropriate here', 'الذكاء الاصطناعي شاف إن المتابعة هنا مش مناسبة');
            add('human_replied', 'a teammate answered the customer', 'حد من الفريق رد على العميل');
            add('delivery_failed', 'WhatsApp could not deliver the message', 'واتساب مقدرش يوصّل الرسالة');
        } catch (_) { /* the page's vocabulary is not there yet: the raw reason is shown, as before */ }
    }

    // ---- wiring -------------------------------------------------------------------------------------
    function wrapRender() {
        if (typeof window.fuRenderSteps !== 'function' || window.fuRenderSteps.__fuai) return;
        const orig = window.fuRenderSteps;
        const wrapped = function () {
            const r = orig.apply(this, arguments);
            try { decorate(); } catch (e) { console.warn('followup-ai', e); }
            if (enabledFor !== orgId()) loadStatus().then(() => { try { decorate(); } catch (e) { console.warn('followup-ai', e); } });
            return r;
        };
        wrapped.__fuai = true;
        window.fuRenderSteps = wrapped;
    }

    function init() {
        injectStyle();
        addStopReasons();
        wrapRender();
        loadStatus().then(() => { try { decorate(); } catch (e) { console.warn('followup-ai', e); } });
        // The studio answers the server's access question a moment later than
        // this module starts. When it has an answer we may show the
        // configuration controls too.
        window.addEventListener('agent-studio:decided', () => {
            enabledFor = null;   // ask again, now that the studio has decided
            loadStatus().then(() => { try { decorate(); } catch (e) { console.warn('followup-ai', e); } });
        });
    }

    window.fuAiRefresh = init;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
