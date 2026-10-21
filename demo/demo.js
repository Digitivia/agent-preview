// UI Demo Mode: the interactive prototype of the AI Agent Upgrade (agent role setup, Test Chat, AI follow-ups).
//
// ISOLATION, by construction:
//   * this page loads no Supabase client, no analytics, no third-party script; its CSP says connect-src 'none', so the
//     browser itself refuses any request to a server;
//   * nothing here calls fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon (a test greps for them);
//   * the only storage is this browser's localStorage under one key, written when the visitor presses "Save local draft";
//   * the replies and AI examples come from engine.js (scripted, no model);
//   * it refuses to run on the production host.
(function () {
    'use strict';

    const ALLOWED_HOSTS = ['digitivia.github.io', 'localhost', '127.0.0.1', 'app.test'];
    const STORAGE_KEY = 'digitivia-ui-demo-v1';
    const I = window.DEMO_I18N;
    const E = window.DemoEngine;
    const app = document.getElementById('app');

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const uid = () => 's' + Math.random().toString(36).slice(2, 9);

    if (ALLOWED_HOSTS.indexOf(location.hostname) < 0) {
        app.innerHTML = '<div class="blocked card"><h1>UI Demo Mode</h1><p>This demo runs on the preview site only. It is not available on this domain.</p></div>';
        return;
    }

    // ------------------------------------------------------------------ state
    const TONES = ['Professional & Formal', 'Friendly & Casual', 'Empathetic & Helpful', 'Sales-Oriented & Persuasive', 'Witty & Humorous'];
    const DIALECTS = ['egyptian_ar', 'formal_ar', 'gulf_ar', 'levantine_ar', 'moroccan_ar', 'franco', 'formal_en', 'casual_en', 'french', 'bilingual', 'bilingual_fr'];
    const CHANNELS = ['website', 'whatsapp', 'page', 'instagram'];
    const FU_CHANNELS = ['whatsapp', 'page', 'instagram'];
    const TABS = ['agent', 'chat', 'followups', 'about'];
    const MAX_STEPS = 5;
    const MAX_CUSTOM = 2000;
    const WINDOW_MIN = 24 * 60;

    function cfgDefault(role) {
        return {
            role: role || null, name: '', gender: '', age: 'adult', dialect: 'egyptian_ar', tone: 'Friendly & Casual', model: 'balanced',
            sales: { approach: 'consultative', recommend: true, upsell: false, discount: 'never', collectLead: true, closeOrder: true, handoff: '' },
            support: { empathy: 'high', askOrderNumber: true, escalateAngry: true, orderLookup: true, returnPolicy: '', hours: '' },
            custom: '', length: 'short',
        };
    }
    function stepDefault(i) {
        const wait = [60, 600, 1440][i] || 60;
        return { id: uid(), wait, mode: 'fixed', en: 'Hi {name}, just checking in. Do you still need help?', ar: 'أهلاً {name}، حبيت أطمّن عليكي. لسه محتاجة مساعدة؟', goal: '', lang: 'auto' };
    }
    function exampleSteps() {
        return [
            { id: uid(), wait: 60, mode: 'ai', en: 'Hi {name}, are you still interested? I am happy to help.', ar: 'أهلاً {name}، لسه مهتمة؟ يسعدني أساعدك.', goal: 'Remind them about the product they asked about', lang: 'auto' },
            { id: uid(), wait: 600, mode: 'ai', en: 'Hi {name}, if anything is unclear, just ask me.', ar: 'أهلاً {name}، لو في أي حاجة مش واضحة اسأليني.', goal: 'Offer an easier next step', lang: 'auto' },
            { id: uid(), wait: 1440, mode: 'fixed', en: "Hi {name}, I'll pause here. Reply any time and we'll continue.", ar: 'أهلاً {name}، هوقف هنا دلوقتي. ابعتيلي في أي وقت ونكمل.', goal: '', lang: 'auto' },
        ];
    }
    function fuDefault() {
        return { enabled: true, channels: { whatsapp: true, page: true, instagram: false }, hours: { enabled: false, start: '09:00', end: '18:00' }, steps: exampleSteps() };
    }
    function defaults() {
        return {
            v: 1, lang: (navigator.language || 'en').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en', theme: 'dark', tab: 'agent', channel: 'whatsapp',
            configs: { website: cfgDefault('sales'), whatsapp: cfgDefault('sales'), page: cfgDefault('support'), instagram: cfgDefault(null) },
            followups: fuDefault(), savedAt: {},
        };
    }

    let storageOk = true;
    // Whatever is in localStorage is untrusted (another tab, an old build, a hand edit): rebuild the state from the
    // known fields only, with their types and allowed values checked, so a bad value can neither crash nor inject markup.
    const pick = (v, allowed, dflt) => (allowed.indexOf(v) >= 0 ? v : dflt);
    const str = (v, max, dflt) => (typeof v === 'string' ? v.slice(0, max) : dflt);
    const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
    function cleanCfg(c, dflt) {
        c = c && typeof c === 'object' ? c : {};
        const d = dflt, s = c.sales || {}, u = c.support || {};
        return {
            role: pick(c.role, ['sales', 'support', null], d.role), name: str(c.name, 60, ''), gender: pick(c.gender, ['', 'male', 'female', 'neutral'], ''),
            age: pick(c.age, ['young', 'adult', 'mature'], 'adult'), dialect: pick(c.dialect, DIALECTS, d.dialect), tone: pick(c.tone, TONES, d.tone), model: pick(c.model, ['economy', 'balanced', 'premium'], 'balanced'),
            sales: { approach: pick(s.approach, ['consultative', 'direct', 'soft'], 'consultative'), recommend: bool(s.recommend, true), upsell: bool(s.upsell, false), discount: pick(s.discount, ['never', 'catalogue'], 'never'), collectLead: bool(s.collectLead, true), closeOrder: bool(s.closeOrder, true), handoff: str(s.handoff, 80, '') },
            support: { empathy: pick(u.empathy, ['high', 'balanced', 'brief'], 'high'), askOrderNumber: bool(u.askOrderNumber, true), escalateAngry: bool(u.escalateAngry, true), orderLookup: bool(u.orderLookup, true), returnPolicy: str(u.returnPolicy, 4000, ''), hours: str(u.hours, 120, '') },
            custom: str(c.custom, 20000, ''), length: pick(c.length, ['short', 'medium', 'detailed'], 'short'),
        };
    }
    function cleanFu(f, dflt) {
        f = f && typeof f === 'object' ? f : {};
        const ch = f.channels || {}, h = f.hours || {};
        const time = (v, d) => (typeof v === 'string' && /^\d\d:\d\d$/.test(v) ? v : d);
        const steps = (Array.isArray(f.steps) ? f.steps : dflt.steps).slice(0, MAX_STEPS).map((x, i) => {
            x = x && typeof x === 'object' ? x : {};
            const w = Number(x.wait);
            return { id: typeof x.id === 'string' && /^s[a-z0-9]{1,8}$/.test(x.id) ? x.id : uid(), wait: w >= 1 && w <= 43200 ? Math.round(w) : 60, mode: pick(x.mode, ['fixed', 'ai'], 'fixed'),
                en: str(x.en, 1000, ''), ar: str(x.ar, 1000, ''), goal: str(x.goal, 240, ''), lang: pick(x.lang, ['auto', 'ar', 'en'], 'auto') };
        });
        return { enabled: bool(f.enabled, true), channels: { whatsapp: bool(ch.whatsapp, true), page: bool(ch.page, true), instagram: bool(ch.instagram, false) }, hours: { enabled: bool(h.enabled, false), start: time(h.start, '09:00'), end: time(h.end, '18:00') }, steps };
    }
    function load() {
        const d = defaults();
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return d;
            const o = JSON.parse(raw);
            if (!o || typeof o !== 'object' || o.v !== 1) return d;
            const saved = {};
            ['fu', 'website', 'whatsapp', 'page', 'instagram'].forEach((k) => { const n = o.savedAt && Number(o.savedAt[k]); if (n > 0) saved[k] = n; });
            const cfgs = {};
            CHANNELS.forEach((ch) => { cfgs[ch] = cleanCfg(o.configs && o.configs[ch], d.configs[ch]); });
            return { v: 1, lang: pick(o.lang, ['en', 'ar'], d.lang), theme: pick(o.theme, ['dark', 'light'], 'dark'), tab: pick(o.tab, TABS, 'agent'), channel: pick(o.channel, CHANNELS, 'whatsapp'), configs: cfgs, followups: cleanFu(o.followups, d.followups), savedAt: saved };
        } catch (_) { storageOk = false; return d; }
    }
    function persist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); storageOk = true; } catch (_) { storageOk = false; }
    }

    let S = load(); // the saved (persisted) demo state
    const U = { drafts: {}, fuDraft: null, chats: {}, typing: {}, chatLang: null, device: 'phone', openAdv: false, errors: null, fuLoading: false, previews: {}, toast: null, modal: null, undo: null, fuErrors: null };

    const t = (k) => { const d = I[S.lang] || I.en; return d[k] != null ? d[k] : (I.en[k] != null ? I.en[k] : k); };
    const ar = () => S.lang === 'ar';

    const cfg = () => U.drafts[S.channel] || S.configs[S.channel];
    const dirtyCfg = (ch) => !!U.drafts[ch] && !same(U.drafts[ch], S.configs[ch]);
    const fu = () => U.fuDraft || S.followups;
    const dirtyFu = () => !!U.fuDraft && !same(U.fuDraft, S.followups);
    function editCfg() { if (!U.drafts[S.channel]) U.drafts[S.channel] = clone(S.configs[S.channel]); return U.drafts[S.channel]; }
    function editFu() { if (!U.fuDraft) U.fuDraft = clone(S.followups); return U.fuDraft; }
    function setPath(obj, path, val) { const p = path.split('.'); let o = obj; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; }
    function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

    // ------------------------------------------------------------------ view helpers
    const icon = {
        sales: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 2v2h2l3.6 7.6-1.4 2.4A2 2 0 0 0 7 17h12v-2H7.4l1.1-2h7.5a2 2 0 0 0 1.7-1l3.6-6.5A1 1 0 0 0 20.4 4H5.2l-.9-2H1z"/></svg>',
        support: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1v1a2 2 0 0 1-2 2h-3v2h3a4 4 0 0 0 4-4V10a9 9 0 0 0-9-9z"/></svg>',
    };
    const fmtWait = (m) => {
        const a = ar();
        if (m % 1440 === 0) { const d = m / 1440; return a ? (d === 1 ? 'يوم' : d + ' أيام') : d + (d === 1 ? ' day' : ' days'); }
        if (m % 60 === 0) { const h = m / 60; return a ? (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h + ' ساعات') : h + (h === 1 ? ' hour' : ' hours'); }
        return a ? m + ' دقيقة' : m + ' min';
    };
    const roleName = (r) => (r === 'sales' ? t('role_sales') : r === 'support' ? t('role_support') : t('role_none'));
    const chanName = (c) => t('ch_' + c);
    const hhmm = (d) => d.toLocaleTimeString(ar() ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

    function seg(name, value, options, extra, label) {
        return '<div class="seg' + (extra ? ' ' + extra : '') + '" role="group" aria-label="' + esc(label || '') + '">' +
            options.map((o) => '<button type="button" data-act="set" data-f="' + esc(name) + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (value === o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div>';
    }
    function select(f, value, options, id) {
        return '<select id="' + id + '" data-act="sel" data-f="' + f + '">' + options.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    }
    function field(id, label, control, helpText, err) {
        return '<div class="field' + (err ? ' err' : '') + '"><label for="' + id + '">' + esc(label) + '</label>' + control + (helpText ? '<span class="help">' + esc(helpText) + '</span>' : '') + (err ? '<span class="errmsg" role="alert">' + esc(err) + '</span>' : '') + '</div>';
    }
    function sw(f, on, title, desc, locked) {
        return '<div class="toggle"><div class="txt"><b>' + esc(title) + '</b>' + (desc ? '<span>' + esc(desc) + '</span>' : '') + '</div>' +
            '<button type="button" class="sw" role="switch" aria-checked="' + !!on + '" aria-label="' + esc(title) + '" data-act="tgl" data-f="' + f + '"' + (locked ? ' disabled' : '') + '></button></div>';
    }

    // ------------------------------------------------------------------ shell
    function shell() {
        const a = ar();
        document.documentElement.lang = S.lang;
        document.documentElement.dir = a ? 'rtl' : 'ltr';
        document.documentElement.setAttribute('data-theme', S.theme);
        document.title = t('doc_title');
        app.innerHTML =
            '<div class="banner" id="banner" role="status"><strong>' + esc(t('banner_title')) + '</strong><span class="grow">' + esc(t('banner_text')) + '</span></div>' +
            '<header class="topbar"><img src="../cropped-White.png" alt="Digitivia" width="144" height="30"><div class="grow"><div class="sub">' + esc(t('subtitle')) + '</div></div>' +
            '<div class="tools"><a class="btn sm" href="../" id="back">' + esc(t('back')) + '</a>' +
            '<button class="btn sm" type="button" data-act="lang">' + esc(a ? 'English' : 'عربي') + '</button>' +
            '<button class="btn sm" type="button" data-act="theme" aria-pressed="' + (S.theme === 'light') + '">' + esc(S.theme === 'light' ? t('theme_dark') : t('theme_light')) + '</button>' +
            '<button class="btn sm danger" type="button" data-act="reset-ask">' + esc(t('reset_demo')) + '</button></div></header>' +
            '<nav class="tabs" role="tablist" aria-label="' + esc(t('sections')) + '">' + TABS.map((k) => '<button class="tab" role="tab" id="tab-' + k + '" data-act="tab" data-v="' + k + '" aria-selected="' + (S.tab === k) + '" tabindex="' + (S.tab === k ? '0' : '-1') + '" aria-controls="panel">' + esc(t('tab_' + k)) + (k === 'agent' && CHANNELS.some(dirtyCfg) ? ' <span class="dirty" aria-hidden="true"></span>' : '') + (k === 'followups' && dirtyFu() ? ' <span class="dirty" aria-hidden="true"></span>' : '') + '</button>').join('') + '</nav>' +
            '<main id="panel" role="tabpanel" tabindex="-1"></main><div class="toast" id="toast" role="status" aria-live="polite"></div><div id="modal"></div>';
        syncBannerHeight();
        panel();
    }
    function syncBannerHeight() {
        const b = document.getElementById('banner');
        if (b) document.documentElement.style.setProperty('--banner-h', b.offsetHeight + 'px');
    }

    function focusKey(el) {
        if (!el || !el.getAttribute || el === document.body) return null;
        if (el.id) return '#' + el.id;
        const a = ['data-act', 'data-f', 'data-v', 'data-id'].map((n) => (el.hasAttribute(n) ? '[' + n + '="' + el.getAttribute(n) + '"]' : '')).join('');
        return a ? '#panel ' + el.tagName.toLowerCase() + a : null;
    }
    // Every action re-renders the panel; keep the keyboard user where they were and keep a half-typed chat message.
    function panel() {
        const p = document.getElementById('panel');
        if (!p) return;
        const key = p.contains(document.activeElement) ? focusKey(document.activeElement) : null;
        const inp = document.getElementById('chat-input');
        const draft = inp ? inp.value : '';
        p.innerHTML = ({ agent: viewAgent, chat: viewChat, followups: viewFollowups, about: viewAbout }[S.tab] || viewAgent)();
        if (S.tab === 'chat') {
            const ni = document.getElementById('chat-input');
            if (ni && draft) { ni.value = draft; const sb = document.getElementById('send'); if (sb) sb.disabled = !!U.typing[S.channel]; }
            const log = document.getElementById('log'); if (log) log.scrollTop = log.scrollHeight;
        }
        if (key) { try { const n = document.querySelector(key); if (n && n.focus) n.focus({ preventScroll: true }); } catch (_) { /* selector not valid any more */ } }
    }
    function refreshTabs() {
        TABS.forEach((k) => {
            const el = document.getElementById('tab-' + k);
            if (!el) return;
            el.setAttribute('aria-selected', String(S.tab === k));
            el.setAttribute('tabindex', S.tab === k ? '0' : '-1');
            const dirty = (k === 'agent' && CHANNELS.some(dirtyCfg)) || (k === 'followups' && dirtyFu());
            el.innerHTML = esc(t('tab_' + k)) + (dirty ? ' <span class="dirty" aria-hidden="true"></span>' : '');
        });
    }

    function toast(msg, undoable) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.innerHTML = '<div>' + esc(msg) + (undoable ? ' <button class="btn sm" type="button" data-act="undo">' + esc(t('undo')) + '</button>' : '') + '</div>';
        clearTimeout(U.toast);
        U.toast = setTimeout(() => { el.innerHTML = ''; U.undo = null; }, undoable ? 6000 : 3200);
    }

    // ------------------------------------------------------------------ screen 1: agent setup
    function instructionsSummary(c) {
        const a = ar();
        const out = [];
        out.push([t('sum_role'), roleName(c.role)]);
        out.push([t('sum_name'), c.name || t('sum_name_default')]);
        out.push([t('sum_tone'), t('tone_' + TONES.indexOf(c.tone))]);
        out.push([t('sum_lang'), t('dia_' + c.dialect)]);
        if (c.role === 'sales') {
            const s = c.sales;
            out.push([t('sum_approach'), t('appr_' + s.approach)]);
            out.push([t('sum_rules'), [s.recommend ? t('r_recommend') : null, s.upsell ? t('r_upsell') : null, s.collectLead ? t('r_lead') : null, s.closeOrder ? t('r_close') : null, t('disc_' + s.discount)].filter(Boolean).join(a ? '، ' : ', ')]);
        } else if (c.role === 'support') {
            const s = c.support;
            out.push([t('sum_rules'), [t('emp_' + s.empathy), s.askOrderNumber ? t('r_ordno') : null, s.escalateAngry ? t('r_escalate') : null, s.orderLookup ? t('r_lookup') : null].filter(Boolean).join(a ? '، ' : ', ')]);
            if (s.returnPolicy) out.push([t('sum_policy'), s.returnPolicy]);
        }
        out.push([t('sum_len'), t('len_' + c.length)]);
        if (c.custom.trim()) out.push([t('sum_custom'), c.custom.trim().slice(0, 140) + (c.custom.length > 140 ? '...' : '')]);
        out.push([t('sum_guard'), t('guard_short')]);
        return out;
    }

    function validateCfg(c) {
        const e = {};
        if (!c.role) e.role = t('err_role');
        if (c.name.length > 40) e.name = t('err_name_len');
        if (c.custom.length > MAX_CUSTOM) e.custom = t('err_custom_len');
        if (c.role === 'support' && c.support.returnPolicy.length > 400) e.policy = t('err_policy_len');
        return e;
    }

    function viewAgent() {
        const c = cfg();
        const errs = U.errors || {};
        const a = ar();
        const dirty = dirtyCfg(S.channel);
        const saved = S.savedAt[S.channel];
        const roleOpt = (r) => '<button type="button" class="role" role="radio" aria-checked="' + (c.role === r) + '" data-act="role" data-v="' + r + '"><span class="t"><span class="dot"></span>' + icon[r] + esc(roleName(r)) + '</span><span class="d">' + esc(t('role_' + r + '_desc')) + '</span></button>';
        let roleCard = '';
        if (c.role === 'sales') {
            const s = c.sales;
            roleCard = '<section class="card" aria-labelledby="h-sales"><h2 id="h-sales">' + esc(t('sales_title')) + '</h2><p class="hint">' + esc(t('sales_hint')) + '</p>' +
                '<div class="field"><span class="lbl">' + esc(t('sales_approach')) + '</span>' + seg('sales.approach', s.approach, [['consultative', t('appr_consultative')], ['direct', t('appr_direct')], ['soft', t('appr_soft')]], 'block', t('sales_approach')) + '<span class="help">' + esc(t('appr_help_' + s.approach)) + '</span></div>' +
                '<div class="field"><span class="lbl">' + esc(t('sales_discount')) + '</span>' + seg('sales.discount', s.discount, [['never', t('disc_never')], ['catalogue', t('disc_catalogue')]], 'block', t('sales_discount')) + '<span class="help">' + esc(t('disc_help')) + '</span></div>' +
                sw('sales.recommend', s.recommend, t('r_recommend'), t('r_recommend_d')) + sw('sales.upsell', s.upsell, t('r_upsell'), t('r_upsell_d')) + sw('sales.collectLead', s.collectLead, t('r_lead'), t('r_lead_d')) + sw('sales.closeOrder', s.closeOrder, t('r_close'), t('r_close_d')) +
                field('f-handoff', t('sales_handoff'), '<input type="text" id="f-handoff" data-act="txt" data-f="sales.handoff" maxlength="80" value="' + esc(s.handoff) + '" placeholder="' + esc(t('sales_handoff_ph')) + '">', t('sales_handoff_help')) + '</section>';
        } else if (c.role === 'support') {
            const s = c.support;
            roleCard = '<section class="card" aria-labelledby="h-sup"><h2 id="h-sup">' + esc(t('sup_title')) + '</h2><p class="hint">' + esc(t('sup_hint')) + '</p>' +
                '<div class="field"><span class="lbl">' + esc(t('sup_empathy')) + '</span>' + seg('support.empathy', s.empathy, [['high', t('emp_high')], ['balanced', t('emp_balanced')], ['brief', t('emp_brief')]], 'block', t('sup_empathy')) + '</div>' +
                sw('support.askOrderNumber', s.askOrderNumber, t('r_ordno'), t('r_ordno_d')) + sw('support.escalateAngry', s.escalateAngry, t('r_escalate'), t('r_escalate_d')) + sw('support.orderLookup', s.orderLookup, t('r_lookup'), t('r_lookup_d')) +
                field('f-policy', t('sup_policy'), '<textarea id="f-policy" data-act="txt" data-f="support.returnPolicy" rows="3" placeholder="' + esc(t('sup_policy_ph')) + '">' + esc(s.returnPolicy) + '</textarea>', t('sup_policy_help'), errs.policy) +
                field('f-hours', t('sup_hours'), '<input type="text" id="f-hours" data-act="txt" data-f="support.hours" maxlength="120" value="' + esc(s.hours) + '" placeholder="' + esc(t('sup_hours_ph')) + '">') + '</section>';
        } else {
            roleCard = '<div class="notice"><span>' + esc(t('pick_role_hint')) + '</span></div>';
        }

        const form =
            '<div class="chan" role="group" aria-label="' + esc(t('channel')) + '">' + CHANNELS.map((ch) => '<button type="button" data-act="chan" data-v="' + ch + '" aria-pressed="' + (S.channel === ch) + '">' + esc(chanName(ch)) + (dirtyCfg(ch) ? '<span class="dirty" title="' + esc(t('unsaved')) + '"></span>' : '') + '</button>').join('') + '</div>' +
            (errs.role || errs.name || errs.custom || errs.policy ? '<div class="notice err" role="alert"><b>' + esc(t('fix_errors')) + '</b></div>' : '') +
            '<section class="card" aria-labelledby="h-role"><h2 id="h-role">' + esc(t('role_title')) + '</h2><p class="hint">' + esc(t('role_hint')) + '</p><div class="roles" role="radiogroup" aria-labelledby="h-role">' + roleOpt('sales') + roleOpt('support') + '</div>' + (errs.role ? '<p class="errmsg" role="alert">' + esc(errs.role) + '</p>' : '') + '</section>' +
            roleCard +
            '<section class="card" aria-labelledby="h-voice"><h2 id="h-voice">' + esc(t('voice_title')) + '</h2><p class="hint">' + esc(t('voice_hint')) + '</p><div class="cols">' +
            field('f-name', t('f_name'), '<input type="text" id="f-name" data-act="txt" data-f="name" value="' + esc(c.name) + '" placeholder="' + esc(t('f_name_ph')) + '" maxlength="60">', t('f_name_help'), errs.name) +
            field('f-tone', t('f_tone'), select('tone', c.tone, TONES.map((x, i) => [x, t('tone_' + i)]), 'f-tone'), t('f_tone_help')) +
            field('f-gender', t('f_gender'), select('gender', c.gender, [['', t('choose')], ['male', t('g_male')], ['female', t('g_female')], ['neutral', t('g_neutral')]], 'f-gender')) +
            field('f-age', t('f_age'), select('age', c.age, [['young', t('a_young')], ['adult', t('a_adult')], ['mature', t('a_mature')]], 'f-age')) +
            field('f-dia', t('f_dialect'), select('dialect', c.dialect, DIALECTS.map((d) => [d, t('dia_' + d)]), 'f-dia'), t('f_dialect_help')) +
            '</div><div class="field"><span class="lbl">' + esc(t('f_model')) + '</span>' + seg('model', c.model, [['economy', t('m_economy')], ['balanced', t('m_balanced')], ['premium', t('m_premium')]], 'block', t('f_model')) + '<span class="help">' + esc(t('f_model_help')) + '</span></div></section>' +
            '<section class="accord"><button type="button" data-act="adv" aria-expanded="' + U.openAdv + '" aria-controls="adv-body">' + esc(t('adv_title')) + '</button>' +
            (U.openAdv ? '<div class="body" id="adv-body">' +
                field('f-custom', t('adv_custom'), '<textarea id="f-custom" data-act="txt" data-f="custom" rows="5" placeholder="' + esc(t('adv_custom_ph')) + '">' + esc(c.custom) + '</textarea>', null, errs.custom) +
                '<span class="help" id="custom-count">' + esc(c.custom.length + ' / ' + MAX_CUSTOM) + '</span>' +
                '<div class="notice"><span><b>' + esc(t('adv_precedence_t')) + '</b> ' + esc(t('adv_precedence')) + '</span></div>' +
                '<div class="field"><span class="lbl">' + esc(t('adv_len')) + '</span>' + seg('length', c.length, [['short', t('len_short')], ['medium', t('len_medium')], ['detailed', t('len_detailed')]], 'block', t('adv_len')) + '</div>' +
                sw('guard1', true, t('guard1'), t('guard1_d'), true) + sw('guard2', true, t('guard2'), t('guard2_d'), true) + sw('guard3', true, t('guard3'), t('guard3_d'), true) +
                '</div>' : '') + '</section>';

        const side = '<aside class="card sticky" aria-labelledby="h-sum"><h2 id="h-sum">' + esc(t('sum_title')) + '</h2><p class="hint">' + esc(t('sum_hint')) + '</p>' +
            '<ul class="preview-list" id="sum-list">' + instructionsSummary(c).map((r) => '<li><b>' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</li>').join('') + '</ul>' +
            '<p class="help" id="sum-note">' + esc(t('sum_note')) + '</p><div class="chips"><button type="button" class="btn sm primary" data-act="to-chat">' + esc(t('try_chat')) + '</button></div></aside>';

        const state = dirty ? t('unsaved_changes') : (saved ? t('saved_at') + ' ' + hhmm(new Date(saved)) : t('no_changes'));
        const bar = '<div class="savebar"><span class="state" id="agent-state">' + esc(state) + '</span><button type="button" class="btn ghost" data-act="discard-agent"' + (dirty ? '' : ' disabled') + '>' + esc(t('discard')) + '</button><button type="button" class="btn primary" data-act="save-agent">' + esc(t('save_local')) + '</button></div>';
        return '<div class="page-head"><h1>' + esc(t('agent_h1')) + '</h1><p>' + esc(t('agent_p')) + '</p></div><div class="grid2"><div>' + form + bar + '</div>' + side + '</div>';
    }

    // ------------------------------------------------------------------ screen 2: test chat
    function chatLang() { return U.chatLang || S.lang; }
    function chatState() {
        const ch = S.channel;
        if (!U.chats[ch]) U.chats[ch] = { msgs: [], greetedFor: null };
        return U.chats[ch];
    }
    function ensureGreeting() {
        const st = chatState();
        if (!st.msgs.length) st.msgs.push({ who: 'bot', text: E.greeting(cfg(), chatLang()), at: Date.now() });
    }
    function suggestions() {
        const c = cfg();
        const k = c.role === 'support' ? 'sup' : 'sal';
        return [1, 2, 3, 4].map((n) => t('sg_' + k + n));
    }
    function msgHtml(m) {
        return '<div class="msg ' + (m.who === 'me' ? 'me' : 'bot') + '" dir="auto">' + esc(m.text) + '<small>' + esc(m.who === 'bot' ? t('sim_label') + ' · ' : '') + esc(hhmm(new Date(m.at))) + '</small></div>';
    }
    function viewChat() {
        const c = cfg();
        ensureGreeting();
        const st = chatState();
        const typing = !!U.typing[S.channel];
        const name = c.name || t('sum_name_default');
        const noRole = !c.role;
        return '<div class="page-head"><h1>' + esc(t('chat_h1')) + '</h1><p>' + esc(t('chat_p')) + '</p></div>' +
            '<div class="card"><div class="cols">' +
            '<div class="field"><span class="lbl">' + esc(t('channel')) + '</span><div class="seg" role="group" aria-label="' + esc(t('channel')) + '">' + CHANNELS.map((ch) => '<button type="button" data-act="chan" data-v="' + ch + '" aria-pressed="' + (S.channel === ch) + '">' + esc(chanName(ch)) + '</button>').join('') + '</div></div>' +
            '<div class="field"><span class="lbl">' + esc(t('chat_lang')) + '</span><div class="seg" role="group" aria-label="' + esc(t('chat_lang')) + '"><button type="button" data-act="clang" data-v="ar" aria-pressed="' + (chatLang() === 'ar') + '">العربية</button><button type="button" data-act="clang" data-v="en" aria-pressed="' + (chatLang() === 'en') + '">English</button></div></div>' +
            '<div class="field"><span class="lbl">' + esc(t('chat_device')) + '</span><div class="seg" role="group" aria-label="' + esc(t('chat_device')) + '">' + ['phone', 'tablet', 'desktop'].map((d) => '<button type="button" data-act="device" data-v="' + d + '" aria-pressed="' + (U.device === d) + '">' + esc(t('dev_' + d)) + '</button>').join('') + '</div></div>' +
            '</div>' + (noRole ? '<div class="notice warn"><span>' + esc(t('chat_norole')) + ' <button type="button" class="btn sm" data-act="to-agent">' + esc(t('tab_agent')) + '</button></span></div>' : '<p class="help">' + esc(t('chat_uses')) + '</p>') + '</div>' +
            '<div class="chatwrap"><div class="device" data-device="' + U.device + '" id="device"><section class="chat" aria-label="' + esc(t('chat_h1')) + '">' +
            '<div class="chat-head"><div class="avatar" aria-hidden="true">' + esc(name.slice(0, 1).toUpperCase()) + '</div><div class="who"><b>' + esc(name) + '</b><span>' + esc(roleName(c.role)) + ' · ' + esc(chanName(S.channel)) + '</span></div>' +
            '<button type="button" class="btn sm" data-act="chat-reset">' + esc(t('chat_reset')) + '</button></div>' +
            '<div class="sim" role="note">' + esc(t('chat_sim')) + '</div>' +
            '<div class="log" id="log" role="log" aria-live="polite" aria-label="' + esc(t('chat_h1')) + '">' + st.msgs.map(msgHtml).join('') + (typing ? '<div class="typing" id="typing" role="status" aria-label="' + esc(t('typing')) + '"><i></i><i></i><i></i></div>' : '') + '</div>' +
            '<div class="suggest" aria-label="' + esc(t('chat_try')) + '">' + suggestions().map((s) => '<button type="button" class="chip" data-act="sugg" data-v="' + esc(s) + '"' + (typing ? ' disabled' : '') + '>' + esc(s) + '</button>').join('') + '</div>' +
            '<form class="composer" id="composer" action="#"><label class="sr" for="chat-input">' + esc(t('chat_input')) + '</label><textarea id="chat-input" rows="1" maxlength="500" placeholder="' + esc(t('chat_input')) + '" data-act="chat-in" dir="auto"></textarea><button type="button" class="btn primary" data-act="send" id="send" disabled>' + esc(t('send')) + '</button></form>' +
            '</section></div></div>';
    }
    function sendChat(text) {
        const ch = S.channel;
        text = String(text || '').trim();
        if (!text || U.typing[ch]) return;
        const st = chatState();
        st.msgs.push({ who: 'me', text, at: Date.now() });
        U.typing[ch] = true;
        const lang = chatLang();
        const conf = clone(cfg());
        if (S.tab === 'chat' && S.channel === ch) panel();
        setTimeout(() => {
            st.msgs.push({ who: 'bot', text: E.chatReply(conf, lang, text), at: Date.now() });
            U.typing[ch] = false;
            if (S.tab === 'chat' && S.channel === ch) { panel(); focusInput(); }
        }, 750 + Math.floor(Math.random() * 450));
        focusInput();
    }
    function focusInput() { const el = document.getElementById('chat-input'); if (el) el.focus(); }

    // ------------------------------------------------------------------ screen 3: follow-ups
    function validateFu(f) {
        const e = { steps: {}, general: null };
        if (!f.steps.length) e.general = t('fe_nosteps');
        if (FU_CHANNELS.every((c) => !f.channels[c])) e.general = t('fe_nochannel');
        if (f.hours.enabled && f.hours.start >= f.hours.end) e.hours = t('fe_hours');
        f.steps.forEach((s) => {
            const x = {};
            if (!(s.wait >= 1 && s.wait <= 43200)) x.wait = t('fe_wait');
            const hasMsg = s.en.trim() || s.ar.trim();
            if (!hasMsg) x.msg = s.mode === 'ai' ? t('fe_fallback') : t('fe_msg');
            if (s.goal.length > 200) x.goal = t('fe_goal');
            if (Object.keys(x).length) e.steps[s.id] = x;
        });
        e.any = !!(e.general || e.hours || Object.keys(e.steps).length);
        return e;
    }
    function cumulative(f, idx) { let m = 0; for (let i = 0; i <= idx; i++) m += f.steps[i].wait; return m; }
    function stepPreview(s, idx, role) {
        const lang = s.lang === 'auto' ? S.lang : s.lang;
        if (s.mode === 'ai') return E.aiPreview(role, lang, idx, s.goal);
        const raw = lang === 'ar' ? (s.ar.trim() || s.en.trim()) : (s.en.trim() || s.ar.trim());
        return raw.replace(/\{name\}/g, E.CATALOG.customer[lang === 'ar' ? 'ar' : 'en']);
    }
    function stepHtml(s, idx, f, errs) {
        const x = errs && errs.steps && errs.steps[s.id] || {};
        const n = f.steps.length;
        const cum = cumulative(f, idx);
        const role = (S.configs.whatsapp.role) || 'sales';
        const pv = U.previews[s.id];
        const unit = s.wait % 1440 === 0 ? 'day' : s.wait % 60 === 0 ? 'hour' : 'min';
        const val = unit === 'day' ? s.wait / 1440 : unit === 'hour' ? s.wait / 60 : s.wait;
        const pre = [30, 60, 120, 360, 720, 1440];
        return '<article class="step' + (Object.keys(x).length ? ' invalid' : '') + '" data-id="' + s.id + '" aria-label="' + esc(t('step') + ' ' + (idx + 1)) + '">' +
            '<div class="step-head"><span class="step-num">' + (idx + 1) + '</span><span class="ttl">' + esc(t('step') + ' ' + (idx + 1)) + ' <span class="chip ' + (s.mode === 'ai' ? 'accent' : '') + '">' + esc(s.mode === 'ai' ? t('mode_ai') : t('mode_fixed')) + '</span></span>' +
            '<div class="step-actions"><button type="button" class="btn icon sm" data-act="up" data-id="' + s.id + '" aria-label="' + esc(t('move_up')) + '"' + (idx === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="btn icon sm" data-act="down" data-id="' + s.id + '" aria-label="' + esc(t('move_down')) + '"' + (idx === n - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" class="btn icon sm" data-act="dup" data-id="' + s.id + '" aria-label="' + esc(t('duplicate')) + '"' + (n >= MAX_STEPS ? ' disabled' : '') + '>⧉</button>' +
            '<button type="button" class="btn icon sm warn" data-act="del" data-id="' + s.id + '" aria-label="' + esc(t('delete')) + '">✕</button></div></div>' +
            '<div class="field' + (x.wait ? ' err' : '') + '"><span class="lbl">' + esc(t('wait_label')) + '</span><div class="presets">' + pre.map((p) => '<button type="button" class="btn sm" data-act="wait" data-id="' + s.id + '" data-v="' + p + '" aria-pressed="' + (s.wait === p) + '">' + esc(fmtWait(p)) + '</button>').join('') + '</div>' +
            '<div class="waitrow"><label class="sr" for="w-' + s.id + '">' + esc(t('wait_custom')) + '</label><input type="number" id="w-' + s.id + '" min="1" max="999" value="' + val + '" data-act="wait-n" data-id="' + s.id + '">' +
            '<label class="sr" for="u-' + s.id + '">' + esc(t('wait_unit')) + '</label><select id="u-' + s.id + '" data-act="wait-u" data-id="' + s.id + '"><option value="min"' + (unit === 'min' ? ' selected' : '') + '>' + esc(t('u_min')) + '</option><option value="hour"' + (unit === 'hour' ? ' selected' : '') + '>' + esc(t('u_hour')) + '</option><option value="day"' + (unit === 'day' ? ' selected' : '') + '>' + esc(t('u_day')) + '</option></select>' +
            '<span class="cum">' + esc(idx === 0 ? t('after_quiet') : t('after_prev')) + ' · ' + esc(t('total') + ' ' + fmtWait(cum)) + '</span></div>' + (x.wait ? '<span class="errmsg" role="alert">' + esc(x.wait) + '</span>' : '') + '</div>' +
            '<div class="field"><span class="lbl">' + esc(t('mode_label')) + '</span><div class="seg block" role="group" aria-label="' + esc(t('mode_label')) + '"><button type="button" data-act="mode" data-id="' + s.id + '" data-v="fixed" aria-pressed="' + (s.mode === 'fixed') + '">' + esc(t('mode_fixed')) + '</button><button type="button" data-act="mode" data-id="' + s.id + '" data-v="ai" aria-pressed="' + (s.mode === 'ai') + '">' + esc(t('mode_ai')) + '</button></div></div>' +
            (s.mode === 'ai' ? '<div class="ai-box"><p class="help">' + esc(t('ai_help')) + '</p>' +
                '<div class="field' + (x.goal ? ' err' : '') + '"><label for="g-' + s.id + '">' + esc(t('ai_goal')) + '</label><input type="text" id="g-' + s.id + '" data-act="step-txt" data-id="' + s.id + '" data-f="goal" maxlength="240" value="' + esc(s.goal) + '" placeholder="' + esc(t('ai_goal_ph')) + '"><span class="help" dir="ltr"><span id="gc-' + s.id + '">' + s.goal.length + '</span> / 200</span>' + (x.goal ? '<span class="errmsg" role="alert">' + esc(x.goal) + '</span>' : '') + '</div>' +
                '<div class="field"><span class="lbl">' + esc(t('ai_lang')) + '</span><div class="seg" role="group" aria-label="' + esc(t('ai_lang')) + '">' + [['auto', t('lang_auto')], ['ar', 'العربية'], ['en', 'English']].map((o) => '<button type="button" data-act="slang" data-id="' + s.id + '" data-v="' + o[0] + '" aria-pressed="' + (s.lang === o[0]) + '">' + esc(o[1]) + '</button>').join('') + '</div><span class="help">' + esc(t('ai_lang_help')) + '</span></div></div>' : '') +
            '<div class="cols"><div class="field' + (x.msg ? ' err' : '') + '"><label for="e-' + s.id + '">' + esc(s.mode === 'ai' ? t('fallback_en') : t('msg_en')) + '</label><textarea id="e-' + s.id + '" data-act="step-txt" data-id="' + s.id + '" data-f="en" rows="3" dir="ltr" maxlength="1000">' + esc(s.en) + '</textarea></div>' +
            '<div class="field' + (x.msg ? ' err' : '') + '"><label for="a-' + s.id + '">' + esc(s.mode === 'ai' ? t('fallback_ar') : t('msg_ar')) + '</label><textarea id="a-' + s.id + '" data-act="step-txt" data-id="' + s.id + '" data-f="ar" rows="3" dir="rtl" maxlength="1000">' + esc(s.ar) + '</textarea></div></div>' +
            '<span class="help">' + esc(s.mode === 'ai' ? t('fallback_help') : t('msg_help')) + '</span>' + (x.msg ? ' <span class="errmsg" role="alert">' + esc(x.msg) + '</span>' : '') +
            '<div class="winwrap" data-win="' + s.id + '">' + winHtml(s, cum, f) + '</div>' +
            '<div class="chips"><button type="button" class="btn sm" data-act="preview" data-id="' + s.id + '"' + (pv && pv.loading ? ' disabled' : '') + '>' + esc(s.mode === 'ai' ? t('preview_ai') : t('preview_fixed')) + '</button></div>' +
            '<div class="preview-out" id="pv-' + s.id + '" aria-live="polite">' + previewHtml(pv, s, idx, role) + '</div></article>';
    }
    function winHtml(s, cum, f) {
        return cum >= WINDOW_MIN && f.channels.whatsapp ? '<div class="notice warn"><span>' + esc(s.mode === 'ai' ? t('win_ai') : t('win_fixed')) + '</span></div>' : '';
    }
    // The wait fields change the totals of every later step. Update those in place: a redraw on blur would swallow the
    // click on whatever the person pressed next (Save, for instance).
    function refreshWait() {
        const f = fu();
        f.steps.forEach((s, i) => {
            const el = document.querySelector('.step[data-id="' + s.id + '"]');
            if (!el) return;
            const cum = cumulative(f, i);
            const c = el.querySelector('.cum'); if (c) c.textContent = (i === 0 ? t('after_quiet') : t('after_prev')) + ' · ' + t('total') + ' ' + fmtWait(cum);
            el.querySelectorAll('.presets [data-act="wait"]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-v')) === s.wait)));
            const w = el.querySelector('.winwrap'); if (w) w.innerHTML = winHtml(s, cum, f);
        });
        const tl = document.querySelectorAll('.timeline .when');
        f.steps.forEach((s, i) => { if (tl[i]) tl[i].textContent = t('tl_at') + ' ' + fmtWait(cumulative(f, i)); });
    }
    function previewHtml(pv, s, idx, role) {
        if (!pv) return '';
        if (pv.loading) return '<span class="spinner" aria-hidden="true"></span> ' + esc(t('writing'));
        const lang = s.lang === 'auto' ? S.lang : s.lang;
        return '<div class="bubble" dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '">' + esc(pv.text) + '</div><p class="help">' + esc(pv.ai ? t('pv_ai_note') : t('pv_fixed_note')) + '</p>';
    }
    function viewFollowups() {
        const f = fu();
        const errs = U.fuErrors;
        const dirty = dirtyFu();
        const role = S.configs.whatsapp.role || 'sales';
        let list;
        if (U.fuLoading) list = '<div class="skel"></div><div class="skel"></div>';
        else if (!f.steps.length) list = '<div class="empty"><h3>' + esc(t('empty_title')) + '</h3><p>' + esc(t('empty_p')) + '</p><div class="chips center"><button type="button" class="btn primary" data-act="add">' + esc(t('add_step')) + '</button><button type="button" class="btn" data-act="example">' + esc(t('load_example')) + '</button></div></div>';
        else list = '<div class="steps">' + f.steps.map((s, i) => stepHtml(s, i, f, errs)).join('') + '</div>';
        const timeline = f.steps.length ? '<section class="card" aria-labelledby="h-tl"><h2 id="h-tl">' + esc(t('tl_title')) + '</h2><p class="hint">' + esc(t('tl_hint')) + '</p><div class="timeline">' +
            '<div class="tl-row"><span class="tl-dot"></span><div><b>' + esc(t('tl_start')) + '</b></div></div>' +
            f.steps.map((s, i) => '<div class="tl-row"><span class="tl-dot"></span><div><b>' + esc(t('step') + ' ' + (i + 1)) + ' · ' + esc(s.mode === 'ai' ? t('mode_ai') : t('mode_fixed')) + '</b><div class="when">' + esc(t('tl_at') + ' ' + fmtWait(cumulative(f, i))) + '</div></div></div>').join('') + '</div></section>' : '';
        const state = dirty ? t('unsaved_changes') : (S.savedAt.fu ? t('saved_at') + ' ' + hhmm(new Date(S.savedAt.fu)) : t('no_changes'));
        return '<div class="page-head"><h1>' + esc(t('fu_h1')) + '</h1><p>' + esc(t('fu_p')) + '</p></div>' +
            '<div class="notice"><span><b>' + esc(t('fu_flag_t')) + '</b> ' + esc(t('fu_flag')) + '</span></div>' +
            (errs && errs.any ? '<div class="notice err" role="alert"><b>' + esc(t('fix_errors')) + '</b>' + (errs.general ? ' ' + esc(errs.general) : '') + '</div>' : '') +
            '<div class="grid2"><div>' +
            '<section class="card" aria-labelledby="h-fs"><h2 id="h-fs">' + esc(t('fs_title')) + '</h2>' +
            sw('fu.enabled', f.enabled, t('fs_enabled'), t('fs_enabled_d')) +
            '<div class="field"><span class="lbl">' + esc(t('fs_channels')) + '</span><div class="chips">' + FU_CHANNELS.map((c) => '<button type="button" class="chip ' + (f.channels[c] ? 'ok' : '') + '" role="switch" aria-checked="' + !!f.channels[c] + '" data-act="fch" data-v="' + c + '">' + (f.channels[c] ? '✓ ' : '') + esc(chanName(c)) + '</button>').join('') + '</div><span class="help">' + esc(t('fs_channels_help')) + '</span></div>' +
            sw('fu.hours.enabled', f.hours.enabled, t('fs_hours'), t('fs_hours_d')) +
            (f.hours.enabled ? '<div class="cols">' + field('h-start', t('fs_from'), '<input type="time" id="h-start" data-act="hrs" data-f="start" value="' + esc(f.hours.start) + '">') + field('h-end', t('fs_to'), '<input type="time" id="h-end" data-act="hrs" data-f="end" value="' + esc(f.hours.end) + '">', null, errs && errs.hours) + '</div>' : '') +
            '<div class="field"><span class="lbl">' + esc(t('fs_stops')) + '</span><div class="chips">' + ['s1', 's2', 's3', 's4', 's5'].map((k) => '<span class="chip">' + esc(t('stop_' + k)) + '</span>').join('') + '</div></div></section>' +
            '<section class="card" aria-labelledby="h-seq"><h2 id="h-seq">' + esc(t('seq_title')) + '</h2><p class="hint">' + esc(t('seq_hint')) + '</p><div class="chips">' +
            '<button type="button" class="btn sm primary" data-act="add"' + (f.steps.length >= MAX_STEPS ? ' disabled' : '') + '>' + esc(t('add_step')) + '</button>' +
            '<button type="button" class="btn sm" data-act="example">' + esc(t('load_example')) + '</button>' +
            '<button type="button" class="btn sm" data-act="reload">' + esc(t('reload_saved')) + '</button>' +
            '<button type="button" class="btn sm warn" data-act="clear"' + (f.steps.length ? '' : ' disabled') + '>' + esc(t('clear_all')) + '</button></div>' +
            (f.steps.length >= MAX_STEPS ? '<p class="help">' + esc(t('max_steps')) + '</p>' : '') + '</section>' + list +
            '<div class="savebar"><span class="state" id="fu-state">' + esc(state) + '</span><button type="button" class="btn ghost" data-act="discard-fu"' + (dirty ? '' : ' disabled') + '>' + esc(t('discard')) + '</button><button type="button" class="btn primary" data-act="save-fu">' + esc(t('save_local')) + '</button></div></div>' +
            '<div>' + timeline + '<aside class="card" aria-labelledby="h-cap"><h2 id="h-cap">' + esc(t('cap_title')) + '</h2><ul class="preview-list"><li>' + esc(t('cap_wa')) + '</li><li>' + esc(t('cap_ms')) + '</li><li>' + esc(t('cap_ig')) + '</li><li>' + esc(t('cap_web')) + '</li><li>' + esc(t('cap_ai')) + '</li></ul></aside></div></div>';
    }

    // ------------------------------------------------------------------ screen 4: about
    function viewAbout() {
        return '<div class="page-head"><h1>' + esc(t('about_h1')) + '</h1><p>' + esc(t('about_p')) + '</p></div>' +
            '<section class="card about"><h2>' + esc(t('about_real_t')) + '</h2><ul>' + [1, 2, 3, 4, 5, 6, 7].map((n) => '<li>' + esc(t('about_no' + n)) + '</li>').join('') + '</ul></section>' +
            '<section class="card about"><h2>' + esc(t('about_sim_t')) + '</h2><ul>' + [1, 2, 3, 4].map((n) => '<li>' + esc(t('about_sim' + n)) + '</li>').join('') + '</ul></section>' +
            '<section class="card about"><h2>' + esc(t('about_store_t')) + '</h2><p>' + esc(t('about_store')) + ' <code>' + STORAGE_KEY + '</code>. ' + esc(storageOk ? '' : t('about_nostore')) + '</p></section>' +
            '<section class="card about"><h2>' + esc(t('about_how_t')) + '</h2><ul>' + [1, 2, 3, 4].map((n) => '<li>' + esc(t('about_how' + n)) + '</li>').join('') + '</ul></section>';
    }

    // ------------------------------------------------------------------ actions
    function resetModal() {
        const m = document.getElementById('modal');
        m.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-t"><div class="box"><h2 id="m-t">' + esc(t('reset_title')) + '</h2><p>' + esc(t('reset_text')) + '</p><div class="row"><button type="button" class="btn" data-act="reset-cancel" id="m-cancel">' + esc(t('cancel')) + '</button><button type="button" class="btn primary" data-act="reset-do">' + esc(t('reset_demo')) + '</button></div></div></div>';
        const b = document.getElementById('m-cancel'); if (b) b.focus();
    }
    function closeModal() { const m = document.getElementById('modal'); if (m) m.innerHTML = ''; }

    function saveAgent() {
        const c = editCfg();
        const e = validateCfg(c);
        U.errors = Object.keys(e).length ? e : null;
        if (U.errors) { panel(); const first = document.querySelector('.field.err input, .field.err textarea, .errmsg'); if (first && first.focus) first.focus(); return; }
        S.configs[S.channel] = clone(c);
        delete U.drafts[S.channel];
        S.savedAt[S.channel] = Date.now();
        persist();
        refreshTabs(); panel();
        toast(t('toast_saved'));
    }
    function saveFu() {
        const f = editFu();
        const e = validateFu(f);
        U.fuErrors = e.any ? e : null;
        if (e.any) { panel(); const el = document.querySelector('.step.invalid, .notice.err'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); return; }
        S.followups = clone(f);
        U.fuDraft = null;
        S.savedAt.fu = Date.now();
        persist();
        refreshTabs(); panel();
        toast(t('toast_saved'));
    }

    function stepById(id) { return editFu().steps.find((s) => s.id === id); }
    function minutesFrom(val, unit) { return Math.round(Number(val) * (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1)); }

    function onClick(ev) {
        const el = ev.target.closest('[data-act]');
        if (!el || el.disabled) return;
        const act = el.getAttribute('data-act'), v = el.getAttribute('data-v'), f = el.getAttribute('data-f'), id = el.getAttribute('data-id');
        switch (act) {
            case 'tab': S.tab = v; persist(); location.hash = v; refreshTabs(); panel(); { const p = document.getElementById('panel'); if (p) window.scrollTo(0, 0); } break;
            case 'lang': S.lang = ar() ? 'en' : 'ar'; U.chatLang = null; U.chats = {}; U.previews = {}; persist(); shell(); break;
            case 'theme': S.theme = S.theme === 'light' ? 'dark' : 'light'; persist(); shell(); break;
            case 'reset-ask': resetModal(); break;
            case 'reset-cancel': closeModal(); break;
            case 'reset-do': try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* nothing stored */ } S = defaults(); Object.assign(U, { drafts: {}, fuDraft: null, chats: {}, typing: {}, chatLang: null, errors: null, fuErrors: null, previews: {}, openAdv: false }); closeModal(); shell(); toast(t('toast_reset')); break;
            case 'chan': S.channel = v; U.errors = null; persist(); panel(); refreshTabs(); break;
            case 'role': { editCfg().role = v; U.errors = null; panel(); refreshTabs(); break; }
            case 'set': { const c = editCfg(); setPath(c, f, v); panel(); refreshTabs(); break; }
            case 'tgl': { if (f.indexOf('fu.') === 0) { const d = editFu(); setPath(d, f.slice(3), !getPath(d, f.slice(3))); } else { const c = editCfg(); setPath(c, f, !getPath(c, f)); } panel(); refreshTabs(); break; }
            case 'adv': U.openAdv = !U.openAdv; panel(); break;
            case 'save-agent': saveAgent(); break;
            case 'discard-agent': delete U.drafts[S.channel]; U.errors = null; refreshTabs(); panel(); toast(t('toast_discarded')); break;
            case 'to-chat': S.tab = 'chat'; persist(); refreshTabs(); panel(); window.scrollTo(0, 0); break;
            case 'to-agent': S.tab = 'agent'; persist(); refreshTabs(); panel(); window.scrollTo(0, 0); break;
            case 'clang': U.chatLang = v; U.chats = {}; panel(); break;
            case 'device': U.device = v; panel(); break;
            case 'chat-reset': delete U.chats[S.channel]; U.typing[S.channel] = false; panel(); focusInput(); break;
            case 'sugg': sendChat(v); break;
            case 'send': { const inp = document.getElementById('chat-input'); if (inp) { const tx = inp.value; inp.value = ''; sendChat(tx); } break; }
            // follow-ups
            case 'fch': { const d = editFu(); d.channels[v] = !d.channels[v]; panel(); refreshTabs(); break; }
            case 'add': { const d = editFu(); if (d.steps.length < MAX_STEPS) d.steps.push(stepDefault(d.steps.length)); U.fuErrors = null; panel(); refreshTabs(); break; }
            case 'example': { const d = editFu(); d.steps = exampleSteps(); U.fuErrors = null; U.previews = {}; panel(); refreshTabs(); toast(t('toast_example')); break; }
            case 'clear': { const d = editFu(); U.undo = { steps: clone(d.steps) }; d.steps = []; U.fuErrors = null; panel(); refreshTabs(); toast(t('toast_cleared'), true); break; }
            case 'reload': U.fuLoading = true; U.fuDraft = null; U.fuErrors = null; U.previews = {}; panel(); refreshTabs(); setTimeout(() => { U.fuLoading = false; if (S.tab === 'followups') panel(); toast(t('toast_reloaded')); }, 800); break;
            case 'discard-fu': U.fuDraft = null; U.fuErrors = null; refreshTabs(); panel(); toast(t('toast_discarded')); break;
            case 'save-fu': saveFu(); break;
            case 'undo': if (U.undo) { editFu().steps = U.undo.steps; U.undo = null; panel(); refreshTabs(); document.getElementById('toast').innerHTML = ''; toast(t('toast_restored')); } break;
            case 'mode': stepById(id).mode = v; U.fuErrors = null; delete U.previews[id]; panel(); refreshTabs(); break;
            case 'slang': stepById(id).lang = v; delete U.previews[id]; panel(); break;
            case 'wait': { stepById(id).wait = Number(v); U.fuErrors = null; panel(); refreshTabs(); break; }
            case 'dup': { const d = editFu(); const i = d.steps.findIndex((s) => s.id === id); if (i >= 0 && d.steps.length < MAX_STEPS) { const c = clone(d.steps[i]); c.id = uid(); d.steps.splice(i + 1, 0, c); } panel(); refreshTabs(); break; }
            case 'del': { const d = editFu(); const i = d.steps.findIndex((s) => s.id === id); if (i >= 0) { U.undo = { steps: clone(d.steps) }; d.steps.splice(i, 1); } U.fuErrors = null; panel(); refreshTabs(); toast(t('toast_deleted'), true); break; }
            case 'up': case 'down': { const d = editFu(); const i = d.steps.findIndex((s) => s.id === id); const j = act === 'up' ? i - 1 : i + 1; if (i >= 0 && j >= 0 && j < d.steps.length) { const x = d.steps[i]; d.steps[i] = d.steps[j]; d.steps[j] = x; } panel(); refreshTabs(); { const b = document.querySelector('[data-act="' + act + '"][data-id="' + id + '"]'); if (b && !b.disabled) b.focus(); } break; }
            case 'preview': {
                const d = editFu(); const s = d.steps.find((x) => x.id === id); if (!s) break;
                U.previews[id] = { loading: true }; panel();
                setTimeout(() => {
                    const cur = fu().steps.findIndex((x) => x.id === id);
                    if (cur < 0) return;
                    const st = fu().steps[cur];
                    U.previews[id] = { text: stepPreview(st, cur, S.configs.whatsapp.role || 'sales'), ai: st.mode === 'ai' };
                    if (S.tab === 'followups') { const out = document.getElementById('pv-' + id); if (out) out.innerHTML = previewHtml(U.previews[id], st, cur, ''); const b = document.querySelector('[data-act="preview"][data-id="' + id + '"]'); if (b) b.disabled = false; }
                }, s.mode === 'ai' ? 900 : 250);
                break;
            }
            default: break;
        }
    }
    function onChange(ev) {
        const el = ev.target;
        const act = el.getAttribute && el.getAttribute('data-act');
        if (act === 'sel') { const c = editCfg(); setPath(c, el.getAttribute('data-f'), el.value); refreshMeta(); }
        else if (act === 'wait-n' || act === 'wait-u') {
            const id = el.getAttribute('data-id');
            const num = document.getElementById('w-' + id), unit = document.getElementById('u-' + id);
            const s = stepById(id); s.wait = minutesFrom(num.value || 0, unit.value); refreshWait(); refreshMeta();
        } else if (act === 'hrs') { editFu().hours[el.getAttribute('data-f')] = el.value; refreshTabs(); }
    }
    function onInput(ev) {
        const el = ev.target;
        const act = el.getAttribute && el.getAttribute('data-act');
        if (act === 'txt') {
            const c = editCfg(); setPath(c, el.getAttribute('data-f'), el.value);
            refreshMeta();
        } else if (act === 'step-txt') {
            const id = el.getAttribute('data-id'), f = el.getAttribute('data-f');
            const s = stepById(id); s[f] = el.value;
            if (f === 'goal') { const c = document.getElementById('gc-' + id); if (c) c.textContent = String(el.value.length); }
            delete U.previews[id];
            refreshMeta();
        } else if (act === 'wait-n') {
            const id = el.getAttribute('data-id'); const unit = document.getElementById('u-' + id);
            stepById(id).wait = minutesFrom(el.value || 0, unit.value); refreshWait(); refreshMeta();
        } else if (act === 'chat-in') {
            const send = document.getElementById('send'); if (send) send.disabled = !el.value.trim() || !!U.typing[S.channel];
            el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
    }
    function refreshMeta() {
        refreshTabs();
        const sl = document.getElementById('sum-list');
        if (sl) sl.innerHTML = instructionsSummary(cfg()).map((r) => '<li><b>' + esc(r[0]) + ':</b> ' + esc(r[1]) + '</li>').join('');
        const cc = document.getElementById('custom-count'); if (cc) cc.textContent = cfg().custom.length + ' / ' + MAX_CUSTOM;
        const as = document.getElementById('agent-state'); if (as) as.textContent = dirtyCfg(S.channel) ? t('unsaved_changes') : (S.savedAt[S.channel] ? t('saved_at') + ' ' + hhmm(new Date(S.savedAt[S.channel])) : t('no_changes'));
        const fs = document.getElementById('fu-state'); if (fs) fs.textContent = dirtyFu() ? t('unsaved_changes') : (S.savedAt.fu ? t('saved_at') + ' ' + hhmm(new Date(S.savedAt.fu)) : t('no_changes'));
        const da = document.querySelector('[data-act="discard-agent"]'); if (da) da.disabled = !dirtyCfg(S.channel);
        const df = document.querySelector('[data-act="discard-fu"]'); if (df) df.disabled = !dirtyFu();
        document.querySelectorAll('.chan button').forEach((b) => { const ch = b.getAttribute('data-v'); const d = b.querySelector('.dirty'); if (dirtyCfg(ch) && !d) b.insertAdjacentHTML('beforeend', '<span class="dirty" title="' + esc(t('unsaved')) + '"></span>'); else if (!dirtyCfg(ch) && d) d.remove(); });
    }
    function onKey(ev) {
        const el = ev.target;
        if (el && el.id === 'chat-input' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); const tx = el.value; el.value = ''; el.style.height = 'auto'; sendChat(tx); const s = document.getElementById('send'); if (s) s.disabled = true; }
        if (ev.key === 'Escape') closeModal();
        if (el && el.getAttribute && el.getAttribute('role') === 'tab' && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
            const dir = (ev.key === 'ArrowRight') === !ar() ? 1 : -1;
            const i = (TABS.indexOf(S.tab) + dir + TABS.length) % TABS.length;
            S.tab = TABS[i]; persist(); location.hash = S.tab; refreshTabs(); panel(); const nt = document.getElementById('tab-' + S.tab); if (nt) nt.focus();
        }
    }

    app.addEventListener('submit', (ev) => ev.preventDefault());
    app.addEventListener('click', onClick);
    app.addEventListener('change', onChange);
    app.addEventListener('input', onInput);
    app.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (TABS.indexOf(h) >= 0 && h !== S.tab) { S.tab = h; refreshTabs(); panel(); } });
    window.addEventListener('resize', syncBannerHeight);

    const h0 = location.hash.replace('#', '');
    if (TABS.indexOf(h0) >= 0) S.tab = h0;
    shell();
})();
