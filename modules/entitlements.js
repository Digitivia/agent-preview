/* Entitlements client (bundles v2, 2026-08-18).
 *
 * One read model: get_org_entitlements(org_id) — hydrated once at org load
 * (index.html calls Entitlements.hydrate right after applyOfferTypeUI).
 * With the backend kill switch off, or for grandfathered (plan_model=legacy)
 * orgs, `enforced` is false and every feature reads as granted, so this file
 * changes nothing for existing customers until enforcement is turned on.
 *
 * Exploration stays open everywhere: tabs render and navigation is never
 * blocked. Only meaningful ACTIONS consult the gate — call
 * `Entitlements.gate('followups')` at an action entry point; it returns true
 * when allowed and otherwise opens the upgrade popup and returns false.
 * Buttons can also opt in declaratively with data-entitlement="followups"
 * (a capture-phase listener intercepts the click before inline onclick).
 * The backend enforces independently (bundle_gate_check p_feature + seat
 * caps), so this layer is UX, not security.
 */
(function () {
    'use strict';

    var FEATURE_META = {
        followups:      { labelKey: 'entitlements.f_followups',      fallback: 'Follow-ups',      plan: 'growth' },
        meetings:       { labelKey: 'entitlements.f_meetings',       fallback: 'Meeting booking', plan: 'growth' },
        orders:         { labelKey: 'entitlements.f_orders',         fallback: 'Order creation & confirmation', plan: 'growth' },
        content_studio: { labelKey: 'entitlements.f_content_studio', fallback: 'Content Studio',  plan: 'pro' },
        task_manager:   { labelKey: 'entitlements.f_task_manager',   fallback: 'Task Manager',    plan: 'pro' },
        // Every paid plan has campaigns; only the free trial does not (R4-1).
        campaigns:      { labelKey: 'entitlements.f_campaigns',      fallback: 'WhatsApp campaigns', plan: 'starter' }
    };

    // Sidebar/nav lock badges: feature -> switchTab target. Meetings has no
    // dedicated tab (booking happens inside conversations + calendar sync).
    var FEATURE_TABS = {
        followups: 'followups',
        orders: 'orders',
        content_studio: 'create-post',
        task_manager: 'task-manager',
        campaigns: 'campaigns'
    };

    var PLAN_LABELS = { starter: 'Starter', growth: 'Growth', pro: 'Pro', payg: 'Pay-As-You-Go' };

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function tr(key, fallback) {
        try {
            if (typeof window.t === 'function') {
                var v = window.t(key);
                // t() returns the key itself on miss — treat that as a miss.
                if (v && v !== key) return v;
            }
        } catch (e) { /* fall through */ }
        return fallback;
    }

    var Entitlements = {
        data: null,
        loaded: false,

        hydrate: async function (orgId) {
            if (!orgId || !window.supabaseClient) return null;
            try {
                var res = await window.supabaseClient.rpc('get_org_entitlements', { p_org_id: orgId });
                if (!res.error && res.data && !res.data.error) {
                    this.data = res.data;
                    this.loaded = true;
                    this.applyUI();
                    // The grace banner reads service_state from here (SPEC §6.8).
                    try {
                        if (typeof window.refreshUsageBanner === 'function') window.refreshUsageBanner();
                    } catch (e) { /* a banner is decoration */ }
                    // The model picker marks what this plan does not include.
                    if (window.DigitiviaModelPicker && typeof window.DigitiviaModelPicker.setPlanRank === 'function'
                        && typeof res.data.plan_rank === 'number') {
                        window.DigitiviaModelPicker.setPlanRank(res.data.plan_rank);
                    }
                }
            } catch (e) {
                console.warn('Entitlements hydrate failed (fail-open):', e);
            }
            return this.data;
        },

        enforced: function () {
            return !!(this.loaded && this.data && this.data.enforced === true);
        },

        has: function (feature) {
            // Fail OPEN on the frontend: if we could not load entitlements,
            // never block a click — the backend gate is authoritative.
            if (!this.enforced()) return true;
            var f = (this.data && this.data.features) || {};
            return f[feature] === true;
        },

        planSlug: function () {
            return (this.data && this.data.plan_slug) || '';
        },

        seatInfo: function () {
            if (!this.data) return null;
            return { limit: this.data.users_limit, used: this.data.members_used };
        },

        /** Gate an action. Returns true when allowed; otherwise opens the
         *  upgrade popup and returns false. */
        gate: function (feature) {
            if (this.has(feature)) return true;
            this.openUpgradeModal(feature);
            return false;
        },

        applyUI: function () {
            var self = this;
            Object.keys(FEATURE_TABS).forEach(function (feature) {
                var tab = FEATURE_TABS[feature];
                var locked = !self.has(feature);
                var nodes = document.querySelectorAll(
                    '[onclick*="switchTab(\'' + tab + '\')"], [data-tab="' + tab + '"]');
                nodes.forEach(function (el) {
                    var badge = el.querySelector('.spl-lock');
                    if (locked && !badge) {
                        badge = document.createElement('span');
                        badge.className = 'spl-lock';
                        badge.setAttribute('aria-label', 'Premium feature');
                        badge.textContent = '✦'; // ✦ premium mark
                        el.appendChild(badge);
                    } else if (!locked && badge) {
                        badge.remove();
                    }
                });
            });
        },

        /** The Upgrade Moment. `override` ({ title, body, ctaLabel,
         *  dismissLabel }, all plain text) replaces the feature copy for callers
         *  that are not a feature: a locked model, a trial milestone. Callers
         *  that pass only a feature get exactly what they always got. */
        openUpgradeModal: function (feature, override) {
            var meta = FEATURE_META[feature] || { fallback: feature, plan: 'growth', labelKey: '' };
            var featureName = tr(meta.labelKey, meta.fallback);
            var planName = PLAN_LABELS[meta.plan] || meta.plan;
            var current = this.planSlug();
            // The plan the customer is on, in words: never the raw slug, which
            // read as "Free_trial" once the free trial had locked features.
            var currentLabel = current === 'free_trial'
                ? tr('entitlements.plan_free_trial', 'Free trial')
                : (PLAN_LABELS[current] || current);

            var old = document.getElementById('spl-upgrade');
            if (old) old.remove();

            var o = (override && typeof override === 'object') ? override : null;
            var titleHtml = o
                ? escapeHtml(o.title || '')
                : tr('entitlements.upgrade_title', 'Unlock ' + featureName);
            var bodyHtml = o
                ? escapeHtml(o.body || '')
                : tr('entitlements.upgrade_body_1', 'This feature is part of the') + ' ' +
                    '<strong>' + planName + '</strong> ' +
                    tr('entitlements.upgrade_body_2', 'bundle.') + ' ' +
                    (current ? (tr('entitlements.upgrade_current', 'Your current plan:') + ' <strong class="spl-upgrade-current">' + currentLabel + '</strong>.') : '');
            var ctaHtml = o && o.ctaLabel ? escapeHtml(o.ctaLabel) : tr('entitlements.upgrade_cta', 'See plans');
            var laterHtml = o && o.dismissLabel ? escapeHtml(o.dismissLabel) : tr('entitlements.upgrade_later', 'Maybe later');

            var wrap = document.createElement('div');
            wrap.id = 'spl-upgrade';
            wrap.className = 'spl-upgrade-overlay';
            wrap.innerHTML =
                '<div class="spl-upgrade-card" role="dialog" aria-modal="true">' +
                    '<div class="spl-upgrade-mark">✦</div>' +
                    '<h3 class="spl-upgrade-title">' + titleHtml + '</h3>' +
                    '<p class="spl-upgrade-body">' + bodyHtml + '</p>' +
                    '<div class="spl-upgrade-actions">' +
                        '<button type="button" class="spl-btn spl-btn-primary" id="spl-upgrade-cta">' +
                            ctaHtml + '</button>' +
                        '<button type="button" class="spl-btn spl-btn-ghost" id="spl-upgrade-close">' +
                            laterHtml + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(wrap);

            function close() { wrap.remove(); }
            wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
            wrap.querySelector('#spl-upgrade-close').addEventListener('click', close);
            wrap.querySelector('#spl-upgrade-cta').addEventListener('click', function () {
                close();
                if (typeof window.openPricingModal === 'function') window.openPricingModal();
            });
        }
    };

    // Declarative gating: any element carrying data-entitlement="<feature>"
    // is intercepted before its own handlers when the feature is locked.
    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-entitlement]') : null;
        if (!el) return;
        var feature = el.getAttribute('data-entitlement');
        if (!feature || Entitlements.has(feature)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        Entitlements.openUpgradeModal(feature);
    }, true);

    window.Entitlements = Entitlements;
    window.entitlementGate = function (feature) { return Entitlements.gate(feature); };
})();
