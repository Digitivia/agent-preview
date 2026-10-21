// agent-studio.js — the integrated AI Agent Upgrade experience.
//
// This is the single owner of the new configuration surface inside the real
// dashboard. It is NOT a separate app: it mounts into the existing agent
// configuration tabs (the same `.agent-role-slot` the old role picker used, the
// same Advanced Prompt section, the same Save button) and it writes through the
// same authorised backend the rest of the dashboard uses.
//
// ---------------------------------------------------------------------------
// What the backend gives us (all of it already exists in the live project)
// ---------------------------------------------------------------------------
//   rpc agent_upgrade_access()            -> { enabled }  server-side gate:
//                                              the caller is authenticated and
//                                              the email is on the allowlist.
//   rpc get_agent_studio(org, agent)       -> { persona, version, business,
//                                              can_edit, effective }
//   rpc save_agent_studio(org, agent,      -> { ok, version, saved_at,
//            changes, expected_version)        changed_keys }  atomic save with
//                                              optimistic concurrency: a stale
//                                              browser cannot overwrite a newer
//                                              saved version.
//   rpc resolve_agent_prompt(org, agent)   -> { text, source, sections[] }
//                                              THE authoritative prompt
//                                              composition pipeline. Every
//                                              layer arrives with its number
//                                              and its origin, so the UI can
//                                              explain where each instruction
//                                              came from.
//   rpc list_agent_versions / get_agent_version / restore_agent_version
//   rpc followup_ai_status(org)            -> { mode, enabled }
//
// The layered persona (persona.layers, schema v2) is the single source of truth:
//
//   enabled        bool          turn the layered composer on for this agent
//   primary        sales|support the agent's main job
//   capabilities   []            sales is always present; booking only when a
//                                calendar is actually connected
//   knowledge.policies  string   layer 3 — business knowledge and policies
//   style.preset   consultative|friendly|professional|persuasive|luxury
//   style.length   short|medium|detailed
//   style.initiative  low|balanced|high
//   style.followup light|balanced|persistent
//   inherit_base   bool          false drops the platform base persona
//   ack            []            conflict resolutions the owner has chosen
//
// The six conceptual layers the UI shows map onto the backend like this:
//
//   1 Base Agent Persona ........ identity + base            (platform)
//   2 Selected Capabilities ..... capabilities               (studio)
//   3 Business Knowledge ........ knowledge                   (studio)
//   4 Personality & Style ....... style                      (studio)
//   5 Customer Instructions ..... system_prompt              (owner)
//   6 Effective Final Prompt .... the composed text           (all of them)
//
// Layer 5 lives in the `agent_configs.system_prompt` column, which is exactly
// where the existing Advanced Prompt / AI Chat Builder / AI Chat Editor write.
// That is why editing in one place never erases another: the guided setup
// writes layers 2-4, the free-text editor writes layer 5, and the server
// composes them. Nothing overwrites anybody.
//
// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
// The new UI only appears for accounts the server says may use it. The check is
// `rpc agent_upgrade_access`, which reads the caller's authenticated identity
// (auth.uid()/jwt) — not an email typed into the page. Every write goes
// through RLS-protected tables and RPCs, so the workspace, the agent and the
// permission are all decided by the database, never by the browser.
(function () {
    'use strict';

    // The other modules wait for this flag before they paint, so the slot is
    // never claimed twice while the access answer is still in flight.
    window.AgentStudioPending = true;

    const AGENT_IDS = ['website', 'whatsapp', 'page', 'instagram', 'telegram'];

    const lang = () => ((localStorage.getItem('app_language') || 'en') === 'ar' ? 'ar' : 'en');

    const TXT = {
        en: {
            caps_title: 'What this agent can do',
            caps_sub: 'Choose one or more. Sales is the base every agent starts from; add the rest and the agent will recognise when each one applies.',
            primary_label: 'Main job',
            primary_sales: 'Sales Agent',
            primary_support: 'Customer Service',
            primary_hint: 'The main job decides the agent\'s default behaviour. The rest are used when the customer\'s need calls for them.',
            style_title: 'How it talks',
            style_preset: 'Style',
            style_length: 'Reply length',
            style_initiative: 'Initiative',
            style_followup: 'Follow-up behaviour',
            knowledge_title: 'Business knowledge and policies',
            knowledge_ph: 'Delivery areas, returns, working hours, offers, anything the agent should know and never guess.',
            knowledge_hint: 'Written once, used by the agent and by every AI-written follow-up.',
            eff_title: 'Effective prompt',
            eff_note: 'This is exactly what the agent is told. Each block shows where it comes from.',
            eff_show: 'Show', eff_hide: 'Hide', eff_refresh: 'Refresh',
            layer_base: 'Base persona',
            layer_caps: 'Capabilities',
            layer_knowledge: 'Business knowledge',
            layer_style: 'Personality and style',
            layer_custom: 'Your instructions',
            layer_guards: 'Safety rules',
            layer_identity: 'Identity',
            layer_standard: 'Standard instructions',
            src_platform: 'From Digitivia', src_studio: 'Yours', src_owner: 'Yours', src_owner_warn: 'Your instructions',
            unsaved: 'unsaved changes', saved: 'Saved', saving: 'Saving…', failed: 'Save failed',
            save_now: 'Save changes', discard: 'Discard', retry: 'Retry',
            saved_at: 'saved', versions: 'Version history', version: 'Version', no_versions: 'No saved versions yet.',
            restore: 'Restore this version', compare: 'Compare', close: 'Close', cancel: 'Cancel',
            restore_confirm: 'Restore this version? Your current configuration is kept as a version first, so nothing is lost.',
            restored: 'Version restored.',
            stale: 'Someone saved a newer version. Reload the agent to see it before saving again.',
            no_perm: 'You do not have permission to configure agents.',
            conflict_title: 'This may conflict with the base persona',
            conflict_body: 'Your own instructions say something the base persona would disagree with. Choose how to resolve it — nothing is changed until you do.',
            conflict_keep: 'Keep the base and add mine',
            conflict_only: 'Use only my instructions',
            conflict_dismiss: 'Keep both for now',
            conflict_resolved: 'Resolved. You can change this any time.',
            booking_need: 'Connect Google Calendar to use appointments.',
            booking_connect: 'Connect calendar',
            sales_always: 'Always on — the base every agent starts from',
            new_default: 'A new agent starts as a Sales Agent. Change it whenever you like.',
            legacy_note: 'This agent still runs on the standard instructions for its role. The first change you save here switches it to your own configuration.',
            cal_connected: 'Calendar connected — appointments are available.',
            inherited: 'Inherited', added: 'Added by you', customised: 'Changed by you',
            empty_layers: 'Nothing configured yet.',
            diff_same: 'No differences.',
            restore_done: 'Restored.',
            err_save: 'Could not save. Your changes are still here — try again.',
            err_load: 'Could not load the agent configuration.',
        },
        ar: {
            caps_title: 'الإيجنت ده هيعمل إيه؟',
            caps_sub: 'اختار واحدة أو أكتر. المبيعات هي الأساس اللي كل إيجنت بيبدأ منه، والباقي بيُستخدَم لما حاجة العميل تستدعيه.',
            primary_label: 'الشغل الأساسي',
            primary_sales: 'مندوب مبيعات',
            primary_support: 'خدمة عملاء',
            primary_hint: 'الشغل الأساسي بيحدد السلوك الافتراضي للإيجنت. الباقي بيتستخدم لما حاجة العميل تستدعيه.',
            style_title: 'إزاي بيتكلم',
            style_preset: 'الأسلوب',
            style_length: 'طول الرد',
            style_initiative: 'المبادرة',
            style_followup: 'المتابعة بعد الصمت',
            knowledge_title: 'معرفة النشاط والسياسات',
            knowledge_ph: 'مناطق التوصيل، الاسترجاع، مواعيد العمل، العروض، وأي حاجة المفروض الإيجنت يعرفها ومتخترعش.',
            knowledge_hint: 'بتتكتب مرة واحدة، وبتستخدمها الإيجنت وكل متابعة تكتبها بالذكاء الاصطناعي.',
            eff_title: 'الأوامر الفعلية',
            eff_note: 'دي بالظبط اللي بتتقال للإيجنت. كل جزء بيوضح جاي منين.',
            eff_show: 'إظهار', eff_hide: 'إخفاء', eff_refresh: 'تحديث',
            layer_base: 'الشخصية الأساسية',
            layer_caps: 'القدرات',
            layer_knowledge: 'معرفة النشاط',
            layer_style: 'الشخصية والأسلوب',
            layer_custom: 'تعليماتك',
            layer_guards: 'قواعد الأمان',
            layer_identity: 'الهوية',
            layer_standard: 'التعليمات القياسية',
            src_platform: 'من ديجيتيفيا', src_studio: 'منك', src_owner: 'منك', src_owner_warn: 'تعليماتك',
            unsaved: 'تغييرات مش متحفوظة', saved: 'اتحفظ', saving: 'بنحفظ…', failed: 'الحفظ فشل',
            save_now: 'احفظ التغييرات', discard: 'تراجع', retry: 'جرّب تاني',
            saved_at: 'اتحفظ', versions: 'تاريخ الإصدارات', version: 'إصدار', no_versions: 'مفيش إصدارات متحفوظة بعد.',
            restore: 'استرجع الإصدار ده', compare: 'قارن', close: 'إقفل', cancel: 'إلغاء',
            restore_confirm: 'ترجع للإصدار ده؟ الإعداد الحالي بتاعك يتحفظ كإصدار الأول، فمفيش حاجة هتضيع.',
            restored: 'الإصدار اترجّع.',
            stale: 'حد تاني حفظ إصدار أحدث. اعمل تحديث للإيجنت قبل ما تحفظ تاني.',
            no_perm: 'مفيش صلاحية عندك تضبط الإيجنت.',
            conflict_title: 'ممكن يتعارض مع الشخصية الأساسية',
            conflict_body: 'تعليماتك بتقول حاجة الشخصية الأساسية كانت هتخالفها. اختار إزاي نحلها — مفيش حاجة هتتغير غير لما تختار.',
            conflict_keep: 'سيب الأساسية وزوّد عليه تعليماتك',
            conflict_only: 'اعتمد تعليماتي بس',
            conflict_dismiss: 'سيب الاتنين دلوقتي',
            conflict_resolved: 'اتحل. تقدر تغيّره في أي وقت.',
            booking_need: 'اربط Google Calendar عشان تستخدم المواعيد.',
            booking_connect: 'اربط التقويم',
            sales_always: 'دايماً شغّال — الأساس اللي كل إيجنت بيبدأ منه',
            new_default: 'الإيجنت الجديد بيبدأ مندوب مبيعات. غيّره في أي وقت.',
            legacy_note: 'الإيجنت ده لسه شغال بالتعليمات القياسية لدوره. أول تغيير تحفظه هنا بيحوّله لإعدادك إنت.',
            cal_connected: 'التقويم متربّط — المواعيد متاحة.',
            inherited: 'موروث', added: 'ضيفته انت', customised: 'غيّرته انت',
            empty_layers: 'لسه مفيش إعدادات.',
            diff_same: 'مفيش اختلاف.',
            restore_done: 'اترجّع.',
            err_save: 'مقدرناش نحفظ. تغييراتك لسه موجودة — جرّب تاني.',
            err_load: 'مقدرناش نحمّل إعداد الإيجنت.',
        },
    };
    const T = (k) => (TXT[lang()][k] != null ? TXT[lang()][k] : (TXT.en[k] || k));

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const sb = () => window.supabaseClient;
    const orgId = () => window.currentUserOrgId;
    const canEdit = () => (typeof window.hasPermission === 'function' ? !!window.hasPermission('agents.configure') : true);
    const isAr = () => lang() === 'ar';

    // ---- capability / style metadata -----------------------------------------
    // The server is the authority on what is allowed (public.agent_capability_catalog
    // strips a capability the workspace cannot use). The labels live here so the
    // page can render before the catalogue round-trip finishes.
    const CAP_META = {
        sales: { icon: 'M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 2v2h2l3.6 7.6-1.4 2.4A2 2 0 0 0 7 17h12v-2H7.4l1.1-2h7.5a2 2 0 0 0 1.7-1l3.6-6.5A2 2 0 0 0 20.4 4H5.2l-.9-2H1z' },
        support: { icon: 'M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1v1a2 2 0 0 1-2 2h-3v2h3a4 4 0 0 0 4-4v-1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z' },
        recommend: { icon: 'M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z' },
        lead: { icon: 'M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h8v-2.5c0-1 .5-1.9 1.3-2.6A10 10 0 0 0 8 13zm8 0c-.3 0-.6 0-1 .1 1 .8 1.6 1.9 1.6 3.4V19H23v-2.5c0-2.3-4.7-3.5-7-3.5z' },
        faq: { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2zm2.1-7.7-.9.9c-.7.7-1.2 1.3-1.2 2.8h-2v-.5c0-1.1.4-2.1 1.2-2.8l1.2-1.3a2 2 0 1 0-3.4-2z' },
        booking: { icon: 'M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V9h14z' },
    };
    const CAP_LABEL = {
        en: {
            sales: ['Sales', 'Helps customers choose and buy.'],
            support: ['Customer service', 'Solves problems and answers order questions.'],
            recommend: ['Product recommendations', 'Suggests the right product for the need.'],
            lead: ['Lead qualification', 'Collects contact details and qualifies the interest.'],
            faq: ['FAQs and knowledge', 'Answers from your business knowledge and policies.'],
            booking: ['Appointment booking', 'Books into a connected calendar.'],
        },
        ar: {
            sales: ['المبيعات', 'يساعد العميل يختار ويشتري.'],
            support: ['خدمة العملاء', 'بيحل المشاكل وبيجاوب على استفسارات الطلبات.'],
            recommend: ['توصية بالمنتجات', 'يقترح المنتج المناسب للحاجة.'],
            lead: ['تأهيل العملاء المحتملين', 'بيجمع بيانات العميل وبيقيّم الاهتمام.'],
            faq: ['الأسئلة الشائعة والمعرفة', 'بيجاوب من معرفة نشاطك وسياساته.'],
            booking: ['حجز المواعيد', 'بيحجز في تقويم متصل.'],
        },
    };
    const PRESET_LABEL = {
        en: { consultative: 'Consultative', friendly: 'Friendly', professional: 'Professional', persuasive: 'Persuasive', luxury: 'Premium' },
        ar: { consultative: 'استشاري', friendly: 'ودود', professional: 'مهني', persuasive: 'مقنع', luxury: 'فاخر' },
    };
    const LENGTH_LABEL = { en: { short: 'Short', medium: 'Medium', detailed: 'Detailed' }, ar: { short: 'مختصر', medium: 'متوسط', detailed: 'مفصّل' } };
    const INITIATIVE_LABEL = { en: { low: 'Reactive', balanced: 'Balanced', high: 'Proactive' }, ar: { low: 'متفاعل', balanced: 'متوازن', high: 'مبادر' } };
    const FOLLOWUP_LABEL = { en: { light: 'Light', balanced: 'Balanced', persistent: 'Persistent' }, ar: { light: 'خفيف', balanced: 'متوازن', persistent: 'مثابر' } };
    const LAYER_LABEL = {
        en: { identity: 'Identity', base: 'Base persona', capabilities: 'Capabilities', knowledge: 'Business knowledge', style: 'Personality and style', custom: 'Your instructions', guards: 'Safety rules' },
        ar: { identity: 'الهوية', base: 'الشخصية الأساسية', capabilities: 'القدرات', knowledge: 'معرفة النشاط', style: 'الشخصية والأسلوب', custom: 'تعليماتك', guards: 'قواعد الأمان' },
    };
    const LAYER_ORIGIN = {
        en: { platform: 'From Digitivia', studio: 'Set by you', owner: 'Your instructions' },
        ar: { platform: 'من ديجيتيفيا', studio: 'من إعداداتك', owner: 'تعليماتك' },
    };

    // The capabilities the server can offer. `booking` is only offered when a
    // calendar is really connected — the server strips it otherwise, so asking
    // for it would silently do nothing.
    let allowedCaps = ['sales', 'support', 'recommend', 'lead', 'faq'];

    // ---- state ---------------------------------------------------------------
    const state = {};      // agent -> { version, savedAt, persona, layers, effective, dirty, saving, error, diffs }
    let enabled = false;
    let accessChecked = false;

    function st(agent) {
        if (!state[agent]) {
            state[agent] = {
                version: 0, savedAt: null, persona: {}, layers: null, effective: null,
                dirty: false, saving: false, error: null, savedPrompt: '', savedTone: '',
                savedPersona: '', conflicts: [], calendar: null, loading: true,
            };
        }
        return state[agent];
    }

    function defaultLayers() {
        return {
            v: 2, enabled: true, primary: 'sales', capabilities: ['sales'],
            knowledge: { policies: '' }, style: { preset: null, length: 'short', initiative: 'balanced', followup: 'balanced' },
            inherit_base: true, ack: [],
        };
    }

    // ---- data ----------------------------------------------------------------
    async function rpc(name, args) {
        const { data, error } = await sb().rpc(name, args);
        if (error) { const e = new Error(error.message || 'rpc_error'); e.code = error.code; e.rpc = name; throw e; }
        return data;
    }

    async function checkAccess() {
        if (accessChecked) return enabled;
        accessChecked = true;
        try {
            const r = await rpc('agent_upgrade_access', {});
            enabled = !!(r && r.enabled);
        } catch (e) {
            enabled = false;
        }
        return enabled;
    }

    // Tell the rest of the page that the question has been answered, so the
    // modules that were waiting can either paint or stay out of the way.
    function announceDecision() {
        window.AgentStudioPending = false;
        try { window.dispatchEvent(new CustomEvent('agent-studio:decided', { detail: { enabled } })); } catch (e) { /* ignore */ }
    }

    async function loadAgent(agent) {
        const s = st(agent);
        s.loading = true;
        try {
            const [studio, effective, row] = await Promise.all([
                rpc('get_agent_studio', { p_org_id: orgId(), p_agent: agent }),
                rpc('resolve_agent_prompt', { p_org_id: orgId(), p_agent: agent, p_include_guards: true }),
                // The saved text and tone live in the agent row; the studio RPC
                // returns the layers and the version, not the raw prompt.
                sb().from('agent_configs').select('system_prompt, tone, persona').eq('org_id', orgId()).eq('agent', agent).maybeSingle()
                    .then((r) => r && r.data).catch(() => null),
            ]);
            s.version = (studio && studio.version) || 0;
            s.persona = (studio && studio.persona) || {};
            s.layers = normaliseLayers(s.persona.layers, s.persona);
            s.__savedLayers = normaliseLayers(s.persona.layers, s.persona);
            s.effective = effective || null;
            s.savedPrompt = (row && typeof row.system_prompt === 'string') ? row.system_prompt : '';
            s.savedTone = (row && typeof row.tone === 'string') ? row.tone : '';
            s.savedPersona = JSON.stringify(s.persona || {});
            // An agent nobody has configured yet: no role, no layers, no prompt.
            // Those are the agents that start as a Sales Agent.
            s.isNew = !s.persona.layers && !s.persona.role && !String(s.savedPrompt || '').trim();
            s.error = null;
        } catch (e) {
            s.error = e;
        } finally {
            s.loading = false;
        }
        return s;
    }

    // The server normalises; we mirror it so the UI never shows a value the
    // backend would silently rewrite.
    //
    // An agent that was never configured through the studio has no `layers`
    // block at all: it runs on the legacy path, where the role alone decides
    // the persona. For those we mirror what is stored instead of inventing a
    // layer configuration, so opening the page never changes how the agent
    // behaves. The first deliberate edit here turns the layered composer on.
    function normaliseLayers(raw, persona) {
        const d = defaultLayers();
        if (!raw || typeof raw !== 'object') {
            const role = (persona && persona.role === 'support') ? 'support' : 'sales';
            d.primary = role;
            d.capabilities = role === 'support' ? ['sales', 'support'] : ['sales'];
            d.enabled = false;          // the layered composer is not on for this agent yet
            d.legacy = true;
            return d;
        }
        const out = { ...d, ...raw };
        out.style = { ...d.style, ...(raw.style || {}) };
        out.knowledge = { ...d.knowledge, ...(raw.knowledge || {}) };
        out.capabilities = Array.isArray(raw.capabilities) && raw.capabilities.length ? raw.capabilities.slice() : ['sales'];
        if (out.capabilities.indexOf('sales') === -1) out.capabilities.unshift('sales');
        out.capabilities = out.capabilities.filter((c) => allowedCaps.indexOf(c) !== -1 || c === 'sales');
        if (['sales', 'support'].indexOf(out.primary) === -1) out.primary = 'sales';
        if (out.capabilities.indexOf(out.primary) === -1) out.capabilities.push(out.primary);
        out.ack = Array.isArray(raw.ack) ? raw.ack.slice() : [];
        out.enabled = raw.enabled !== false;
        out.inherit_base = raw.inherit_base !== false;
        out.v = raw.v || 2;
        out.legacy = !out.enabled;
        return out;
    }

    // ---- capability availability ---------------------------------------------
    let calendar = { connected: false, checked: false };

    async function loadCapabilities() {
        // The catalogue RPC is platform-staff only, so availability is derived
        // from what this workspace can actually do. The server still strips
        // anything we get wrong, so this only affects what we offer.
        try {
            calendar = Object.assign({ checked: true }, await calendarStatus());
        } catch (e) {
            calendar = { connected: false, checked: true };
        }
        allowedCaps = ['sales', 'support', 'recommend', 'lead', 'faq'];
        if (calendar.connected) allowedCaps.push('booking');
        return allowedCaps;
    }

    async function calendarStatus() {
        if (typeof window.checkGoogleCalendarStatus === 'function') {
            try { return await window.checkGoogleCalendarStatus(); } catch (e) { return { connected: false }; }
        }
        return { connected: false };
    }

    // ---- conflict detection ---------------------------------------------------
    // Layer 5 (the owner's own instructions) is free text. When it contradicts
    // the base persona we do not silently pick a winner: we show the conflict
    // and let the owner decide, then remember the decision in layers.ack.
    const CONFLICT_PATTERNS = [
        /\byou\s+are\s+(not|no\s+longer)\b/i,
        /\b(ignore|disregard|forget)\s+(your|the|all)\s+(role|rules|instructions|persona|system)\b/i,
        /\bact\s+as\s+(a|an)\b/i,
        /\byour\s+(job|role|purpose)\s+is\b/i,
        /\bdo\s+not\s+(act|be)\s+as\b/i,
        /\bnever\s+(act|be)\s+as\b/i,
        /انت\s+(مش|مش)\s+/,
        /لست\s+/,
        /تجاهل\s+(دورك|الشخصية|التعليمات)/,
        /اتصرف\s+كأنك/,
        /مهمتك\s+/,
        /لا\s+تكون\s+/,
    ];

    function detectConflicts(agent) {
        const s = st(agent);
        const prompt = currentPrompt(agent);
        if (!prompt || !prompt.trim()) return [];
        const hits = [];
        CONFLICT_PATTERNS.forEach((rx) => { if (rx.test(prompt)) hits.push(rx.source); });
        if (!hits.length) return [];
        if (!s.layers || s.layers.inherit_base === false) return [];   // already resolved: owner only
        if ((s.layers.ack || []).indexOf('conflict:base_role') !== -1) return [];   // already decided
        return hits;
    }

    function currentPrompt(agent) {
        const el = document.getElementById('prompt-' + agent);
        return el ? el.value : (st(agent).savedPrompt || '');
    }

    function currentTone(agent) {
        const el = document.getElementById('tone-' + agent);
        return el ? el.value : (st(agent).savedTone || '');
    }

    // ---- save ----------------------------------------------------------------
    function collectChanges(agent) {
        const s = st(agent);
        const changes = {};
        const prompt = currentPrompt(agent);
        const tone = currentTone(agent);
        if (prompt !== s.savedPrompt) changes.system_prompt = prompt;
        if (tone !== s.savedTone) changes.tone = tone;
        const persona = { role: s.layers.primary };
        // Only send the layer block when it differs from what is stored, so a
        // plain prompt edit never rewrites the capability configuration.
        if (JSON.stringify(s.layers) !== JSON.stringify(s.__savedLayers)) {
            persona.layers = s.layers;
        }
        if (Object.keys(persona).length) changes.persona = persona;
        return changes;
    }

    async function save(agent, opts) {
        const s = st(agent);
        if (!canEdit()) { s.error = new Error(T('no_perm')); render(agent); return false; }
        s.saving = true;
        s.error = null;
        render(agent);
        const changes = collectChanges(agent);
        try {
            const res = await rpc('save_agent_studio', {
                p_org_id: orgId(),
                p_agent: agent,
                p_changes: changes,
                p_expected_version: s.version,
                p_note: (opts && opts.note) || '',
            });
            s.version = (res && res.version) || s.version;
            s.savedAt = (res && res.saved_at) || new Date().toISOString();
            s.dirty = false;
            s.saving = false;
            // Re-read so the UI shows exactly what the server stored.
            await loadAgent(agent);
            syncAppState(agent);
            render(agent);
            renderEffectiveInto(agent);
            flashSaved(agent, res);
            return true;
        } catch (e) {
            s.saving = false;
            if (e && e.code === 'P0001') {
                s.error = new Error(T('stale'));
            } else {
                s.error = new Error(T('err_save') + ' ' + (e && e.message ? e.message : ''));
            }
            render(agent);
            return false;
        }
    }

    // Keep the host app's own dirty tracking in step: the app knows about the
    // prompt, the tone and the persona snapshot; the studio adds the layers.
    function syncAppState(agent) {
        try {
            if (window.initialStates && window.initialStates[agent]) {
                window.initialStates[agent].personaSnap = window.personaFormSnapshot
                    ? window.personaFormSnapshot(agent) : window.initialStates[agent].personaSnap;
                window.initialStates[agent].prompt = currentPrompt(agent);
                window.initialStates[agent].tone = currentTone(agent);
            }
            if (typeof window.checkDirty === 'function') window.checkDirty(agent);
        } catch (e) { /* the host app state is best-effort */ }
    }

    // A change to the layer configuration turns the layered composer on for
    // this agent. Until then the agent keeps running exactly as it did.
    function touchLayers(agent) {
        const s = st(agent);
        s.layers.enabled = true;
        s.layers.legacy = false;
        markDirty(agent);
    }

    function markDirty(agent, opts) {
        const s = st(agent);
        s.dirty = true;
        s.conflicts = detectConflicts(agent);
        // A full re-render would steal the caret from a text field, so the
        // callers that only changed a value refresh the chrome instead.
        if (opts && opts.rerender === false) refreshChrome(agent);
        else render(agent);
        // the app's Save button must light up for layer-only edits too
        try {
            const btn = document.querySelector(`#${agent} .save-btn`);
            if (btn) { btn.innerText = isAr() ? 'احفظ التغييرات *' : 'Save Changes *'; btn.style.background = '#e6b72a'; btn.style.color = '#000'; }
        } catch (e) { /* ignore */ }
    }

    function stateChipHtml(s) {
        if (s.saving) return `<span class="asx-state" data-kind="saving">${esc(T('saving'))}</span>`;
        if (s.error) return `<span class="asx-state" data-kind="error">${esc(T('failed'))}</span>`;
        if (s.dirty) return `<span class="asx-state" data-kind="dirty">${esc(T('unsaved'))}</span>`;
        return `<span class="asx-state" data-kind="${s.savedAt ? 'saved' : 'idle'}">${s.savedAt ? esc(T('saved') + ' · v' + s.version) : esc(T('saved'))}</span>`;
    }

    // Light update: the state chip and the foot actions, nothing that holds
    // the caret.
    function refreshChrome(agent) {
        const s = st(agent);
        syncDirty(agent);
        const root = document.querySelector(`#${agent} .asx`);
        if (!root) return;
        const chip = root.querySelector('[data-role="state"]');
        if (chip) chip.outerHTML = stateChipHtml(s);
        const foot = root.querySelector('[data-role="foot-actions"]');
        if (foot) {
            const versionsBtn = `<button type="button" class="asx-link" data-act="versions">${esc(T('versions'))}</button>`;
            foot.innerHTML = versionsBtn + (s.dirty
                ? ` <button type="button" class="asx-btn" data-act="discard">${esc(T('discard'))}</button>
          <button type="button" class="asx-btn primary" data-act="save">${esc(T('save_now'))}</button>` : '');
        }
        const conflict = root.querySelector('.asx-conflict');
        if (!conflict && s.conflicts && s.conflicts.length) render(agent);
    }

    // ---- effective prompt -----------------------------------------------------
    async function refreshEffective(agent) {
        const s = st(agent);
        try {
            s.effective = await rpc('resolve_agent_prompt', { p_org_id: orgId(), p_agent: agent, p_include_guards: true });
        } catch (e) { /* keep the old one */ }
        render(agent);
    }

    // ---- rendering ------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('asx-styles')) return;
        const css = `
.asx{--asx-line:rgba(255,255,255,.09);--asx-soft:rgba(255,255,255,.04);margin:4px 0 2px;display:flex;flex-direction:column;gap:14px}
:root[data-theme="light"] .asx{--asx-line:rgba(15,23,42,.12);--asx-soft:rgba(15,23,42,.03)}
.asx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.asx-title{margin:0;font-size:1rem;font-weight:650;letter-spacing:-.01em;line-height:1.3}
.asx-sub{margin:4px 0 0;font-size:.8rem;line-height:1.5;color:var(--text-secondary,#9aa2ae);max-width:62ch}
.asx-state{font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
.asx-state[data-kind="idle"]{color:var(--text-secondary,#9aa2ae);border-color:var(--asx-line)}
.asx-state[data-kind="dirty"]{color:#7a5b12;background:#fbf1de;border-color:#e8d6a8}
.asx-state[data-kind="saving"]{color:var(--text-secondary,#9aa2ae);border-color:var(--asx-line)}
.asx-state[data-kind="saved"]{color:#1c6b4a;background:#e6f5ee;border-color:#bfe6d4}
.asx-state[data-kind="error"]{color:#93302e;background:#fbeceb;border-color:#f0c4c2}
:root[data-theme="dark"] .asx-state[data-kind="dirty"]{color:#f6e6c4;background:#3a2f14;border-color:#5c4a1e}
:root[data-theme="dark"] .asx-state[data-kind="saved"]{color:#d7f2e6;background:#12332a;border-color:#1f5343}
:root[data-theme="dark"] .asx-state[data-kind="error"]{color:#fadedd;background:#3a1e1f;border-color:#5e2b2a}
.asx-caps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media(max-width:900px){.asx-caps{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.asx-caps{grid-template-columns:1fr}}
.asx-cap{position:relative;display:flex;flex-direction:column;gap:2px;text-align:start;padding:10px 12px 10px 36px;border-radius:12px;border:1px solid var(--asx-line);background:var(--asx-soft);color:var(--text-primary,#e9edf3);cursor:pointer;min-height:44px;transition:border-color .12s ease,background .12s ease}
.asx-cap:hover{border-color:var(--sp-accent,#6d6bd9)}
.asx-cap[aria-pressed="true"]{border-color:var(--sp-accent,#6d6bd9);background:rgba(109,107,217,.14)}
.asx-cap[disabled]{opacity:.5;cursor:not-allowed}
.asx-cap .asx-ck{position:absolute;inset-inline-start:12px;inset-block-start:12px;width:16px;height:16px;border-radius:5px;border:1.5px solid var(--asx-line);display:grid;place-items:center}
.asx-cap[aria-pressed="true"] .asx-ck{border-color:var(--sp-accent,#6d6bd9);background:var(--sp-accent,#6d6bd9)}
.asx-cap[aria-pressed="true"] .asx-ck::after{content:"";width:8px;height:4px;border-inline-start:2px solid #fff;border-block-end:2px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}
.asx-cap-t{font-size:.85rem;font-weight:620;line-height:1.3}
.asx-cap-d{font-size:.74rem;line-height:1.45;color:var(--text-secondary,#9aa2ae)}
.asx-cap-note{font-size:.7rem;color:var(--text-secondary,#9aa2ae);margin-top:2px}
.asx-row{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.asx-label{font-size:.78rem;font-weight:620;color:var(--text-secondary,#9aa2ae)}
.asx-seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--asx-soft);border:1px solid var(--asx-line);flex-wrap:wrap}
.asx-seg button{border:0;background:transparent;color:var(--text-secondary,#9aa2ae);font-size:.8rem;font-weight:600;padding:6px 14px;border-radius:999px;cursor:pointer;min-height:34px}
.asx-seg button[aria-checked="true"]{background:var(--sp-accent,#6d6bd9);color:#fff}
.asx-hint{font-size:.74rem;color:var(--text-secondary,#9aa2ae);line-height:1.5;margin:2px 0 0}
.asx-adv{border:1px solid var(--asx-line);border-radius:12px;overflow:hidden}
.asx-adv>summary{cursor:pointer;list-style:none;padding:11px 14px;font-size:.83rem;font-weight:620;display:flex;align-items:center;gap:8px;user-select:none}
.asx-adv>summary::-webkit-details-marker{display:none}
.asx-adv>summary::before{content:"\\25B8";transition:transform .15s ease;font-size:.7rem;color:var(--text-secondary,#9aa2ae)}
.asx-adv[open]>summary::before{transform:rotate(90deg)}
[dir="rtl"] .asx-adv[open]>summary::before{transform:rotate(-90deg)}
.asx-adv-hint{font-weight:400;font-size:.75rem;color:var(--text-secondary,#9aa2ae)}
.asx-adv-body{padding:0 14px 14px;display:flex;flex-direction:column;gap:14px}
.asx-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.asx-ta{width:100%;min-height:96px;padding:10px 12px;border-radius:10px;border:1px solid var(--asx-line);background:var(--asx-soft);color:var(--text-primary,#e9edf3);font:inherit;font-size:.82rem;line-height:1.5;resize:vertical}
.asx-ta:focus{outline:2px solid var(--sp-focus,#8b89ea);outline-offset:1px}
.asx-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-top:1px solid var(--asx-line);padding-top:10px}
.asx-meta{font-size:.73rem;color:var(--text-secondary,#9aa2ae)}
.asx-actions{display:flex;gap:8px;align-items:center}
.asx-btn{border:1px solid var(--asx-line);background:var(--asx-soft);color:var(--text-primary,#e9edf3);border-radius:999px;padding:6px 14px;font-size:.78rem;font-weight:620;cursor:pointer;min-height:34px}
.asx-btn:hover{border-color:var(--sp-accent,#6d6bd9)}
.asx-btn.primary{background:var(--sp-accent,#6d6bd9);border-color:var(--sp-accent,#6d6bd9);color:#fff}
.asx-link{background:none;border:0;color:var(--sp-accent,#6d6bd9);font-size:.78rem;font-weight:600;cursor:pointer;padding:6px 0;text-decoration:underline;text-underline-offset:3px}
.asx-conflict{border:1px solid rgba(217,164,65,.45);background:rgba(217,164,65,.1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.asx-conflict h4{margin:0;font-size:.85rem;font-weight:650}
.asx-conflict p{margin:0;font-size:.78rem;line-height:1.55;color:var(--text-secondary,#9aa2ae)}
.asx-conflict .asx-actions{flex-wrap:wrap}
.asx-eff{border:1px solid var(--asx-line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--asx-soft)}
.asx-eff-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.asx-eff-head h4{margin:0;font-size:.88rem;font-weight:650}
.asx-layers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.asx-layer{border:1px solid var(--asx-line);border-radius:10px;padding:10px 12px;background:var(--sp-surface,#171a20)}
.asx-layer-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.asx-layer-n{font-size:.68rem;font-weight:700;min-width:18px;height:18px;border-radius:5px;display:grid;place-items:center;background:var(--sp-accent-soft,rgba(109,107,217,.16));color:var(--sp-accent,#6d6bd9)}
.asx-layer-k{font-size:.8rem;font-weight:620}
.asx-layer-s{font-size:.68rem;color:var(--text-secondary,#9aa2ae);border:1px solid var(--asx-line);border-radius:999px;padding:1px 8px}
.asx-layer-b{font-size:.78rem;line-height:1.6;color:var(--text-secondary,#9aa2ae);white-space:pre-wrap;word-break:break-word;margin:0;max-height:9.5em;overflow:auto}
.asx-layer[data-open="1"] .asx-layer-b{max-height:none}
.asx-layer-b.clamp{max-height:5.5em;overflow:hidden;position:relative}
.asx-empty{font-size:.78rem;color:var(--text-secondary,#9aa2ae);padding:8px 0}
.asx-flash{position:fixed;inset-block-end:20px;inset-inline-end:20px;z-index:4000;background:#12332a;color:#d7f2e6;border:1px solid #1f5343;border-radius:12px;padding:10px 16px;font-size:.8rem;font-weight:600;box-shadow:var(--sp-shadow-overlay,0 12px 32px rgba(0,0,0,.38));animation:asx-in .2s ease}
:root[data-theme="light"] .asx-flash{background:#e6f5ee;color:#1c6b4a;border-color:#bfe6d4}
@keyframes asx-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.asx-drawer{position:fixed;inset:0;z-index:4200;background:var(--sp-scrim,rgba(6,10,14,.62));display:flex;justify-content:flex-end}
.asx-drawer-panel{width:min(560px,100%);height:100%;background:var(--sp-surface,#171a20);border-inline-start:1px solid var(--asx-line);display:flex;flex-direction:column;box-shadow:var(--sp-shadow-overlay,0 12px 32px rgba(0,0,0,.38))}
.asx-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--asx-line)}
.asx-drawer-head h3{margin:0;font-size:1rem;font-weight:650}
.asx-drawer-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.asx-ver{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--asx-line);border-radius:10px;flex-wrap:wrap}
.asx-ver-n{font-size:.82rem;font-weight:620}
.asx-ver-m{font-size:.72rem;color:var(--text-secondary,#9aa2ae)}
.asx-diff{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.asx-diff-col{border:1px solid var(--asx-line);border-radius:10px;padding:10px;font-size:.76rem;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow:auto}
@media(max-width:640px){.asx-diff{grid-template-columns:1fr}}
.asx-modal{position:fixed;inset:0;z-index:4300;background:var(--sp-scrim,rgba(6,10,14,.62));display:grid;place-items:center;padding:16px}
.asx-modal-box{background:var(--sp-surface,#171a20);border:1px solid var(--asx-line);border-radius:16px;padding:20px;max-width:440px;width:100%;display:flex;flex-direction:column;gap:12px;box-shadow:var(--sp-shadow-overlay,0 12px 32px rgba(0,0,0,.38))}
.asx-modal-box h3{margin:0;font-size:1rem;font-weight:650}
.asx-modal-box p{margin:0;font-size:.82rem;line-height:1.6;color:var(--text-secondary,#9aa2ae)}
.asx-modal-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
@media(max-width:520px){.asx-head{flex-direction:column}.asx-state{align-self:flex-start}}
`;
        const st = document.createElement('style');
        st.id = 'asx-styles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function capMeta(key) {
        const m = CAP_META[key] || { icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z' };
        return m;
    }

    function renderCaps(agent) {
        const s = st(agent);
        const L = s.layers || defaultLayers();
        const caps = ['sales', 'support', 'recommend', 'lead', 'faq', 'booking'];
        const cal = calendar;
        const cards = caps.map((key) => {
            const meta = capMeta(key);
            const on = L.capabilities.indexOf(key) !== -1;
            const label = CAP_LABEL[lang()][key] || [key, ''];
            const needsCal = key === 'booking';
            const unavailable = needsCal && cal && !cal.connected;
            // Sales is the base the server always keeps, so it is shown as on
            // and cannot be switched off.
            const locked = key === 'sales';
            return `<button type="button" class="asx-cap" data-cap="${key}" aria-pressed="${on ? 'true' : 'false'}"${unavailable ? ' disabled' : ''}${locked ? ' data-locked="1"' : ''}>
        <span class="asx-ck" aria-hidden="true"></span>
        <span class="asx-cap-t">${esc(label[0])}</span>
        <span class="asx-cap-d">${esc(label[1])}</span>
        ${locked ? `<span class="asx-cap-note">${esc(T('sales_always'))}</span>` : ''}
        ${unavailable ? `<span class="asx-cap-note">${esc(T('booking_need'))}</span>` : ''}
      </button>`;
        }).join('');

        const primary = ['sales', 'support'].map((r) =>
            `<button type="button" role="radio" aria-checked="${L.primary === r ? 'true' : 'false'}" data-primary="${r}">${esc(r === 'sales' ? T('primary_sales') : T('primary_support'))}</button>`).join('');

        const newHint = s.isNew
            ? `<p class="asx-hint asx-new">${esc(T('new_default'))}</p>`
            : '';

        return `${newHint}<div class="asx-caps" role="group" aria-label="${esc(T('caps_title'))}">${cards}</div>
      <div class="asx-row">
        <span class="asx-label">${esc(T('primary_label'))}</span>
        <div class="asx-seg" role="radiogroup" aria-label="${esc(T('primary_label'))}">${primary}</div>
        <p class="asx-hint">${esc(T('primary_hint'))}</p>
      </div>`;
    }

    function renderStyle(agent) {
        const s = st(agent);
        const L = s.layers || defaultLayers();
        const seg = (name, values, labels, current) => `<div class="asx-seg" role="radiogroup" aria-label="${esc(name)}">` +
            values.map((v) => `<button type="button" role="radio" aria-checked="${current === v ? 'true' : 'false'}" data-style="${name}" data-val="${v}">${esc(labels[v] || v)}</button>`).join('') + '</div>';
        const presets = Object.keys(PRESET_LABEL.en);
        return `<div class="asx-grid2">
        <div class="asx-row"><span class="asx-label">${esc(T('style_preset'))}</span>${seg(T('style_preset'), presets, PRESET_LABEL[lang()], L.style.preset)}</div>
        <div class="asx-row"><span class="asx-label">${esc(T('style_length'))}</span>${seg(T('style_length'), Object.keys(LENGTH_LABEL.en), LENGTH_LABEL[lang()], L.style.length)}</div>
        <div class="asx-row"><span class="asx-label">${esc(T('style_initiative'))}</span>${seg(T('style_initiative'), Object.keys(INITIATIVE_LABEL.en), INITIATIVE_LABEL[lang()], L.style.initiative)}</div>
        <div class="asx-row"><span class="asx-label">${esc(T('style_followup'))}</span>${seg(T('style_followup'), Object.keys(FOLLOWUP_LABEL.en), FOLLOWUP_LABEL[lang()], L.style.followup)}</div>
      </div>`;
    }

    function renderEffective(agent) {
        const s = st(agent);
        const eff = s.effective;
        if (!eff) return '';
        const origin = LAYER_ORIGIN[lang()];
        const sections = Array.isArray(eff.sections) ? eff.sections : [];
        const legacyNote = (eff.source && eff.source !== 'layered')
            ? `<p class="asx-hint">${esc(T('legacy_note'))}</p>` : '';

        const block = (layer, key, src, text) => `<li class="asx-layer" data-layer="${layer}" data-open="0">
          <div class="asx-layer-h">
            <span class="asx-layer-n">${esc(layer)}</span>
            <span class="asx-layer-k">${esc(key)}</span>
            <span class="asx-layer-s">${esc(src)}</span>
          </div>
          <p class="asx-layer-b clamp" data-role="body">${esc(text)}</p>
        </li>`;

        let rows;
        if (sections.length) {
            // The layered composer: every layer with its number and origin.
            rows = sections.map((sec) => {
                const label = LAYER_LABEL[lang()][sec.key] || sec.key;
                let src = origin.studio;
                if (sec.source && sec.source.indexOf('platform') === 0) src = origin.platform;
                else if (sec.source === 'owner') src = origin.owner;
                return block(sec.layer, label, src, sec.text || '');
            }).join('');
        } else if (eff.source === 'merchant') {
            // The agent runs on the merchant's own instructions. The server
            // returns the safety rules next to them; both are shown as they
            // are used.
            rows = block(5, T('layer_custom'), origin.owner, s.savedPrompt || currentPrompt(agent) || '');
            if (eff.guards) rows += block(6, T('layer_guards'), origin.platform, eff.guards);
        } else if (eff.text) {
            rows = block(1, T('layer_standard'), origin.platform, eff.text);
        } else {
            rows = `<li class="asx-empty">${esc(T('empty_layers'))}</li>`;
        }

        return `<div class="asx-eff" data-eff="${agent}">
      <div class="asx-eff-head">
        <h4>${esc(T('eff_title'))}</h4>
        <div class="asx-actions">
          <button type="button" class="asx-btn" data-act="eff-expand">${esc(T('eff_show'))}</button>
          <button type="button" class="asx-btn" data-act="eff-refresh">${esc(T('eff_refresh'))}</button>
        </div>
      </div>
      <p class="asx-hint">${esc(T('eff_note'))}</p>
      ${legacyNote}
      <ol class="asx-layers">${rows}</ol>
    </div>`;
    }

    function renderConflict(agent) {
        const s = st(agent);
        if (!s.conflicts || !s.conflicts.length) return '';
        return `<div class="asx-conflict" role="alert">
      <h4>${esc(T('conflict_title'))}</h4>
      <p>${esc(T('conflict_body'))}</p>
      <div class="asx-actions">
        <button type="button" class="asx-btn primary" data-act="conflict-keep">${esc(T('conflict_keep'))}</button>
        <button type="button" class="asx-btn" data-act="conflict-only">${esc(T('conflict_only'))}</button>
        <button type="button" class="asx-link" data-act="conflict-dismiss">${esc(T('conflict_dismiss'))}</button>
      </div>
    </div>`;
    }

    // The truth about "is there anything to save" is asked of the DOM, not
    // remembered from an event: the free-text editor belongs to the host app
    // and can change without us hearing about it.
    function syncDirty(agent) {
        const s = st(agent);
        if (currentPrompt(agent) !== s.savedPrompt) s.dirty = true;
        return s.dirty;
    }

    function render(agent) {
        const s = st(agent);
        syncDirty(agent);
        const root = document.querySelector(`#${agent} .asx`);
        if (!root) return;
        const stateHtml = stateChipHtml(s);

        const savedMeta = s.savedAt
            ? `${esc(T('saved_at'))} ${esc(new Date(s.savedAt).toLocaleString())} · ${esc('v' + s.version)}`
            : '';

        root.innerHTML = `
      <div class="asx-head">
        <div>
          <h3 class="asx-title">${esc(T('caps_title'))}</h3>
          <p class="asx-sub">${esc(T('caps_sub'))}</p>
        </div>
        ${stateHtml}
      </div>
      ${renderConflict(agent)}
      ${renderCaps(agent)}
      <details class="asx-adv" ${openByDefault(agent) ? 'open' : ''}>
        <summary>${esc(T('style_title'))} <span class="asx-adv-hint">${esc(T('style_preset'))} · ${esc(T('style_length'))} · ${esc(T('style_initiative'))}</span></summary>
        <div class="asx-adv-body">${renderStyle(agent)}</div>
      </details>
      <details class="asx-adv">
        <summary>${esc(T('knowledge_title'))}</summary>
        <div class="asx-adv-body">
          <textarea class="asx-ta" data-act="knowledge" placeholder="${esc(T('knowledge_ph'))}" maxlength="4000">${esc((s.layers && s.layers.knowledge && s.layers.knowledge.policies) || '')}</textarea>
          <p class="asx-hint">${esc(T('knowledge_hint'))}</p>
        </div>
      </details>
      <div class="asx-foot">
        <div class="asx-meta">${savedMeta}</div>
        <div class="asx-actions" data-role="foot-actions">
          <button type="button" class="asx-link" data-act="versions">${esc(T('versions'))}</button>
          ${s.dirty ? `<button type="button" class="asx-btn" data-act="discard">${esc(T('discard'))}</button>
          <button type="button" class="asx-btn primary" data-act="save">${esc(T('save_now'))}</button>` : ''}
        </div>
      </div>`;
    }

    // The style panel remembers whether the owner opened it.
    const advOpen = {};
    function openByDefault(agent) { return !!advOpen[agent]; }

    function renderEffectiveInto(agent) {
        const host = document.querySelector(`#${agent} .asx-eff-host`);
        if (!host) return;
        host.innerHTML = renderEffective(agent);
    }
    // ---- mount ----------------------------------------------------------------
    // The studio gets its own section in the agent tab, above the prompt
    // editors, so the order the owner reads is:
    //   what it can do -> how it talks -> what it knows -> the editors ->
    //   what the agent is finally told.
    //
    // The dashboard builds its agent tabs in stages, so the section may not
    // exist yet when the studio boots. ensureMounted() is idempotent and is
    // re-run whenever the tab content changes.
    function ensureMounted(agent) {
        const promptSec = document.getElementById(agent + '-prompt-sec');
        if (!promptSec) return false;
        const wrap = promptSec.closest('.section-wrapper');
        if (!wrap || !wrap.parentElement) return false;
        if (wrap.parentElement.querySelector('.asx-sec-' + agent)) return false;   // already there
        const sec = document.createElement('div');
        sec.className = 'section-wrapper asx-sec-' + agent;
        const header = (typeof window.renderAgentSectionHeaderMarkup === 'function')
            ? window.renderAgentSectionHeaderMarkup({
                sectionId: agent + '-studio-sec',
                labelKey: 'agent_config.header_studio',
                fallbackText: 'Agent setup',
                isActive: true,
            })
            : '';
        sec.innerHTML = header +
            `<div id="${agent}-studio-sec" class="section-content open">
          <div class="asx" data-agent="${agent}"></div>
          <div class="asx-eff-host" data-agent="${agent}"></div>
        </div>`;
        wrap.parentElement.insertBefore(sec, wrap);
        // The old role picker is replaced by the capabilities multi-select.
        const slot = document.querySelector(`#${agent} .agent-role-slot`);
        if (slot && slot.querySelector('.suggestions')) slot.querySelector('.suggestions').remove();
        render(agent);
        renderEffectiveInto(agent);
        wire(agent);
        watchHostPrompt(agent);
        return true;
    }
    function mountAll() {
        AGENT_IDS.forEach((agent) => { if (document.getElementById(agent)) ensureMounted(agent); });
    }

    // The dashboard may build or rebuild an agent tab after we mounted. When
    // that happens our section is gone with it, so we put it back.
    function watchTabs() {
        let pending = false;
        const check = () => {
            if (pending) return;
            pending = true;
            setTimeout(() => {
                pending = false;
                AGENT_IDS.forEach((agent) => {
                    if (!document.getElementById(agent)) return;
                    ensureMounted(agent);
                    watchHostPrompt(agent);   // the textarea may have been replaced
                    // The effective-prompt panel is filled separately; if the
                    // host rebuilt the section, it is empty again.
                    const host = document.querySelector(`#${agent} .asx-eff-host`);
                    if (host && !host.innerHTML.trim()) renderEffectiveInto(agent);
                });
            }, 120);
        };
        const attach = () => {
            const targets = AGENT_IDS.map((id) => document.getElementById(id)).filter(Boolean);
            if (!targets.length) return setTimeout(attach, 500);
            const obs = new MutationObserver(check);
            targets.forEach((t) => obs.observe(t, { childList: true, subtree: true }));
            check();
        };
        attach();
    }

    // ---- events ---------------------------------------------------------------
    function wire(agent) {
        const root = document.querySelector(`#${agent} .asx`);
        if (!root || root.dataset.wired === '1') return;
        root.dataset.wired = '1';

        root.addEventListener('click', async (ev) => {
            const capBtn = ev.target.closest('[data-cap]');
            const priBtn = ev.target.closest('[data-primary]');
            const styBtn = ev.target.closest('[data-style]');
            const actBtn = ev.target.closest('[data-act]');
            const s = st(agent);

            if (capBtn) {
                if (capBtn.disabled) return;
                const key = capBtn.dataset.cap;
                if (key === 'sales') return;   // the base is always on
                const caps = s.layers.capabilities.slice();
                const i = caps.indexOf(key);
                if (i === -1) caps.push(key); else caps.splice(i, 1);
                s.layers.capabilities = caps;
                touchLayers(agent);
                return;
            }
            if (priBtn) {
                const role = priBtn.dataset.primary;
                s.layers.primary = role;
                if (s.layers.capabilities.indexOf(role) === -1) s.layers.capabilities.push(role);
                touchLayers(agent);
                return;
            }
            if (styBtn) {
                s.layers.style[styBtn.dataset.style] = styBtn.dataset.val;
                touchLayers(agent);
                return;
            }
            if (actBtn) {
                const act = actBtn.dataset.act;
                if (act === 'save') { await save(agent); return; }
                if (act === 'discard') { await reload(agent); return; }
                if (act === 'versions') { openVersions(agent); return; }
                if (act === 'eff-refresh') { await refreshEffective(agent); return; }
                if (act === 'eff-expand') {
                    const host = document.querySelector(`#${agent} .asx-eff`);
                    if (host) {
                        const open = host.querySelectorAll('.asx-layer[data-open="1"]').length > 0;
                        host.querySelectorAll('.asx-layer').forEach((li) => { li.dataset.open = open ? '0' : '1'; });
                        host.querySelectorAll('.asx-layer-b').forEach((p) => p.classList.toggle('clamp', open));
                        actBtn.textContent = open ? T('eff_show') : T('eff_hide');
                    }
                    return;
                }
                if (act === 'conflict-keep') {
                    s.layers.ack = (s.layers.ack || []).concat(['conflict:base_role']);
                    s.conflicts = [];
                    touchLayers(agent);
                    return;
                }
                if (act === 'conflict-only') {
                    s.layers.ack = (s.layers.ack || []).concat(['conflict:base_role']);
                    s.layers.inherit_base = false;
                    s.conflicts = [];
                    touchLayers(agent);
                    return;
                }
                if (act === 'conflict-dismiss') {
                    s.layers.ack = (s.layers.ack || []).concat(['conflict:base_role']);
                    s.conflicts = [];
                    touchLayers(agent);
                    return;
                }
            }
        });

        root.addEventListener('input', (ev) => {
            if (ev.target && ev.target.dataset && ev.target.dataset.act === 'knowledge') {
                st(agent).layers.knowledge.policies = ev.target.value;
                st(agent).layers.enabled = true;
                st(agent).layers.legacy = false;
                markDirty(agent, { rerender: false });
            }
        });

        root.addEventListener('toggle', (ev) => {
            const d = ev.target;
            if (d && d.tagName === 'DETAILS' && d.closest('.asx')) {
                const idx = Array.prototype.indexOf.call(d.parentElement.querySelectorAll('details'), d);
                advOpen[agent + ':' + idx] = d.open;
            }
        }, true);
    }

    // ---- reload / versions ----------------------------------------------------
    async function reload(agent) {
        const s = st(agent);
        s.dirty = false;
        s.conflicts = [];
        await loadAgent(agent);
        const ta = document.getElementById('prompt-' + agent);
        if (ta) ta.value = s.savedPrompt;
        const tone = document.getElementById('tone-' + agent);
        if (tone) tone.value = s.savedTone;
        syncAppState(agent);
        render(agent);
        renderEffectiveInto(agent);
    }

    async function openVersions(agent) {
        const s = st(agent);
        const drawer = document.createElement('div');
        drawer.className = 'asx-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.innerHTML = `<div class="asx-drawer-panel">
        <div class="asx-drawer-head">
          <h3>${esc(T('versions'))}</h3>
          <button type="button" class="asx-btn" data-close="1">${esc(T('close'))}</button>
        </div>
        <div class="asx-drawer-body" data-role="body"><p class="asx-empty">…</p></div>
      </div>`;
        document.body.appendChild(drawer);
        const body = drawer.querySelector('[data-role="body"]');
        const close = () => { drawer.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        drawer.addEventListener('click', (e) => { if (e.target === drawer || e.target.closest('[data-close]')) close(); });

        let versions = [];
        try {
            versions = await rpc('list_agent_versions', { p_org_id: orgId(), p_agent: agent, p_limit: 25 });
        } catch (e) {
            body.innerHTML = `<p class="asx-empty">${esc(T('err_load'))}</p>`;
            return;
        }
        if (!versions || !versions.length) {
            body.innerHTML = `<p class="asx-empty">${esc(T('no_versions'))}</p>`;
            return;
        }
        body.innerHTML = versions.map((v) => `
      <div class="asx-ver" data-version="${v.version}">
        <div>
          <div class="asx-ver-n">${esc(T('version'))} ${esc(v.version)}${v.restored_from ? ' · ↩︎ ' + esc(v.restored_from) : ''}</div>
          <div class="asx-ver-m">${esc(new Date(v.created_at).toLocaleString())} · ${esc((v.changed_keys || []).join(', '))}</div>
        </div>
        <div class="asx-actions">
          <button type="button" class="asx-btn" data-act="compare" data-version="${v.version}">${esc(T('compare'))}</button>
          <button type="button" class="asx-btn" data-act="restore" data-version="${v.version}">${esc(T('restore'))}</button>
        </div>
      </div>`).join('');

        body.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const version = parseInt(btn.dataset.version, 10);
            if (btn.dataset.act === 'compare') {
                await showCompare(agent, version, body);
            } else if (btn.dataset.act === 'restore') {
                await confirmRestore(agent, version, drawer, body);
            }
        });
    }

    async function showCompare(agent, version, body) {
        let old = null;
        try { old = await rpc('get_agent_version', { p_org_id: orgId(), p_agent: agent, p_version: version }); }
        catch (e) { /* fall through */ }
        const s = st(agent);
        const oldText = old ? (old.system_prompt || '') : '';
        const newText = currentPrompt(agent);
        const box = document.createElement('div');
        box.className = 'asx-diff';
        box.innerHTML = `<div class="asx-diff-col"><strong>${esc(T('version') + ' ' + version)}</strong>\n\n${esc(oldText || '—')}</div>
      <div class="asx-diff-col"><strong>${esc(T('saved'))}</strong>\n\n${esc(newText || '—')}</div>`;
        const existing = body.querySelector('.asx-diff');
        if (existing) existing.remove();
        body.insertBefore(box, body.firstChild);
    }

    async function confirmRestore(agent, version, drawer, body) {
        const modal = document.createElement('div');
        modal.className = 'asx-modal';
        modal.innerHTML = `<div class="asx-modal-box">
        <h3>${esc(T('restore'))}</h3>
        <p>${esc(T('restore_confirm'))}</p>
        <div class="asx-modal-actions">
          <button type="button" class="asx-btn" data-x="1">${esc(T('cancel'))}</button>
          <button type="button" class="asx-btn primary" data-x="go">${esc(T('restore'))}</button>
        </div>
      </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-x]');
            if (!b) { modal.remove(); return; }
            if (b.dataset.x !== 'go') { modal.remove(); return; }
            modal.remove();
            const s = st(agent);
            try {
                const res = await rpc('restore_agent_version', {
                    p_org_id: orgId(), p_agent: agent, p_version: version, p_expected_version: s.version,
                });
                if (res && res.version != null) s.version = res.version;
                await reload(agent);
                flashSaved(agent, { version: s.version, saved_at: new Date().toISOString() });
                drawer.remove();
            } catch (e) {
                s.error = new Error(T('err_save'));
                render(agent);
            }
        });
    }

    function flashSaved(agent, res) {
        const n = document.createElement('div');
        n.className = 'asx-flash';
        n.textContent = (T('saved') + ' · v' + ((res && res.version) || st(agent).version));
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 2600);
    }

    // ---- host-app integration --------------------------------------------------
    function wrapHostSave() {
        if (window.__asxSaveWrapped) return;
        window.__asxSaveWrapped = true;
        const original = window.saveRole;
        if (typeof original !== 'function') return;
        window.saveRole = function (agentId) {
            if (!enabled) return original.apply(this, arguments);
            const s = st(agentId);
            // Nothing of ours changed and the app has no edits either: let the
            // host do exactly what it always did.
            const hostDirty = (function () {
                try { return window.isDirtyState && window.isDirtyState[agentId]; } catch (e) { return false; }
            })();
            if (!s.dirty && !hostDirty) return original.apply(this, arguments);
            return save(agentId);
        };
    }

    function wrapHostDirty() {
        if (window.__asxDirtyWrapped) return;
        window.__asxDirtyWrapped = true;
        const original = window.checkDirty;
        if (typeof original !== 'function') return;
        window.checkDirty = function (agentId) {
            const r = original.apply(this, arguments);
            try {
                const s = state[agentId];
                if (s && s.dirty) {
                    const btn = document.querySelector(`#${agentId} .save-btn`);
                    if (btn) { btn.innerText = isAr() ? 'احفظ التغييرات *' : 'Save Changes *'; btn.style.background = '#e6b72a'; btn.style.color = '#000'; }
                }
            } catch (e) { /* ignore */ }
            return r;
        };
    }

    // The host app's own prompt textarea must feed the conflict check.
    function watchHostPrompt(agent) {
        const ta = document.getElementById('prompt-' + agent);
        if (!ta || ta.dataset.asxWatched === '1') return;
        ta.dataset.asxWatched = '1';
        ta.addEventListener('input', () => {
            const s = st(agent);
            // The free-text editor is layer 5 of the same configuration, so a
            // change there is an unsaved change here too.
            if (currentPrompt(agent) !== s.savedPrompt) s.dirty = true;
            const c = detectConflicts(agent);
            if ((c || []).join() !== (s.conflicts || []).join()) {
                s.conflicts = c;
                render(agent);
            } else {
                refreshChrome(agent);
            }
        });
    }

    // ---- boot -----------------------------------------------------------------
    let booted = false;
    async function boot() {
        if (booted) return;
        booted = true;
        try {
            await bootInner();
        } catch (e) {
            console.warn('[agent-studio] boot', e);
        } finally {
            announceDecision();
        }
    }

    async function bootInner() {
        injectStyles();
        for (let i = 0; i < 60 && !orgId(); i++) await new Promise((r) => setTimeout(r, 250));
        if (!orgId()) return;
        if (!await checkAccess()) return;   // the new UI stays hidden
        enabled = true;
        window.AgentStudioEnabled = true;

        await loadCapabilities();
        await Promise.all(AGENT_IDS.map((a) => loadAgent(a).catch(() => {})));
        mountAll();
        watchTabs();
        AGENT_IDS.forEach((agent) => { wire(agent); watchHostPrompt(agent); });
        wrapHostSave();
        wrapHostDirty();
        // The prompt layer is the owner's own instructions (layer 5). Make that
        // obvious where the text actually lives.
        AGENT_IDS.forEach((agent) => {
            const ta = document.getElementById('prompt-' + agent);
            if (ta && !ta.closest('.asx-layer-host')) {
                ta.setAttribute('aria-describedby', 'asx-layer-note-' + agent);
            }
        });
        window.AgentStudioReady = true;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.AgentStudio = {
        get enabled() { return enabled; },
        // True only once the server has allowed this account. The other modules
        // read it to decide whether to keep their hands off the slot.
        get ownsRoleSlot() { return enabled; },
        boot,
        mountAll,
        save,
        reload,
        refreshEffective,
        openVersions,
        state,
        _normaliseLayers: normaliseLayers,
        _allowedCaps: () => allowedCaps.slice(),
    };
})();
