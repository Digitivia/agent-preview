/* Partners console (internal). Digitivia staff only.
 *
 * Loaded as a plain script after every inline block in index.html, so it can
 * see globals but nothing in index.html can see into it except through
 * window.PartnersAdmin. That is deliberate: this file is the only place that
 * knows the partner admin API, and the 2026-09-07 outage was caused by an
 * inline block calling a helper that lived in a later block.
 *
 * Visibility is decided in index.html by is_platform_staff(); this module
 * assumes it is only ever initialised for staff, and the database refuses every
 * call it makes if that assumption is ever wrong. The UI is not the boundary.
 */
(function () {
    'use strict';

    var state = { list: [], openId: null, detail: null, loading: false, filter: '' };

    function t(key, fallback) {
        try {
            if (typeof window.t === 'function') {
                var v = window.t('partners.' + key);
                if (v && v !== 'partners.' + key) return v;
            }
        } catch (e) { /* fall through to the English fallback */ }
        return fallback;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Amounts arrive as integer minor units and are never turned into floats
    // for arithmetic - only for display, once, here.
    function money(cents, currency) {
        if (cents == null) return '—';
        var v = (Number(cents) / 100);
        try {
            return new Intl.NumberFormat((window.currentLang === 'ar') ? 'ar-EG' : 'en-US',
                { style: 'currency', currency: currency || 'EGP', maximumFractionDigits: 2 }).format(v);
        } catch (e) {
            return v.toFixed(2) + ' ' + (currency || '');
        }
    }

    function when(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleDateString(); } catch (e) { return String(iso).slice(0, 10); }
    }

    var STATUS_TONE = {
        active: '#10b981', onboarding: '#f59e0b', prospect: '#64748b',
        suspended: '#ef4444', terminated: '#94a3b8',
        pending_setup: '#f59e0b', churned: '#94a3b8',
        open: '#3b82f6', triaging: '#8b5cf6', in_progress: '#3b82f6',
        waiting_partner: '#f59e0b', resolved: '#10b981', closed: '#94a3b8'
    };

    function chip(text, tone) {
        var c = tone || STATUS_TONE[text] || '#64748b';
        return '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:0.7rem;' +
            'font-weight:600;background:' + c + '22;color:' + c + ';border:1px solid ' + c + '55;">' +
            esc(String(text || '').replace(/_/g, ' ')) + '</span>';
    }

    function rpc(fn, args) {
        if (!window.supabaseClient) return Promise.reject(new Error('no client'));
        return window.supabaseClient.rpc(fn, args || {}).then(function (r) {
            if (r.error) throw r.error;
            return r.data;
        });
    }

    function toast(msg, bad) {
        if (typeof window.showToast === 'function') { window.showToast(msg, bad ? 'error' : 'success'); return; }
        if (typeof window.showNotification === 'function') { window.showNotification(msg, bad ? 'error' : 'success'); return; }
        console[bad ? 'error' : 'log']('[partners] ' + msg);
    }

    function root() { return document.getElementById('partners-page-root'); }

    // ---------------------------------------------------------------- list --
    function renderList() {
        var el = root();
        if (!el) return;
        var rows = state.list.filter(function (p) {
            if (!state.filter) return true;
            var q = state.filter.toLowerCase();
            return (p.display_name || '').toLowerCase().indexOf(q) >= 0 ||
                   (p.legal_name || '').toLowerCase().indexOf(q) >= 0 ||
                   (p.slug || '').toLowerCase().indexOf(q) >= 0;
        });

        var totals = state.list.reduce(function (a, p) {
            a.partners += 1;
            a.active += (p.status === 'active' ? 1 : 0);
            a.customers += Number(p.customers_active || 0);
            a.due += Number(p.commission_accrued_cents || 0);
            a.requests += Number(p.open_requests || 0);
            return a;
        }, { partners: 0, active: 0, customers: 0, due: 0, requests: 0 });

        el.innerHTML =
        '<div class="card glass">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:1rem;">' +
            '<div>' +
              '<h2 style="margin:0;font-size:1.2rem;">' + esc(t('title', 'Partners')) + '</h2>' +
              '<p style="margin:4px 0 0;font-size:0.82rem;color:var(--text-secondary);">' +
                esc(t('subtitle', 'Agencies and companies selling Digitivia to their own customers.')) + '</p>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<input id="pa-search" type="search" placeholder="' + esc(t('search', 'Search partners')) + '" ' +
                'value="' + esc(state.filter) + '" ' +
                'style="padding:8px 12px;border-radius:8px;border:1px solid var(--border-color,rgba(255,255,255,.12));' +
                'background:rgba(255,255,255,.04);color:var(--text-primary);min-width:180px;">' +
              '<button class="pill-btn primary" id="pa-new">' + esc(t('new_partner', '+ New partner')) + '</button>' +
            '</div>' +
          '</div>' +
          '<div data-feature-notice="partners"></div>' +
          statCards(totals) +
          (rows.length ? table(rows) : empty()) +
        '</div>';

        var s = document.getElementById('pa-search');
        if (s) s.addEventListener('input', function (e) { state.filter = e.target.value; renderList(); });
        var n = document.getElementById('pa-new');
        if (n) n.addEventListener('click', openNewPartner);
        el.querySelectorAll('[data-partner-id]').forEach(function (tr) {
            tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-partner-id')); });
        });
        repaintBadges();
    }

    function statCards(x) {
        function card(label, value, tone) {
            return '<div style="flex:1 1 140px;min-width:140px;padding:12px 14px;border-radius:12px;' +
                'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">' +
                '<div style="font-size:0.7rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;">' +
                esc(label) + '</div>' +
                '<div style="font-size:1.35rem;font-weight:700;margin-top:4px;color:' + (tone || 'var(--text-primary)') + ';">' +
                value + '</div></div>';
        }
        return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:1rem;">' +
            card(t('kpi_partners', 'Partners'), x.partners) +
            card(t('kpi_active', 'Active'), x.active, '#10b981') +
            card(t('kpi_customers', 'Customers live'), x.customers) +
            card(t('kpi_due', 'Commission due'), money(x.due, 'EGP'), '#f59e0b') +
            card(t('kpi_requests', 'Open requests'), x.requests, x.requests ? '#ef4444' : null) +
            '</div>';
    }

    function empty() {
        return '<div style="padding:2.4rem 1rem;text-align:center;color:var(--text-secondary);">' +
            '<p style="margin:0 0 6px;font-size:0.95rem;">' + esc(t('empty_title', 'No partners yet.')) + '</p>' +
            '<p style="margin:0;font-size:0.82rem;">' +
            esc(t('empty_body', 'Create the first one, and they will be invited to sign and set up their portal.')) +
            '</p></div>';
    }

    function table(rows) {
        var head = ['partner', 'status', 'customers', 'commission_due', 'commission_paid', 'requests'];
        var labels = {
            partner: t('col_partner', 'Partner'), status: t('col_status', 'Status'),
            customers: t('col_customers', 'Customers'), commission_due: t('col_due', 'Due'),
            commission_paid: t('col_paid', 'Paid'), requests: t('col_requests', 'Requests')
        };
        var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:640px;">' +
            '<thead><tr>' + head.map(function (h) {
                return '<th style="text-align:start;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;' +
                    'letter-spacing:.04em;color:var(--text-secondary);border-bottom:1px solid rgba(255,255,255,.08);">' +
                    esc(labels[h]) + '</th>';
            }).join('') + '</tr></thead><tbody>';

        rows.forEach(function (p) {
            html += '<tr data-partner-id="' + esc(p.id) + '" style="cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);">' +
                '<td style="padding:10px;"><div style="font-weight:600;">' + esc(p.display_name) + '</div>' +
                  '<div style="font-size:0.72rem;color:var(--text-secondary);">' + esc(p.slug) + '</div></td>' +
                '<td style="padding:10px;">' + chip(p.status) + '</td>' +
                '<td style="padding:10px;">' + esc(p.customers_active) + ' / ' + esc(p.customers_total) + '</td>' +
                '<td style="padding:10px;">' + money(p.commission_accrued_cents, 'EGP') + '</td>' +
                '<td style="padding:10px;color:var(--text-secondary);">' + money(p.commission_paid_cents, 'EGP') + '</td>' +
                '<td style="padding:10px;">' + (Number(p.open_requests) ? chip(p.open_requests + ' open', '#ef4444') : '—') + '</td>' +
                '</tr>';
        });
        return html + '</tbody></table></div>';
    }

    // -------------------------------------------------------------- detail --
    function openDetail(id) {
        state.openId = id;
        var el = root();
        if (el) el.innerHTML = '<div class="card glass" style="padding:2rem;text-align:center;color:var(--text-secondary);">' +
            esc(t('loading', 'Loading…')) + '</div>';
        rpc('admin_partner_detail', { p_partner_id: id })
            .then(function (d) { state.detail = d; renderDetail(); })
            .catch(function (e) { toast(e.message || String(e), true); state.openId = null; renderList(); });
    }

    function section(title, body, action) {
        return '<div style="margin-top:1.1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.08);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:.6rem;">' +
            '<h3 style="margin:0;font-size:0.95rem;">' + esc(title) + '</h3>' + (action || '') + '</div>' + body + '</div>';
    }

    function renderDetail() {
        var el = root(); var d = state.detail;
        if (!el || !d || !d.partner) return;
        var p = d.partner;
        var ag = (d.agreements || []).filter(function (a) { return a.status === 'accepted'; })[0] ||
                 (d.agreements || [])[0];

        el.innerHTML =
        '<div class="card glass">' +
          '<button class="pill-btn" id="pa-back" style="margin-bottom:1rem;">← ' + esc(t('back', 'All partners')) + '</button>' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">' +
            '<div><h2 style="margin:0;font-size:1.25rem;">' + esc(p.display_name) + ' ' + chip(p.status) + '</h2>' +
              '<p style="margin:4px 0 0;font-size:0.82rem;color:var(--text-secondary);">' +
                esc(p.legal_name) + ' · ' + esc(p.slug) + '</p></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="pill-btn" id="pa-status">' + esc(t('change_status', 'Change status')) + '</button>' +
              '<button class="pill-btn" id="pa-payout">' + esc(t('create_payout', 'Create payout')) + '</button>' +
            '</div>' +
          '</div>' +

          section(t('sec_commercial', 'Commercial model'), commercialBody(ag, p)) +
          section(t('sec_customers', 'Customers'), customersBody(d.customers || [])) +
          section(t('sec_commission', 'Commission'), commissionBody(d.commission_summary || {})) +
          section(t('sec_branding', 'Branding & domains'), brandingBody(d.branding, d.domains || [])) +
          section(t('sec_documents', 'Documents'), documentsBody(d.documents || [])) +
          section(t('sec_contacts', 'Contacts'), contactsBody(d.contacts || [])) +
        '</div>';

        document.getElementById('pa-back').addEventListener('click', function () {
            state.openId = null; state.detail = null; load();
        });
        document.getElementById('pa-status').addEventListener('click', changeStatus);
        document.getElementById('pa-payout').addEventListener('click', createPayout);
        el.querySelectorAll('[data-activate-org]').forEach(function (b) {
            b.addEventListener('click', function () { activateCustomer(b.getAttribute('data-activate-org')); });
        });
        el.querySelectorAll('[data-pay-org]').forEach(function (b) {
            b.addEventListener('click', function () { recordPayment(b.getAttribute('data-pay-org')); });
        });
        repaintBadges();
    }

    function kv(label, value) {
        return '<div style="display:flex;gap:8px;padding:4px 0;font-size:0.85rem;">' +
            '<span style="color:var(--text-secondary);min-width:150px;">' + esc(label) + '</span>' +
            '<span>' + (value == null ? '—' : value) + '</span></div>';
    }

    function commercialBody(ag, p) {
        if (!ag) return '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">' +
            esc(t('no_agreement', 'No agreement yet. The partner cannot create customers until one is accepted.')) + '</p>';
        // effective_rate_pct is the number actually in force - the override when
        // there is one, otherwise the plan's. Resolved server-side so this
        // screen and any other reader cannot disagree about what a partner earns.
        var rate = ag.effective_rate_pct != null ? ag.effective_rate_pct : ag.rate_pct_override;
        var rateText = rate != null
            ? esc(rate) + '%' + (ag.rate_is_override ? ' <span style="font-size:0.72rem;color:var(--text-secondary);">(' +
                esc(t('f_rate_override', 'agreed for this partner')) + ')</span>' : '')
            : esc(t('f_rate_unset', 'not set'));
        return kv(t('f_agreement', 'Agreement'), chip(ag.status)) +
            kv(t('f_plan', 'Commercial model'), esc(ag.commission_plan_name || '—')) +
            kv(t('f_accepted', 'Accepted'), esc(when(ag.accepted_at))) +
            kv(t('f_signed_by', 'Signed name'), esc((ag.acceptance && ag.acceptance.typed_name) || '—')) +
            kv(t('f_rate', 'Commission rate'), rateText) +
            kv(t('f_support', 'Support owned by'), esc(ag.effective_support_owner || ag.support_owner_override || p.support_owner)) +
            kv(t('f_plans', 'Plans they may sell'), ag.allowed_plan_slugs ? esc(ag.allowed_plan_slugs.join(', ')) : esc(t('f_plans_all', 'all partner plans'))) +
            kv(t('f_hash', 'Text fingerprint'), ag.body_sha256 ? '<code style="font-size:0.72rem;">' + esc(ag.body_sha256.slice(0, 16)) + '…</code>' : '—');
    }

    function customersBody(list) {
        if (!list.length) return '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">' +
            esc(t('no_customers', 'No customers yet.')) + '</p>';
        var h = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:560px;"><tbody>';
        list.forEach(function (c) {
            h += '<tr style="border-bottom:1px solid rgba(255,255,255,.05);">' +
                '<td style="padding:8px 10px;font-weight:600;">' + esc(c.name) + '</td>' +
                '<td style="padding:8px 10px;">' + chip(c.status) + '</td>' +
                '<td style="padding:8px 10px;font-size:0.8rem;color:var(--text-secondary);">' + esc(c.plan_slug || '—') + '</td>' +
                '<td style="padding:8px 10px;font-size:0.8rem;">' + esc(c.subscription_status || '—') + '</td>' +
                '<td style="padding:8px 10px;text-align:end;white-space:nowrap;">' +
                  (c.status === 'pending_setup'
                    ? '<button class="pill-btn primary" data-activate-org="' + esc(c.org_id) + '" style="font-size:0.72rem;padding:4px 10px;">' +
                        esc(t('activate', 'Activate')) + '</button> '
                    : '') +
                  '<button class="pill-btn" data-pay-org="' + esc(c.org_id) + '" style="font-size:0.72rem;padding:4px 10px;">' +
                    esc(t('record_payment', 'Record payment')) + '</button>' +
                '</td></tr>';
        });
        return h + '</tbody></table></div>';
    }

    function commissionBody(s) {
        return '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            ['accrued_cents', 'approved_cents', 'paid_cents'].map(function (k) {
                var label = { accrued_cents: t('c_accrued', 'Accrued'), approved_cents: t('c_approved', 'Approved'), paid_cents: t('c_paid', 'Paid') }[k];
                return '<div style="flex:1 1 130px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);' +
                    'border:1px solid rgba(255,255,255,.08);"><div style="font-size:0.7rem;color:var(--text-secondary);">' +
                    esc(label) + '</div><div style="font-size:1.1rem;font-weight:700;">' + money(s[k] || 0, 'EGP') + '</div></div>';
            }).join('') + '</div>';
    }

    function brandingBody(b, domains) {
        var out = kv(t('b_name', 'Shown as'), b && b.display_name ? esc(b.display_name) : '—') +
            kv(t('b_colour', 'Primary colour'), b && b.primary_color
                ? '<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;background:' +
                  esc(b.primary_color) + ';"></span> <code style="font-size:0.75rem;">' + esc(b.primary_color) + '</code>' : '—') +
            kv(t('b_powered', 'Attribution line'), b ? esc(b.powered_by) : '—');
        if (!domains.length) {
            out += kv(t('b_domains', 'Domains'), esc(t('b_no_domains', 'none — they use the shared link')));
        } else {
            out += kv(t('b_domains', 'Domains'), domains.map(function (d) {
                return '<div>' + esc(d.hostname) + ' ' + chip(d.status) + '</div>';
            }).join(''));
        }
        return out;
    }

    function documentsBody(list) {
        if (!list.length) return '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">' +
            esc(t('no_documents', 'No documents attached.')) + '</p>';
        return list.map(function (d) {
            return '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:0.85rem;' +
                'border-bottom:1px solid rgba(255,255,255,.05);"><span>' + esc(d.file_name) + ' ' + chip(d.kind) + '</span>' +
                '<span style="color:var(--text-secondary);">' + esc(when(d.created_at)) + '</span></div>';
        }).join('');
    }

    function contactsBody(list) {
        if (!list.length) return '<p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">' +
            esc(t('no_contacts', 'No contacts recorded.')) + '</p>';
        return list.map(function (c) {
            return kv(esc(c.full_name) + (c.is_primary ? ' ★' : ''),
                esc([c.title, c.email, c.phone].filter(Boolean).join(' · ')));
        }).join('');
    }

    // ------------------------------------------------------------- actions --
    // Native prompts on purpose: this is an internal console used by a handful
    // of people, and a bespoke modal stack here would be effort spent where no
    // customer ever looks. Every one of these calls is authorised server-side.
    function openNewPartner() {
        var slug = window.prompt(t('ask_slug', 'URL handle (lowercase letters, digits and dashes):'));
        if (!slug) return;
        var legal = window.prompt(t('ask_legal', 'Registered company name:'));
        if (!legal) return;
        var display = window.prompt(t('ask_display', 'Name to show their customers:'), legal) || legal;
        var model = window.prompt(t('ask_model', 'Commercial model — type partner_supported or digitivia_supported:'), 'partner_supported');
        if (!model) return;
        var email = window.prompt(t('ask_email', "Their owner's email (invited to the partner portal). Leave blank to skip:")) || '';

        rpc('admin_create_partner', { p: {
            slug: String(slug).trim().toLowerCase(), legal_name: legal, display_name: display,
            commission_plan_code: String(model).trim(), owner_email: email.trim()
        }}).then(function (res) {
            if (!res || res.success !== true) { toast(t('err_prefix', 'Could not create partner: ') + (res && res.error), true); return; }
            toast(t('ok_created', 'Partner created and the owner invited.'));
            load();
        }).catch(function (e) { toast(e.message || String(e), true); });
    }

    function changeStatus() {
        var next = window.prompt(t('ask_status', 'New status — prospect, onboarding, active, suspended or terminated:'),
            state.detail.partner.status);
        if (!next) return;
        rpc('admin_update_partner', { p_partner_id: state.openId, p: { status: String(next).trim() } })
            .then(function () { toast(t('ok_saved', 'Saved.')); openDetail(state.openId); })
            .catch(function (e) { toast(e.message || String(e), true); });
    }

    function activateCustomer(orgId) {
        var days = window.prompt(t('ask_days', 'Activate for how many days?'), '30');
        if (!days) return;
        rpc('admin_activate_partner_customer', { p_org_id: orgId, p_duration_days: parseInt(days, 10) || 30 })
            .then(function (res) {
                if (!res || res.success !== true) { toast(t('err_prefix', 'Failed: ') + (res && res.error), true); return; }
                toast(t('ok_activated', 'Customer activated. Their agents can answer now.'));
                openDetail(state.openId);
            }).catch(function (e) { toast(e.message || String(e), true); });
    }

    function recordPayment(orgId) {
        var amount = window.prompt(t('ask_amount', 'Amount received, in whole currency units (e.g. 2500):'));
        if (!amount) return;
        var currency = window.prompt(t('ask_currency', 'Currency code:'), 'EGP') || 'EGP';
        var ref = window.prompt(t('ask_ref', 'Reference (bank reference, invoice number). Leave blank if none:')) || '';
        var cents = Math.round(parseFloat(amount) * 100);
        if (!isFinite(cents) || cents < 0) { toast(t('err_amount', 'That is not an amount.'), true); return; }

        rpc('admin_record_org_payment', { p: {
            org_id: orgId, amount_cents: cents, currency: String(currency).trim().toUpperCase(),
            source: 'manual', external_ref: ref.trim()
        }}).then(function (res) {
            if (!res || res.success !== true) { toast(t('err_prefix', 'Failed: ') + (res && res.error), true); return; }
            var c = res.commission || {};
            toast(t('ok_payment', 'Payment recorded. Commission booked: ') + money(c.cents || 0, currency));
            openDetail(state.openId);
        }).catch(function (e) { toast(e.message || String(e), true); });
    }

    function createPayout() {
        // Approve everything still accrued, then batch it. Two steps in the
        // database, one decision here.
        rpc('admin_partner_detail', { p_partner_id: state.openId }).then(function (d) {
            var period = window.prompt(t('ask_period', 'Payout period label (e.g. 2026-09):'),
                new Date().toISOString().slice(0, 7));
            if (!period) return null;
            var rail = window.prompt(t('ask_rail', 'Paid via — wise, payoneer, bank, stripe or other:'), 'wise') || 'other';
            var ref = window.prompt(t('ask_payout_ref', 'Transfer reference:')) || '';
            return window.supabaseClient
                .from('partner_commission_events')
                .select('id')
                .eq('partner_id', state.openId)
                .eq('status', 'accrued')
                .then(function (r) {
                    var ids = (r.data || []).map(function (x) { return x.id; });
                    if (!ids.length) return null;
                    return rpc('admin_approve_commissions', { p_event_ids: ids });
                })
                .then(function () {
                    return rpc('admin_create_payout', {
                        p_partner_id: state.openId, p_period_label: period,
                        p_rail: String(rail).trim(), p_reference: ref.trim()
                    });
                });
        }).then(function (res) {
            if (!res) return;
            if (res.success !== true) { toast(t('err_prefix', 'Failed: ') + res.error, true); return; }
            toast(t('ok_payout', 'Payout recorded: ') + money(res.total_cents, res.currency));
            openDetail(state.openId);
        }).catch(function (e) { toast(e.message || String(e), true); });
    }

    // A badge that fails to draw must never take the console down with it.
    function repaintBadges() {
        try { if (typeof window.paintFeatureBadges === 'function') window.paintFeatureBadges(); }
        catch (e) { console.error('paintFeatureBadges failed', e); }
    }

    function load() {
        if (state.loading) return;
        state.loading = true;
        var el = root();
        if (el && !state.list.length) {
            el.innerHTML = '<div class="card glass" style="padding:2rem;text-align:center;color:var(--text-secondary);">' +
                esc(t('loading', 'Loading…')) + '</div>';
        }
        rpc('admin_list_partners', { p_status: null })
            .then(function (rows) { state.list = rows || []; state.loading = false; renderList(); })
            .catch(function (e) {
                state.loading = false;
                if (el) el.innerHTML = '<div class="card glass" style="padding:2rem;color:var(--text-secondary);">' +
                    esc(t('load_failed', 'Could not load partners: ')) + esc(e.message || String(e)) + '</div>';
            });
    }

    window.PartnersAdmin = {
        init: function () {
            if (state.openId) { openDetail(state.openId); return; }
            load();
        },
        reload: load
    };
})();
