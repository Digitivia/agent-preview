/* Partner portal. Runs on partner.html, talks to the same database as the
 * customer dashboard, and shows a partner only what belongs to them.
 *
 * Nothing here is a security boundary. Every read is a policy-filtered table or
 * a SECURITY DEFINER function that resolves the caller's partner from their own
 * membership, and every write is a function that checks it again. A partner who
 * edits this file in their browser gets the same rows back.
 *
 * Self-contained by design: no dependency on index.html's globals, its i18n
 * dictionaries or its 30k lines of CSS. The two pages share a session and a
 * database; they do not share a runtime.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------ strings --
    var STR = {
        en: {
            portal: 'Partner Portal', poweredBy: 'Powered by Digitivia',
            signIn: 'Sign in', signOut: 'Sign out', email: 'Email', password: 'Password',
            signInTitle: 'Sign in to your partner portal',
            signInSub: 'Use the account that was invited. It is the same login as the main app.',
            signingIn: 'Signing in…', loading: 'Loading…',
            offline: 'Cannot reach the server',
            offlineBody: 'The portal could not load its connection library. Check your network and reload.',
            notPartner: 'This account is not a partner account',
            notPartnerBody: 'You are signed in, but this login is not attached to a partner. If you were expecting a partner portal, ask your contact at Digitivia to send the invitation again.',
            openApp: 'Open the main app',
            navDashboard: 'Dashboard', navCustomers: 'Customers', navRequests: 'Requests', navSettings: 'Settings',
            // onboarding
            onbTitle: 'Set up your partnership', stepCompany: 'Company', stepAgreement: 'Agreement',
            stepBranding: 'Branding', stepLinks: 'Your links', stepDone: 'Done',
            onbCompanySub: 'Who we are contracting with. This appears on your agreement and on our records.',
            legalName: 'Registered company name', displayName: 'Name your customers see',
            country: 'Country', website: 'Website', taxId: 'Tax / registration number',
            saveContinue: 'Save and continue', back: 'Back',
            agreementSub: 'Read it, then confirm it is you.',
            noTemplate: 'Your agreement is not ready yet. We are preparing it and will let you know as soon as you can sign.',
            rateLine: 'Commission: {rate}% recurring, for as long as your customer keeps paying.',
            supportPartner: 'You handle customer service for your customers. We handle the platform and technical support.',
            supportDigitivia: 'We handle technical support and customer service for your customers.',
            typedName: 'Type your full name to sign', confirmPassword: 'Confirm your password',
            confirmPasswordHint: 'Confirming who you are at the moment of signing is what makes this a signature rather than a checkbox.',
            sendCode: 'Email me a code', sendingCode: 'Sending…', codeSent: 'We sent a code to {email}.',
            enterCode: 'Enter the code we emailed you',
            codeHint: 'Your account signs in with Google, so we confirm it is you by email instead of a password.',
            agreeBox: 'I have read the agreement and I accept it on behalf of the company named above.',
            accept: 'Accept and continue', accepting: 'Signing…',
            brandingSub: 'What your customers see instead of our name. You can change any of this later.',
            logoUrl: 'Logo URL', primaryColour: 'Primary colour', supportEmail: 'Support email for your customers',
            attribution: 'Attribution line', attrPartner: 'Powered by your company',
            attrDigitivia: 'Powered by Digitivia', attrNone: 'No attribution line',
            skipForNow: 'Skip for now',
            linksSub: 'Two links that work today. A subdomain of your own comes later.',
            loginLink: 'Your branded sign-in link', signupLink: 'Your signup link',
            signupLinkHint: 'Anyone who creates an account through this link is permanently recorded as yours.',
            copy: 'Copy', copied: 'Copied',
            domainLater: 'Pointing your own subdomain (like app.yourcompany.com) at us is not switched on yet. We will tell you when it is.',
            finish: 'Finish setup',
            // dashboard
            kpiCustomers: 'Customers', kpiActive: 'active', kpiPending: 'pending setup',
            kpiAtRisk: 'Needs attention', kpiCommission: 'Commission', kpiEarned: 'earned, not yet paid',
            kpiPaid: 'paid to date', kpiRequests: 'Open requests',
            attentionTitle: 'Needs your attention',
            attentionPending: '{n} customer(s) waiting to be activated by us.',
            attentionRisk: '{n} customer(s) with a subscription problem.',
            attentionWaiting: '{n} request(s) waiting for your reply.',
            allClear: 'Nothing needs you right now.',
            // customers
            customersTitle: 'Your customers', addCustomer: 'Add a customer',
            colName: 'Customer', colStatus: 'Status', colPlan: 'Plan', colUsage: 'Conversations',
            colCommission: 'Commission', colCreated: 'Added',
            noCustomers: 'No customers yet. Add your first one and we will send them their login.',
            newCustomerTitle: 'Add a customer', newCustomerSub: 'We create the real account and email the owner their invitation.',
            custName: 'Business name', ownerEmail: 'Owner email', ownerEmailHint: 'They receive the invitation and become the account owner.',
            contactName: 'Contact name', contactPhone: 'Phone', plan: 'Package',
            agreedPrice: 'Price you agreed', currency: 'Currency', notes: 'Notes',
            createIt: 'Create the account', creating: 'Creating…',
            createdOk: 'Account created. We emailed {email} their invitation.',
            noPlans: 'No packages are available to you yet. Ask us to enable one.',
            pendingSetupNote: 'Created. We activate the account once the commercial side is settled.',
            // requests
            requestsTitle: 'Requests to Digitivia', newRequest: 'New request',
            noRequests: 'No open requests. Anything you need from us, ask here rather than by message.',
            reqType: 'What is this about', reqSubject: 'Subject', reqDescription: 'Details',
            reqPriority: 'Priority', reqCustomer: 'About which customer (optional)',
            reqSend: 'Send it', reqSending: 'Sending…', reqSent: 'Sent. We will come back to you here.',
            reqNone: 'Not about a specific customer',
            t_technical_problem: 'Technical problem', t_onboarding_problem: 'Problem setting a customer up',
            t_special_customer_case: 'Special customer case', t_custom_development: 'Custom development',
            t_large_opportunity: 'Large opportunity', t_billing_issue: 'Billing issue', t_other: 'Something else',
            p_low: 'Low', p_medium: 'Normal', p_high: 'High', p_urgent: 'Urgent',
            reply: 'Reply', send: 'Send', conversation: 'Conversation',
            // settings
            settingsTitle: 'Settings', secCompany: 'Company', secBranding: 'Branding', secLinks: 'Links',
            secAgreement: 'Your agreement', save: 'Save', saved: 'Saved',
            acceptedOn: 'Accepted on {date} by {name}.',
            supportOwner: 'Customer service is handled by',
            youOwnSupport: 'you', weOwnSupport: 'Digitivia',
            // shared
            required: 'Please fill in the required fields.',
            failed: 'That did not work: ',
            statusLabels: {
                pending_setup: 'pending setup', active: 'active', suspended: 'suspended', churned: 'churned',
                open: 'open', triaging: 'triaging', waiting_partner: 'waiting for you',
                in_progress: 'in progress', resolved: 'resolved', closed: 'closed'
            }
        },
        ar: {
            portal: 'بوابة الشركاء', poweredBy: 'مدعوم من Digitivia',
            signIn: 'تسجيل الدخول', signOut: 'تسجيل الخروج', email: 'البريد الإلكتروني', password: 'كلمة المرور',
            signInTitle: 'سجّل الدخول إلى بوابة الشركاء',
            signInSub: 'استخدم الحساب الذي وصلته الدعوة. هو نفس حساب التطبيق الأساسي.',
            signingIn: 'جارٍ تسجيل الدخول…', loading: 'جارٍ التحميل…',
            offline: 'تعذر الوصول إلى الخادم',
            offlineBody: 'لم تتمكن البوابة من تحميل مكتبة الاتصال. تحقق من الشبكة وأعد التحميل.',
            notPartner: 'هذا الحساب ليس حساب شريك',
            notPartnerBody: 'أنت مسجّل الدخول، لكن هذا الحساب غير مرتبط بشريك. إن كنت تتوقع بوابة شركاء، اطلب من جهة الاتصال لديك في Digitivia إعادة إرسال الدعوة.',
            openApp: 'افتح التطبيق الأساسي',
            navDashboard: 'اللوحة', navCustomers: 'العملاء', navRequests: 'الطلبات', navSettings: 'الإعدادات',
            onbTitle: 'أكمل إعداد الشراكة', stepCompany: 'الشركة', stepAgreement: 'الاتفاقية',
            stepBranding: 'الهوية', stepLinks: 'روابطك', stepDone: 'تم',
            onbCompanySub: 'مع من نتعاقد. تظهر هذه البيانات في اتفاقيتك وفي سجلاتنا.',
            legalName: 'اسم الشركة المسجل', displayName: 'الاسم الذي يراه عملاؤك',
            country: 'الدولة', website: 'الموقع الإلكتروني', taxId: 'الرقم الضريبي / السجل',
            saveContinue: 'احفظ وتابع', back: 'رجوع',
            agreementSub: 'اقرأها، ثم أكّد أنك أنت.',
            noTemplate: 'اتفاقيتك ليست جاهزة بعد. نحن نجهزها وسنخبرك فور إمكانية التوقيع.',
            rateLine: 'العمولة: {rate}% متكررة، طالما استمر عميلك في الدفع.',
            supportPartner: 'أنت تتولى خدمة عملائك. ونحن نتولى المنصة والدعم الفني.',
            supportDigitivia: 'نحن نتولى الدعم الفني وخدمة العملاء لعملائك.',
            typedName: 'اكتب اسمك الكامل للتوقيع', confirmPassword: 'أكّد كلمة المرور',
            confirmPasswordHint: 'تأكيد هويتك لحظة التوقيع هو ما يجعل هذا توقيعًا لا مجرد علامة اختيار.',
            sendCode: 'أرسل لي رمزًا بالبريد', sendingCode: 'جارٍ الإرسال…', codeSent: 'أرسلنا رمزًا إلى {email}.',
            enterCode: 'أدخل الرمز الذي أرسلناه إليك',
            codeHint: 'حسابك يسجّل الدخول عبر Google، لذلك نؤكد هويتك بالبريد بدل كلمة المرور.',
            agreeBox: 'قرأت الاتفاقية وأوافق عليها نيابة عن الشركة المذكورة أعلاه.',
            accept: 'أوافق وأتابع', accepting: 'جارٍ التوقيع…',
            brandingSub: 'ما يراه عملاؤك بدلًا من اسمنا. يمكنك تغيير أي منه لاحقًا.',
            logoUrl: 'رابط الشعار', primaryColour: 'اللون الأساسي', supportEmail: 'بريد الدعم لعملائك',
            attribution: 'سطر النسبة', attrPartner: 'مدعوم من شركتك',
            attrDigitivia: 'مدعوم من Digitivia', attrNone: 'بدون سطر نسبة',
            skipForNow: 'تخطَّ الآن',
            linksSub: 'رابطان يعملان اليوم. النطاق الفرعي الخاص بك يأتي لاحقًا.',
            loginLink: 'رابط الدخول بهويتك', signupLink: 'رابط التسجيل الخاص بك',
            signupLinkHint: 'كل من ينشئ حسابًا عبر هذا الرابط يُسجَّل لك بشكل دائم.',
            copy: 'نسخ', copied: 'تم النسخ',
            domainLater: 'توجيه نطاق فرعي خاص بك (مثل app.yourcompany.com) إلينا غير مفعّل بعد. سنخبرك عند تفعيله.',
            finish: 'إنهاء الإعداد',
            kpiCustomers: 'العملاء', kpiActive: 'نشط', kpiPending: 'بانتظار التفعيل',
            kpiAtRisk: 'يحتاج انتباهك', kpiCommission: 'العمولة', kpiEarned: 'مستحقة ولم تُدفع',
            kpiPaid: 'مدفوعة حتى الآن', kpiRequests: 'طلبات مفتوحة',
            attentionTitle: 'يحتاج انتباهك',
            attentionPending: '{n} عميل بانتظار التفعيل من جهتنا.',
            attentionRisk: '{n} عميل لديه مشكلة في الاشتراك.',
            attentionWaiting: '{n} طلب بانتظار ردك.',
            allClear: 'لا شيء يحتاجك الآن.',
            customersTitle: 'عملاؤك', addCustomer: 'أضف عميلًا',
            colName: 'العميل', colStatus: 'الحالة', colPlan: 'الباقة', colUsage: 'المحادثات',
            colCommission: 'العمولة', colCreated: 'أُضيف',
            noCustomers: 'لا يوجد عملاء بعد. أضف أول عميل وسنرسل له بيانات الدخول.',
            newCustomerTitle: 'أضف عميلًا', newCustomerSub: 'ننشئ الحساب الحقيقي ونرسل الدعوة إلى المالك.',
            custName: 'اسم النشاط', ownerEmail: 'بريد المالك', ownerEmailHint: 'تصله الدعوة ويصبح مالك الحساب.',
            contactName: 'اسم جهة الاتصال', contactPhone: 'الهاتف', plan: 'الباقة',
            agreedPrice: 'السعر المتفق عليه', currency: 'العملة', notes: 'ملاحظات',
            createIt: 'أنشئ الحساب', creating: 'جارٍ الإنشاء…',
            createdOk: 'تم إنشاء الحساب. أرسلنا الدعوة إلى {email}.',
            noPlans: 'لا توجد باقات متاحة لك بعد. اطلب منا تفعيل واحدة.',
            pendingSetupNote: 'تم الإنشاء. نفعّل الحساب بعد استكمال الجانب التجاري.',
            requestsTitle: 'طلبات إلى Digitivia', newRequest: 'طلب جديد',
            noRequests: 'لا توجد طلبات مفتوحة. أي شيء تحتاجه منا اطلبه هنا بدل الرسائل.',
            reqType: 'الموضوع', reqSubject: 'العنوان', reqDescription: 'التفاصيل',
            reqPriority: 'الأولوية', reqCustomer: 'يخص أي عميل (اختياري)',
            reqSend: 'أرسل', reqSending: 'جارٍ الإرسال…', reqSent: 'تم الإرسال. سنعود إليك هنا.',
            reqNone: 'لا يخص عميلًا بعينه',
            t_technical_problem: 'مشكلة تقنية', t_onboarding_problem: 'مشكلة في إعداد عميل',
            t_special_customer_case: 'حالة عميل خاصة', t_custom_development: 'تطوير مخصص',
            t_large_opportunity: 'فرصة كبيرة', t_billing_issue: 'مشكلة في الفوترة', t_other: 'شيء آخر',
            p_low: 'منخفضة', p_medium: 'عادية', p_high: 'مرتفعة', p_urgent: 'عاجلة',
            reply: 'رد', send: 'إرسال', conversation: 'المحادثة',
            settingsTitle: 'الإعدادات', secCompany: 'الشركة', secBranding: 'الهوية', secLinks: 'الروابط',
            secAgreement: 'اتفاقيتك', save: 'حفظ', saved: 'تم الحفظ',
            acceptedOn: 'قُبلت في {date} بواسطة {name}.',
            supportOwner: 'خدمة العملاء يتولاها',
            youOwnSupport: 'أنت', weOwnSupport: 'Digitivia',
            required: 'من فضلك أكمل الحقول المطلوبة.',
            failed: 'لم ينجح ذلك: ',
            statusLabels: {
                pending_setup: 'بانتظار التفعيل', active: 'نشط', suspended: 'موقوف', churned: 'منتهٍ',
                open: 'مفتوح', triaging: 'قيد الفرز', waiting_partner: 'بانتظارك',
                in_progress: 'قيد العمل', resolved: 'تم الحل', closed: 'مغلق'
            }
        }
    };

    var lang = (function () {
        try { return localStorage.getItem('pp_language') || localStorage.getItem('app_language') || 'en'; }
        catch (e) { return 'en'; }
    })();
    if (lang !== 'ar') lang = 'en';

    function T(key, vars) {
        var v = STR[lang][key];
        if (v == null) v = STR.en[key];
        if (v == null) return key;
        if (vars) {
            Object.keys(vars).forEach(function (k) { v = v.split('{' + k + '}').join(vars[k]); });
        }
        return v;
    }
    function statusLabel(s) {
        return (STR[lang].statusLabels && STR[lang].statusLabels[s])
            || (STR.en.statusLabels && STR.en.statusLabels[s])
            || String(s || '').replace(/_/g, ' ');
    }

    // ------------------------------------------------------------ helpers --
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function money(cents, currency) {
        if (cents == null) return '—';
        try {
            return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US',
                { style: 'currency', currency: currency || 'EGP', maximumFractionDigits: 2 })
                .format(Number(cents) / 100);
        } catch (e) { return (Number(cents) / 100).toFixed(2) + ' ' + (currency || ''); }
    }
    function when(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB'); }
        catch (e) { return String(iso).slice(0, 10); }
    }
    var TONE = {
        active: '#1f9d6d', pending_setup: '#b26a00', suspended: '#cf4d60', churned: '#8794a1',
        open: '#2c718a', triaging: '#7c5cff', in_progress: '#2c718a',
        waiting_partner: '#b26a00', resolved: '#1f9d6d', closed: '#8794a1'
    };
    function chip(s) {
        var c = TONE[s] || '#617585';
        return '<span class="pp-chip" style="color:' + c + ';border-color:' + c + '55;background:' + c + '18;">'
            + esc(statusLabel(s)) + '</span>';
    }
    function el(id) { return document.getElementById(id); }
    function root() { return el('pp-root'); }

    var toastTimer = null;
    function toast(msg, bad) {
        var t = el('pp-toast');
        if (!t) { t = document.createElement('div'); t.id = 'pp-toast'; document.body.appendChild(t); }
        t.className = 'pp-toast' + (bad ? ' bad' : '');
        t.textContent = msg;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 7000 : 3500);
    }

    function sb() { return window.supabaseClient; }
    function rpc(fn, args) {
        return sb().rpc(fn, args || {}).then(function (r) {
            if (r.error) throw r.error;
            return r.data;
        });
    }

    // A deliberately small markdown renderer: headings, bold, italic, lists and
    // paragraphs, everything escaped first. An agreement is prose, and pulling a
    // markdown library onto a page that renders a legal document is a supply
    // chain we do not need.
    function md(src) {
        var lines = String(src || '').split('\n');
        var out = [], inList = false;
        function inline(x) {
            return esc(x)
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/\*([^*]+)\*/g, '<em>$1</em>');
        }
        lines.forEach(function (raw) {
            var line = raw.replace(/\s+$/, '');
            var h = line.match(/^(#{1,4})\s+(.*)$/);
            var li = line.match(/^[-*]\s+(.*)$/);
            if (li) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + inline(li[1]) + '</li>');
                return;
            }
            if (inList) { out.push('</ul>'); inList = false; }
            if (h) { var n = Math.min(h[1].length + 1, 4); out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); return; }
            if (!line) return;
            out.push('<p>' + inline(line) + '</p>');
        });
        if (inList) out.push('</ul>');
        return out.join('');
    }

    // -------------------------------------------------------------- state --
    var S = { boot: null, view: 'dashboard', overview: null, customers: null,
              requests: null, catalog: null, openRequest: null, brand: null };

    // -------------------------------------------------------------- brand --
    function applyBrand(b) {
        S.brand = b;
        var name = el('brand-name'), sub = el('brand-sub'), logo = el('brand-logo'), fav = el('brand-favicon');
        if (!b || !b.branded) {
            if (name) name.textContent = T('portal');
            if (sub) sub.textContent = 'Digitivia';
            document.title = T('portal') + ' · Digitivia';
            return;
        }
        if (name) name.textContent = b.display_name || T('portal');
        if (sub) sub.textContent = T('portal');
        document.title = (b.display_name || T('portal'));
        if (b.logo_url && logo) { logo.src = b.logo_url; logo.alt = b.display_name || ''; logo.hidden = false; }
        if (b.favicon_url && fav) fav.href = b.favicon_url;
        if (b.primary_color) {
            document.documentElement.style.setProperty('--pp-accent', b.primary_color);
            document.documentElement.style.setProperty('--pp-accent-strong', b.primary_color);
        }
    }

    function brandKeyFromLocation() {
        var q = new URLSearchParams(location.search).get('brand');
        if (q) return { slug: q, host: null };
        var h = location.hostname;
        // Our own hostnames carry our own brand; anything else might be a
        // partner's, and resolve_brand answers "not branded" when it is not.
        if (!h || /(^|\.)digitivia\.com$/i.test(h) || h === 'localhost' || h === '127.0.0.1') {
            return { slug: null, host: null };
        }
        return { slug: null, host: h };
    }

    // --------------------------------------------------------------- boot --
    function start() {
        if (window.__supabaseCdnFailed || !sb()) {
            root().innerHTML = '<div class="pp-card"><h2>' + esc(T('offline')) + '</h2>'
                + '<p class="pp-sub">' + esc(T('offlineBody')) + '</p></div>';
            return;
        }
        document.documentElement.lang = lang;
        document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
        var lt = el('lang-toggle');
        if (lt) {
            lt.textContent = (lang === 'ar') ? 'English' : 'العربية';
            lt.addEventListener('click', function () {
                try { localStorage.setItem('pp_language', lang === 'ar' ? 'en' : 'ar'); } catch (e) { /* private mode */ }
                location.reload();
            });
        }
        var so = el('sign-out');
        if (so) {
            so.textContent = T('signOut');
            so.addEventListener('click', function () {
                sb().auth.signOut().then(function () { location.reload(); });
            });
        }

        var key = brandKeyFromLocation();
        var brandP = (key.slug || key.host)
            ? rpc('resolve_brand', { p_hostname: key.host, p_slug: key.slug }).catch(function () { return null; })
            : Promise.resolve(null);

        brandP.then(function (b) {
            applyBrand(b);
            return sb().auth.getSession();
        }).then(function (r) {
            if (r && r.data && r.data.session) return loadPortal();
            renderSignIn();
        }).catch(function (e) {
            renderSignIn(e && e.message);
        });
    }

    function renderSignIn(err) {
        var so = el('sign-out'); if (so) so.hidden = true;
        root().innerHTML =
            '<div class="pp-card" style="max-width:420px;margin-inline:auto;">' +
              '<h2>' + esc(T('signInTitle')) + '</h2>' +
              '<p class="pp-sub">' + esc(T('signInSub')) + '</p>' +
              (err ? '<div class="pp-note bad">' + esc(err) + '</div>' : '') +
              '<form id="pp-signin" novalidate>' +
                '<label class="pp-field"><span>' + esc(T('email')) + '</span>' +
                  '<input type="email" id="si-email" autocomplete="username" required></label>' +
                '<label class="pp-field"><span>' + esc(T('password')) + '</span>' +
                  '<input type="password" id="si-pass" autocomplete="current-password" required></label>' +
                '<button class="pp-btn primary" type="submit" id="si-go" style="width:100%;">' + esc(T('signIn')) + '</button>' +
              '</form>' +
            '</div>';
        el('pp-signin').addEventListener('submit', function (e) {
            e.preventDefault();
            var b = el('si-go'); b.disabled = true; b.textContent = T('signingIn');
            sb().auth.signInWithPassword({
                email: (el('si-email').value || '').trim(),
                password: el('si-pass').value || ''
            }).then(function (r) {
                if (r.error) throw r.error;
                return loadPortal();
            }).catch(function (e2) {
                b.disabled = false; b.textContent = T('signIn');
                toast(T('failed') + (e2.message || e2), true);
            });
        });
    }

    function loadPortal() {
        root().innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        var so = el('sign-out'); if (so) so.hidden = false;
        return rpc('partner_portal_bootstrap').then(function (b) {
            S.boot = b;
            if (!b || b.is_partner !== true) return renderNotPartner();
            // The brand a partner sees in their own portal is their own, even on
            // our hostname - they are looking at their business, not ours.
            if (!S.brand && b.branding) applyBrand(Object.assign({ branded: true }, b.branding));
            var o = b.onboarding || {};
            if (!o.company_done || !o.agreement_done) return renderOnboarding();
            return renderShell();
        }).catch(function (e) {
            root().innerHTML = '<div class="pp-card"><h2>' + esc(T('failed')) + '</h2>'
                + '<p class="pp-sub">' + esc(e.message || String(e)) + '</p></div>';
        });
    }

    function renderNotPartner() {
        root().innerHTML =
            '<div class="pp-card" style="max-width:520px;margin-inline:auto;">' +
              '<h2>' + esc(T('notPartner')) + '</h2>' +
              '<p class="pp-sub">' + esc(T('notPartnerBody')) + '</p>' +
              '<a class="pp-btn primary" href="/index.html" style="text-decoration:none;display:inline-block;">' +
                esc(T('openApp')) + '</a>' +
            '</div>';
    }

    // --------------------------------------------------------- onboarding --
    // Resumable: every step reads its state from the bootstrap RPC rather than
    // from anything held in this page, so closing the tab loses nothing.
    var onbStep = null;

    function onboardingSteps() {
        var o = (S.boot && S.boot.onboarding) || {};
        return [
            { key: 'company',   label: T('stepCompany'),   done: !!o.company_done },
            { key: 'agreement', label: T('stepAgreement'), done: !!o.agreement_done },
            { key: 'branding',  label: T('stepBranding'),  done: !!o.branding_done },
            { key: 'links',     label: T('stepLinks'),     done: !!o.agreement_done }
        ];
    }

    function renderOnboarding() {
        var steps = onboardingSteps();
        if (!onbStep) {
            var first = steps.filter(function (x) { return !x.done; })[0];
            onbStep = first ? first.key : 'links';
        }
        var strip = steps.map(function (x, i) {
            var cls = x.done ? 'done' : (x.key === onbStep ? 'now' : '');
            return '<div class="pp-step ' + cls + '"><span class="dot">' + (x.done ? '✓' : (i + 1)) + '</span>'
                + esc(x.label) + '</div>';
        }).join('');

        root().innerHTML =
            '<div class="pp-card">' +
              '<h2>' + esc(T('onbTitle')) + '</h2>' +
              '<div class="pp-steps" style="margin-top:12px;">' + strip + '</div>' +
              '<div id="onb-body"></div>' +
            '</div>';

        var body = el('onb-body');
        if (onbStep === 'company') return onbCompany(body);
        if (onbStep === 'agreement') return onbAgreement(body);
        if (onbStep === 'branding') return onbBranding(body);
        return onbLinks(body);
    }

    function onbCompany(host) {
        var p = (S.boot && S.boot.partner) || {};
        var c = p.company || {};
        host.innerHTML =
            '<p class="pp-sub">' + esc(T('onbCompanySub')) + '</p>' +
            '<label class="pp-field"><span class="req">' + esc(T('legalName')) + '</span>' +
              '<input id="ob-legal" value="' + esc(p.legal_name || '') + '"></label>' +
            '<label class="pp-field"><span class="req">' + esc(T('displayName')) + '</span>' +
              '<input id="ob-display" value="' + esc(p.display_name || '') + '"></label>' +
            '<div class="pp-grid">' +
              '<label class="pp-field"><span class="req">' + esc(T('country')) + '</span>' +
                '<input id="ob-country" value="' + esc(c.country || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('website')) + '</span>' +
                '<input id="ob-website" value="' + esc(c.website || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('taxId')) + '</span>' +
                '<input id="ob-tax" value="' + esc(c.tax_id || '') + '"></label>' +
            '</div>' +
            '<button class="pp-btn primary" id="ob-save">' + esc(T('saveContinue')) + '</button>';

        el('ob-save').addEventListener('click', function () {
            var legal = (el('ob-legal').value || '').trim();
            var disp = (el('ob-display').value || '').trim();
            var country = (el('ob-country').value || '').trim();
            if (!legal || !disp || !country) { toast(T('required'), true); return; }
            var b = el('ob-save'); b.disabled = true;
            rpc('partner_update_profile', { p: {
                legal_name: legal, display_name: disp,
                company: { country: country, website: (el('ob-website').value || '').trim(),
                           tax_id: (el('ob-tax').value || '').trim() }
            }}).then(function (res) {
                if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                onbStep = 'agreement';
                return loadPortal();
            }).catch(function (e) { b.disabled = false; toast(T('failed') + (e.message || e), true); });
        });
    }

    function onbAgreement(host) {
        var ag = S.boot && S.boot.agreement;
        var p = (S.boot && S.boot.partner) || {};
        if (!ag) {
            host.innerHTML = '<div class="pp-note warn">' + esc(T('noTemplate')) + '</div>';
            return;
        }
        host.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';

        // The exact text in the partner's own language, straight from the
        // published template. The policy on agreement_templates only lets a
        // published row out, so a draft can never be put in front of anyone.
        var tplId = ag.template_id;
        var pick = tplId
            ? sb().from('agreement_templates').select('id,title,body_md,lang,version,code').eq('id', tplId).maybeSingle()
                .then(function (r) {
                    if (r.error || !r.data) return null;
                    // Prefer the same document in the reader's language.
                    return sb().from('agreement_templates')
                        .select('id,title,body_md,lang,version')
                        .eq('code', r.data.code).eq('lang', lang).eq('status', 'published')
                        .order('version', { ascending: false }).limit(1).maybeSingle()
                        .then(function (r2) { return (r2.data || r.data); });
                })
            : sb().from('agreement_templates')
                .select('id,title,body_md,lang,version')
                .eq('status', 'published').eq('lang', lang)
                .order('version', { ascending: false }).limit(1).maybeSingle()
                .then(function (r) { return r.data; });

        Promise.all([pick, sb().auth.getUser()]).then(function (both) {
            var tpl = both[0];
            var user = both[1] && both[1].data && both[1].data.user;
            var email = (user && user.email) || '';
            // Which providers this account can actually prove itself with. An
            // account created through Google has no password, and asking it for
            // one is a dead end - so those confirm by a code sent to the same
            // mailbox the invitation went to.
            var providers = (user && user.app_metadata &&
                (user.app_metadata.providers || [user.app_metadata.provider])) || [];
            var hasPassword = providers.indexOf('email') >= 0;

            var plan = ag.commission_plan || {};
            var rate = plan.rate_pct;
            var support = plan.support_owner || p.support_owner;

            host.innerHTML =
                '<p class="pp-sub">' + esc(T('agreementSub')) + '</p>' +
                (rate != null ? '<div class="pp-note">' + esc(T('rateLine', { rate: rate })) + '<br>' +
                    esc(support === 'partner' ? T('supportPartner') : T('supportDigitivia')) + '</div>' : '') +
                (tpl
                    ? '<h3>' + esc(tpl.title) + '</h3><div class="pp-agreement" id="ob-doc">' + md(tpl.body_md) + '</div>'
                    : '<div class="pp-note warn">' + esc(T('noTemplate')) + '</div>') +
                (tpl ? (
                '<label class="pp-field" style="margin-top:14px;"><span class="req">' + esc(T('typedName')) + '</span>' +
                  '<input id="ob-signer" autocomplete="name"></label>' +
                (hasPassword
                  ? '<label class="pp-field"><span class="req">' + esc(T('confirmPassword')) + '</span>' +
                      '<input id="ob-pass" type="password" autocomplete="current-password">' +
                      '<span class="pp-hint">' + esc(T('confirmPasswordHint')) + '</span></label>'
                  : '<div class="pp-field"><span class="req">' + esc(T('enterCode')) + '</span>' +
                      '<div class="pp-copy" style="margin-top:5px;">' +
                        '<input id="ob-code" inputmode="numeric" autocomplete="one-time-code" style="flex:1 1 140px;">' +
                        '<button class="pp-btn" type="button" id="ob-sendcode">' + esc(T('sendCode')) + '</button>' +
                      '</div>' +
                      '<span class="pp-hint">' + esc(T('codeHint')) + '</span></div>') +
                '<label style="display:flex;gap:9px;align-items:flex-start;font-size:.85rem;margin:14px 0;">' +
                  '<input type="checkbox" id="ob-agree" style="margin-top:3px;flex:none;">' +
                  '<span>' + esc(T('agreeBox')) + '</span></label>' +
                '<button class="pp-btn primary" id="ob-accept">' + esc(T('accept')) + '</button>'
                ) : '');

            if (!tpl) return;

            var codeBtn = el('ob-sendcode');
            if (codeBtn) codeBtn.addEventListener('click', function () {
                codeBtn.disabled = true; codeBtn.textContent = T('sendingCode');
                sb().auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } })
                    .then(function (r) {
                        codeBtn.disabled = false; codeBtn.textContent = T('sendCode');
                        if (r.error) throw new Error(r.error.message);
                        toast(T('codeSent', { email: email }));
                    })
                    .catch(function (e) {
                        codeBtn.disabled = false; codeBtn.textContent = T('sendCode');
                        toast(T('failed') + (e.message || e), true);
                    });
            });

            el('ob-accept').addEventListener('click', function () {
                var name = (el('ob-signer').value || '').trim();
                var secret = hasPassword ? (el('ob-pass').value || '') : (el('ob-code').value || '').trim();
                if (!name || !el('ob-agree').checked || !secret) { toast(T('required'), true); return; }
                var b = el('ob-accept'); b.disabled = true; b.textContent = T('accepting');

                // Re-confirm identity at the moment of signing. A checkbox says
                // somebody clicked; this says who, by the same credential they
                // hold the account with.
                var proof = hasPassword
                    ? sb().auth.signInWithPassword({ email: email, password: secret })
                    : sb().auth.verifyOtp({ email: email, token: secret, type: 'email' });

                proof.then(function (r) {
                    if (r.error) throw new Error(r.error.message);
                    return rpc('partner_accept_agreement', {
                        p_agreement_id: ag.id,
                        p_typed_name: name,
                        // No IP: a browser cannot know its own, and a value it
                        // reports is worth nothing. Capturing it truthfully
                        // needs an edge function and is noted as not done.
                        p_meta: {
                            user_agent: navigator.userAgent,
                            reauthenticated_at: new Date().toISOString(),
                            reauth_method: hasPassword ? 'password' : 'email_otp',
                            signer_email: email,
                            lang: lang,
                            template_version: tpl.version,
                            template_lang: tpl.lang
                        }
                    });
                }).then(function (res) {
                    if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                    onbStep = 'branding';
                    return loadPortal();
                }).catch(function (e) {
                    b.disabled = false; b.textContent = T('accept');
                    toast(T('failed') + (e.message || e), true);
                });
            });
        });
    }

    function onbBranding(host) {
        var b = (S.boot && S.boot.branding) || {};
        var p = (S.boot && S.boot.partner) || {};
        host.innerHTML =
            '<p class="pp-sub">' + esc(T('brandingSub')) + '</p>' +
            '<label class="pp-field"><span>' + esc(T('displayName')) + '</span>' +
              '<input id="br-name" value="' + esc(b.display_name || p.display_name || '') + '"></label>' +
            '<label class="pp-field"><span>' + esc(T('logoUrl')) + '</span>' +
              '<input id="br-logo" type="url" placeholder="https://…" value="' + esc(b.logo_url || '') + '"></label>' +
            '<div class="pp-grid">' +
              '<label class="pp-field"><span>' + esc(T('primaryColour')) + '</span>' +
                '<input id="br-colour" type="color" value="' + esc(b.primary_color || '#2c718a') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('supportEmail')) + '</span>' +
                '<input id="br-email" type="email" value="' + esc(b.support_email || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('attribution')) + '</span>' +
                '<select id="br-powered">' +
                  '<option value="partner"' + (b.powered_by === 'partner' ? ' selected' : '') + '>' + esc(T('attrPartner')) + '</option>' +
                  '<option value="digitivia"' + (b.powered_by !== 'partner' && b.powered_by !== 'none' ? ' selected' : '') + '>' + esc(T('attrDigitivia')) + '</option>' +
                  '<option value="none"' + (b.powered_by === 'none' ? ' selected' : '') + '>' + esc(T('attrNone')) + '</option>' +
                '</select></label>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="pp-btn primary" id="br-save">' + esc(T('saveContinue')) + '</button>' +
              '<button class="pp-btn ghost" id="br-skip">' + esc(T('skipForNow')) + '</button>' +
            '</div>';

        el('br-skip').addEventListener('click', function () { onbStep = 'links'; renderOnboarding(); });
        el('br-save').addEventListener('click', function () {
            var btn = el('br-save'); btn.disabled = true;
            rpc('partner_update_branding', { p: {
                display_name: (el('br-name').value || '').trim() || null,
                logo_url: (el('br-logo').value || '').trim() || null,
                primary_color: el('br-colour').value || null,
                support_email: (el('br-email').value || '').trim() || null,
                powered_by: el('br-powered').value
            }}).then(function (res) {
                if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                onbStep = 'links';
                return loadPortal();
            }).catch(function (e) { btn.disabled = false; toast(T('failed') + (e.message || e), true); });
        });
    }

    function partnerLinks() {
        var slug = (S.boot && S.boot.partner && S.boot.partner.slug) || '';
        var base = location.origin;
        return {
            login: base + '/partner.html?brand=' + encodeURIComponent(slug),
            signup: base + '/index.html?partner=' + encodeURIComponent(slug)
        };
    }

    function copyRow(labelText, value, hint) {
        return '<label class="pp-field"><span>' + esc(labelText) + '</span>' +
            '<div class="pp-copy" style="margin-top:5px;">' +
              '<code>' + esc(value) + '</code>' +
              '<button class="pp-btn" type="button" data-copy="' + esc(value) + '">' + esc(T('copy')) + '</button>' +
            '</div>' + (hint ? '<span class="pp-hint">' + esc(hint) + '</span>' : '') + '</label>';
    }

    function wireCopy(scope) {
        (scope || document).querySelectorAll('[data-copy]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var v = btn.getAttribute('data-copy');
                var done = function () { toast(T('copied')); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(v).then(done, function () { window.prompt(T('copy'), v); });
                } else { window.prompt(T('copy'), v); }
            });
        });
    }

    function onbLinks(host) {
        var L = partnerLinks();
        host.innerHTML =
            '<p class="pp-sub">' + esc(T('linksSub')) + '</p>' +
            copyRow(T('loginLink'), L.login) +
            copyRow(T('signupLink'), L.signup, T('signupLinkHint')) +
            '<div class="pp-note warn">' + esc(T('domainLater')) + '</div>' +
            '<button class="pp-btn primary" id="ob-finish">' + esc(T('finish')) + '</button>';
        wireCopy(host);
        el('ob-finish').addEventListener('click', function () { onbStep = null; renderShell(); });
    }

    // -------------------------------------------------------------- shell --
    function renderShell() {
        var tabs = [
            ['dashboard', T('navDashboard')], ['customers', T('navCustomers')],
            ['requests', T('navRequests')], ['settings', T('navSettings')]
        ];
        root().innerHTML =
            '<nav class="pp-nav">' + tabs.map(function (t) {
                return '<button data-view="' + t[0] + '"' + (S.view === t[0] ? ' aria-current="page"' : '') + '>'
                    + esc(t[1]) + '</button>';
            }).join('') + '</nav><div id="pp-view"></div>';

        root().querySelectorAll('.pp-nav button').forEach(function (b) {
            b.addEventListener('click', function () { S.view = b.getAttribute('data-view'); renderShell(); });
        });
        var v = el('pp-view');
        if (S.view === 'customers') return viewCustomers(v);
        if (S.view === 'requests') return viewRequests(v);
        if (S.view === 'settings') return viewSettings(v);
        return viewDashboard(v);
    }

    // ---------------------------------------------------------- dashboard --
    function stat(k, v, n) {
        return '<div class="pp-stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>'
            + (n ? '<div class="n">' + esc(n) + '</div>' : '') + '</div>';
    }

    function viewDashboard(host) {
        host.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        Promise.all([rpc('partner_portal_overview'), rpc('partner_list_customers')])
        .then(function (r) {
            var o = r[0] || {}; S.overview = o; S.customers = r[1] || [];
            var c = o.customers || {}, com = o.commission || {}, req = o.requests || {};
            var cur = com.currency || 'EGP';

            var todo = [];
            if (Number(c.pending_setup)) todo.push(T('attentionPending', { n: c.pending_setup }));
            if (Number(o.at_risk)) todo.push(T('attentionRisk', { n: o.at_risk }));
            if (Number(req.waiting_partner)) todo.push(T('attentionWaiting', { n: req.waiting_partner }));

            host.innerHTML =
                '<div class="pp-card">' +
                  '<h3>' + esc(T('attentionTitle')) + '</h3>' +
                  (todo.length
                    ? '<ul style="margin:0;padding-inline-start:20px;font-size:.88rem;line-height:1.8;">' +
                        todo.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
                    : '<p class="pp-sub" style="margin:0;">' + esc(T('allClear')) + '</p>') +
                '</div>' +
                '<div class="pp-card"><div class="pp-grid">' +
                  stat(T('kpiCustomers'), esc(c.total || 0), (c.active || 0) + ' ' + T('kpiActive') + ' · ' + (c.pending_setup || 0) + ' ' + T('kpiPending')) +
                  stat(T('kpiAtRisk'), esc(o.at_risk || 0)) +
                  stat(T('kpiCommission'), money((com.accrued_cents || 0) + (com.approved_cents || 0), cur), T('kpiEarned')) +
                  stat(T('kpiPaid'), money(com.paid_cents || 0, cur)) +
                  stat(T('kpiRequests'), esc(req.open || 0)) +
                '</div></div>' +
                '<div class="pp-card">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
                    '<h3 style="margin:0;">' + esc(T('customersTitle')) + '</h3>' +
                    '<button class="pp-btn primary" id="dash-add">' + esc(T('addCustomer')) + '</button>' +
                  '</div>' +
                  customersTable(S.customers.slice(0, 8)) +
                '</div>';
            el('dash-add').addEventListener('click', function () { S.view = 'customers'; renderShell(); setTimeout(openNewCustomer, 0); });
        }).catch(function (e) {
            host.innerHTML = '<div class="pp-card"><p class="pp-sub">' + esc(T('failed') + (e.message || e)) + '</p></div>';
        });
    }

    function customersTable(rows) {
        if (!rows || !rows.length) return '<div class="pp-empty">' + esc(T('noCustomers')) + '</div>';
        return '<div class="pp-scroll"><table class="pp-table"><thead><tr>' +
            ['colName', 'colStatus', 'colPlan', 'colUsage', 'colCommission', 'colCreated']
                .map(function (k) { return '<th>' + esc(T(k)) + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            rows.map(function (c) {
                var used = Number(c.conversations_used || 0), lim = Number(c.conversations_limit || 0);
                return '<tr>' +
                    '<td><div style="font-weight:600;">' + esc(c.org_name) + '</div>' +
                      (c.contact_email ? '<div style="font-size:.75rem;color:var(--pp-muted);">' + esc(c.contact_email) + '</div>' : '') + '</td>' +
                    '<td>' + chip(c.status) + (c.subscription_status && c.subscription_status !== 'active'
                        ? '<div style="font-size:.72rem;color:var(--pp-muted);margin-top:3px;">' + esc(c.subscription_status) + '</div>' : '') + '</td>' +
                    '<td>' + esc(c.plan_slug || '—') + '</td>' +
                    '<td>' + (lim ? esc(used) + ' / ' + esc(lim) : esc(used)) + '</td>' +
                    '<td>' + money(c.commission_accrued_cents, c.currency || 'EGP') + '</td>' +
                    '<td style="color:var(--pp-muted);">' + esc(when(c.created_at)) + '</td>' +
                '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    // ---------------------------------------------------------- customers --
    function viewCustomers(host) {
        host.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        rpc('partner_list_customers').then(function (rows) {
            S.customers = rows || [];
            host.innerHTML =
                '<div class="pp-card">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
                    '<h2 style="margin:0;">' + esc(T('customersTitle')) + '</h2>' +
                    '<button class="pp-btn primary" id="cu-add">' + esc(T('addCustomer')) + '</button>' +
                  '</div>' +
                  '<div id="cu-form"></div>' +
                  customersTable(S.customers) +
                '</div>';
            el('cu-add').addEventListener('click', openNewCustomer);
        }).catch(function (e) {
            host.innerHTML = '<div class="pp-card"><p class="pp-sub">' + esc(T('failed') + (e.message || e)) + '</p></div>';
        });
    }

    function openNewCustomer() {
        var slot = el('cu-form');
        if (!slot) { S.view = 'customers'; renderShell(); return; }
        slot.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        var pid = S.boot && S.boot.partner && S.boot.partner.id;
        rpc('get_partner_catalog', { p_partner_id: pid, p_currency: 'EGP', p_interval: 'month' })
        .then(function (plans) {
            S.catalog = plans || [];
            if (!S.catalog.length) {
                slot.innerHTML = '<div class="pp-note warn">' + esc(T('noPlans')) + '</div>';
                return;
            }
            slot.innerHTML =
              '<div style="border:1px solid var(--pp-border);border-radius:12px;padding:15px;margin-bottom:16px;">' +
                '<h3>' + esc(T('newCustomerTitle')) + '</h3>' +
                '<p class="pp-sub">' + esc(T('newCustomerSub')) + '</p>' +
                '<div class="pp-grid">' +
                  '<label class="pp-field"><span class="req">' + esc(T('custName')) + '</span><input id="nc-name"></label>' +
                  '<label class="pp-field"><span class="req">' + esc(T('ownerEmail')) + '</span>' +
                    '<input id="nc-email" type="email" autocomplete="off">' +
                    '<span class="pp-hint">' + esc(T('ownerEmailHint')) + '</span></label>' +
                  '<label class="pp-field"><span>' + esc(T('contactName')) + '</span><input id="nc-contact"></label>' +
                  '<label class="pp-field"><span>' + esc(T('contactPhone')) + '</span><input id="nc-phone" type="tel"></label>' +
                  '<label class="pp-field"><span class="req">' + esc(T('plan')) + '</span><select id="nc-plan">' +
                    S.catalog.map(function (p) {
                      var lim = p.limits && p.limits.conversations_limit;
                      return '<option value="' + esc(p.plan_slug) + '">' + esc(p.plan_name) +
                        (lim ? ' — ' + esc(lim) + ' ' + esc(T('colUsage').toLowerCase()) : '') + '</option>';
                    }).join('') + '</select></label>' +
                  '<label class="pp-field"><span>' + esc(T('agreedPrice')) + '</span>' +
                    '<input id="nc-price" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
                  '<label class="pp-field"><span>' + esc(T('currency')) + '</span>' +
                    '<select id="nc-cur"><option>EGP</option><option>USD</option><option>EUR</option></select></label>' +
                '</div>' +
                '<label class="pp-field"><span>' + esc(T('notes')) + '</span><textarea id="nc-notes"></textarea></label>' +
                '<button class="pp-btn primary" id="nc-go">' + esc(T('createIt')) + '</button>' +
              '</div>';

            el('nc-go').addEventListener('click', function () {
                var name = (el('nc-name').value || '').trim();
                var email = (el('nc-email').value || '').trim();
                if (!name || !email) { toast(T('required'), true); return; }
                var priceRaw = parseFloat(el('nc-price').value);
                var b = el('nc-go'); b.disabled = true; b.textContent = T('creating');
                rpc('partner_create_customer', { p: {
                    name: name, owner_email: email,
                    contact_name: (el('nc-contact').value || '').trim(),
                    contact_phone: (el('nc-phone').value || '').trim(),
                    plan_slug: el('nc-plan').value,
                    agreed_price_cents: isFinite(priceRaw) ? Math.round(priceRaw * 100) : null,
                    currency: el('nc-cur').value,
                    billing_interval: 'month',
                    notes: (el('nc-notes').value || '').trim()
                }}).then(function (res) {
                    if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                    toast(T('createdOk', { email: res.invitation_sent_to || email }));
                    S.view = 'customers'; renderShell();
                }).catch(function (e) {
                    b.disabled = false; b.textContent = T('createIt');
                    toast(T('failed') + (e.message || e), true);
                });
            });
        }).catch(function (e) {
            slot.innerHTML = '<div class="pp-note bad">' + esc(T('failed') + (e.message || e)) + '</div>';
        });
    }

    // ----------------------------------------------------------- requests --
    var REQ_TYPES = ['technical_problem', 'onboarding_problem', 'special_customer_case',
                     'custom_development', 'large_opportunity', 'billing_issue', 'other'];

    function viewRequests(host) {
        if (S.openRequest) return viewRequestDetail(host, S.openRequest);
        host.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        Promise.all([
            sb().rpc('partner_list_requests', { p_include_closed: true }),
            S.customers ? Promise.resolve({ data: S.customers }) : sb().rpc('partner_list_customers')
        ]).then(function (r) {
            if (r[0].error) throw r[0].error;
            S.requests = r[0].data || [];
            S.customers = (r[1] && r[1].data) || S.customers || [];
            host.innerHTML =
                '<div class="pp-card">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
                    '<h2 style="margin:0;">' + esc(T('requestsTitle')) + '</h2>' +
                    '<button class="pp-btn primary" id="rq-new">' + esc(T('newRequest')) + '</button>' +
                  '</div>' +
                  '<div id="rq-form"></div>' +
                  (S.requests.length ? requestsTable(S.requests)
                                     : '<div class="pp-empty">' + esc(T('noRequests')) + '</div>') +
                '</div>';
            el('rq-new').addEventListener('click', openNewRequest);
            host.querySelectorAll('[data-request-id]').forEach(function (tr) {
                tr.addEventListener('click', function () {
                    S.openRequest = tr.getAttribute('data-request-id'); renderShell();
                });
            });
        }).catch(function (e) {
            host.innerHTML = '<div class="pp-card"><p class="pp-sub">' + esc(T('failed') + (e.message || e)) + '</p></div>';
        });
    }

    function requestsTable(rows) {
        return '<div class="pp-scroll"><table class="pp-table"><thead><tr>' +
            '<th>#</th><th>' + esc(T('reqSubject')) + '</th><th>' + esc(T('reqType')) + '</th>' +
            '<th>' + esc(T('colStatus')) + '</th><th>' + esc(T('reqPriority')) + '</th><th>' + esc(T('colCreated')) + '</th>' +
            '</tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr data-request-id="' + esc(r.id) + '" style="cursor:pointer;">' +
                  '<td style="color:var(--pp-muted);">' + esc(r.request_number) + '</td>' +
                  '<td style="font-weight:600;">' + esc(r.subject) + '</td>' +
                  '<td>' + esc(T('t_' + r.request_type)) + '</td>' +
                  '<td>' + chip(r.status) + '</td>' +
                  '<td>' + esc(T('p_' + r.priority)) + '</td>' +
                  '<td style="color:var(--pp-muted);">' + esc(when(r.created_at)) + '</td>' +
                '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    function openNewRequest() {
        var slot = el('rq-form');
        if (!slot) return;
        slot.innerHTML =
          '<div style="border:1px solid var(--pp-border);border-radius:12px;padding:15px;margin-bottom:16px;">' +
            '<div class="pp-grid">' +
              '<label class="pp-field"><span class="req">' + esc(T('reqType')) + '</span><select id="nr-type">' +
                REQ_TYPES.map(function (t) { return '<option value="' + t + '">' + esc(T('t_' + t)) + '</option>'; }).join('') +
              '</select></label>' +
              '<label class="pp-field"><span>' + esc(T('reqPriority')) + '</span><select id="nr-pri">' +
                ['low', 'medium', 'high', 'urgent'].map(function (p) {
                  return '<option value="' + p + '"' + (p === 'medium' ? ' selected' : '') + '>' + esc(T('p_' + p)) + '</option>';
                }).join('') + '</select></label>' +
              '<label class="pp-field"><span>' + esc(T('reqCustomer')) + '</span><select id="nr-cust">' +
                '<option value="">' + esc(T('reqNone')) + '</option>' +
                (S.customers || []).map(function (c) {
                  return '<option value="' + esc(c.org_id) + '">' + esc(c.org_name) + '</option>';
                }).join('') + '</select></label>' +
            '</div>' +
            '<label class="pp-field"><span class="req">' + esc(T('reqSubject')) + '</span><input id="nr-subject"></label>' +
            '<label class="pp-field"><span>' + esc(T('reqDescription')) + '</span><textarea id="nr-body"></textarea></label>' +
            '<button class="pp-btn primary" id="nr-go">' + esc(T('reqSend')) + '</button>' +
          '</div>';

        el('nr-go').addEventListener('click', function () {
            var subject = (el('nr-subject').value || '').trim();
            if (!subject) { toast(T('required'), true); return; }
            var b = el('nr-go'); b.disabled = true; b.textContent = T('reqSending');
            rpc('partner_create_request', { p: {
                request_type: el('nr-type').value, priority: el('nr-pri').value,
                customer_org_id: el('nr-cust').value || null,
                subject: subject, description: (el('nr-body').value || '').trim()
            }}).then(function (res) {
                if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                toast(T('reqSent'));
                renderShell();
            }).catch(function (e) {
                b.disabled = false; b.textContent = T('reqSend');
                toast(T('failed') + (e.message || e), true);
            });
        });
    }

    function viewRequestDetail(host, id) {
        host.innerHTML = '<div class="pp-spin">' + esc(T('loading')) + '</div>';
        rpc('partner_request_detail', { p_request_id: id }).then(function (d) {
            if (!d || d.error) throw new Error((d && d.error) || 'not found');
            var r = d.request, comments = d.comments || [];
            host.innerHTML =
              '<div class="pp-card">' +
                '<button class="pp-btn ghost" id="rq-back" style="margin-bottom:12px;">← ' + esc(T('requestsTitle')) + '</button>' +
                '<h2 style="margin:0;">#' + esc(r.request_number) + ' · ' + esc(r.subject) + '</h2>' +
                '<p class="pp-sub">' + esc(T('t_' + r.request_type)) + ' · ' + chip(r.status).replace(/<[^>]+>/g, '') +
                  ' · ' + esc(T('p_' + r.priority)) + ' · ' + esc(when(r.created_at)) + '</p>' +
                (r.description ? '<div class="pp-note">' + esc(r.description).replace(/\n/g, '<br>') + '</div>' : '') +
                '<h3 style="margin-top:16px;">' + esc(T('conversation')) + '</h3>' +
                (comments.length ? comments.map(function (c) {
                    var mine = c.author_side === 'partner';
                    return '<div style="padding:10px 12px;border-radius:10px;margin-bottom:8px;font-size:.87rem;line-height:1.5;' +
                        'background:' + (mine ? 'var(--pp-accent-soft)' : 'var(--pp-bg)') + ';border:1px solid var(--pp-border);">' +
                        '<div style="font-size:.72rem;color:var(--pp-muted);margin-bottom:4px;">' +
                          esc(mine ? (S.boot.partner.display_name || 'You') : 'Digitivia') + ' · ' + esc(when(c.created_at)) + '</div>' +
                        esc(c.body).replace(/\n/g, '<br>') + '</div>';
                  }).join('') : '<p class="pp-sub">—</p>') +
                (r.status === 'closed' ? '' :
                  '<label class="pp-field" style="margin-top:12px;"><span>' + esc(T('reply')) + '</span>' +
                    '<textarea id="rq-reply"></textarea></label>' +
                  '<button class="pp-btn primary" id="rq-send">' + esc(T('send')) + '</button>') +
              '</div>';
            el('rq-back').addEventListener('click', function () { S.openRequest = null; renderShell(); });
            var sendBtn = el('rq-send');
            if (sendBtn) sendBtn.addEventListener('click', function () {
                var body = (el('rq-reply').value || '').trim();
                if (!body) { toast(T('required'), true); return; }
                sendBtn.disabled = true;
                rpc('partner_add_request_comment', { p_request_id: id, p_body: body, p_internal: false })
                    .then(function (res) {
                        if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                        viewRequestDetail(host, id);
                    }).catch(function (e) {
                        sendBtn.disabled = false; toast(T('failed') + (e.message || e), true);
                    });
            });
        }).catch(function (e) {
            S.openRequest = null;
            host.innerHTML = '<div class="pp-card"><p class="pp-sub">' + esc(T('failed') + (e.message || e)) + '</p></div>';
        });
    }

    // ----------------------------------------------------------- settings --
    function viewSettings(host) {
        var p = (S.boot && S.boot.partner) || {};
        var ag = (S.boot && S.boot.agreement) || null;
        var b = (S.boot && S.boot.branding) || {};
        var c = p.company || {};
        var L = partnerLinks();
        var plan = (ag && ag.commission_plan) || {};

        host.innerHTML =
          '<div class="pp-card"><h2>' + esc(T('secAgreement')) + '</h2>' +
            (ag && ag.status === 'accepted'
              ? '<p class="pp-sub">' + esc(T('acceptedOn', {
                    date: when(ag.accepted_at),
                    name: (ag.acceptance && ag.acceptance.typed_name) || '—'
                })) + '</p>' +
                (plan.rate_pct != null ? '<div class="pp-note">' + esc(T('rateLine', { rate: plan.rate_pct })) + '</div>' : '') +
                '<p class="pp-sub" style="margin:0;">' + esc(T('supportOwner')) + ': <strong>' +
                  esc((plan.support_owner || p.support_owner) === 'partner' ? T('youOwnSupport') : T('weOwnSupport')) +
                '</strong></p>'
              : '<div class="pp-note warn">' + esc(T('noTemplate')) + '</div>') +
          '</div>' +

          '<div class="pp-card"><h2>' + esc(T('secCompany')) + '</h2>' +
            '<label class="pp-field"><span>' + esc(T('legalName')) + '</span><input id="st-legal" value="' + esc(p.legal_name || '') + '"></label>' +
            '<label class="pp-field"><span>' + esc(T('displayName')) + '</span><input id="st-display" value="' + esc(p.display_name || '') + '"></label>' +
            '<div class="pp-grid">' +
              '<label class="pp-field"><span>' + esc(T('country')) + '</span><input id="st-country" value="' + esc(c.country || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('website')) + '</span><input id="st-website" value="' + esc(c.website || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('taxId')) + '</span><input id="st-tax" value="' + esc(c.tax_id || '') + '"></label>' +
            '</div>' +
            '<button class="pp-btn primary" id="st-save-company">' + esc(T('save')) + '</button>' +
          '</div>' +

          '<div class="pp-card"><h2>' + esc(T('secBranding')) + '</h2>' +
            '<p class="pp-sub">' + esc(T('brandingSub')) + '</p>' +
            '<label class="pp-field"><span>' + esc(T('displayName')) + '</span><input id="st-bname" value="' + esc(b.display_name || '') + '"></label>' +
            '<label class="pp-field"><span>' + esc(T('logoUrl')) + '</span><input id="st-logo" type="url" value="' + esc(b.logo_url || '') + '"></label>' +
            '<div class="pp-grid">' +
              '<label class="pp-field"><span>' + esc(T('primaryColour')) + '</span><input id="st-colour" type="color" value="' + esc(b.primary_color || '#2c718a') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('supportEmail')) + '</span><input id="st-semail" type="email" value="' + esc(b.support_email || '') + '"></label>' +
              '<label class="pp-field"><span>' + esc(T('attribution')) + '</span><select id="st-powered">' +
                '<option value="partner"' + (b.powered_by === 'partner' ? ' selected' : '') + '>' + esc(T('attrPartner')) + '</option>' +
                '<option value="digitivia"' + (b.powered_by !== 'partner' && b.powered_by !== 'none' ? ' selected' : '') + '>' + esc(T('attrDigitivia')) + '</option>' +
                '<option value="none"' + (b.powered_by === 'none' ? ' selected' : '') + '>' + esc(T('attrNone')) + '</option>' +
              '</select></label>' +
            '</div>' +
            '<button class="pp-btn primary" id="st-save-brand">' + esc(T('save')) + '</button>' +
          '</div>' +

          '<div class="pp-card"><h2>' + esc(T('secLinks')) + '</h2>' +
            copyRow(T('loginLink'), L.login) +
            copyRow(T('signupLink'), L.signup, T('signupLinkHint')) +
            '<div class="pp-note warn" style="margin-bottom:0;">' + esc(T('domainLater')) + '</div>' +
          '</div>';

        wireCopy(host);

        el('st-save-company').addEventListener('click', function () {
            var btn = el('st-save-company'); btn.disabled = true;
            rpc('partner_update_profile', { p: {
                legal_name: (el('st-legal').value || '').trim(),
                display_name: (el('st-display').value || '').trim(),
                company: { country: (el('st-country').value || '').trim(),
                           website: (el('st-website').value || '').trim(),
                           tax_id: (el('st-tax').value || '').trim() }
            }}).then(function (res) {
                btn.disabled = false;
                if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                toast(T('saved'));
                return loadPortal();
            }).catch(function (e) { btn.disabled = false; toast(T('failed') + (e.message || e), true); });
        });

        el('st-save-brand').addEventListener('click', function () {
            var btn = el('st-save-brand'); btn.disabled = true;
            rpc('partner_update_branding', { p: {
                display_name: (el('st-bname').value || '').trim() || null,
                logo_url: (el('st-logo').value || '').trim() || null,
                primary_color: el('st-colour').value || null,
                support_email: (el('st-semail').value || '').trim() || null,
                powered_by: el('st-powered').value
            }}).then(function (res) {
                btn.disabled = false;
                if (!res || res.success !== true) throw new Error((res && res.error) || 'failed');
                toast(T('saved'));
                return loadPortal();
            }).catch(function (e) { btn.disabled = false; toast(T('failed') + (e.message || e), true); });
        });
    }

    window.PartnerPortal = { start: start, _t: T, _md: md, _money: money, _state: S };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
