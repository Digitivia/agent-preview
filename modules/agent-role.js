// agent-role.js — "What should this agent do?" (Sales Agent / Customer Service).
//
// Loaded as a classic script AFTER the main app script (same pattern as
// modules/prompt-builder.js). It never renders on its own: a MutationObserver
// watches for the empty `.agent-role-slot` that each agent tab carries and mounts
// a small card into it. The two stub pills that used to sit there stay inside the
// slot as the fallback if this file ever fails to load.
//
// What the card writes (nothing else, and never the system prompt):
//   agent_configs.persona.role            this channel's role: 'sales' | 'support'
//   organizations.external_onboarding_data.business.reply_language   'auto' | 'ar' | 'en'
// The database turns a role into the agent's persona at read time
// (public.resolve_agent_prompt), only when the merchant wrote no prompt of their own,
// so choosing a role can never overwrite anything a merchant typed.
(function () {
    'use strict';

    const AGENT_IDS = ['website', 'whatsapp', 'page', 'instagram', 'telegram'];
    const ROLES = ['sales', 'support'];
    const REPLY_LANGS = ['auto', 'ar', 'en'];

    const lang = () => ((localStorage.getItem('app_language') || 'en') === 'ar' ? 'ar' : 'en');

    const TXT = {
        en: {
            title: 'What should this agent do?',
            sub: 'Pick one and the agent works well straight away, with no instructions to write. Instructions you write yourself always come first.',
            sales: 'Sales Agent',
            sales_desc: 'Answers product questions, recommends what fits, handles objections and takes the order.',
            support: 'Customer Service',
            support_desc: 'Solves problems, answers from your knowledge and policies, and passes hard cases to your team.',
            lang_label: 'Reply language',
            lang_auto: 'Match the customer (Egyptian Arabic for Arabic)',
            lang_ar: 'Always Egyptian Arabic',
            lang_en: 'Always English',
            saving: 'Saving',
            saved: 'Saved',
            err: 'Could not save. Try again.',
            err_norow: 'Save this agent once first, then pick a role.',
            no_perm: 'Only people who can configure agents can change this.',
            own_prompt: 'You wrote your own instructions below, so they are used instead of this role. Clear them to use the role.',
            inactive: 'Saved. The role starts working when your workspace is switched over to it.',
            active: 'Active. This agent now follows this role.',
            from_business: 'Using the role from your business setup',
            from_business_inactive: 'Using the role from your business setup. It starts working when your workspace is switched over to it.',
            group: 'Agent role',
        },
        ar: {
            title: 'الإيجنت ده هيعمل إيه؟',
            sub: 'اختار واحدة والإيجنت يشتغل كويس على طول من غير ما تكتب تعليمات. التعليمات اللي تكتبها بنفسك دايمًا ليها الأولوية.',
            sales: 'مندوب مبيعات',
            sales_desc: 'بيرد على أسئلة المنتجات، ويرشّحلك المناسب، ويتعامل مع الاعتراضات، ويكمّل الطلب.',
            support: 'خدمة عملاء',
            support_desc: 'بيحل المشاكل، ويجاوب من معلوماتك وسياساتك، ويحوّل الحالات الصعبة لفريقك.',
            lang_label: 'لغة الرد',
            lang_auto: 'زي العميل (مصري لو العميل بيكتب عربي)',
            lang_ar: 'مصري دايمًا',
            lang_en: 'إنجليزي دايمًا',
            saving: 'بنحفظ',
            saved: 'اتحفظ',
            err: 'مقدرناش نحفظ. جرّب تاني.',
            err_norow: 'احفظ الإيجنت ده مرة الأول، وبعدين اختار الدور.',
            no_perm: 'بس اللي ليهم صلاحية ضبط الإيجنت يقدروا يغيّروا ده.',
            own_prompt: 'انت كتبت تعليماتك الخاصة تحت، فبتتستخدم هي بدل الدور ده. امسحها لو عايز تستخدم الدور.',
            inactive: 'اتحفظ. الدور هيبدأ يشتغل لما نفعّله على حسابك.',
            active: 'شغال. الإيجنت ده دلوقتي ماشي على الدور ده.',
            from_business: 'ماشي بالدور اللي اخترته في إعداد نشاطك',
            from_business_inactive: 'ماشي بالدور اللي اخترته في إعداد نشاطك. هيبدأ يشتغل لما نفعّله على حسابك.',
            group: 'دور الإيجنت',
        },
    };
    const T = (k) => TXT[lang()][k];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const sb = () => window.supabaseClient;
    const orgId = () => window.currentUserOrgId;
    const canEdit = () => (typeof window.hasPermission === 'function' ? !!window.hasPermission('agents.configure') : true);

    // ---- data ---------------------------------------------------------------
    // One read answers all agent tabs mounted in the same instant (the tabs are all
    // decorated together at boot). Shared only while in flight; a later mount reads again.
    let inFlight = { org: null, promise: null };
    function loadState() {
        const org = orgId();
        if (!(inFlight.promise && inFlight.org === org)) {
            const promise = (async () => {
                const out = { agents: {}, business: {} };
                try {
                    const { data } = await sb().from('agent_configs')
                        .select('agent, persona, system_prompt').eq('org_id', org).in('agent', AGENT_IDS);
                    (data || []).forEach((r) => { if (r && r.agent) out.agents[r.agent] = r; });
                } catch (e) { /* the card still renders, just without saved state */ }
                try {
                    const { data } = await sb().from('organizations').select('external_onboarding_data').eq('id', org).maybeSingle();
                    const eod = data && data.external_onboarding_data;
                    if (eod && typeof eod === 'object' && eod.business && typeof eod.business === 'object') out.business = eod.business;
                } catch (e) { /* same */ }
                return out;
            })();
            inFlight = { org, promise };
            promise.finally(() => { if (inFlight.promise === promise) inFlight = { org: null, promise: null }; });
        }
        return inFlight.promise;
    }

    async function resolverMode(agent) {
        try {
            const { data, error } = await sb().rpc('resolve_agent_prompt', { p_org_id: orgId(), p_agent: agent });
            if (error || !data || typeof data !== 'object') return null;
            return data;
        } catch (e) { return null; }
    }

    async function writeAgentRole(agent, role) {
        const { data: cur, error: readErr } = await sb().from('agent_configs')
            .select('persona').eq('org_id', orgId()).eq('agent', agent).maybeSingle();
        if (readErr) throw readErr;
        if (!cur) { const e = new Error('no_row'); e.code = 'no_row'; throw e; }
        const persona = (cur.persona && typeof cur.persona === 'object' && !Array.isArray(cur.persona)) ? { ...cur.persona } : {};
        persona.role = role;
        const { data, error } = await sb().from('agent_configs')
            .update({ persona, updated_at: new Date().toISOString() })
            .eq('org_id', orgId()).eq('agent', agent).select('id');
        if (error) throw error;
        if (!data || !data.length) { const e = new Error('no_row'); e.code = 'no_row'; throw e; }
    }

    async function writeReplyLanguage(value) {
        const { data, error: readErr } = await sb().from('organizations')
            .select('external_onboarding_data').eq('id', orgId()).maybeSingle();
        if (readErr) throw readErr;
        const eod = (data && data.external_onboarding_data && typeof data.external_onboarding_data === 'object')
            ? JSON.parse(JSON.stringify(data.external_onboarding_data)) : {};
        eod.business = (eod.business && typeof eod.business === 'object') ? eod.business : {};
        eod.business.reply_language = value;
        const { error } = await sb().from('organizations').update({ external_onboarding_data: eod }).eq('id', orgId());
        if (error) throw error;
        if (window.currentOrgData && typeof window.currentOrgData === 'object') window.currentOrgData.external_onboarding_data = eod;
    }

    // ---- view ---------------------------------------------------------------
    const ICON = {
        sales: '<svg class="ar-ico" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM1 2v2h2l3.6 7.6-1.4 2.4A2 2 0 0 0 7 17h12v-2H7.4l1.1-2h7.5a2 2 0 0 0 1.7-1l3.6-6.5A1 1 0 0 0 20.4 4H5.2l-.9-2H1z"/></svg>',
        support: '<svg class="ar-ico" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1v1a2 2 0 0 1-2 2h-3v2h3a4 4 0 0 0 4-4v-1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/></svg>',
    };

    function injectStyles() {
        if (document.getElementById('ar-styles')) return;
        const st = document.createElement('style');
        st.id = 'ar-styles';
        st.textContent = `
.ar-card { margin-block-start: var(--sp-4, 16px); padding: var(--sp-4, 16px); border: 1px solid var(--sp-line, #2a2f39);
  border-radius: var(--sp-r-lg, 14px); background: var(--sp-surface, #171a20); color: var(--sp-ink, #e9edf3); }
.ar-title { font-size: var(--sp-t-lg, 1rem); font-weight: 600; line-height: var(--sp-lh-tight, 1.25); }
.ar-sub { margin-block: var(--sp-1, 4px) var(--sp-3, 12px); font-size: var(--sp-t-sm, 0.8125rem); color: var(--sp-ink-2, #9aa2ae); line-height: var(--sp-lh, 1.5); }
.ar-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--sp-3, 12px); }
.ar-opt { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2, 8px); min-block-size: 44px; text-align: start;
  padding: var(--sp-3, 12px) var(--sp-4, 16px); border: 1px solid var(--sp-line-2, #39404c); border-radius: var(--sp-r-md, 10px);
  background: var(--sp-surface-2, #1e222a); color: inherit; font: inherit; cursor: pointer; }
.ar-opt:hover { border-color: var(--sp-accent, #6d6bd9); }
.ar-opt:focus-visible { outline: 2px solid var(--sp-focus, #8b89ea); outline-offset: 2px; }
.ar-opt[aria-checked="true"] { border-color: var(--sp-accent, #6d6bd9); background: var(--sp-accent-soft, rgba(109,107,217,.16)); }
.ar-opt[disabled] { opacity: .6; cursor: not-allowed; }
.ar-opt-head { display: flex; align-items: center; gap: var(--sp-2, 8px); font-weight: 600; font-size: var(--sp-t-md, 0.875rem); }
.ar-opt-desc { font-size: var(--sp-t-sm, 0.8125rem); color: var(--sp-ink-2, #9aa2ae); line-height: var(--sp-lh, 1.5); }
.ar-ico { flex: none; }
.ar-lang { margin-block-start: var(--sp-4, 16px); display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2, 8px) var(--sp-3, 12px); }
.ar-lang label { font-size: var(--sp-t-sm, 0.8125rem); color: var(--sp-ink-2, #9aa2ae); }
.ar-lang select { min-block-size: 44px; max-inline-size: 100%; padding: 0 var(--sp-3, 12px); border-radius: var(--sp-r-md, 10px);
  border: 1px solid var(--sp-line-2, #39404c); background: var(--sp-surface-2, #1e222a); color: var(--sp-ink, #e9edf3); font: inherit; font-size: 16px; }
.ar-status { min-block-size: 1.25rem; margin-block-start: var(--sp-3, 12px); font-size: var(--sp-t-sm, 0.8125rem); color: var(--sp-ink-2, #9aa2ae); }
.ar-status.ok { color: var(--sp-ok, #3fb27f); } .ar-status.bad { color: var(--sp-err, #e5726f); }
.ar-note { margin-block-start: var(--sp-3, 12px); padding: var(--sp-2, 8px) var(--sp-3, 12px); border-radius: var(--sp-r-md, 10px);
  background: var(--sp-warn-soft, #3a2f14); color: var(--sp-warn-ink, #f6e6c4); font-size: var(--sp-t-sm, 0.8125rem); line-height: var(--sp-lh, 1.5); }
@media (prefers-reduced-motion: no-preference) { .ar-opt { transition: border-color .15s ease, background-color .15s ease; } }
`;
        document.head.appendChild(st);
    }

    function cardHtml(agent, s) {
        const role = s.role;
        const disabled = (!s.editable || s.busy) ? ' disabled' : '';
        const opts = ROLES.map((r, i) => {
            const on = role === r;
            // Roving tabindex: the chosen option, else the first, is the one tab stop in the group.
            const tab = on || (!role && i === 0) ? 0 : -1;
            return `<button type="button" class="ar-opt" role="radio" aria-checked="${on}" tabindex="${tab}" data-role="${r}"${disabled}>
                <span class="ar-opt-head">${ICON[r]}<span>${esc(T(r))}</span></span>
                <span class="ar-opt-desc">${esc(T(r + '_desc'))}</span>
            </button>`;
        }).join('');
        const langOpts = REPLY_LANGS.map((l) =>
            `<option value="${l}"${s.replyLang === l ? ' selected' : ''}>${esc(T('lang_' + l))}</option>`).join('');
        const id = `ar-lang-${agent}`;
        return `<div class="ar-card" data-ar-card="${agent}">
            <div class="ar-title" data-feature="agent-role" id="ar-title-${agent}">${esc(T('title'))}</div>
            <div data-feature-notice="agent-role"></div>
            <div class="ar-sub">${esc(T('sub'))}</div>
            <div class="ar-options" role="radiogroup" aria-labelledby="ar-title-${agent}">${opts}</div>
            <div class="ar-lang"><label for="${id}">${esc(T('lang_label'))}</label>
                <select id="${id}" data-ar-lang${disabled}>${langOpts}</select></div>
            <div class="ar-status ${s.statusKind || ''}" role="status" aria-live="polite">${esc(s.status || '')}</div>
            ${s.hasPrompt ? `<div class="ar-note">${esc(T('own_prompt'))}</div>` : ''}
            ${!s.editable ? `<div class="ar-note">${esc(T('no_perm'))}</div>` : ''}
        </div>`;
    }

    const states = new Map(); // agent -> state

    function render(slot) {
        const agent = slot.getAttribute('data-agent');
        const s = states.get(agent);
        if (!s) return;
        slot.innerHTML = cardHtml(agent, s);
        try { if (typeof window.paintFeatureBadges === 'function') window.paintFeatureBadges(); } catch (e) { /* cosmetic */ }
    }

    function setStatus(slot, agent, text, kind) {
        const s = states.get(agent); if (!s) return;
        s.status = text; s.statusKind = kind || '';
        const el = slot.querySelector('.ar-status');
        if (el) { el.textContent = text; el.className = 'ar-status ' + (kind || ''); }
    }

    // Says whether the role is doing anything yet. Before the workspace is switched over the database
    // answers mode 'off': the choice is saved but inert, and the card says so instead of implying it works.
    async function refreshActive(slot, agent, justSaved) {
        const s = states.get(agent); if (!s) return;
        const r = await resolverMode(agent);
        if (!r || !s.role) return;
        if (r.source === 'role_default') setStatus(slot, agent, T('active'), 'ok');
        else if (r.mode === 'off') {
            if (justSaved) setStatus(slot, agent, T('inactive'), 'ok');
            else setStatus(slot, agent, T(s.fromBusiness ? 'from_business_inactive' : 'inactive'), '');
        }
    }

    async function choose(slot, agent, role) {
        const s = states.get(agent);
        if (!s || s.busy || !ROLES.includes(role) || !s.editable) return;
        const before = s.role;
        s.busy = true; s.role = role; s.status = T('saving'); s.statusKind = '';
        render(slot);
        try {
            await writeAgentRole(agent, role);
            s.agentRole = role; s.busy = false;
            render(slot);
            slot.querySelector(`.ar-opt[data-role="${role}"]`)?.focus();
            setStatus(slot, agent, T('saved'), 'ok');
            refreshActive(slot, agent, true);
        } catch (e) {
            s.role = before; s.busy = false;
            render(slot);
            setStatus(slot, agent, e && e.code === 'no_row' ? T('err_norow') : T('err'), 'bad');
        }
    }

    async function chooseLang(slot, agent, value) {
        const s = states.get(agent);
        if (!s || s.busy || !REPLY_LANGS.includes(value) || !s.editable) return;
        const before = s.replyLang;
        s.busy = true; s.replyLang = value; s.status = T('saving'); s.statusKind = '';
        render(slot);
        try {
            await writeReplyLanguage(value);
            s.busy = false; render(slot); setStatus(slot, agent, T('saved'), 'ok');
        } catch (e) {
            s.replyLang = before; s.busy = false; render(slot); setStatus(slot, agent, T('err'), 'bad');
        }
    }

    function wire(slot) {
        const agent = slot.getAttribute('data-agent');
        slot.addEventListener('click', (ev) => {
            const btn = ev.target.closest && ev.target.closest('.ar-opt');
            if (btn && slot.contains(btn)) choose(slot, agent, btn.getAttribute('data-role'));
        });
        slot.addEventListener('change', (ev) => {
            if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-ar-lang')) chooseLang(slot, agent, ev.target.value);
        });
        // Radio-group keyboard model: arrows move the choice, in reading order for the page direction.
        slot.addEventListener('keydown', (ev) => {
            const btn = ev.target.closest && ev.target.closest('.ar-opt');
            if (!btn || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) return;
            ev.preventDefault();
            const rtl = document.documentElement.dir === 'rtl' || getComputedStyle(slot).direction === 'rtl';
            const fwd = ev.key === 'ArrowDown' || ev.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
            const i = ROLES.indexOf(btn.getAttribute('data-role'));
            const next = ROLES[(i + (fwd ? 1 : ROLES.length - 1)) % ROLES.length];
            choose(slot, agent, next);
        });
    }

    async function mount(slot) {
        const agent = slot.getAttribute('data-agent');
        if (!AGENT_IDS.includes(agent) || slot.hasAttribute('data-ar-mounted') || !sb() || !orgId()) return;
        // The integrated studio (modules/agent-studio.js) asks the server whether
        // this account may use the new UI. Until that answer arrives we must not
        // paint, otherwise the two cards would fight for the same slot.
        if (window.AgentStudioPending) { setTimeout(() => mountAll(), 400); return; }
        // When the studio is allowed it owns this slot: it renders the same role
        // choice as part of the capabilities multi-select, so this card must
        // not also appear.
        if (window.AgentStudio && window.AgentStudio.ownsRoleSlot) return;
        slot.setAttribute('data-ar-mounted', '1');
        const data = await loadState();
        const row = data.agents[agent] || null;
        const persona = row && row.persona && typeof row.persona === 'object' ? row.persona : {};
        const own = ROLES.includes(persona.role) ? persona.role : null;
        const orgRole = ROLES.includes(data.business.agent_role) ? data.business.agent_role : null;
        const rl = REPLY_LANGS.includes(data.business.reply_language) ? data.business.reply_language : 'auto';
        states.set(agent, {
            agentRole: own, role: own || orgRole, fromBusiness: !own && !!orgRole, replyLang: rl,
            hasPrompt: !!(row && String(row.system_prompt || '').trim()), editable: canEdit(), busy: false, status: '', statusKind: '',
        });
        render(slot);
        wire(slot);
        if (states.get(agent).fromBusiness) setStatus(slot, agent, T('from_business'), '');
        refreshActive(slot, agent, false);
    }

    function mountAll() {
        document.querySelectorAll('.agent-role-slot:not([data-ar-mounted])').forEach((slot) => {
            mount(slot).catch((e) => console.warn('[agent-role] mount', e));
        });
    }

    function boot() {
        injectStyles();
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; mountAll(); }, 150);
        };
        (function attach() {
            const targets = AGENT_IDS.map((id) => document.getElementById(id)).filter(Boolean);
            if (!targets.length) return setTimeout(attach, 500);
            const obs = new MutationObserver(schedule);
            targets.forEach((t) => obs.observe(t, { childList: true, subtree: true }));
            schedule();
        })();
        // The card's words live in this module, so a language switch (same tab: <html lang/dir>
        // changes; other tab: a storage event) has to repaint it.
        const repaint = () => document.querySelectorAll('.agent-role-slot[data-ar-mounted]').forEach((slot) => render(slot));
        window.addEventListener('storage', (e) => { if (e.key === 'app_language') repaint(); });
        new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
        // The studio answers the server's access question asynchronously; when it
        // has an answer we may finally paint (or stay out of the way).
        window.addEventListener('agent-studio:decided', schedule);
    }

    window.AgentRole = { mountAll, ROLES, REPLY_LANGS, _states: states };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
