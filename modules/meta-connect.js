(function() {
    'use strict';
    // ============================================================
    //   META CONNECT MODULE
    //   Created 2026-04-27 from the "Meta Preview Prompts" set:
    //     - Prompt 2: WhatsApp Embedded Signup connect-modal polish
    //                 (step indicator, tooltip captions, access-granted
    //                  card, template proof panel, screencast banner).
    //     - Prompt 3: Messenger + Instagram channel connect cards inside
    //                 their existing agent tabs.
    //
    //   Self-contained classic script. Does NOT modify any existing
    //   render function in index.html; instead it observes the DOM and
    //   wraps `window.startWhatsAppEmbeddedSignup` to inject cosmetic
    //   pieces. Reads window.SUPABASE_URL / window.SUPABASE_KEY /
    //   window.supabaseClient / window.currentUserOrgId / window.t /
    //   window.showToast / window.FB - all already in scope by the time
    //   this script runs (loaded after the main app script).
    // ============================================================

    const SUPA = () => window.SUPABASE_URL || '';
    const KEY  = () => window.SUPABASE_KEY || '';
    const META_TOKEN_URL = () => `${SUPA()}/functions/v1/meta-token-manager`;
    const TEMPLATES_URL  = () => `${SUPA()}/functions/v1/list-waba-templates`;
    const t = (k) => (typeof window.t === 'function' ? window.t(k) : k);
    const tr = (k, fallback) => {
        const v = t(k);
        return (!v || v === k) ? fallback : v;
    };
    const toast = (msg, kind) => (typeof window.showToast === 'function'
        ? window.showToast(msg, kind)
        : console.log(`[toast:${kind || 'info'}] ${msg}`));

    // Facebook Login for Business configurations. Business-type apps serve
    // plain-scope FB.login ONLY to app admins/testers — real customers get
    // Meta's "Feature Unavailable" dialog. The config_id defines the
    // requested permissions + assets (User access token type, 60 days;
    // meta-token-manager exchanges to a non-expiring Page token).
    const LOGIN_CONFIG_IDS = {
        page: '1713991173062813',       // digitivia-production-messenger
        instagram: '1020101887614755',  // digitivia-production-instagram
    };

    // ----- shared FB token helper (Prompt 3) -----
    // opts: { config_id } for Login-for-Business configs; falls back to a
    // raw scope list (admin/testing only) when no config is given.
    window.getOrRefreshMetaToken = async function(requiredScopes, opts) {
        // Wait for the FB SDK if it's still loading -- the SDK is loaded
        // by initWhatsAppEmbeddedSignup in index.html, exposed globally
        // as window.ensureFbSdk. Without this await, clicking Connect
        // Facebook Page or Connect Instagram before the WhatsApp modal
        // is ever opened reliably hits "Facebook SDK not ready".
        if (typeof window.ensureFbSdk === 'function') {
            try { await window.ensureFbSdk(); } catch (_) { /* fall through */ }
        }
        // Reuse the session token only for scope-based (admin/test) calls: a
        // cached token may have been granted under a DIFFERENT login config
        // and lack this channel's permissions.
        if (!(opts && opts.config_id)) {
            const existing = window.FB && window.FB.getAuthResponse && window.FB.getAuthResponse();
            if (existing && existing.accessToken && existing.expiresIn > 0) return existing.accessToken;
        }
        return new Promise((resolve, reject) => {
            if (!window.FB) return reject(new Error(tr('meta_connect.fb_sdk_not_ready', 'Facebook SDK not ready. Please try again.')));
            window.FB.login(function(response) {
                if (response && response.authResponse && response.authResponse.accessToken) {
                    resolve(response.authResponse.accessToken);
                } else {
                    reject(new Error(tr('meta_connect.fb_login_cancelled', 'Facebook login was cancelled or failed.')));
                }
            }, (opts && opts.config_id)
                ? { config_id: opts.config_id }
                : { scope: (requiredScopes || []).join(',') });
        });
    };

    async function getSessionAuthHeaders() {
        const headers = { 'Content-Type': 'application/json', 'apikey': KEY() };
        try {
            const session = (await window.supabaseClient.auth.getSession()).data.session;
            if (session && session.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        } catch (e) {
            console.warn('[meta-connect] no session', e);
        }
        return headers;
    }

    // ============================================================
    //   WHATSAPP CONNECT MODAL POLISH (Prompt 2)
    // ============================================================

    function detectWaState(body) {
        const badge = body.querySelector('.wa-connect-status-badge');
        if (!badge || !badge.classList) return 'disconnected';
        // Use exact classList tokens so a future class like 'not-connected'
        // or 'half-connected' does not get misclassified.
        if (badge.classList.contains('connected'))               return 'connected';
        if (badge.classList.contains('onboarding_complete'))     return 'onboarding_complete';
        if (badge.classList.contains('onboarding_in_progress'))  return 'onboarding_in_progress';
        if (badge.classList.contains('disconnected'))            return 'disconnected';
        return 'disconnected';
    }

    // ADDITION 1 — STEP INDICATOR
    function injectStepIndicator(body, vState) {
        if (body.querySelector('.wa-step-indicator')) return;
        const activeIdx = vState === 'connected' ? 2 : (vState === 'onboarding_complete' ? 1 : 0);
        const labels = [
            tr('whatsapp_connect.step_login',   'Meta Login'),
            tr('whatsapp_connect.step_grant',   'Grant Access'),
            tr('whatsapp_connect.step_confirm', 'Confirm Connection'),
        ];
        const segs = labels.map((label, i) => {
            const isActive = i === activeIdx;
            const isDone = i < activeIdx;
            const bg = isActive ? 'var(--theme-color, #57b078)'
                     : isDone   ? 'rgba(87,176,120,0.55)'
                                : 'rgba(255,255,255,0.15)';
            const color = (isActive || isDone) ? '#fff' : 'rgba(255,255,255,0.6)';
            return `<div style="flex:1;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;font-size:0.72rem;font-weight:600;color:${color};background:${bg};">
                <span style="opacity:.8;">${i + 1}</span><span>${label}</span>
            </div>`;
        }).join('<div style="flex:0 0 14px;height:1px;background:rgba(255,255,255,0.15);"></div>');
        const html = `<div class="wa-step-indicator" style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">${segs}</div>`;
        body.insertAdjacentHTML('afterbegin', html);
    }

    // ADDITION 2 — TOOLTIP CAPTIONS
    // Match buttons by either inline onclick (current state of the file)
    // or visible text (future-proof: if buttons migrate to addEventListener
    // the tooltips still attach).
    function injectTooltips(body) {
        const tipContinue   = tr('whatsapp_connect.tip_continue',  'Opens Meta login. You will be asked to grant WhatsApp Business access to Digitivia.');
        const tipReconnect  = tr('whatsapp_connect.tip_reconnect', 'Re-opens Meta login to refresh your WhatsApp Business connection.');
        const tipClear      = tr('whatsapp_connect.tip_clear',     'Resets stored connection data. Use only if you want to start over from scratch.');
        const tipCopy       = tr('whatsapp_connect.tip_copy',      'Copies the raw connection payload to clipboard for debugging.');
        const tipSettings   = tr('whatsapp_connect.tip_settings',  'View or update your connected WhatsApp Business Account settings.');

        const matchers = [
            { onclick: /startWhatsAppEmbeddedSignup/,         text: /continue with facebook|reconnect|run onboarding/i, getTitle: (t) => /reconnect|onboarding/i.test(t) ? tipReconnect : tipContinue },
            { onclick: /clearSavedWhatsAppConnectionState/,   text: /clear state|clear saved/i,                          getTitle: () => tipClear },
            { onclick: /copyWhatsAppConnectionJson/,          text: /copy json/i,                                         getTitle: () => tipCopy },
        ];

        body.querySelectorAll('button').forEach((btn) => {
            if (btn.title) return;
            const onclickAttr = btn.getAttribute('onclick') || '';
            const txt = (btn.textContent || '').trim();
            for (const m of matchers) {
                if (m.onclick.test(onclickAttr) || m.text.test(txt)) {
                    btn.title = m.getTitle(txt);
                    break;
                }
            }
        });
        body.querySelectorAll('.wa-header-btn-secondary').forEach((b) => {
            if (!b.title) b.title = tipSettings;
        });
    }

    // ADDITION 4 — TEMPLATE PROOF PANEL
    function injectTemplatesPanel(body, vState) {
        if (vState !== 'connected') return;
        if (body.querySelector('#wa-templates-panel')) return;
        // Pull the WABA / phone proofs straight from the rendered DOM
        const proofRow = body.querySelector('.wa-connect-proof, .wa-proof-cards, .wa-connect-meta-grid');
        const wabaText = (() => {
            const m = body.innerText.match(/WABA ID[\s\S]{0,40}?([0-9]{6,})/);
            return m ? m[1] : '';
        })();
        const phoneText = (() => {
            const m = body.innerText.match(/(\+\d[\d \-]{6,})/);
            return m ? m[1].trim() : '';
        })();

        const safeWaba = String(wabaText || '').replace(/"/g, '&quot;');
        const html = `
          <div id="wa-templates-panel" data-waba-id="${safeWaba}" style="margin-top:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;">
              <div>
                <div style="font-size:0.82rem;color:var(--text-secondary);">${tr('whatsapp_connect.label_waba_id', 'WABA ID')}</div>
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);">${wabaText || '—'}</div>
              </div>
              <div>
                <div style="font-size:0.82rem;color:var(--text-secondary);">${tr('whatsapp_connect.label_phone', 'Phone Number')}</div>
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);">${phoneText || '—'}</div>
              </div>
            </div>
            <button id="wa-view-templates-btn" class="lp-btn lp-btn-outline"
              title="${tr('whatsapp_connect.tip_templates', 'Fetches your approved WhatsApp message templates from Meta to confirm business management access.')}">
              ${tr('whatsapp_connect.btn_view_templates', 'View Message Templates')} <span class="beta-badge">BETA</span>
            </button>
            <div id="wa-templates-list" style="margin-top:12px;display:none;"></div>
          </div>`;
        body.insertAdjacentHTML('beforeend', html);
        body.querySelector('#wa-view-templates-btn').addEventListener('click', () => loadWabaTemplates(false));
        loadWabaTemplates(true); // auto-load on connect
    }

    async function loadWabaTemplates(auto) {
        const btn  = document.getElementById('wa-view-templates-btn');
        const list = document.getElementById('wa-templates-list');
        const panel = document.getElementById('wa-templates-panel');
        if (!btn || !list || !panel) return;

        // Read the WABA ID from the data attribute we stamped when
        // building the panel. No DOM-scraping fallback -- if it's
        // missing, the panel was built with no detectable WABA ID and
        // the user should reconnect.
        const wabaId = panel.dataset.wabaId || '';
        if (!wabaId) {
            // Only complain on an explicit click — the auto-load path runs on
            // every background re-render and would toast on unrelated tabs.
            if (!auto) toast(tr('whatsapp_connect.no_waba_id', 'No WABA ID detected in this connection.'), 'error');
            return;
        }

        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = tr('whatsapp_connect.loading', 'Loading…');

        try {
            const headers = await getSessionAuthHeaders();
            const r = await fetch(TEMPLATES_URL(), {
                method: 'POST',
                headers,
                body: JSON.stringify({ waba_id: wabaId, org_id: window.currentUserOrgId })
            });
            const j = await r.json();
            const tpls = Array.isArray(j && j.templates) ? j.templates : [];
            const placeholder = j && j.source === 'placeholder';
            list.style.display = '';
            list.innerHTML = (placeholder
                ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">${tr('whatsapp_connect.placeholder_note', 'Connect your WABA to see live templates.')}</div>`
                : ''
            ) + (tpls.length ? tpls.map((tpl) => {
                const c = tpl.status === 'PENDING' ? '#f59e0b' : '#10b981';
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.03);margin-bottom:6px;">
                    <div style="font-weight:600;color:var(--text-primary);font-size:0.86rem;">${tpl.name}</div>
                    <span style="font-size:0.68rem;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:.05em;">${tpl.status}</span>
                    <span style="margin-left:auto;font-size:0.72rem;color:var(--text-secondary);">${tpl.category || ''} · ${tpl.language || ''}</span>
                  </div>`;
            }).join('') : `<div style="font-size:0.78rem;color:var(--text-secondary);">${tr('whatsapp_connect.no_templates', 'No templates yet.')}</div>`);
        } catch (e) {
            toast(tr('whatsapp_connect.templates_failed', 'Could not load templates.'), 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function postProcessWhatsAppConnectBody() {
        const body = document.getElementById('whatsapp-connect-body');
        if (!body || !body.firstChild) return;
        const vState = detectWaState(body);
        injectStepIndicator(body, vState);
        injectTooltips(body);
        injectTemplatesPanel(body, vState);
    }

    function setupWhatsAppModalObserver() {
        const body = document.getElementById('whatsapp-connect-body');
        if (!body) return setTimeout(setupWhatsAppModalObserver, 600);
        const obs = new MutationObserver(() => {
            // Defer to after the existing render finishes its synchronous DOM writes
            requestAnimationFrame(postProcessWhatsAppConnectBody);
        });
        obs.observe(body, { childList: true });
        postProcessWhatsAppConnectBody();
    }

    // ADDITION 3 — ACCESS GRANTED CARD
    function wrapStartWhatsApp() {
        const orig = window.startWhatsAppEmbeddedSignup;
        if (typeof orig !== 'function' || orig.__meta_wrapped) return false;
        const wrapped = async function() {
            const realLogin = window.FB && window.FB.login;
            if (typeof realLogin === 'function') {
                window.FB.login = function(cb, opts) {
                    return realLogin.call(window.FB, function(response) {
                        if (response && response.authResponse && response.authResponse.accessToken) {
                            const body = document.getElementById('whatsapp-connect-body');
                            if (body && !body.querySelector('#wa-access-granted-card')) {
                                const card = document.createElement('div');
                                card.id = 'wa-access-granted-card';
                                card.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 20px;border-radius:14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);margin-bottom:16px;animation:fadeIn 0.3s ease;';
                                card.innerHTML = `
                                  <span style="font-size:1.8rem;">✅</span>
                                  <div>
                                    <div style="font-weight:700;color:#10b981;font-size:0.9rem;">${tr('whatsapp_connect.granted_title', 'Access Granted')}</div>
                                    <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">${tr('whatsapp_connect.granted_body', 'WhatsApp Business access granted to Digitivia. Setting up your connection now…')}</div>
                                  </div>`;
                                body.insertBefore(card, body.firstChild);
                                setTimeout(() => card.remove(), 1500);
                            }
                        }
                        window.FB.login = realLogin;
                        return cb(response);
                    }, opts);
                };
            }
            try { return await orig.apply(this, arguments); }
            finally { if (typeof realLogin === 'function') window.FB.login = realLogin; }
        };
        wrapped.__meta_wrapped = true;
        window.startWhatsAppEmbeddedSignup = wrapped;
        return true;
    }

    // ADDITION 5 — SCREENCAST BANNER
    function renderScreencastBanner() {
        const on = localStorage.getItem('digitivia_screencast_mode') === '1';
        const existing = document.getElementById('digitivia-screencast-banner');
        if (!on) { if (existing) existing.remove(); return; }
        const slot = document.getElementById('whatsapp-agent-connect-slot');
        if (!slot) return;
        if (existing) return;
        const banner = document.createElement('div');
        banner.id = 'digitivia-screencast-banner';
        banner.style.cssText = 'margin-bottom:12px;padding:12px 16px;border-radius:10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);display:flex;align-items:flex-start;gap:10px;';
        banner.innerHTML = `
          <span style="font-size:1.1rem;flex-shrink:0;">🎬</span>
          <div style="flex:1;">
            <div style="font-size:0.82rem;font-weight:600;color:#f59e0b;margin-bottom:4px;">${tr('whatsapp_connect.screencast_title', 'Screencast Mode Active')}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.5;">${tr('whatsapp_connect.screencast_steps', 'Steps: 1) Click "Continue with Facebook"  2) Log in and grant WhatsApp Business access  3) Confirm connection below')}</div>
          </div>
          <button id="digitivia-screencast-dismiss" style="background:none;border:none;color:var(--text-secondary);font-size:1rem;cursor:pointer;flex-shrink:0;padding:0;" title="${tr('whatsapp_connect.screencast_dismiss', 'Dismiss screencast mode')}">✕</button>`;
        slot.parentNode.insertBefore(banner, slot);
        document.getElementById('digitivia-screencast-dismiss').addEventListener('click', () => {
            localStorage.removeItem('digitivia_screencast_mode');
            banner.remove();
        });
    }

    // ============================================================
    //   MESSENGER + INSTAGRAM CONNECT CARDS (Prompt 3)
    //
    //   One card per platform, first in its agent tab, listing every
    //   account the workspace has connected (SPEC §3.3, §4). A workspace
    //   may connect as many Pages and Instagram accounts as it likes, on
    //   any plan (OD1, OD9): nothing here counts against a cap. WhatsApp
    //   stays one number per workspace for now, so its card lists what is
    //   connected but offers no "Connect another".
    // ============================================================

    // More connected Meta accounts than this reads as a busy setup and earns
    // the "High traffic" chip (SPEC §3.4). Purely informational. Declared
    // once; tests/channel-multi-connect.test.js holds it to that.
    const HIGH_TRAFFIC_ACCOUNTS = 5;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (
        vars && vars[k] != null ? String(vars[k]) : m));

    function orgReady() {
        // Guard: do not query before the user/org is resolved. The tab
        // observer can fire during early app boot when currentUserOrgId
        // is still undefined, which would issue org_id=eq.undefined and
        // 400 from PostgREST.
        return !!(window.currentUserOrgId && window.supabaseClient
            && typeof window.currentUserOrgId === 'string'
            && window.currentUserOrgId !== 'undefined');
    }

    // "Which accounts are active on each Meta platform" is asked by the
    // dashboard widget and by every channel card, and on page load they all
    // ask in the same instant: one watcher pass mounts the three cards and
    // draws the dashboard, which made six identical requests (Sentry
    // JAVASCRIPT-M, 2026-09-18). One request answers all of them. Callers
    // share it only while it is in flight; nothing is kept once it answers,
    // so a later caller always reads the table again, and forgetMetaCount()
    // (every connect and disconnect here) drops the one in flight as well.
    const META_PLATFORMS = ['page', 'instagram', 'whatsapp'];
    let activeRowsInFlight = { orgId: null, promise: null };
    function forgetActiveRows() { activeRowsInFlight = { orgId: null, promise: null }; }

    function fetchActiveRowsByPlatform() {
        const orgId = window.currentUserOrgId;
        if (activeRowsInFlight.promise && activeRowsInFlight.orgId === orgId) return activeRowsInFlight.promise;
        const promise = (async () => {
            if (!orgReady()) return null;
            try {
                const { data, error } = await window.supabaseClient
                    .from('org_channel_accounts')
                    .select('platform, external_account_id, account_name, instagram_username, meta, connected_at')
                    .eq('org_id', orgId)
                    .in('platform', META_PLATFORMS)
                    .eq('is_active', true)
                    .order('connected_at', { ascending: false });
                if (error) {
                    console.warn('[meta-connect] fetch rows', error.message);
                    return null;
                }
                // Newest first overall stays newest first within each platform.
                const byPlatform = Object.fromEntries(META_PLATFORMS.map((p) => [p, []]));
                (Array.isArray(data) ? data : []).forEach((r) => {
                    if (r && byPlatform[r.platform]) byPlatform[r.platform].push(r);
                });
                return byPlatform;
            } catch (e) {
                console.warn('[meta-connect] fetch rows threw', e);
                return null;
            }
        })();
        activeRowsInFlight = { orgId, promise };
        promise.finally(() => { if (activeRowsInFlight.promise === promise) forgetActiveRows(); });
        return promise;
    }

    // Every active account of one platform, newest first. null means the
    // lookup failed, which is not the same thing as "nothing connected".
    async function fetchActiveChannelRows(platform) {
        if (!META_PLATFORMS.includes(platform)) {
            console.warn('[meta-connect] fetch rows: not a Meta platform', platform);
            return null;
        }
        const byPlatform = await fetchActiveRowsByPlatform();
        return byPlatform ? byPlatform[platform] : null;
    }

    // Every account this workspace has held on a platform, connected or not.
    // Reconnecting one of them never needs a plan (SPEC §3.7).
    async function fetchOwnedAccountIds(platform) {
        const owned = new Set();
        if (!orgReady()) return owned;
        try {
            const { data } = await window.supabaseClient
                .from('org_channel_accounts')
                .select('external_account_id')
                .eq('org_id', window.currentUserOrgId)
                .eq('platform', platform);
            (data || []).forEach((r) => {
                if (r && r.external_account_id) owned.add(String(r.external_account_id));
            });
        } catch (_) { /* an empty set only means "ask for a plan" */ }
        return owned;
    }

    // All connected Meta accounts in the workspace (Pages, Instagram and
    // WhatsApp; Telegram and the website are not Meta), counted once for every
    // card that renders in the same half minute.
    let metaCountCache = { orgId: null, at: 0, promise: null };
    function countConnectedMetaAccounts() {
        const orgId = window.currentUserOrgId;
        if (metaCountCache.promise && metaCountCache.orgId === orgId
            && Date.now() - metaCountCache.at < 30000) {
            return metaCountCache.promise;
        }
        const promise = (async () => {
            if (!orgReady()) return 0;
            try {
                const { count, error } = await window.supabaseClient
                    .from('org_channel_accounts')
                    .select('id', { count: 'exact', head: true })
                    .eq('org_id', orgId)
                    .in('platform', ['page', 'instagram', 'whatsapp'])
                    .eq('is_active', true);
                return error ? 0 : (Number(count) || 0);
            } catch (_) { return 0; }
        })();
        metaCountCache = { orgId, at: Date.now(), promise };
        return promise;
    }
    // Called wherever an account was connected or disconnected: the count and
    // any read of the rows still in flight describe the table from before.
    function forgetMetaCount() {
        metaCountCache = { orgId: null, at: 0, promise: null };
        forgetActiveRows();
    }

    function isHighTrafficOrg(connectedCount) {
        return Number(connectedCount) > HIGH_TRAFFIC_ACCOUNTS;
    }

    // "WhatsApp 1073807889148908" and bare numbers are ids, not names.
    const ID_LIKE = /^(whatsapp\s*)?\+?[0-9][0-9\s-]{4,}$/i;
    function realName(v) {
        const s = String(v == null ? '' : v).trim();
        return s && !ID_LIKE.test(s) ? s : '';
    }

    // The name a customer knows the account by, never a raw id (SPEC §4.3).
    function accountLabel(platform, row) {
        const meta = (row && row.meta && typeof row.meta === 'object') ? row.meta : {};
        if (platform === 'instagram') {
            const user = realName(String(row.instagram_username || '').replace(/^@/, ''))
                || realName(String(row.account_name || '').replace(/^@/, ''));
            return user ? `@${user}`
                : tr('instagram_connect.unnamed', 'Instagram account, reconnect to see the name');
        }
        if (platform === 'whatsapp') {
            return realName(row.account_name) || realName(meta.verified_name)
                || String(meta.display_phone_number || '').trim()
                || tr('whatsapp_connect.unnamed', 'WhatsApp number, reconnect to see the name');
        }
        return realName(row.account_name)
            || tr('messenger_connect.unnamed', 'Facebook Page, reconnect to see the name');
    }

    // SPEC §4.2. A row never says Connected while its last health check says
    // it is not answering. No snapshot yet, or a status the check could not
    // decide, stays Connected: nothing says otherwise.
    const UNHEALTHY_STATUSES = ['not_subscribed', 'token_invalid', 'error', 'not_primary_receiver'];
    function needsAttention(row) {
        const h = row && row.meta && row.meta.webhook_health;
        if (!h || typeof h !== 'object') return false;
        if (h.not_primary_receiver === true) return true;
        return UNHEALTHY_STATUSES.includes(String(h.status || ''));
    }

    function iconFor(platform) {
        try {
            // Declared by index.html; read defensively so a missing icon can
            // never stop the card from drawing.
            // eslint-disable-next-line no-undef
            if (typeof SOCIAL_ICON_URLS !== 'undefined' && SOCIAL_ICON_URLS[platform]) return SOCIAL_ICON_URLS[platform];
        } catch (_) { /* no icon */ }
        return '';
    }

    function paintBadges() {
        try { if (typeof window.paintFeatureBadges === 'function') window.paintFeatureBadges(); }
        catch (_) { /* a badge is decoration */ }
    }

    // The stylesheet for every connect surface: the agent-tab card, its account
    // list and picker, and the dashboard widget. It reads the app's --sp-*
    // design tokens, so light, dark and RTL follow without extra rules; the
    // literal fallbacks only matter where this module is loaded on its own.
    // Layout answers to the width of the card itself (container queries), not
    // the window, because the same card also sits inside the dashboard widget.
    function ensureStyles() {
        if (document.getElementById('mc-styles')) return;
        const style = document.createElement('style');
        style.id = 'mc-styles';
        style.textContent = `
.meta-connect-card{container:mc-card/inline-size}
.mc-card-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.mc-plate,.mc-dash-plate{width:40px;height:40px;border-radius:var(--sp-r-md,10px);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.14)}
.mc-plate img,.mc-dash-plate img{width:24px;height:24px;object-fit:contain}
.mc-card-heading{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.mc-card-title{margin:0;font-size:var(--sp-t-lg,1rem);font-weight:650;line-height:1.3;color:var(--sp-ink,var(--text-primary))}
.mc-card-head .mc-card-beta{margin-inline-start:auto;align-self:flex-start}
.mc-status{display:inline-flex;align-items:center;gap:6px;font-size:var(--sp-t-sm,.8125rem);font-weight:600;line-height:1.3;color:var(--sp-ink-2,var(--text-secondary))}
.mc-status::before{content:"";width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--sp-ink-3,#79818d)}
.mc-status-ok{color:var(--sp-ok,#3fb27f)}
.mc-status-ok::before{background:currentColor}
.mc-status-warn{color:var(--sp-warn,#d9a441)}
.mc-status-warn::before{background:currentColor}
.mc-skel{display:inline-block;width:96px;height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(127,127,127,.12),rgba(127,127,127,.26),rgba(127,127,127,.12));background-size:200% 100%;animation:mc-shimmer 1.2s ease-in-out infinite}
@keyframes mc-shimmer{to{background-position:-200% 0}}
.mc-card-desc,.mc-card-helper{margin:0 0 8px;max-width:72ch;font-size:var(--sp-t-sm,.8125rem);line-height:1.55;color:var(--sp-ink-2,var(--text-secondary))}
.mc-card-desc:empty,.mc-card-helper:empty{display:none}
.mc-card-body{margin-top:12px}
.mc-card-body > .lp-btn{min-height:44px;padding:10px 20px}
.mc-callout{padding:10px 12px;border-radius:var(--sp-r-md,10px);font-size:var(--sp-t-sm,.8125rem);line-height:1.55;background:var(--sp-warn-soft,rgba(245,158,11,.1));color:var(--sp-warn-ink,var(--text-primary))}
.mc-accounts{display:flex;flex-direction:column;gap:10px}
.mc-accounts-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mc-accounts-title{font-size:var(--sp-t-md,.875rem);font-weight:650;color:var(--sp-ink,var(--text-primary))}
.mc-count{min-width:22px;height:20px;padding:0 7px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:var(--sp-t-xs,.75rem);font-weight:700;font-variant-numeric:tabular-nums;background:var(--sp-surface-3,rgba(127,127,127,.16));color:var(--sp-ink-2,var(--text-secondary))}
.mc-traffic-chip{font-size:var(--sp-t-xs,.75rem);font-weight:650;padding:2px 9px;border-radius:999px;background:var(--sp-ok-soft,rgba(63,178,127,.14));color:var(--sp-ok-ink,#2f9e5b)}
.mc-traffic-line{margin:-2px 0 2px;font-size:var(--sp-t-sm,.8125rem);line-height:1.5;color:var(--sp-ink-2,var(--text-secondary))}
.mc-account-box,.mc-account-list,.mc-picker-list{display:flex;flex-direction:column;border:1px solid var(--sp-line,rgba(127,127,127,.2));border-radius:var(--sp-r-lg,14px);background:var(--sp-surface-2,rgba(127,127,127,.04));overflow:hidden}
.mc-account-box > .mc-account-list{border:none;border-radius:0;background:none}
.mc-account{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"icon main pill actions";align-items:center;gap:6px 12px;padding:12px 14px;min-height:56px}
.mc-account + .mc-account{border-top:1px solid var(--sp-line,rgba(127,127,127,.2))}
.mc-account-attention{background:color-mix(in srgb,var(--sp-warn,#d9a441) 9%,transparent)}
.mc-account-icon{grid-area:icon;width:24px;height:24px;border-radius:6px;object-fit:contain}
.mc-account-main{grid-area:main;min-width:0}
.mc-account-name{font-size:var(--sp-t-md,.875rem);font-weight:600;line-height:1.35;color:var(--sp-ink,var(--text-primary));overflow-wrap:anywhere;text-align:match-parent}
.mc-account-detail{margin-top:2px;font-size:var(--sp-t-sm,.8125rem);line-height:1.45;color:var(--sp-ink-2,var(--text-secondary))}
.mc-pill{grid-area:pill;justify-self:end;font-size:var(--sp-t-xs,.75rem);font-weight:650;padding:3px 10px;border-radius:999px;white-space:nowrap}
.mc-pill-ok{background:var(--sp-ok-soft,rgba(16,185,129,.14));color:var(--sp-ok-ink,#10b981)}
.mc-pill-warn{background:var(--sp-warn-soft,rgba(245,158,11,.16));color:var(--sp-warn-ink,#b45309)}
.mc-account-actions,.mc-retry{grid-area:actions}
.mc-account-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
.meta-connect-card .mc-account .lp-btn{width:auto;max-width:none;min-height:32px;padding:6px 12px;border-radius:8px;font-size:var(--sp-t-sm,.8125rem)}
.mc-link{min-height:32px;padding:6px 8px;border:none;border-radius:6px;background:none;color:var(--sp-ink-2,var(--text-secondary));font:inherit;font-size:var(--sp-t-sm,.8125rem);font-weight:500;cursor:pointer}
.mc-link:hover{color:var(--sp-ink,var(--text-primary));text-decoration:underline;text-underline-offset:3px}
[class*="-disconnect-link"].mc-link:hover{color:var(--sp-err,#e5726f)}
.mc-connect-another{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;padding:10px 14px;border:none;border-top:1px solid var(--sp-line,rgba(127,127,127,.2));background:transparent;color:var(--theme-color,var(--sp-accent,#5BAEB0));font:inherit;font-size:var(--sp-t-md,.875rem);font-weight:650;cursor:pointer;transition:background-color .15s ease-out}
.mc-connect-another:hover{background:color-mix(in srgb,var(--theme-color,var(--sp-accent,#5BAEB0)) 10%,transparent)}
.mc-connect-another svg{width:16px;height:16px;flex:0 0 auto}
.mc-connect-another .feat-badge{margin-inline-start:2px}
.mc-link:focus-visible,.mc-connect-another:focus-visible,.mc-pick:focus-within,.mc-dash-btn:focus-visible,.mc-dash-close:focus-visible{outline:2px solid var(--sp-focus,#7fd3d5);outline-offset:-2px}
.mc-dash-btn:focus-visible,.mc-dash-close:focus-visible{outline-offset:2px}
.mc-picker,.mc-summary{display:flex;flex-direction:column;gap:12px}
.mc-picker-title,.mc-summary-line{font-size:var(--sp-t-md,.875rem);font-weight:650;line-height:1.4;color:var(--sp-ink,var(--text-primary))}
.mc-picker-note{padding:10px 12px;border-radius:var(--sp-r-md,10px);font-size:var(--sp-t-sm,.8125rem);line-height:1.55;background:var(--sp-warn-soft,rgba(245,158,11,.1));color:var(--sp-warn-ink,var(--text-primary))}
.mc-pick{display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 14px;cursor:pointer;transition:background-color .15s ease-out}
.mc-pick + .mc-pick{border-top:1px solid var(--sp-line,rgba(127,127,127,.2))}
.mc-pick:hover{background:var(--sp-surface-3,rgba(127,127,127,.08))}
.mc-pick input{width:18px;height:18px;margin:0;flex:0 0 auto;accent-color:var(--theme-color,var(--sp-accent,#57b078))}
.mc-pick-disabled{cursor:default}
.mc-pick-disabled:hover{background:none}
.mc-pick-disabled .mc-pick-name{color:var(--sp-ink-3,var(--text-secondary))}
.mc-pick-pic{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:var(--sp-surface-3,rgba(127,127,127,.18))}
.mc-pick-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.mc-pick-name{font-size:var(--sp-t-md,.875rem);font-weight:550;line-height:1.35;color:var(--sp-ink,var(--text-primary));overflow-wrap:anywhere}
.mc-pick-sub{font-size:var(--sp-t-xs,.75rem);color:var(--sp-ink-2,var(--text-secondary))}
.mc-pick-note{font-size:var(--sp-t-xs,.75rem);font-weight:600;color:var(--sp-ink-2,var(--text-secondary));white-space:nowrap}
.mc-pick-note:empty{display:none}
.mc-picker-actions{display:flex;gap:8px;flex-wrap:wrap}
.meta-connect-card .mc-picker-actions .lp-btn{width:auto;max-width:none;min-height:40px;padding:8px 18px}
.meta-connect-card .mc-picker-go:disabled{opacity:.5;cursor:not-allowed;filter:none;transform:none}
.mc-progress{display:flex;align-items:center;gap:10px;min-height:44px;font-size:var(--sp-t-md,.875rem);color:var(--sp-ink-2,var(--text-secondary))}
.mc-progress::before{content:"";width:16px;height:16px;flex:0 0 auto;border-radius:50%;border:2px solid var(--sp-line-2,rgba(127,127,127,.3));border-top-color:var(--theme-color,var(--sp-accent,#5BAEB0));animation:mc-spin .8s linear infinite}
@keyframes mc-spin{to{transform:rotate(360deg)}}
@container mc-card (max-width:520px){
  .mc-account{grid-template-columns:auto auto minmax(0,1fr);grid-template-areas:"icon main main" ". pill actions";row-gap:8px}
  .mc-account-attention{grid-template-areas:"icon main main" ". pill pill" ". actions actions"}
  .mc-pill{justify-self:start}
  .mc-account-actions{justify-content:flex-start}
  .mc-picker-actions{flex-direction:column}
  .meta-connect-card .mc-picker-actions .lp-btn{width:100%;min-height:44px}
}
.mc-dash{container:mc-dash/inline-size;margin-bottom:var(--sp-5,24px);padding:var(--sp-5,20px);border-radius:var(--sp-r-lg,14px);background:var(--sp-surface,rgba(127,127,127,.05));border:1px solid var(--sp-line,rgba(127,127,127,.16))}
.mc-dash-head{display:flex;flex-direction:column;gap:10px;margin-bottom:var(--sp-4,16px)}
.mc-dash-heading{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 16px}
.mc-dash-title{margin:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:var(--sp-t-lg,1rem);font-weight:700;line-height:1.35;color:var(--sp-ink,var(--text-primary));text-wrap:balance}
.mc-dash-progress{margin:0;font-size:var(--sp-t-sm,.8125rem);font-weight:500;color:var(--sp-ink-2,var(--text-secondary));font-variant-numeric:tabular-nums;white-space:nowrap}
.mc-dash-meter{height:4px;border-radius:999px;overflow:hidden;background:var(--sp-surface-3,rgba(127,127,127,.16))}
.mc-dash-meter > span{display:block;width:100%;height:100%;border-radius:inherit;background:var(--sp-accent,var(--theme-color,#5BAEB0));transform-origin:left center;transition:transform .4s cubic-bezier(.16,1,.3,1)}
[dir="rtl"] .mc-dash-meter > span{transform-origin:right center}
.mc-dash-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);border:1px solid var(--sp-line,rgba(127,127,127,.2));border-radius:var(--sp-r-lg,14px);overflow:hidden;background:var(--sp-surface-2,rgba(127,127,127,.04))}
.mc-dash-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"plate text action";align-items:center;gap:12px;min-width:0;padding:12px 14px;min-height:68px}
.mc-dash-item + .mc-dash-item{border-top:1px solid var(--sp-line,rgba(127,127,127,.2))}
.mc-dash-plate{grid-area:plate}
.mc-dash-text{grid-area:text;min-width:0;display:flex;flex-direction:column;gap:2px}
.mc-dash-name-row{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px}
.mc-dash-name{font-size:var(--sp-t-md,.875rem);font-weight:650;line-height:1.35;color:var(--sp-ink,var(--text-primary))}
.mc-dash-state{display:inline-flex;align-items:center;gap:5px;font-size:var(--sp-t-xs,.75rem);font-weight:600;color:var(--sp-ink-2,var(--text-secondary))}
.mc-dash-state::before{content:"";width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--sp-ink-3,#79818d)}
.mc-dash-on .mc-dash-state{color:var(--sp-ok,#3fb27f)}
.mc-dash-on .mc-dash-state::before{background:currentColor}
.mc-dash-sub{font-size:var(--sp-t-sm,.8125rem);line-height:1.45;color:var(--sp-ink-2,var(--text-secondary));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-dash-btn{grid-area:action;min-height:44px;padding:8px 18px;border-radius:var(--sp-r-md,10px);font:inherit;font-size:var(--sp-t-md,.875rem);font-weight:650;white-space:nowrap;cursor:pointer;transition:background-color .15s ease-out,border-color .15s ease-out,color .15s ease-out}
.mc-dash-connect{border:1px solid transparent;background:var(--sp-accent,var(--theme-color,#5BAEB0));color:var(--sp-accent-ink,#0d2a2b)}
.mc-dash-connect:hover{background:var(--sp-accent-hover,#74c1c3)}
.mc-dash-connect:disabled{opacity:.6;cursor:progress}
.mc-dash-manage{border:1px solid var(--sp-line-2,rgba(127,127,127,.35));background:transparent;color:var(--sp-ink,var(--text-primary))}
.mc-dash-manage:hover{border-color:var(--sp-accent,var(--theme-color));color:var(--sp-accent,var(--theme-color))}
@container mc-dash (min-width:640px){
  .mc-dash-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;border:none;border-radius:0;overflow:visible;background:none}
  .mc-dash-item{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"plate text" "action action";align-items:center;gap:16px 12px;padding:16px;border:1px solid var(--sp-line,rgba(127,127,127,.2));border-radius:var(--sp-r-lg,14px);background:var(--sp-surface-2,rgba(127,127,127,.04))}
  .mc-dash-item + .mc-dash-item{border-top:1px solid var(--sp-line,rgba(127,127,127,.2))}
  .mc-dash-on{border-color:color-mix(in srgb,var(--sp-ok,#3fb27f) 45%,var(--sp-line,transparent))}
  .mc-dash-btn{width:100%;min-height:40px}
}
@container mc-dash (max-width:639px){
  .mc-dash-sub{white-space:normal;overflow:visible}
  .mc-dash-off .mc-dash-state{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
}
@media (max-width:480px){.mc-dash{padding:16px}}
.mc-dash-flow{margin-top:var(--sp-4,16px);padding-top:var(--sp-4,16px);border-top:1px solid var(--sp-line,rgba(127,127,127,.2))}
.mc-dash-flow:empty{display:none}
.mc-dash-flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.mc-dash-flow-title{display:flex;align-items:center;gap:10px;min-width:0;margin:0;font-size:var(--sp-t-md,.875rem);font-weight:650;color:var(--sp-ink,var(--text-primary))}
.mc-dash-flow-title .mc-dash-plate{width:32px;height:32px;border-radius:8px}
.mc-dash-flow-title .mc-dash-plate img{width:20px;height:20px}
.mc-dash-close{width:40px;height:40px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--sp-r-md,10px);background:transparent;color:var(--sp-ink-2,var(--text-secondary));cursor:pointer;transition:background-color .15s ease-out,color .15s ease-out}
.mc-dash-close:hover{background:var(--sp-surface-3,rgba(127,127,127,.12));color:var(--sp-ink,var(--text-primary))}
.mc-dash-close svg{width:18px;height:18px}
.mc-card--embedded .mc-card-head,.mc-card--embedded .mc-card-desc,.mc-card--embedded .mc-card-helper{display:none}
.mc-card--embedded .mc-card-body{margin-top:0}
.meta-connect-card .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){.mc-skel,.mc-progress::before{animation:none}.mc-dash-meter > span{transition:none}}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    function plateHtml(platform, cls) {
        const icon = iconFor(platform);
        return `<span class="${cls}">${icon ? `<img src="${esc(icon)}" alt="" width="24" height="24">` : ''}</span>`;
    }

    async function ensureFB() {
        if (window.FB) return true;
        // Actually load the SDK instead of just waiting for it — without
        // this, clicking Connect before the WhatsApp modal ever opened
        // means window.FB never appears and the 1s grace below toasts
        // "Facebook SDK not ready".
        if (typeof window.ensureFbSdk === 'function') {
            try { await window.ensureFbSdk(); } catch (_) { /* fall through */ }
        }
        if (window.FB) return true;
        await new Promise((r) => setTimeout(r, 1000));
        if (window.FB) return true;
        toast(tr('meta_connect.fb_sdk_not_ready', 'Facebook SDK not ready. Please try again.'), 'error');
        return false;
    }

    function buildCard(platform) {
        const isIG = platform === 'instagram';
        const isWA = platform === 'whatsapp';
        ensureStyles();
        const card = document.createElement('div');
        card.id = `${platform}-connect-card`;
        card.className = 'card glass meta-connect-card';
        card.dataset.platform = platform;
        card.style.cssText = 'margin-bottom:18px;padding:18px;';
        const title = isWA
            ? tr('whatsapp_connect.card_title', 'WhatsApp Channel Connection')
            : (isIG
                ? tr('instagram_connect.card_title', 'Instagram Channel Connection')
                : tr('messenger_connect.card_title',  'Messenger Channel Connection'));
        // One header: the channel's logo, its name and where it stands. The
        // status line starts as a placeholder bar until the accounts load.
        card.innerHTML = `
          <div class="mc-card-head">
            ${plateHtml(platform, 'mc-plate')}
            <div class="mc-card-heading">
              <h3 class="mc-card-title">${esc(title)}</h3>
              <span class="mc-card-status ${platform}-card-status"><span class="mc-skel" aria-hidden="true"></span><span class="sr-only">${esc(tr('meta_connect.loading', 'Loading'))}</span></span>
            </div>
            <span class="beta-badge feat-badge feat-badge-beta mc-card-beta">BETA</span>
          </div>
          <p class="mc-card-desc ${platform}-card-desc"></p>
          <p class="mc-card-helper ${platform}-card-helper"></p>
          <div class="mc-card-body ${platform}-card-body"></div>`;
        return card;
    }

    function statusHtml(kind, text) {
        return `<span class="mc-status mc-status-${kind}">${esc(text)}</span>`;
    }

    function platformCopy(platform) {
        if (platform === 'whatsapp') {
            return {
                desc:   tr('whatsapp_connect.description',
                    'Connect your WhatsApp Business Account to send and receive WhatsApp messages inside Omnio.'),
                helper: '',
            };
        }
        if (platform === 'instagram') {
            return {
                desc:   tr('instagram_connect.description',
                    'Connect your Instagram Professional account to manage DMs inside Omnio. Your Instagram account must be linked to a Facebook Page you manage.'),
                helper: tr('instagram_connect.helper_pro',
                    "Don't have a Professional account? Go to Instagram Settings → Account → Switch to Professional Account."),
            };
        }
        return {
            desc:   tr('messenger_connect.description',
                'Connect your Facebook Page to receive and reply to Messenger conversations inside Omnio.'),
            helper: '',
        };
    }

    async function renderCardStatus(card, platform) {
        // A card lent to another surface (the dashboard widget) only ever
        // shows a connect flow; "back to the status view" means "done here".
        if (card.classList.contains('mc-card--embedded')) {
            card.dataset.mode = 'status';
            card.dispatchEvent(new CustomEvent('meta-connect:done', { bubbles: true, detail: { platform } }));
            return;
        }
        card.dataset.mode = 'status';
        const isIG = platform === 'instagram';
        const isWA = platform === 'whatsapp';
        const [rows, connectedCount] = await Promise.all([
            fetchActiveChannelRows(platform),
            countConnectedMetaAccounts(),
        ]);
        // A connect flow opened while this was loading owns the card now.
        if (card.dataset.mode === 'flow') return;
        const status = card.querySelector(`.${platform}-card-status`);
        const desc   = card.querySelector(`.${platform}-card-desc`);
        const helper = card.querySelector(`.${platform}-card-helper`);
        const body   = card.querySelector(`.${platform}-card-body`);
        const copy = platformCopy(platform);
        // How to connect is only worth reading while nothing is connected.
        desc.textContent   = '';
        helper.textContent = '';

        if (rows === null && orgReady()) {
            // The lookup failed. Saying "Not connected" here would be a lie
            // for a workspace that is connected.
            status.innerHTML = statusHtml('warn', tr('meta_connect.status_unknown', 'Status unavailable'));
            body.innerHTML = `<div class="mc-callout" role="status">${esc(tr('meta_connect.load_failed', 'Could not load your connected accounts. Refresh the page to try again.'))}</div>`;
            paintBadges();
            return;
        }

        if (rows && rows.length) {
            status.innerHTML = statusHtml('ok', tr('meta_connect.connected', 'Connected'));
            body.innerHTML = '';
            body.appendChild(buildAccountsPanel(card, platform, rows, connectedCount));
        } else {
            status.innerHTML = statusHtml('off', tr('meta_connect.not_connected', 'Not Connected'));
            desc.textContent   = copy.desc;
            helper.textContent = copy.helper;
            // Warm the plan check so a Connect click opens the dialog at once.
            if (window.requireActivePlanForConnect) {
                window.requireActivePlanForConnect('', { silent: true }).catch(() => {});
            }
            const btnLabel = isWA
                ? tr('whatsapp_connect.btn_connect_card', 'Connect WhatsApp')
                : (isIG
                    ? tr('instagram_connect.btn_connect', 'Connect Instagram')
                    : tr('messenger_connect.btn_connect',  'Connect Facebook Page'));
            const btnTitle = isWA
                ? tr('whatsapp_connect.tip_connect_card', 'Opens the Meta WhatsApp Business Embedded Signup to link your WABA and phone number.')
                : (isIG
                    ? tr('instagram_connect.tip_connect', 'Opens Facebook login to discover your linked Instagram Professional account.')
                    : tr('messenger_connect.tip_connect',  'Opens Facebook login. You will select which Page to connect to Messenger.'));
            body.innerHTML = `
              <button class="lp-btn lp-btn-primary ${platform}-connect-btn" title="${btnTitle}">${btnLabel}</button>`;
            card.querySelector(`.${platform}-connect-btn`).addEventListener('click', () => {
                if (isWA) {
                    if (typeof window.startWhatsAppEmbeddedSignup === 'function') {
                        window.startWhatsAppEmbeddedSignup();
                    }
                    return;
                }
                handleConnect(card, platform);
            });
        }
        paintBadges();
    }

    // The connected-channels panel (SPEC §4): one row per account, each drawn
    // on its own so one bad row can never blank the others.
    function buildAccountsPanel(card, platform, rows, connectedCount) {
        const isWA = platform === 'whatsapp';
        const panel = document.createElement('div');
        panel.className = 'mc-accounts';

        const head = document.createElement('div');
        head.className = 'mc-accounts-head';
        const title = document.createElement('span');
        title.className = 'mc-accounts-title';
        title.textContent = tr('meta_connect.connected_accounts', 'Connected accounts');
        head.appendChild(title);
        const count = document.createElement('span');
        count.className = 'mc-count';
        count.textContent = String(rows.length);
        head.appendChild(count);
        // The list, the alert and this chip shipped as one release with
        // "Connect another", which carries its one NEW badge.
        const busy = isHighTrafficOrg(connectedCount);
        if (busy) {
            const chip = document.createElement('span');
            chip.className = 'mc-traffic-chip';
            chip.textContent = tr('meta_connect.high_traffic', 'High traffic');
            head.appendChild(chip);
        }
        panel.appendChild(head);
        if (busy) {
            const line = document.createElement('div');
            line.className = 'mc-traffic-line';
            line.textContent = fill(tr('meta_connect.high_traffic_line',
                'You have {N} accounts connected. That is a lot of activity in one place, and it is a good sign.'),
                { N: connectedCount });
            panel.appendChild(line);
        }

        // One box: the accounts, then "Connect another" as its last row.
        const box = document.createElement('div');
        box.className = 'mc-account-box';
        const list = document.createElement('div');
        list.className = 'mc-account-list';
        list.setAttribute('role', 'list');
        for (const row of rows) {
            try {
                list.appendChild(buildAccountRow(card, platform, row));
            } catch (e) {
                console.warn('[meta-connect] account row failed to render', e);
            }
        }
        box.appendChild(list);

        // "Connect another" on every platform with rows, WhatsApp included:
        // a second number runs the same Embedded Signup and lands as its own
        // per-number row (backend keeps tokens and sync state per number).
        {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = `mc-connect-another ${platform}-connect-another`;
            more.setAttribute('data-feature', 'channel-multi-connect');
            more.innerHTML = `${PLUS_ICON}<span>${esc(tr('meta_connect.connect_another', 'Connect another'))}</span>`;
            more.addEventListener('click', () => {
                if (isWA && typeof window.startWhatsAppEmbeddedSignup === 'function') {
                    window.startWhatsAppEmbeddedSignup();
                    return;
                }
                handleConnect(card, platform);
            });
            box.appendChild(more);
        }
        panel.appendChild(box);
        return panel;
    }

    function buildAccountRow(card, platform, row) {
        const isWA = platform === 'whatsapp';
        const label = accountLabel(platform, row);
        const attention = !isWA && needsAttention(row);

        const item = document.createElement('div');
        item.className = 'mc-account' + (attention ? ' mc-account-attention' : '');
        item.setAttribute('role', 'listitem');
        const icon = iconFor(platform);
        if (icon) {
            const img = document.createElement('img');
            img.className = 'mc-account-icon';
            img.alt = '';
            img.src = icon;
            item.appendChild(img);
        }
        const main = document.createElement('div');
        main.className = 'mc-account-main';
        const name = document.createElement('div');
        name.className = 'mc-account-name';
        name.dir = 'auto';
        name.textContent = label;
        main.appendChild(name);
        if (attention) {
            const detail = document.createElement('div');
            detail.className = 'mc-account-detail';
            detail.textContent = fill(tr('meta_connect.attention_detail',
                '{name} stopped answering. Reconnect to fix it.'), { name: label });
            main.appendChild(detail);
        }
        item.appendChild(main);

        const pill = document.createElement('span');
        pill.className = 'mc-pill ' + (attention ? 'mc-pill-warn' : 'mc-pill-ok');
        pill.textContent = attention
            ? tr('meta_connect.needs_attention', 'Needs attention')
            : tr('meta_connect.connected', 'Connected');
        item.appendChild(pill);

        const actions = document.createElement('div');
        actions.className = 'mc-account-actions';
        if (attention) {
            const again = document.createElement('button');
            again.type = 'button';
            again.className = 'lp-btn lp-btn-primary mc-reconnect';
            again.textContent = tr('meta_connect.reconnect', 'Reconnect');
            again.addEventListener('click', () => handleConnect(card, platform, {
                preselect: String(row.external_account_id || ''),
            }));
            actions.appendChild(again);
        }
        if (isWA) {
            const settings = document.createElement('button');
            settings.type = 'button';
            settings.className = 'mc-link whatsapp-settings-link';
            settings.textContent = tr('whatsapp_connect.view_settings', 'View Settings');
            settings.addEventListener('click', () => {
                if (typeof window.openWhatsAppConnectModal === 'function') {
                    window.openWhatsAppConnectModal('settings');
                }
            });
            actions.appendChild(settings);
        }
        const off = document.createElement('button');
        off.type = 'button';
        off.className = `mc-link ${platform}-disconnect-link`;
        off.textContent = tr('meta_connect.disconnect', 'Disconnect');
        off.addEventListener('click', () => handleDisconnect(card, platform, row));
        actions.appendChild(off);
        item.appendChild(actions);
        return item;
    }

    async function handleConnect(card, platform, opts) {
        const options = opts || {};
        // No plan, no Facebook dialog (SPEC §9.3): ask before login, not after
        // the customer has already picked a page. One exception (SPEC §3.7): a
        // workspace that already held an account on this platform may always
        // reconnect it, whatever its plan, so the picker then offers only the
        // accounts it owned. A plan that ended must never stand between a
        // merchant and fixing a Page Meta disconnected; the reply-time gate is
        // what decides whether the agent answers.
        let ownedOnly = null;
        if (window.requireActivePlanForConnect) {
            const label = platform === 'instagram' ? 'Instagram' : 'Messenger';
            if (!(await window.requireActivePlanForConnect(label, { silent: true }))) {
                const owned = await fetchOwnedAccountIds(platform);
                if (!owned.size) {
                    await window.requireActivePlanForConnect(label);
                    return;
                }
                ownedOnly = owned;
            }
        }
        card.dataset.mode = 'flow';
        if (!(await ensureFB())) { card.dataset.mode = 'status'; return; }
        // Only permissions Meta approved for advanced access (App Review
        // 2026-05-24). Requesting a rejected scope shows "Invalid Scopes"
        // to every non-admin customer and blocks the login.
        const scopes = platform === 'instagram'
            ? ['pages_show_list','instagram_basic','instagram_manage_messages','pages_messaging','pages_read_engagement']
            : ['pages_show_list','pages_messaging','pages_read_engagement'];
        let token;
        const configId = LOGIN_CONFIG_IDS[platform === 'instagram' ? 'instagram' : 'page'];
        try { token = await window.getOrRefreshMetaToken(scopes, { config_id: configId }); }
        catch (e) {
            card.dataset.mode = 'status';
            toast(e.message || tr('meta_connect.fb_login_cancelled', 'Facebook login was cancelled or failed.'), 'error');
            return;
        }

        // Discover Pages server-side (meta-token-manager `list_pages`): the
        // edge function retries via debug_token granular_scopes when
        // /me/accounts comes back empty, and returns the REAL Graph error
        // instead of collapsing every failure into "No Pages found".
        let pages = [];
        let discovery = null;
        let serverDiscoveryError = null;
        try {
            const headers = await getSessionAuthHeaders();
            const r = await fetch(META_TOKEN_URL(), {
                method: 'POST', headers,
                body: JSON.stringify({
                    action: 'list_pages',
                    org_id: window.currentUserOrgId,
                    short_token: token,
                    platform: platform === 'instagram' ? 'instagram' : 'page',
                }),
            });
            const j = await r.json();
            if (r.ok && j && Array.isArray(j.pages)) {
                discovery = j;
                pages = j.pages;
            } else {
                throw new Error((j && j.error) || `HTTP ${r.status}`);
            }
        } catch (e) {
            console.warn('[meta-connect] list_pages failed, falling back to direct Graph:', e);
            // Remember that the SERVER-side discovery never ran. The browser
            // fallback below can only read /me/accounts — no business assets, no
            // granular-scope retry, and it writes no diagnostic row. Telling a
            // merchant to "tick your Page in the dialog" on the strength of that
            // weaker search is how someone who genuinely manages a Page gets sent
            // in circles, so the empty state has to say which search actually ran.
            serverDiscoveryError = (e && e.message) || String(e);
            // Fallback: direct browser call, keeping the real error visible.
            try {
                const igSub = '{id,name,username,profile_picture_url}';
                const fields = platform === 'instagram'
                    ? `id,name,instagram_business_account${igSub},connected_instagram_account${igSub}`
                    : 'id,name,picture{url}';
                const url = `https://graph.facebook.com/v24.0/me/accounts?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
                const r = await fetch(url);
                const j = await r.json();
                if (j && j.error) {
                    discovery = { graph_error: { code: j.error.code, message: j.error.message } };
                }
                pages = Array.isArray(j && j.data) ? j.data : [];
                // A Page linked to Instagram the newer way exposes only
                // `connected_instagram_account`; normalise so the filter below
                // (and every later read) has one shape.
                pages.forEach((p) => {
                    if (!p.instagram_business_account && p.connected_instagram_account) {
                        p.instagram_business_account = p.connected_instagram_account;
                    }
                });
            } catch (e2) {
                card.dataset.mode = 'status';
                toast(tr('meta_connect.pages_failed', 'Could not load your Pages. Please try again.'), 'error');
                return;
            }
        }
        if (platform === 'instagram') {
            var pagesBeforeIgFilter = pages.length;
            pages = pages.filter((p) => p.instagram_business_account && p.instagram_business_account.id);
        }

        const body = card.querySelector(`.${platform}-card-body`);
        if (pages.length === 0) {
            // Explain WHY, in order of certainty: a real Graph error → missing
            // permission grants → IG account not linked → genuinely no Pages.
            let why;
            const gErr = discovery && discovery.graph_error;
            const missing = (discovery && discovery.missing_scopes) || [];
            // debug_token is what tells us which permissions were granted. When
            // it fails the edge function returns no scopes at all, which reads
            // downstream as "everything was granted" — and an Instagram merchant
            // who simply never granted instagram_basic gets told to switch their
            // account to Professional, which they have already done.
            const scopesUnknown = !!discovery && Array.isArray(discovery.granted_scopes)
                && discovery.granted_scopes.length === 0;
            if (serverDiscoveryError) {
                why = `${tr('meta_connect.server_discovery_failed', 'We could not reach Digitivia\'s Page discovery service, so only a basic search ran. Please try Connect again in a moment.')} (${serverDiscoveryError})`;
            } else if (gErr && gErr.message) {
                why = `${tr('meta_connect.graph_error_prefix', 'Facebook could not list your Pages:')} ${gErr.message}`;
            } else if (missing.length > 0) {
                why = `${tr('meta_connect.missing_permissions', 'Your Facebook login did not grant these required permissions:')} ${missing.join(', ')}. ${tr('meta_connect.rerequest_hint', 'Click Connect again and approve every permission, and make sure you tick the Pages you manage in the Facebook dialog.')}`;
            } else if (discovery && discovery.business_count > 0 && (discovery.page_count === 0)) {
                why = tr('meta_connect.business_no_pages', 'Your Facebook Business was connected, but it has no Pages this app can manage. In the Facebook dialog make sure the Page itself is ticked, and that your user has a Page role (Admin) on it.');
            } else if (scopesUnknown) {
                why = tr('meta_connect.scopes_unknown', 'Facebook did not tell us which permissions you granted, so we cannot say what is missing. Click Connect again and approve every permission, ticking the Page you manage in the Facebook dialog.');
            } else if (platform === 'instagram' && typeof pagesBeforeIgFilter === 'number' && pagesBeforeIgFilter > 0) {
                why = tr('instagram_connect.no_ig_account', 'No Instagram Professional account found linked to your Pages. Go to Instagram Settings → Account → Switch to Professional Account, then link it to your Facebook Page and try again.');
            } else if (platform === 'instagram') {
                why = tr('instagram_connect.no_pages_selected', 'Facebook returned no Pages for your login. In the Facebook dialog, choose "Opt in to all current and future Pages" (or tick your Page), then try again. If you already connected before, open facebook.com → Settings → Business integrations, remove Digitivia, and reconnect.');
            } else {
                why = tr('messenger_connect.no_pages_selected', 'Facebook returned no Pages for your login. In the Facebook dialog, choose "Opt in to all current and future Pages" (or tick your Page), then try again. If you already connected before, open facebook.com → Settings → Business integrations, remove Digitivia, and reconnect.');
            }
            body.innerHTML = `<div class="mc-callout" role="status">${esc(why)}</div>`;
            card.dataset.mode = 'status';
            return;
        }
        await renderPicker(card, platform, pages, token, {
            ownedOnly,
            preselect: options.preselect || '',
        });
    }

    // Choose any number of Pages (or Instagram accounts) and connect them in
    // one pass (SPEC §3.3). A Page that is already connected and healthy is
    // shown, never hidden, and cannot be picked again; one that needs
    // attention can, because connecting it again is how it is repaired.
    async function renderPicker(card, platform, pages, token, opts) {
        const isIG = platform === 'instagram';
        const body = card.querySelector(`.${platform}-card-body`);
        const activeRows = (await fetchActiveChannelRows(platform)) || [];
        const activeById = new Map(activeRows.map((r) => [String(r.external_account_id), r]));

        const items = pages.map((page) => {
            const id = String(isIG ? page.instagram_business_account.id : page.id);
            const row = activeById.get(id);
            let state = 'new';
            if (row) state = needsAttention(row) ? 'reconnect' : 'connected';
            else if (opts.ownedOnly && !opts.ownedOnly.has(id)) state = 'needs_plan';
            return { page, id, state };
        });
        const selectable = items.filter((it) => it.state === 'new' || it.state === 'reconnect');

        body.innerHTML = `
          <div class="mc-picker">
            <div class="mc-picker-title"></div>
            <div class="mc-picker-note" hidden></div>
            <div class="mc-picker-list" role="list"></div>
            <div class="mc-picker-actions">
              <button type="button" class="lp-btn lp-btn-primary mc-picker-go" disabled></button>
              <button type="button" class="lp-btn lp-btn-outline meta-cancel-btn"></button>
            </div>
          </div>`;
        body.querySelector('.mc-picker-title').textContent = isIG
            ? tr('meta_connect.pick_title_ig', 'Choose the Instagram accounts to connect')
            : tr('meta_connect.pick_title_pages', 'Choose the Pages to connect');
        if (opts.ownedOnly) {
            const note = body.querySelector('.mc-picker-note');
            note.hidden = false;
            note.textContent = tr('meta_connect.owned_only_note',
                'Your plan has ended, so you can reconnect accounts you already had. Choose a plan to add new ones.');
        }
        const list = body.querySelector('.mc-picker-list');
        const go = body.querySelector('.mc-picker-go');
        body.querySelector('.meta-cancel-btn').textContent = tr('meta_connect.btn_cancel', 'Cancel');

        const refreshGo = () => {
            const n = list.querySelectorAll('input[type="checkbox"]:checked').length;
            go.disabled = n === 0;
            if (n === 0) {
                go.textContent = isIG
                    ? tr('meta_connect.pick_none_accounts', 'Choose an account to connect')
                    : tr('meta_connect.pick_none_pages', 'Choose a Page to connect');
                return;
            }
            const key = isIG
                ? (n === 1 ? 'meta_connect.connect_one_account' : 'meta_connect.connect_n_accounts')
                : (n === 1 ? 'meta_connect.connect_one_page' : 'meta_connect.connect_n_pages');
            const fallback = isIG
                ? (n === 1 ? 'Connect 1 account' : 'Connect {N} accounts')
                : (n === 1 ? 'Connect 1 page' : 'Connect {N} pages');
            go.textContent = fill(tr(key, fallback), { N: n });
        };

        items.forEach((it, idx) => {
            try {
                const disabled = it.state === 'connected' || it.state === 'needs_plan';
                const ig = it.page.instagram_business_account;
                const pic = isIG
                    ? ((ig && ig.profile_picture_url) || '')
                    : ((it.page.picture && it.page.picture.data && it.page.picture.data.url) || '');
                const pick = document.createElement('label');
                pick.className = 'mc-pick' + (disabled ? ' mc-pick-disabled' : '');
                pick.setAttribute('role', 'listitem');
                pick.innerHTML = `
                  <input type="checkbox" data-idx="${idx}" ${disabled ? 'disabled' : ''}>
                  ${pic ? `<img class="mc-pick-pic" src="${esc(pic)}" alt="">` : '<span class="mc-pick-pic"></span>'}
                  <span class="mc-pick-text"><span class="mc-pick-name"></span><span class="mc-pick-sub"></span></span>
                  <span class="mc-pick-note"></span>`;
                pick.querySelector('.mc-pick-name').textContent = isIG ? `@${ig.username}` : String(it.page.name || '');
                const sub = pick.querySelector('.mc-pick-sub');
                if (isIG) sub.textContent = String(it.page.name || ''); else sub.remove();
                const note = pick.querySelector('.mc-pick-note');
                note.textContent = it.state === 'connected' ? tr('meta_connect.already_connected', 'Already connected')
                    : it.state === 'reconnect' ? tr('meta_connect.reconnect', 'Reconnect')
                    : it.state === 'needs_plan' ? tr('meta_connect.needs_plan', 'Needs a plan')
                    : '';
                const box = pick.querySelector('input');
                if (!disabled && (selectable.length === 1 || (opts.preselect && opts.preselect === it.id))) {
                    box.checked = true;
                }
                box.addEventListener('change', refreshGo);
                list.appendChild(pick);
            } catch (e) {
                console.warn('[meta-connect] picker row failed to render', e);
            }
        });
        refreshGo();

        body.querySelector('.meta-cancel-btn').addEventListener('click', () => renderCardStatus(card, platform));
        go.addEventListener('click', () => {
            const chosen = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
                .map((b) => items[Number(b.dataset.idx)])
                .filter((it) => it && (it.state === 'new' || it.state === 'reconnect'))
                .map((it) => it.page);
            if (chosen.length) handleConfirm(card, platform, chosen, token);
        });
    }

    // Connect the chosen accounts one at a time with the same single-account
    // exchange as always: no new batched wire format, and an earlier success
    // is never rolled back because a later one failed (SPEC §3.3).
    async function handleConfirm(card, platform, pages, token) {
        const body = card.querySelector(`.${platform}-card-body`);
        body.innerHTML = '<div class="mc-progress" aria-live="polite"></div>';
        const progress = body.querySelector('.mc-progress');
        const results = [];
        for (let i = 0; i < pages.length; i++) {
            progress.textContent = fill(tr('meta_connect.connecting_progress', 'Connecting {i} of {n}'),
                { i: i + 1, n: pages.length });
            results.push(await exchangeOne(platform, pages[i], token));
        }
        forgetMetaCount();
        announceConnected(platform, results);
        renderConnectSummary(card, platform, results, token);
    }

    // One "your channel is connected" notice per pass, not per account (SPEC
    // §9.7). Pages go out one exchange at a time, so only this side knows where
    // a pass ends. The server re-reads every account it is given and announces
    // only the ones that really are live, so a lost or repeated call is
    // harmless, and a failed announcement never touches the connect itself.
    async function announceConnected(platform, results) {
        try {
            const ids = results.filter((r) => r && r.ok).map((r) => {
                const ig = r.page && r.page.instagram_business_account;
                return String((platform === 'instagram' ? (ig && ig.id) : (r.page && r.page.id)) || '').trim();
            }).filter(Boolean);
            if (!ids.length) return;
            const headers = await getSessionAuthHeaders();
            await fetch(META_TOKEN_URL(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    action: 'connected_summary',
                    org_id: window.currentUserOrgId,
                    platform,
                    external_account_ids: ids,
                    ui_lang: window.currentLang || 'en',
                }),
            });
        } catch (e) {
            console.warn('[meta-connect] connected_summary', e);
        }
    }

    async function exchangeOne(platform, page, token) {
        const isIG = platform === 'instagram';
        const ig = page.instagram_business_account;
        const name = isIG ? `@${ig.username}` : String(page.name || '');
        const reqBody = isIG ? {
            action: 'exchange',
            org_id: window.currentUserOrgId,
            short_token: token,
            platform: 'instagram',
            account_id: ig.id,
            account_name: ig.username,
            ig_account_id: ig.id,
            page_id: page.id,
            meta_user_id: '',
        } : {
            action: 'exchange',
            org_id: window.currentUserOrgId,
            short_token: token,
            platform: 'page',
            account_id: page.id,
            account_name: page.name,
        };
        try {
            const headers = await getSessionAuthHeaders();
            const r = await fetch(META_TOKEN_URL(), { method: 'POST', headers, body: JSON.stringify(reqBody) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || (j && j.error)) {
                return { page, name, ok: false, error: String((j && j.error) || `HTTP ${r.status}`) };
            }
            if (isIG) {
                try {
                    // The exact row just written, never every Instagram row.
                    await window.supabaseClient.from('org_channel_accounts')
                        .update({ instagram_username: ig.username })
                        .eq('org_id', window.currentUserOrgId)
                        .eq('platform', 'instagram')
                        .eq('external_account_id', String(ig.id));
                } catch (e) { console.warn('[meta-connect] ig_username update', e); }
            }
            // The token can save while the webhook subscription fails (most
            // often because the granted token lacks pages_manage_metadata).
            // Without that subscription Meta delivers NOTHING, so this one is
            // not a success yet.
            const subscribeResult = j && j.subscribe_result;
            if (subscribeResult && subscribeResult !== 'ok') {
                console.warn('[meta-connect] webhook subscription failed:', subscribeResult);
                return { page, name, ok: false, subscribeFailed: true };
            }
            return { page, name, ok: true };
        } catch (e) {
            return { page, name, ok: false, error: String((e && e.message) || e) };
        }
    }

    function failureText(result) {
        if (result.subscribeFailed) {
            return tr('meta_connect.subscribe_failed',
                'Connected, but we could not enable message delivery for this account. Messages will not arrive yet. Please disconnect and connect again, granting all requested permissions — if it keeps failing, contact support.');
        }
        // The server's one sentence written for people; anything else stays in
        // the console, never on screen.
        if (/already connected to another workspace/i.test(result.error || '')) return result.error;
        console.warn('[meta-connect] connect failed:', result.error);
        return tr('meta_connect.item_failed', 'We could not connect this one. Please try again.');
    }

    function renderConnectSummary(card, platform, results, token) {
        const isIG = platform === 'instagram';
        const ok = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);
        if (!failed.length) {
            if (results.length === 1) {
                toast(isIG
                    ? tr('instagram_connect.connect_success', 'Instagram connected! DMs will now appear in your Digitivia inbox.')
                    : tr('messenger_connect.connect_success', 'Messenger connected! Your Page is now linked to Digitivia.'), 'success');
            } else {
                toast(fill(tr('meta_connect.all_connected', '{X} connected.'), { X: ok }), 'success');
            }
            renderCardStatus(card, platform);
            // Whoever mounted this card decides what happens next: the agent tab
            // stays where it is, the dashboard widget takes the customer to the
            // channel's own tab (SPEC §9.6). Only a clean pass fires it; a
            // partial one leaves the retry list in place.
            try {
                card.dispatchEvent(new CustomEvent('meta-connect:connected', {
                    bubbles: true,
                    detail: { platform, count: ok },
                }));
            } catch (e) { console.warn('[meta-connect] connected event', e); }
            return;
        }

        card.dataset.mode = 'flow';
        const body = card.querySelector(`.${platform}-card-body`);
        body.innerHTML = `
          <div class="mc-summary">
            <div class="mc-summary-line" aria-live="polite"></div>
            <div class="mc-account-list" role="list"></div>
            <div class="mc-picker-actions">
              <button type="button" class="lp-btn lp-btn-outline mc-summary-done"></button>
            </div>
          </div>`;
        const line = fill(tr('meta_connect.partial_summary', '{X} connected. {Y} need another look.'),
            { X: ok, Y: failed.length });
        body.querySelector('.mc-summary-line').textContent = line;
        toast(line, ok ? 'warning' : 'error');
        const list = body.querySelector('.mc-account-list');
        failed.forEach((result) => {
            try {
                const item = document.createElement('div');
                item.className = 'mc-account mc-account-attention';
                item.setAttribute('role', 'listitem');
                const main = document.createElement('div');
                main.className = 'mc-account-main';
                const nm = document.createElement('div');
                nm.className = 'mc-account-name';
                nm.textContent = result.name;
                const detail = document.createElement('div');
                detail.className = 'mc-account-detail';
                detail.textContent = failureText(result);
                main.appendChild(nm);
                main.appendChild(detail);
                item.appendChild(main);
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'lp-btn lp-btn-primary mc-retry';
                retry.textContent = tr('meta_connect.retry', 'Retry');
                retry.addEventListener('click', async () => {
                    retry.disabled = true;
                    const again = await exchangeOne(platform, result.page, token);
                    forgetMetaCount();
                    const next = results.map((r) => (r === result ? again : r));
                    renderConnectSummary(card, platform, next, token);
                });
                item.appendChild(retry);
                list.appendChild(item);
            } catch (e) {
                console.warn('[meta-connect] summary row failed to render', e);
            }
        });
        const done = body.querySelector('.mc-summary-done');
        done.textContent = tr('meta_connect.done', 'Done');
        done.addEventListener('click', () => renderCardStatus(card, platform));
    }

    // Disconnect ONE account (SPEC §3.2 point 4). The other Pages keep answering.
    async function handleDisconnect(card, platform, row) {
        const isIG = platform === 'instagram';
        const isWA = platform === 'whatsapp';
        const label = accountLabel(platform, row);
        const msg = fill(tr('meta_connect.disconnect_one_confirm',
            'Disconnect {name}? It will stop answering messages there.'), { name: label });
        if (!window.confirm(msg)) return;
        const headers = await getSessionAuthHeaders();
        try {
            const r = await fetch(META_TOKEN_URL(), {
                method: 'POST', headers,
                body: JSON.stringify({
                    action: 'disconnect',
                    org_id: window.currentUserOrgId,
                    platform,
                    external_account_id: String(row.external_account_id || ''),
                }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || (j && j.error)) throw new Error((j && j.error) || `HTTP ${r.status}`);
        } catch (e) {
            console.warn('[meta-connect] disconnect failed:', e);
            toast(`${tr('meta_connect.disconnect_failed', 'Disconnect failed:')} ${tr('meta_connect.try_again', 'Please try again.')}`, 'error');
            return;
        }
        forgetMetaCount();
        let successMsg;
        if (isWA) {
            successMsg = tr('whatsapp_connect.disconnect_success', 'WhatsApp disconnected.');
        } else if (isIG) {
            successMsg = tr('instagram_connect.disconnect_success', 'Instagram disconnected.');
        } else {
            successMsg = tr('messenger_connect.disconnect_success', 'Messenger disconnected.');
        }
        toast(successMsg, 'info');
        renderCardStatus(card, platform);
    }

    function mountIfNeeded(platform) {
        const tab = document.getElementById(platform);
        if (!tab) return;
        const existing = tab.querySelector(`#${platform}-connect-card`);
        if (existing) {
            // Re-render status on tab activation: the first render can race
            // window.currentUserOrgId (page refresh) and would otherwise show
            // "Not Connected" forever. Skip while a connect flow is open so
            // we don't wipe the page picker / confirmation step.
            if (existing.dataset.mode !== 'flow') renderCardStatus(existing, platform);
            return;
        }
        const card = buildCard(platform);
        // Owner request 2026-08: the connect card is the FIRST thing on the
        // agent tab (the old header "Connect Channel" meeting link is gone),
        // so insert before the config card instead of appending at the bottom.
        tab.insertBefore(card, tab.firstElementChild);
        renderCardStatus(card, platform);
    }

    // The one supported way to put a live connect card anywhere (SPEC §9.2):
    // the agent tabs, the dashboard buttons and onboarding all use this card,
    // so page discovery, token exchange and errors exist exactly once.
    //
    // { embedded: true } lends the card to a surface that already names the
    // channel (the dashboard widget): no header, no instructions, no status
    // list, only the flow itself, starting with a line that says where the
    // customer is. The host listens for 'meta-connect:done' to close it.
    function mountMetaConnectCard(container, platform, opts) {
        if (!container || !platform) return null;
        const embedded = !!(opts && opts.embedded);
        let card = container.querySelector(`.meta-connect-card[data-platform="${platform}"]`);
        if (!card) {
            card = buildCard(platform);
            // The agent tab owns the id; a second copy elsewhere must not
            // duplicate it. Everything inside the card is found relative to it.
            card.removeAttribute('id');
            if (embedded) {
                card.className = 'meta-connect-card mc-card--embedded';
                card.style.cssText = '';
            }
            container.appendChild(card);
        }
        if (embedded) {
            card.dataset.mode = 'flow';
            const body = card.querySelector(`.${platform}-card-body`);
            if (body) {
                body.innerHTML = `<div class="mc-progress mc-waiting" aria-live="polite">${esc(tr('meta_connect.waiting_facebook', 'Finish in the Facebook window to continue.'))}</div>`;
            }
            return card;
        }
        if (card.dataset.mode !== 'flow') renderCardStatus(card, platform);
        return card;
    }
    window.mountMetaConnectCard = mountMetaConnectCard;
    window.handleConnect = handleConnect;

    function refreshWhatsAppCardStatus() {
        const tab = document.getElementById('whatsapp');
        if (!tab) return;
        const card = tab.querySelector('#whatsapp-connect-card');
        if (card) renderCardStatus(card, 'whatsapp');
    }
    window.refreshWhatsAppCardStatus = refreshWhatsAppCardStatus;

    // ============================================================
    //   DASHBOARD CONNECT BUTTONS (SPEC §9.4, §9.6)
    // ============================================================
    // Three tiles above the dashboard's quick actions, with each channel's own
    // logo. A tap opens the real connect flow at once: the same live card the
    // agent tabs use for Messenger and Instagram, Meta's own dialog for
    // WhatsApp. A clean connect lands on that channel's agent tab, where the
    // connected accounts are listed. The widget hides once all three channels
    // are connected, and whenever it cannot tell what is connected.
    const DASH_PLATFORMS = ['page', 'instagram', 'whatsapp'];
    const DASH_COPY = {
        page:      { name: 'Messenger', blurb: 'Facebook Page messages',     connect: 'Connect Messenger' },
        instagram: { name: 'Instagram', blurb: 'Instagram direct messages',  connect: 'Connect Instagram' },
        whatsapp:  { name: 'WhatsApp',  blurb: 'Your WhatsApp Business number', connect: 'Connect WhatsApp' },
    };
    const LAND_DELAY_MS = 1200;
    let dashWaStartedAt = 0;
    let dashWasActive = false;
    let dashWaitTries = 0;

    function goToTab(platform) {
        try {
            const nav = document.querySelector(`.nav-item[onclick*="'${platform}'"]`);
            if (typeof window.switchTab === 'function') window.switchTab(platform, nav || null);
        } catch (e) { console.warn('[meta-connect] switchTab', e); }
    }

    function dashboardActive() {
        const d = document.getElementById('dashboard');
        return !!(d && d.classList.contains('active'));
    }

    async function renderDashboardConnect() {
        const host = document.getElementById('dash-connect-channels');
        if (!host || host.dataset.mode === 'flow') return;
        if (!orgReady()) {
            // First load: the workspace is resolved a moment after the
            // dashboard is shown.
            if (dashWaitTries++ < 40) setTimeout(renderDashboardConnect, 500);
            return;
        }
        dashWaitTries = 0;
        const lists = await Promise.all(DASH_PLATFORMS.map((p) => fetchActiveChannelRows(p)));
        if (host.dataset.mode === 'flow') return;
        if (lists.some((l) => l === null) || lists.every((l) => l.length > 0)) {
            host.hidden = true;
            host.innerHTML = '';
            return;
        }
        ensureStyles();
        const done = lists.filter((l) => l.length > 0).length;
        const total = DASH_PLATFORMS.length;
        const progress = fill(tr('dashboard_connect.progress', '{X} of {N} connected'), { X: done, N: total });
        // One NEW badge for the whole widget, on its title.
        host.innerHTML = `
          <section class="mc-dash" aria-labelledby="mc-dash-title">
            <div class="mc-dash-head">
              <div class="mc-dash-heading">
                <h3 class="mc-dash-title" id="mc-dash-title" data-feature="dashboard-connect-buttons">${esc(tr('dashboard_connect.title', 'Connect a channel and your agent starts answering'))}</h3>
                <p class="mc-dash-progress">${esc(progress)}</p>
              </div>
              <div class="mc-dash-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="${esc(progress)}"><span style="transform:scaleX(${(done / total).toFixed(3)})"></span></div>
            </div>
            <ul class="mc-dash-list" role="list"></ul>
            <div class="mc-dash-flow"></div>
          </section>`;
        const list = host.querySelector('.mc-dash-list');
        DASH_PLATFORMS.forEach((platform, i) => {
            try { list.appendChild(buildDashItem(host, platform, lists[i])); }
            catch (e) { console.warn('[meta-connect] dashboard channel', platform, e); }
        });
        host.hidden = false;
        paintBadges();
    }

    // One channel: logo, name, where it stands, and the one thing to do next.
    function buildDashItem(host, platform, rows) {
        const copy = DASH_COPY[platform];
        const on = rows.length > 0;
        const item = document.createElement('li');
        item.className = `mc-dash-item ${on ? `mc-dash-on ${platform}-dash-on` : 'mc-dash-off'}`;
        const name = tr(`dashboard_connect.name_${platform}`, copy.name);
        // A Page name keeps its own direction inside the sentence around it
        // (an English name in an Arabic "and 1 more" must not reorder it).
        let sub;
        let subHtml;
        if (on) {
            const first = accountLabel(platform, rows[0]);
            const named = `<bdi>${esc(first)}</bdi>`;
            if (rows.length > 1) {
                const tpl = tr('dashboard_connect.and_more', '{name} and {N} more');
                sub = fill(tpl, { name: first, N: rows.length - 1 });
                subHtml = esc(tpl).replace('{name}', named).replace('{N}', String(rows.length - 1));
            } else {
                sub = first;
                subHtml = named;
            }
        } else {
            sub = tr(`dashboard_connect.blurb_${platform}`, copy.blurb);
            subHtml = esc(sub);
        }
        const state = on ? tr('dashboard_connect.state_on', 'Connected') : tr('dashboard_connect.state_off', 'Not connected');
        item.innerHTML = `${plateHtml(platform, 'mc-dash-plate')}
          <div class="mc-dash-text">
            <div class="mc-dash-name-row"><span class="mc-dash-name">${esc(name)}</span><span class="mc-dash-state">${esc(state)}</span></div>
            <span class="mc-dash-sub" title="${esc(sub)}">${subHtml}</span>
          </div>`;
        const btn = document.createElement('button');
        btn.type = 'button';
        if (on) {
            btn.className = 'mc-dash-btn mc-dash-manage';
            btn.textContent = tr('dashboard_connect.manage', 'Manage');
            btn.setAttribute('aria-label', `${tr('dashboard_connect.manage', 'Manage')} ${name}`);
            btn.addEventListener('click', () => goToTab(platform));
        } else {
            const full = tr(`dashboard_connect.connect_${platform}`, copy.connect);
            btn.className = `mc-dash-btn mc-dash-connect ${platform}-dash-connect`;
            btn.textContent = tr('dashboard_connect.connect', 'Connect');
            btn.setAttribute('aria-label', full);
            btn.addEventListener('click', () => onDashboardConnectClick(host, platform));
        }
        item.appendChild(btn);
        return item;
    }

    // One tap, no page in between (SPEC §9.4). The flow opens under the
    // channels, titled with the channel, and closes itself when it is done.
    async function onDashboardConnectClick(host, platform) {
        if (platform === 'whatsapp') {
            dashWaStartedAt = Date.now();
            if (typeof window.startWhatsAppEmbeddedSignup === 'function') window.startWhatsAppEmbeddedSignup();
            return;
        }
        const slot = host.querySelector('.mc-dash-flow');
        if (!slot) return;
        host.dataset.mode = 'flow';
        host.querySelectorAll('.mc-dash-connect').forEach((b) => { b.disabled = true; });
        const title = tr(`dashboard_connect.connect_${platform}`, DASH_COPY[platform].connect);
        slot.innerHTML = `
          <div class="mc-dash-flow-head">
            <h4 class="mc-dash-flow-title">${plateHtml(platform, 'mc-dash-plate')}<span>${esc(title)}</span></h4>
            <button type="button" class="mc-dash-close" aria-label="${esc(tr('dashboard_connect.close', 'Close'))}" title="${esc(tr('dashboard_connect.close', 'Close'))}">${CLOSE_ICON}</button>
          </div>`;
        slot.querySelector('.mc-dash-close').addEventListener('click', () => closeDashboardFlow(host));
        const card = mountMetaConnectCard(slot, platform, { embedded: true });
        if (!card) { closeDashboardFlow(host); return; }
        card.addEventListener('meta-connect:done', () => closeDashboardFlow(host), { once: true });
        card.addEventListener('meta-connect:connected', () => {
            setTimeout(() => {
                closeDashboardFlow(host);
                goToTab(platform);
            }, LAND_DELAY_MS);
        }, { once: true });
        await handleConnect(card, platform);
        // Facebook closed without a choice, or a plan is needed first (the
        // pricing screen is already open): nothing left to show here.
        if (card.isConnected && card.querySelector('.mc-waiting')) closeDashboardFlow(host);
    }

    function closeDashboardFlow(host) {
        const slot = host.querySelector('.mc-dash-flow');
        if (slot) slot.innerHTML = '';
        delete host.dataset.mode;
        renderDashboardConnect();
    }

    // A WhatsApp connect finishes in index.html, which announces it.
    document.addEventListener('meta-connect:connected', (ev) => {
        const d = ev && ev.detail;
        if (!d || d.platform !== 'whatsapp') return;
        forgetMetaCount();
        const fromDashboard = dashWaStartedAt && (Date.now() - dashWaStartedAt) < 30 * 60 * 1000;
        dashWaStartedAt = 0;
        setTimeout(() => {
            renderDashboardConnect();
            if (fromDashboard) goToTab('whatsapp');
        }, LAND_DELAY_MS);
    });
    window.renderDashboardConnect = renderDashboardConnect;

    function watchTabs() {
        let scheduled = false;
        const runOnce = () => {
            scheduled = false;
            mountIfNeeded('page');
            mountIfNeeded('instagram');
            mountIfNeeded('whatsapp');
            // Decoration: a banner that cannot draw (storage blocked) must not
            // stop the dashboard buttons below from drawing.
            try { renderScreencastBanner(); } catch (e) { console.warn('[meta-connect] screencast banner', e); }
            // Drawn each time the dashboard is opened, never on every mutation.
            const dashActive = dashboardActive();
            if (dashActive && !dashWasActive) {
                try { renderDashboardConnect(); } catch (e) { console.warn('[meta-connect] dashboard connect', e); }
            }
            dashWasActive = dashActive;
        };
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            (window.requestIdleCallback || requestAnimationFrame)(runOnce);
        };
        const attach = () => {
            // Watch the three agent tab-content nodes plus the WhatsApp
            // connect slot (which receives state-change innerHTML rewrites
            // from renderWhatsAppConnectState after Embedded Signup runs).
            // This avoids a global observer that fires on every DOM
            // mutation in the 19k-line app.
            const targets = [
                document.getElementById('page'),
                document.getElementById('instagram'),
                document.getElementById('whatsapp'),
                document.getElementById('whatsapp-agent-connect-slot'),
            ].filter(Boolean);
            if (!targets.length) return setTimeout(attach, 400);
            const obs = new MutationObserver(schedule);
            for (const t of targets) {
                obs.observe(t, { attributes: true, attributeFilter: ['class'], childList: true });
            }
            // When renderWhatsAppConnectState updates the slot (after the
            // Embedded Signup completes / state changes), refresh the
            // simple card too so the user sees the new phone label.
            const waSlotObs = new MutationObserver(refreshWhatsAppCardStatus);
            const waSlot = document.getElementById('whatsapp-agent-connect-slot');
            if (waSlot) waSlotObs.observe(waSlot, { childList: true, subtree: true });
            // Also listen for class flips on the active tab from outside
            // (switchTab toggles .active on .tab-content elements).
            const activeObs = new MutationObserver(schedule);
            document.querySelectorAll('.tab-content').forEach((el) => {
                if (el.id === 'page' || el.id === 'instagram' || el.id === 'whatsapp' || el.id === 'dashboard') {
                    activeObs.observe(el, { attributes: true, attributeFilter: ['class'] });
                }
            });
            schedule();
        };
        attach();
    }

    // ============================================================
    //   BOOT
    // ============================================================
    function boot() {
        try { setupWhatsAppModalObserver(); } catch (e) { console.warn('[meta-connect] modal observer', e); }
        let attempts = 0;
        (function tryWrap() {
            if (wrapStartWhatsApp()) return;
            if (attempts++ > 50) return;
            setTimeout(tryWrap, 200);
        })();
        try { watchTabs(); } catch (e) { console.warn('[meta-connect] tab watcher', e); }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
