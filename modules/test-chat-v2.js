// test-chat-v2.js: the agent's Test Chat window, rebuilt.
//
// Loaded as a classic script AFTER the main app script (same pattern as modules/agent-role.js and
// modules/prompt-builder.js). A MutationObserver watches the agent tabs for the old `.chat-container`
// and swaps its inside for the new component, keeping the three hooks other code depends on:
//   - the container keeps the `.chat-container` class (Compare models in prompt-builder.js sits beside it)
//   - the log keeps id `chat-history-<agent>`, the input keeps id `chat-input-<agent>`
//   - Enter / the send button honour Compare models when its checkbox is on
//
// What it talks to: the `agent-test-chat` edge function, which builds the reply the way a live reply is
// built (the merchant's prompt or the role default, persona, language rule, knowledge base, product search)
// and never creates an order, lead, booking or message. This file renders every piece of text with
// textContent, never innerHTML, so a reply or a stored message can not run script.
//
// History: kept in the existing test_chat_sessions / test_chat_messages tables, as before, so the old
// window and the new one show the same conversation. Reset deletes the rows.
(function () {
    'use strict';

    const AGENT_IDS = ['website', 'whatsapp', 'page', 'instagram', 'telegram'];
    const MAX_TURNS_SENT = 20;
    const MAX_CHARS = 2000;

    const sb = () => window.supabaseClient;
    const orgId = () => window.currentUserOrgId;
    const isAr = () => (localStorage.getItem('app_language') || 'en') === 'ar';
    const supaUrl = () => (sb() && sb().supabaseUrl) || window.SUPABASE_URL || '';
    const supaKey = () => window.SUPABASE_KEY || (sb() && sb().supabaseKey) || '';

    const TXT = {
        en: {
            greeting: 'Hi! Ask me anything, the way a customer would.',
            placeholder: 'Type a message',
            send: 'Send',
            reset: 'New chat',
            expand: 'Full screen',
            close: 'Close',
            typing: 'The agent is typing',
            note: 'This is a private test. Nothing is sent to customers, and no orders, bookings or records are created.',
            chips: ['What do you sell?', 'How much is it?', 'I want to order', 'Where is my order?'],
            role_sales: 'Sales Agent',
            role_support: 'Customer Service',
            src_role_default: 'Standard instructions for this role',
            src_merchant: 'Your instructions',
            src_draft: 'Your unsaved edits',
            src_none: 'No instructions yet. Pick a role above.',
            reset_done: 'Chat cleared',
            err_generic: 'The agent could not reply. Try again.',
            err_network: 'No connection. Check your internet and try again.',
            err_rate_minute: 'Too many messages. Try again in a moment.',
            err_rate_day: 'Daily test limit reached for this workspace. It resets tomorrow.',
            err_forbidden: 'You do not have access to this workspace.',
            err_unconfigured: 'This agent is not set up yet. Save it once, then test.',
            err_ai_off: 'AI replies are not available for this workspace right now.',
            err_session: 'Your session expired. Sign in again.',
            copy: 'Copy',
        },
        ar: {
            greeting: 'أهلاً! اسألني أي حاجة زي ما العميل هيسأل.',
            placeholder: 'اكتب رسالة',
            send: 'إرسال',
            reset: 'محادثة جديدة',
            expand: 'ملء الشاشة',
            close: 'إغلاق',
            typing: 'الوكيل بيكتب',
            note: 'ده اختبار خاص. مفيش حاجة بتتبعت للعملاء، ومفيش طلبات أو حجوزات أو سجلات بتتعمل.',
            chips: ['عندكم إيه؟', 'بكام ده؟', 'عايز أطلب', 'فين طلبي؟'],
            role_sales: 'مندوب مبيعات',
            role_support: 'خدمة عملاء',
            src_role_default: 'التعليمات القياسية للدور ده',
            src_merchant: 'تعليماتك',
            src_draft: 'تعديلاتك اللي لسه ما اتحفظتش',
            src_none: 'مفيش تعليمات لسه. اختار دور من فوق.',
            reset_done: 'المحادثة اتمسحت',
            err_generic: 'الوكيل ما قدرش يرد. جرّب تاني.',
            err_network: 'مفيش اتصال. اتأكد من الإنترنت وجرّب تاني.',
            err_rate_minute: 'رسايل كتير. جرّب بعد لحظات.',
            err_rate_day: 'وصلت الحد اليومي للاختبار في مساحة العمل دي. بيتجدد بكرة.',
            err_forbidden: 'ليس لديك صلاحية على مساحة العمل دي.',
            err_unconfigured: 'الوكيل ده لسه ما اتجهزش. احفظه مرة وبعدها اختبره.',
            err_ai_off: 'ردود الذكاء الاصطناعي مش متاحة لمساحة العمل دي دلوقتي.',
            err_session: 'الجلسة انتهت. سجّل دخول تاني.',
            copy: 'نسخ',
        },
    };
    const T = (k) => (TXT[isAr() ? 'ar' : 'en'][k]);

    const states = new Map(); // agent -> { busy, turns, sessionId, full, meta }

    // ---- styles -------------------------------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('tc2-styles')) return;
        const s = document.createElement('style');
        s.id = 'tc2-styles';
        s.textContent = `
.chat-container.tc2 { display:flex; flex-direction:column; block-size:auto; min-block-size:0; max-block-size:none; height:auto;
  background:var(--sp-surface); border:1px solid var(--sp-line); border-radius:var(--sp-r-lg,14px); overflow:hidden; }
.tc2-bar { display:flex; align-items:center; gap:8px; padding:10px 12px; border-block-end:1px solid var(--sp-line); background:var(--sp-surface-2); min-inline-size:0; }
.tc2-badge { flex:1 1 auto; min-inline-size:0; font-size:0.8rem; color:var(--sp-ink-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc2-badge b { color:var(--sp-ink); font-weight:600; }
.tc2-ib { flex:none; inline-size:40px; block-size:40px; display:inline-flex; align-items:center; justify-content:center; border-radius:var(--sp-r-md,10px);
  border:1px solid var(--sp-line-2); background:transparent; color:var(--sp-ink); cursor:pointer; }
.tc2-ib:hover { background:var(--sp-surface-3); }
.tc2-ib:focus-visible, .tc2-send:focus-visible, .tc2-chip:focus-visible, .tc2-input:focus-visible { outline:2px solid var(--sp-focus); outline-offset:2px; }
.tc2-ib svg { inline-size:18px; block-size:18px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.chat-container.tc2 [hidden] { display:none !important; }
.tc2-expand { display:none; }
.tc2-log.chat-history { flex:0 0 auto; block-size:min(56vh, 460px); min-block-size:260px; padding:14px 12px; gap:10px; overflow-y:auto; overscroll-behavior:contain; scroll-behavior:smooth; background:var(--sp-bg); }
.tc2-log .message { max-inline-size:min(86%, 560px); padding:10px 13px; border-radius:16px; line-height:1.5; font-size:0.95rem; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; margin:0; }
.tc2-log .message.msg-user { align-self:flex-end; background:var(--sp-accent); color:var(--sp-accent-ink,#fff); border-end-end-radius:5px; }
.tc2-log .message.msg-ai { align-self:flex-start; background:var(--sp-surface-3); color:var(--sp-ink); border:1px solid var(--sp-line); border-end-start-radius:5px; }
.tc2-log .message.tc2-err { background:var(--sp-err-soft); color:var(--sp-err-ink); border-color:var(--sp-err); }
.tc2-log .message.tc2-sys { align-self:center; background:transparent; border:0; color:var(--sp-ink-3); font-size:0.78rem; padding:2px 8px; }
.tc2-log .tc2-typing { display:inline-flex; gap:5px; align-items:center; block-size:22px; }
.tc2-log .tc2-typing i { inline-size:7px; block-size:7px; border-radius:50%; background:var(--sp-ink-3); animation:tc2-b 1.1s infinite ease-in-out; }
.tc2-log .tc2-typing i:nth-child(2) { animation-delay:.16s; } .tc2-log .tc2-typing i:nth-child(3) { animation-delay:.32s; }
@keyframes tc2-b { 0%,80%,100% { transform:translateY(0); opacity:.5; } 40% { transform:translateY(-4px); opacity:1; } }
@media (prefers-reduced-motion: reduce) { .tc2-log .tc2-typing i { animation:none; } .tc2-log.chat-history { scroll-behavior:auto; } }
.tc2-chips { display:flex; gap:8px; padding:8px 12px 0; overflow-x:auto; scrollbar-width:none; background:var(--sp-surface); }
.tc2-chips::-webkit-scrollbar { display:none; }
.tc2-chip { flex:none; min-block-size:36px; padding:6px 14px; border-radius:var(--sp-r-pill,999px); border:1px solid var(--sp-line-2); background:var(--sp-surface-2); color:var(--sp-ink); font-size:0.85rem; cursor:pointer; white-space:nowrap; }
.tc2-chip:hover { background:var(--sp-surface-3); }
.tc2-composer { display:flex; align-items:flex-end; gap:8px; padding:10px 12px; background:var(--sp-surface); }
.tc2-input { flex:1 1 auto; min-inline-size:0; resize:none; max-block-size:140px; min-block-size:44px; padding:10px 14px; border-radius:22px; border:1px solid var(--sp-line-2);
  background:var(--sp-surface-2); color:var(--sp-ink); font:inherit; font-size:1rem; line-height:1.4; box-sizing:border-box; }
.tc2-send { flex:none; inline-size:44px; block-size:44px; border-radius:50%; border:0; background:var(--sp-accent); color:var(--sp-accent-ink,#fff); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.tc2-send:disabled { opacity:.45; cursor:not-allowed; }
.tc2-send svg { inline-size:18px; block-size:18px; fill:currentColor; }
[dir="rtl"] .tc2-send svg { transform:scaleX(-1); }
.tc2-note { margin:0; padding:0 14px 12px; font-size:0.74rem; color:var(--sp-ink-3); background:var(--sp-surface); line-height:1.4; }
@media (max-width: 768px) {
  .tc2-expand { display:inline-flex; }
  .tc2-log.chat-history { block-size:min(58dvh, 520px); }
  .chat-container.tc2 { border-radius:var(--sp-r-md,12px); }
}
/* Full-screen sheet on phones: the whole visible viewport, keyboard included (--tc2-vh is set from visualViewport). */
.chat-container.tc2.tc2-full { position:fixed; inset:0; z-index:5200; margin:0; border:0; border-radius:0; block-size:var(--tc2-vh,100dvh); max-block-size:none; padding-block-start:env(safe-area-inset-top,0px); }
.tc2-full .tc2-log.chat-history { flex:1 1 auto; block-size:auto; min-block-size:0; max-block-size:none; }
.tc2-full .tc2-composer { padding-block-end:calc(10px + env(safe-area-inset-bottom,0px)); }
body.tc2-lock { overflow:hidden; }
body:has(.chat-container.tc2.tc2-full) :is(.theme-float-btn, .aiw-root, #sentry-feedback) { display:none !important; }
`;
        document.head.appendChild(s);
    }

    // ---- helpers ------------------------------------------------------------------------------------------
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function svg(path) {
        const ns = 'http://www.w3.org/2000/svg';
        const s = document.createElementNS(ns, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', path);
        s.appendChild(p);
        return s;
    }
    const ICON = {
        send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
        reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
        expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
        close: 'M6 6l12 12M18 6L6 18',
    };
    function iconButton(cls, label, icon) {
        const b = el('button', 'tc2-ib ' + cls);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.title = label;
        b.appendChild(svg(icon));
        return b;
    }

    function state(agent) {
        if (!states.has(agent)) states.set(agent, { busy: false, turns: [], sessionId: null, full: false, meta: null });
        return states.get(agent);
    }

    function scrollDown(log) { log.scrollTop = log.scrollHeight; }

    function addBubble(log, kind, text, extraCls) {
        const b = el('div', 'message ' + (kind === 'user' ? 'msg-user' : 'msg-ai') + (extraCls ? ' ' + extraCls : ''), text);
        b.setAttribute('dir', 'auto');
        log.appendChild(b);
        return b;
    }

    function badgeText(meta) {
        if (!meta) return null;
        const role = meta.role === 'sales' ? T('role_sales') : meta.role === 'support' ? T('role_support') : '';
        const src = T('src_' + (meta.prompt_source || 'none'));
        return { role, src };
    }
    function paintBadge(box, agent) {
        const badge = box.querySelector('.tc2-badge');
        if (!badge) return;
        badge.textContent = '';
        const m = badgeText(state(agent).meta);
        if (!m) { badge.textContent = T('note').split('.')[0]; return; }
        if (m.role) { const b = el('b', null, m.role); badge.appendChild(b); badge.appendChild(document.createTextNode(' · ')); }
        badge.appendChild(document.createTextNode(m.src));
    }

    function errorText(status, body) {
        const code = body && body.error;
        if (status === 429) return code === 'rate_limited' && body.scope === 'day' ? T('err_rate_day') : T('err_rate_minute');
        if (status === 403) return T('err_forbidden');
        if (status === 401) return T('err_session');
        if (status === 404 && code === 'agent_not_configured') return T('err_unconfigured');
        if (status === 503 || status === 402) return T('err_ai_off');
        return T('err_generic');
    }

    // ---- history (existing tables) ------------------------------------------------------------------------
    async function ensureSession(agent) {
        const st = state(agent);
        if (st.sessionId) return st.sessionId;
        if (!sb() || !orgId()) return null;
        const { data: found } = await sb().from('test_chat_sessions').select('id').eq('org_id', orgId()).eq('agent', agent).limit(1);
        if (found && found[0]) { st.sessionId = found[0].id; return st.sessionId; }
        const { data: made } = await sb().from('test_chat_sessions').insert([{ org_id: orgId(), agent }]).select('id').single();
        st.sessionId = made ? made.id : null;
        return st.sessionId;
    }
    async function saveMessage(agent, direction, content, meta) {
        try {
            const sid = await ensureSession(agent);
            if (!sid) return;
            await sb().from('test_chat_messages').insert({ session_id: sid, org_id: orgId(), direction, content, meta: meta || {} });
        } catch (_) { /* history is a convenience, never a reason to fail a test */ }
    }
    async function loadHistory(agent, box) {
        const st = state(agent);
        const log = box.querySelector('.tc2-log');
        try {
            const sid = await ensureSession(agent);
            if (!sid) return;
            const { data } = await sb().from('test_chat_messages').select('direction, content, created_at').eq('session_id', sid).order('created_at', { ascending: true }).limit(60);
            if (!data || !data.length) return;
            log.textContent = '';
            st.turns = [];
            data.forEach((m) => {
                const role = m.direction === 'inbound' ? 'user' : 'assistant';
                addBubble(log, role === 'user' ? 'user' : 'ai', String(m.content || ''));
                st.turns.push({ role, content: String(m.content || '').slice(0, MAX_CHARS) });
            });
            scrollDown(log);
            box.querySelector('.tc2-chips').hidden = true;
        } catch (_) { /* keep the greeting */ }
    }

    // ---- sending ------------------------------------------------------------------------------------------
    async function accessToken() {
        const { data } = await sb().auth.getSession();
        return (data && data.session && data.session.access_token) || '';
    }

    function compareOn(agent) {
        const cb = document.getElementById('pb-compare-' + agent);
        return !!(cb && cb.checked);
    }

    async function send(agent, box, raw) {
        const st = state(agent);
        const input = box.querySelector('.tc2-input');
        const log = box.querySelector('.tc2-log');
        const sendBtn = box.querySelector('.tc2-send');
        const text = String(raw == null ? input.value : raw).replace(/\r\n?/g, '\n').trim().slice(0, MAX_CHARS);
        if (!text || st.busy) return;
        if (compareOn(agent)) { // Compare models owns Enter while its box is ticked
            input.value = text;
            input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true }));
            return;
        }
        st.busy = true;
        sendBtn.disabled = true;
        box.querySelector('.tc2-chips').hidden = true;
        input.value = '';
        autosize(input);
        addBubble(log, 'user', text);
        st.turns.push({ role: 'user', content: text });
        const typing = addBubble(log, 'ai', '');
        const dots = el('span', 'tc2-typing');
        dots.setAttribute('role', 'status');
        dots.setAttribute('aria-label', T('typing'));
        for (let i = 0; i < 3; i++) dots.appendChild(el('i'));
        typing.appendChild(dots);
        scrollDown(log);
        saveMessage(agent, 'inbound', text);
        try {
            const token = await accessToken();
            if (!token) throw Object.assign(new Error('session'), { status: 401 });
            const body = { org_id: orgId(), agent, messages: st.turns.slice(-MAX_TURNS_SENT) };
            const ta = document.getElementById('prompt-' + agent);
            if (ta && !ta.readOnly) body.draft_prompt = ta.value; // unsaved edits are what gets tested
            const res = await fetch(supaUrl() + '/functions/v1/agent-test-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: supaKey() },
                body: JSON.stringify(body),
            });
            let data = null;
            try { data = await res.json(); } catch (_) { data = null; }
            if (!res.ok || !data || typeof data.reply !== 'string') {
                typing.remove();
                st.turns.pop(); // the failed message is not part of the conversation the agent has seen
                addBubble(log, 'ai', errorText(res.status, data), 'tc2-err').setAttribute('role', 'alert');
            } else {
                typing.remove();
                addBubble(log, 'ai', data.reply);
                st.turns.push({ role: 'assistant', content: data.reply.slice(0, MAX_CHARS) });
                st.meta = data.meta || null;
                paintBadge(box, agent);
                saveMessage(agent, 'outbound', data.reply, { source: 'agent-test-chat' });
            }
        } catch (e) {
            typing.remove();
            st.turns.pop();
            const msg = e && e.status === 401 ? T('err_session') : T('err_network');
            addBubble(log, 'ai', msg, 'tc2-err').setAttribute('role', 'alert');
        } finally {
            st.busy = false;
            sendBtn.disabled = !input.value.trim();
            scrollDown(log);
            try { input.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }
    }

    async function reset(agent, box) {
        const st = state(agent);
        if (st.busy) return;
        const log = box.querySelector('.tc2-log');
        st.turns = [];
        st.meta = null;
        log.textContent = '';
        addBubble(log, 'ai', st.greeting || T('greeting'));
        addBubble(log, 'ai', T('reset_done'), 'tc2-sys');
        box.querySelector('.tc2-chips').hidden = false;
        paintBadge(box, agent);
        try {
            const sid = await ensureSession(agent);
            if (sid) await sb().from('test_chat_messages').delete().eq('session_id', sid);
        } catch (_) { /* the screen is already clean */ }
    }

    // ---- full-screen sheet (phones) -----------------------------------------------------------------------
    function setFull(agent, box, on) {
        const st = state(agent);
        st.full = on;
        box.classList.toggle('tc2-full', on);
        document.body.classList.toggle('tc2-lock', on);
        const closeBtn = box.querySelector('.tc2-close');
        const expandBtn = box.querySelector('.tc2-expand');
        closeBtn.hidden = !on;
        expandBtn.hidden = on;
        if (on) {
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-label', T('expand'));
            syncViewport(box);
            try { box.querySelector('.tc2-input').focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        } else {
            box.removeAttribute('role'); box.removeAttribute('aria-modal'); box.removeAttribute('aria-label');
            box.style.removeProperty('--tc2-vh');
            try { expandBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }
        scrollDown(box.querySelector('.tc2-log'));
    }
    function syncViewport(box) {
        const vv = window.visualViewport;
        if (vv) box.style.setProperty('--tc2-vh', Math.round(vv.height) + 'px');
    }

    function autosize(input) {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    }

    // ---- mount --------------------------------------------------------------------------------------------
    function mount(agent, container) {
        if (container.dataset.tc2) return;
        container.dataset.tc2 = '1';
        const old = container.querySelector('.msg-ai');
        const st = state(agent);
        st.greeting = old ? String(old.textContent || '').trim() : '';
        container.classList.add('tc2');
        container.textContent = '';

        const bar = el('div', 'tc2-bar');
        bar.appendChild(el('span', 'tc2-badge'));
        const resetBtn = iconButton('tc2-reset', T('reset'), ICON.reset);
        const expandBtn = iconButton('tc2-expand', T('expand'), ICON.expand);
        const closeBtn = iconButton('tc2-close', T('close'), ICON.close);
        closeBtn.hidden = true;
        bar.append(resetBtn, expandBtn, closeBtn);

        const log = el('div', 'chat-history tc2-log');
        log.id = 'chat-history-' + agent;
        log.setAttribute('role', 'log');
        log.setAttribute('aria-live', 'polite');
        log.setAttribute('aria-relevant', 'additions');
        addBubble(log, 'ai', st.greeting || T('greeting'));

        const chips = el('div', 'tc2-chips');
        T('chips').forEach((c) => {
            const b = el('button', 'tc2-chip', c);
            b.type = 'button';
            b.addEventListener('click', () => send(agent, container, c));
            chips.appendChild(b);
        });

        const form = el('form', 'tc2-composer');
        form.setAttribute('autocomplete', 'off');
        const input = el('textarea', 'tc2-input');
        input.id = 'chat-input-' + agent;
        input.rows = 1;
        input.maxLength = MAX_CHARS;
        input.placeholder = T('placeholder');
        input.setAttribute('aria-label', T('placeholder'));
        input.setAttribute('dir', 'auto');
        input.setAttribute('enterkeyhint', 'send');
        const sendBtn = el('button', 'tc2-send');
        sendBtn.type = 'submit';
        sendBtn.disabled = true;
        sendBtn.setAttribute('aria-label', T('send'));
        sendBtn.appendChild(svg(ICON.send));
        form.append(input, sendBtn);

        const note = el('p', 'tc2-note', T('note'));
        container.append(bar, log, chips, form, note);
        paintBadge(container, agent);

        form.addEventListener('submit', (e) => { e.preventDefault(); send(agent, container); });
        input.addEventListener('input', () => { autosize(input); sendBtn.disabled = st.busy || !input.value.trim(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                if (compareOn(agent)) return; // Compare models' own Enter handler runs on keypress
                e.preventDefault();
                send(agent, container);
            }
        });
        resetBtn.addEventListener('click', () => reset(agent, container));
        expandBtn.addEventListener('click', () => setFull(agent, container, true));
        closeBtn.addEventListener('click', () => setFull(agent, container, false));
        container.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.full) { e.stopPropagation(); setFull(agent, container, false); } });
        if (window.visualViewport) {
            const upd = () => { if (st.full) { syncViewport(container); scrollDown(log); } };
            window.visualViewport.addEventListener('resize', upd);
            window.visualViewport.addEventListener('scroll', upd);
        }
        loadHistory(agent, container);
    }

    function mountAll() {
        AGENT_IDS.forEach((agent) => {
            const sec = document.getElementById(agent + '-chat-sec');
            const c = sec && sec.querySelector('.chat-container:not([data-tc2])');
            if (c) { try { mount(agent, c); } catch (e) { console.warn('[test-chat-v2] mount', agent, e); } }
        });
    }

    function repaint() {
        document.querySelectorAll('.chat-container.tc2').forEach((box) => {
            const agent = box.querySelector('.tc2-log') && box.querySelector('.tc2-log').id.replace('chat-history-', '');
            if (!agent) return;
            box.querySelector('.tc2-note').textContent = T('note');
            box.querySelector('.tc2-input').placeholder = T('placeholder');
            const rb = box.querySelector('.tc2-reset');
            rb.title = T('reset'); rb.setAttribute('aria-label', T('reset'));
            box.querySelectorAll('.tc2-chip').forEach((b, i) => { b.textContent = T('chips')[i] || b.textContent; });
            paintBadge(box, agent);
        });
    }

    // The old entry points stay defined for anything that still calls them by name.
    function installLegacyOverrides() {
        window.loadChatHistory = function (agentId) {
            const box = document.getElementById('chat-history-' + agentId);
            const c = box && box.closest('.chat-container.tc2');
            if (c) return loadHistory(agentId, c);
        };
        window.sendChatMessage = function (agentId) {
            const box = document.getElementById('chat-history-' + agentId);
            const c = box && box.closest('.chat-container.tc2');
            if (c) return send(agentId, c);
        };
    }

    function boot() {
        injectStyles();
        installLegacyOverrides();
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; mountAll(); }, 120);
        };
        (function attach() {
            const targets = AGENT_IDS.map((id) => document.getElementById(id)).filter(Boolean);
            if (!targets.length) return setTimeout(attach, 500);
            const obs = new MutationObserver(schedule);
            targets.forEach((t) => obs.observe(t, { childList: true, subtree: true }));
            schedule();
        })();
        window.addEventListener('storage', (e) => { if (e.key === 'app_language') repaint(); });
        new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
    }

    window.TestChatV2 = { mountAll, _states: states, _send: send };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
