/* Digitivia - the free trial, as the dashboard shows it (SPEC §8.5a, §8.7a).
 *
 * ONE READ, EVERY SURFACE. The AI Usage tab, the sidebar meter, the dashboard
 * plan widget and the global banner all draw the trial from get_trial_status(),
 * through this file, so they can never show different numbers. While the trial
 * runs they show two things: "X of 100 messages" and "N days left". Once it
 * has stopped, for any reason, they all say the same sentence with the true
 * count. Never a coin, a conversation count or a dollar figure: the trial is
 * measured in messages (customer messages plus AI replies, R2-1) and nothing
 * else.
 *
 * Paying orgs never reach this file's drawing code: every caller asks
 * isTrialCandidate() first, which is true only for the free trial (or for an
 * org with no plan at all, which is how a finished trial looks to
 * get_coin_status). Everything here is wrapped so a failure draws nothing
 * rather than breaking the page it sits on.
 */
(function () {
    'use strict';

    var TTL_MS = 30000;
    var cache = { orgId: null, at: 0, data: null, promise: null };

    function lang() {
        return (typeof currentLang !== 'undefined' && currentLang === 'ar') ? 'ar' : 'en';
    }

    var TEXT = {
        en: {
            title: 'Free trial',
            messages: '{used} of {limit} messages',
            daysLeft: '{n} days left',
            dayLeft: '1 day left',
            lastDay: 'Last day',
            countsNote: 'Messages from your customers and replies from your AI agent both count.',
            stopped: 'Your free trial is complete. You used {n} messages.',
            stoppedHint: 'Choose a plan and your agent starts replying again right away. Everything you set up is saved.',
            seePlans: 'See plans',
            quiet: 'Paid plans also unlock the strongest AI models.',
            reused: 'One of your connected channels already used its free trial before. Connecting it worked and everything is saved. New messages on it will not be free until you pick a plan.',
            reusedMany: 'Some of your connected channels already used a free trial in another workspace. They are connected and saved, but their new messages are not free until you pick a plan.',
            bannerRunning: 'Free trial: {used} of {limit} messages used, {days}. Choose a plan so your agent keeps replying.',
            bannerStopped: 'Your free trial is complete. You used {n} messages. Choose a plan and your agent starts replying again.',
            nudgeTenTitle: 'Your agent just sent its 10th reply',
            nudgeTenBody: 'It is doing this on {model}, a fast trial model. A paid plan unlocks a strong model for even better replies.',
            nudgeEightyTitle: 'You are close to your {limit} free messages',
            nudgeEightyBody: 'You have seen {model} handle your customers well. A paid plan keeps your agent replying with no limit, and unlocks a stronger model too.',
            notNow: 'Not now'
        },
        ar: {
            title: 'التجربة المجانية',
            messages: '{used} من {limit} رسالة',
            daysLeft: 'باقي {n} يوم',
            dayLeft: 'باقي يوم واحد',
            lastDay: 'آخر يوم',
            countsNote: 'رسايل عملائك وردود المساعد الذكي الاتنين بيتحسبوا.',
            stopped: 'تجربتك المجانية خلصت. استخدمت {n} رسالة.',
            stoppedHint: 'اختار خطة والمساعد هيرجع يرد على طول. كل حاجة عملتها محفوظة.',
            seePlans: 'شوف الخطط',
            quiet: 'الخطط المدفوعة كمان بتفتحلك أقوى موديلات الذكاء الاصطناعي.',
            reused: 'فيه قناة عندك استخدمت الفترة المجانية بتاعتها قبل كده. التوصيل تم وكل حاجة محفوظة. الرسايل الجديدة عليها مش هتكون مجانية غير لما تختار باقة.',
            reusedMany: 'فيه قنوات عندك استخدمت الفترة المجانية قبل كده في مساحة عمل تانية. التوصيل تم وكل حاجة محفوظة، بس رسايلها الجديدة مش هتكون مجانية غير لما تختار باقة.',
            bannerRunning: 'التجربة المجانية: استخدمت {used} من {limit} رسالة، {days}. اختار خطة عشان المساعد يفضل يرد.',
            bannerStopped: 'تجربتك المجانية خلصت. استخدمت {n} رسالة. اختار خطة والمساعد هيرجع يرد.',
            nudgeTenTitle: 'مساعدك دلوقتي بعت رده العاشر',
            nudgeTenBody: 'وده بموديل {model}، موديل سريع في التجربة. الخطة المدفوعة بتفتحلك موديل قوي عشان ردود أحسن.',
            nudgeEightyTitle: 'قربت تخلص الـ {limit} رسالة المجانية',
            nudgeEightyBody: 'شفت {model} بيتعامل مع عملائك كويس. الخطة المدفوعة بتخلي مساعدك يفضل يرد من غير حد، وبتفتحلك موديل أقوى كمان.',
            notNow: 'مش دلوقتي'
        }
    };

    function tx(key, vars) {
        var s = (TEXT[lang()] && TEXT[lang()][key]) || TEXT.en[key] || key;
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                s = s.split('{' + k + '}').join(String(vars[k]));
            });
        }
        return s;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Western digits in both languages, like the rest of the dashboard and the
    // trial emails, so "42" reads the same on every surface.
    function num(n) {
        var v = Math.max(0, Math.round(Number(n) || 0));
        try { return v.toLocaleString('en-US'); } catch (e) { return String(v); }
    }

    function daysText(d) {
        var n = Number(d && d.days_left);
        if (!isFinite(n) || n <= 0) return tx('lastDay');
        if (n === 1) return tx('dayLeft');
        return tx('daysLeft', { n: num(n) });
    }

    // get_coin_status reports the trial as plan_slug 'free_trial' while it
    // runs, and a finished trial as no plan at all. Anything else is a paying
    // org and never costs an extra round trip.
    function isTrialCandidate(coinStatus) {
        var slug = String((coinStatus && coinStatus.plan_slug) || '').toLowerCase();
        return slug === 'free_trial' || slug === '';
    }

    function orgId() {
        try { return (typeof currentUserOrgId !== 'undefined' && currentUserOrgId) || window.currentUserOrgId || null; }
        catch (e) { return null; }
    }

    function load(opts) {
        var id = orgId();
        var force = !!(opts && opts.force);
        if (!id || !window.supabaseClient) return Promise.resolve(null);
        if (!force && cache.orgId === id && cache.data && (Date.now() - cache.at) < TTL_MS) {
            return Promise.resolve(cache.data);
        }
        if (!force && cache.orgId === id && cache.promise) return cache.promise;
        cache.orgId = id;
        cache.promise = window.supabaseClient.rpc('get_trial_status', { p_org_id: id })
            .then(function (res) {
                var d = (res && !res.error && res.data && !res.data.error) ? res.data : null;
                if (cache.orgId === id) { cache.data = d; cache.at = Date.now(); cache.promise = null; }
                return d;
            })
            .catch(function () { cache.promise = null; return null; });
        return cache.promise;
    }

    function peek() {
        return cache.orgId === orgId() ? cache.data : null;
    }

    function invalidate() { cache.at = 0; cache.data = null; cache.promise = null; }

    // A trial the dashboard should draw: the org is on the free trial and the
    // trial plan is switched on.
    function shows(d) { return !!(d && d.is_trial && d.enabled); }

    function openPlans() {
        if (typeof window.openPricingModal === 'function') window.openPricingModal();
    }

    function reusedLine(d) {
        var n = Number(d && d.reused_channels) || 0;
        if (n <= 0) return '';
        return '<p class="dgt-note dgt-note--warn">' + esc(n === 1 ? tx('reused') : tx('reusedMany')) + '</p>';
    }

    /* The AI Usage tab and the dashboard widget: one card, two states. */
    function cardHtml(d, opts) {
        if (!shows(d)) return '';
        var compact = !!(opts && opts.compact);
        var used = Number(d.messages_used) || 0;
        var limit = Number(d.messages_limit) || 100;
        var pct = Math.max(0, Math.min(100, Math.round(used / limit * 100)));
        var html = '<section class="dgt-card' + (compact ? ' dgt-card--compact' : '') + '" dir="' +
            (lang() === 'ar' ? 'rtl' : 'ltr') + '">';
        html += '<div data-feature-notice="free-trial-live"></div>';
        html += '<div class="dgt-head"><span class="dgt-title" data-feature="trial-messages-meter">' + esc(tx('title')) + '</span>';
        if (!d.stopped) html += '<span class="dgt-days">' + esc(daysText(d)) + '</span>';
        html += '</div>';
        if (d.stopped) {
            html += '<p class="dgt-stopped">' + esc(tx('stopped', { n: num(used) })) + '</p>';
            html += '<p class="dgt-note">' + esc(tx('stoppedHint')) + '</p>';
        } else {
            html += '<div class="dgt-count">' + esc(tx('messages', { used: num(used), limit: num(limit) })) + '</div>';
            html += '<div class="dgt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + limit +
                '" aria-valuenow="' + used + '"><span style="inline-size:' + pct + '%;' +
                (pct >= 80 ? 'background:#f59e0b;' : '') + '"></span></div>';
            if (!compact) html += '<p class="dgt-note">' + esc(tx('countsNote')) + '</p>';
            html += '<p class="dgt-note dgt-quiet">' + esc(tx('quiet')) + '</p>';
        }
        html += reusedLine(d);
        html += '<button type="button" class="dgt-cta" data-dgt-plans="1">' + esc(tx('seePlans')) + '</button>';
        html += '</section>';
        return html;
    }

    /* The sidebar meter: the same two numbers in three existing slots. */
    function paintSidebar(d, slots) {
        if (!shows(d) || !slots) return false;
        var used = Number(d.messages_used) || 0;
        var limit = Number(d.messages_limit) || 100;
        var pct = Math.max(0, Math.min(100, Math.round(used / limit * 100)));
        if (slots.label) slots.label.textContent = tx('title');
        if (slots.count) slots.count.textContent = num(used) + ' / ' + num(limit);
        if (slots.bar) {
            slots.bar.style.width = (d.stopped ? 100 : pct) + '%';
            slots.bar.style.background = d.stopped ? '#ef4444' : (pct >= 80 ? '#f59e0b' : 'var(--theme-color)');
        }
        if (slots.sub) slots.sub.textContent = d.stopped ? tx('stopped', { n: num(used) }) : daysText(d);
        if (slots.meter) slots.meter.setAttribute('data-feature', 'trial-messages-meter');
        return true;
    }

    /* The global banner's trial text, or null when the banner should not show. */
    function bannerState(d) {
        if (!shows(d)) return null;
        var used = Number(d.messages_used) || 0;
        var limit = Number(d.messages_limit) || 100;
        var warn = 80;
        if (d.stopped) {
            return { severity: 'finished', text: tx('bannerStopped', { n: num(used) }), cta: tx('seePlans') };
        }
        if (used >= warn) {
            return {
                severity: 'low',
                text: tx('bannerRunning', { used: num(used), limit: num(limit), days: daysText(d) }),
                cta: tx('seePlans')
            };
        }
        return null;
    }

    /* The two dedicated nudges (§8.7a): the 10th AI reply, and 80 of 100.
     * Each fires once per workspace, ever; never both in one session. */
    var nudgedThisSession = false;
    function storageKey(id, milestone) { return 'dgt_trial_nudge_' + id + '_' + milestone; }
    function seen(id, milestone) {
        try { return localStorage.getItem(storageKey(id, milestone)) === '1'; } catch (e) { return true; }
    }
    function markSeen(id, milestone) {
        try { localStorage.setItem(storageKey(id, milestone), '1'); } catch (e) { /* private mode */ }
    }
    function maybeNudge(d) {
        try {
            if (!shows(d) || d.stopped || nudgedThisSession) return;
            if (!window.Entitlements || typeof window.Entitlements.openUpgradeModal !== 'function') return;
            if (document.getElementById('spl-upgrade')) return;   // one pop-up at a time
            var id = orgId();
            if (!id) return;
            var model = d.fallback_model_name || '';
            var limit = Number(d.messages_limit) || 100;
            var milestone = null, title = '', body = '';
            if ((Number(d.messages_used) || 0) >= 80 && !seen(id, 'eighty')) {
                milestone = 'eighty';
                title = tx('nudgeEightyTitle', { limit: num(limit) });
                body = tx('nudgeEightyBody', { model: model });
            } else if ((Number(d.ai_replies_used) || 0) >= 10 && !seen(id, 'tenth')) {
                milestone = 'tenth';
                title = tx('nudgeTenTitle');
                body = tx('nudgeTenBody', { model: model });
            }
            if (!milestone || !model) return;
            markSeen(id, milestone);
            // Reaching 80 first means the 10th-reply moment has passed too;
            // never show it afterwards.
            if (milestone === 'eighty') markSeen(id, 'tenth');
            nudgedThisSession = true;
            window.Entitlements.openUpgradeModal('trial_nudge', {
                title: title, body: body, ctaLabel: tx('seePlans'), dismissLabel: tx('notNow')
            });
        } catch (e) { /* a nudge must never break the page */ }
    }

    function injectStyles() {
        if (document.getElementById('dgt-styles')) return;
        var css = [
            '.dgt-card{display:block;padding:16px 18px;border-radius:14px;margin-block-end:16px;',
            'border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.04);}',
            ':root[data-theme="light"] .dgt-card{border-color:rgba(0,0,0,0.10);background:rgba(0,0,0,0.02);}',
            '.dgt-card--compact{padding:12px 14px;margin-block-end:0;}',
            '.dgt-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}',
            '.dgt-title{font-weight:700;font-size:0.95rem;color:var(--text-primary);}',
            '.dgt-days{font-size:0.78rem;font-weight:600;padding:2px 10px;border-radius:999px;',
            'background:color-mix(in srgb, var(--theme-color,#5BAEB0) 16%, transparent);color:var(--text-primary);}',
            '.dgt-count{margin-block-start:10px;font-size:1.25rem;font-weight:700;color:var(--text-primary);}',
            '.dgt-bar{margin-block-start:8px;block-size:8px;border-radius:999px;overflow:hidden;',
            'background:rgba(127,127,127,0.20);}',
            '.dgt-bar span{display:block;block-size:100%;background:var(--theme-color,#5BAEB0);border-radius:999px;}',
            '.dgt-note{margin:8px 0 0;font-size:0.8rem;line-height:1.5;color:var(--text-secondary);}',
            '.dgt-note--warn{color:#b45309;}',
            ':root:not([data-theme="light"]) .dgt-note--warn{color:#fbbf24;}',
            '.dgt-stopped{margin:10px 0 0;font-size:1rem;font-weight:700;color:var(--text-primary);}',
            '.dgt-cta{margin-block-start:12px;min-block-size:36px;padding:0 16px;border-radius:8px;cursor:pointer;',
            'font:inherit;font-weight:600;font-size:0.85rem;background:var(--theme-color,#5BAEB0);color:#fff;border:0;}'
        ].join('');
        var style = document.createElement('style');
        style.id = 'dgt-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // One delegated listener for every "See plans" button this file draws.
    document.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-dgt-plans]') : null;
        if (b) openPlans();
    });

    try { injectStyles(); } catch (e) { /* head not ready is not fatal */ }

    window.DigitiviaTrial = {
        load: load,
        peek: peek,
        invalidate: invalidate,
        shows: shows,
        isTrialCandidate: isTrialCandidate,
        cardHtml: function (d, opts) { try { injectStyles(); return cardHtml(d, opts); } catch (e) { return ''; } },
        paintSidebar: function (d, slots) { try { return paintSidebar(d, slots); } catch (e) { return false; } },
        bannerState: function (d) { try { return bannerState(d); } catch (e) { return null; } },
        maybeNudge: maybeNudge,
        text: tx
    };
}());
