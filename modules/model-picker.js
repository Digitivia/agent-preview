/* Digitivia — AI model picker.
 *
 * The old control was a <select> of five options, four of which ran the same
 * model. The names in it also meant nothing to the people who actually use
 * this: business owners choosing how their assistant should answer customers.
 *
 * So each card shows exactly what someone deciding needs: the vendor's real
 * logo, the model's name, the exact catalog id (what the resolver and the
 * bill use), one plain sentence per tier, and an honest "High usage cost"
 * badge on the premium tier. Deliberately absent: prices, token counts,
 * context windows, vendor marketing. Cost is governed by the plan's AI
 * allowance, which has its own meter.
 *
 * The catalog is ai_models, read once per page load and shared by every agent
 * tab. Selection writes agent_configs.model_id / .comment_model_id, which
 * resolve_agent_model() then honours for that channel.
 *
 * PLAN LOCKS (SPEC §8.7a). A model whose min_plan_rank is above the org's plan
 * rank (the free trial is rank 0) is still shown, in its usual place, never
 * hidden or dimmed out of reach: it carries a "Paid plans only" mark and the
 * cheapest plan that unlocks it, and a click opens the Upgrade Moment instead
 * of selecting it. Nothing is written. Until the rank is known (or for any
 * paying org) nothing is locked, so a paying picker looks exactly as before.
 */
(function () {
    'use strict';

    var CATALOG = null;          // resolved catalog (non-empty) or null if not loaded/failed
    var CATALOG_PROMISE = null;  // in-flight load, so N tabs cause one query
    var CATALOG_FAILED = false;  // last load finished and failed (so render shows the error, not a spinner)
    var MOUNTS = Object.create(null); // key -> { el, value, onChange }
    var PLAN_RANK = null;        // org plan rank from get_org_entitlements; null = unknown, nothing locked

    function lang() {
        return (typeof currentLang !== 'undefined' && currentLang === 'ar') ? 'ar' : 'en';
    }
    function isRtl() { return lang() === 'ar'; }

    var TEXT = {
        en: {
            auto: 'Automatic',
            autoDesc: 'We pick a fast, capable model for you. Best choice if you are not sure.',
            recommended: 'Recommended',
            groupFast: 'Fast and efficient',
            groupBalanced: 'Balanced',
            groupCapable: 'Most capable',
            tier_essential: 'Fast and low cost. Great for everyday replies and busy pages.',
            tier_balanced: 'Balanced choice — good quality at a fair cost.',
            tier_advanced: 'The smartest replies for complex conversations. Best quality.',
            tier_image: 'Creates your post image from the prompt you write.',
            groupImage: 'Image models',
            pickerLabel: 'AI model',
            highCost: 'High usage cost',
            selected: 'Selected',
            loading: 'Loading models…',
            failed: 'Could not load the model list. Your current choice is unchanged.',
            change: 'Change',
            usedNow: 'In use',
            paidOnly: 'Paid plans only',
            starter: 'Starter',
            lockNote: 'Models marked Paid plans only unlock with any paid plan. Your free trial uses fast, low cost models.',
            lockTitle: 'This model needs a paid plan',
            lockBody: '{model} is available starting with the Starter plan, our cheapest paid plan. Your free trial uses fast, low cost models so everyone gets a real trial.',
            seePlans: 'See plans',
            notNow: 'Not now'
        },
        ar: {
            auto: 'تلقائي',
            autoDesc: 'نختار لك نموذجًا سريعًا وقويًا. الخيار الأفضل إذا لم تكن متأكدًا.',
            recommended: 'موصى به',
            groupFast: 'سريع وفعّال',
            groupBalanced: 'متوازن',
            groupCapable: 'الأقوى',
            tier_essential: 'سريع وبتكلفة منخفضة. ممتاز للردود اليومية والصفحات النشطة.',
            tier_balanced: 'خيار متوازن — جودة جيدة بتكلفة معقولة.',
            tier_advanced: 'أذكى الردود للمحادثات المعقدة. أفضل جودة.',
            tier_image: 'ينشئ صورة المنشور من الوصف الذي تكتبه.',
            groupImage: 'نماذج الصور',
            pickerLabel: 'نموذج الذكاء الاصطناعي',
            highCost: 'استهلاك مرتفع للرصيد',
            selected: 'مختار',
            loading: 'جارٍ تحميل النماذج…',
            failed: 'تعذر تحميل قائمة النماذج. اختيارك الحالي لم يتغير.',
            change: 'تغيير',
            usedNow: 'قيد الاستخدام',
            paidOnly: 'الخطط المدفوعة فقط',
            starter: 'المبتدئ',
            lockNote: 'الموديلات المكتوب عليها الخطط المدفوعة فقط بتتفتح مع أي خطة مدفوعة. التجربة المجانية بتستخدم موديلات سريعة وسعرها بسيط.',
            lockTitle: 'الموديل ده محتاج خطة مدفوعة',
            lockBody: '{model} متاح بداية من خطة المبتدئ، أرخص خطة مدفوعة عندنا. فترة التجربة المجانية بتستخدم موديلات سريعة وسعرها بسيط عشان الكل ياخد تجربة حقيقية.',
            seePlans: 'شوف الخطط',
            notNow: 'مش دلوقتي'
        }
    };
    function tx(key) { return (TEXT[lang()] && TEXT[lang()][key]) || TEXT.en[key] || key; }

    /* Native vendor marks, embedded verbatim from the vendors' published
     * SVGs (via @lobehub/icons-static-svg 1.94.0) - not redrawn, not
     * composed. Monochrome marks use currentColor so they follow the
     * theme; colored marks keep their brand colors. */
    var VENDOR_LOGOS = {
        'OpenAI': '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"></path></svg>',
        'Anthropic': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"></path></svg>',
        'Google': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#lobe-icons-gemini-0-_R_0_)"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#lobe-icons-gemini-1-_R_0_)"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#lobe-icons-gemini-2-_R_0_)"></path><defs><linearGradient gradientUnits="userSpaceOnUse" id="lobe-icons-gemini-0-_R_0_" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"></stop><stop offset="1" stop-color="#08B962" stop-opacity="0"></stop></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="lobe-icons-gemini-1-_R_0_" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"></stop><stop offset="1" stop-color="#F94543" stop-opacity="0"></stop></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="lobe-icons-gemini-2-_R_0_" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"></stop><stop offset=".46" stop-color="#FABC12" stop-opacity="0"></stop></linearGradient></defs></svg>',
        'DeepSeek': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z" fill="#4D6BFE"></path></svg>',
        'Qwen': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z" fill="url(#lobe-icons-qwen-_R_0_)" fill-rule="nonzero"></path><defs><linearGradient id="lobe-icons-qwen-_R_0_" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#6336E7" stop-opacity=".84"></stop><stop offset="100%" stop-color="#6F69F7" stop-opacity=".84"></stop></linearGradient></defs></svg>',
        'MiniMax': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lobe-icons-minimax-_R_0_" x1="0%" x2="100.182%" y1="50.057%" y2="50.057%"><stop offset="0%" stop-color="#E2167E"></stop><stop offset="100%" stop-color="#FE603C"></stop></linearGradient></defs><path d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z" fill="url(#lobe-icons-minimax-_R_0_)" fill-rule="nonzero"></path></svg>',
        'Meta': '<svg height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M6.897 4h-.024l-.031 2.615h.022c1.715 0 3.046 1.357 5.94 6.246l.175.297.012.02 1.62-2.438-.012-.019a48.763 48.763 0 00-1.098-1.716 28.01 28.01 0 00-1.175-1.629C10.413 4.932 8.812 4 6.896 4z" fill="url(#lobe-icons-meta-0-_R_0_)"></path><path d="M6.873 4C4.95 4.01 3.247 5.258 2.02 7.17a4.352 4.352 0 00-.01.017l2.254 1.231.011-.017c.718-1.083 1.61-1.774 2.568-1.785h.021L6.896 4h-.023z" fill="url(#lobe-icons-meta-1-_R_0_)"></path><path d="M2.019 7.17l-.011.017C1.2 8.447.598 9.995.274 11.664l-.005.022 2.534.6.004-.022c.27-1.467.786-2.828 1.456-3.845l.011-.017L2.02 7.17z" fill="url(#lobe-icons-meta-2-_R_0_)"></path><path d="M2.807 12.264l-2.533-.6-.005.022c-.177.918-.267 1.851-.269 2.786v.023l2.598.233v-.023a12.591 12.591 0 01.21-2.44z" fill="url(#lobe-icons-meta-3-_R_0_)"></path><path d="M2.677 15.537a5.462 5.462 0 01-.079-.813v-.022L0 14.468v.024a8.89 8.89 0 00.146 1.652l2.535-.585a4.106 4.106 0 01-.004-.022z" fill="url(#lobe-icons-meta-4-_R_0_)"></path><path d="M3.27 16.89c-.284-.31-.484-.756-.589-1.328l-.004-.021-2.535.585.004.021c.192 1.01.568 1.85 1.106 2.487l.014.017 2.018-1.745a2.106 2.106 0 01-.015-.016z" fill="url(#lobe-icons-meta-5-_R_0_)"></path><path d="M10.78 9.654c-1.528 2.35-2.454 3.825-2.454 3.825-2.035 3.2-2.739 3.917-3.871 3.917a1.545 1.545 0 01-1.186-.508l-2.017 1.744.014.017C2.01 19.518 3.058 20 4.356 20c1.963 0 3.374-.928 5.884-5.33l1.766-3.13a41.283 41.283 0 00-1.227-1.886z" fill="#0082FB"></path><path d="M13.502 5.946l-.016.016c-.4.43-.786.908-1.16 1.416.378.483.768 1.024 1.175 1.63.48-.743.928-1.345 1.367-1.807l.016-.016-1.382-1.24z" fill="url(#lobe-icons-meta-6-_R_0_)"></path><path d="M20.918 5.713C19.853 4.633 18.583 4 17.225 4c-1.432 0-2.637.787-3.723 1.944l-.016.016 1.382 1.24.016-.017c.715-.747 1.408-1.12 2.176-1.12.826 0 1.6.39 2.27 1.075l.015.016 1.589-1.425-.016-.016z" fill="#0082FB"></path><path d="M23.998 14.125c-.06-3.467-1.27-6.566-3.064-8.396l-.016-.016-1.588 1.424.015.016c1.35 1.392 2.277 3.98 2.361 6.971v.023h2.292v-.022z" fill="url(#lobe-icons-meta-7-_R_0_)"></path><path d="M23.998 14.15v-.023h-2.292v.022c.004.14.006.282.006.424 0 .815-.121 1.474-.368 1.95l-.011.022 1.708 1.782.013-.02c.62-.96.946-2.293.946-3.91 0-.083 0-.165-.002-.247z" fill="url(#lobe-icons-meta-8-_R_0_)"></path><path d="M21.344 16.52l-.011.02c-.214.402-.519.67-.917.787l.778 2.462a3.493 3.493 0 00.438-.182 3.558 3.558 0 001.366-1.218l.044-.065.012-.02-1.71-1.784z" fill="url(#lobe-icons-meta-9-_R_0_)"></path><path d="M19.92 17.393c-.262 0-.492-.039-.718-.14l-.798 2.522c.449.153.927.222 1.46.222.492 0 .943-.073 1.352-.215l-.78-2.462c-.167.05-.341.075-.517.073z" fill="url(#lobe-icons-meta-10-_R_0_)"></path><path d="M18.323 16.534l-.014-.017-1.836 1.914.016.017c.637.682 1.246 1.105 1.937 1.337l.797-2.52c-.291-.125-.573-.353-.9-.731z" fill="url(#lobe-icons-meta-11-_R_0_)"></path><path d="M18.309 16.515c-.55-.642-1.232-1.712-2.303-3.44l-1.396-2.336-.011-.02-1.62 2.438.012.02.989 1.668c.959 1.61 1.74 2.774 2.493 3.585l.016.016 1.834-1.914a2.353 2.353 0 01-.014-.017z" fill="url(#lobe-icons-meta-12-_R_0_)"></path><defs><linearGradient id="lobe-icons-meta-0-_R_0_" x1="75.897%" x2="26.312%" y1="89.199%" y2="12.194%"><stop offset=".06%" stop-color="#0867DF"></stop><stop offset="45.39%" stop-color="#0668E1"></stop><stop offset="85.91%" stop-color="#0064E0"></stop></linearGradient><linearGradient id="lobe-icons-meta-1-_R_0_" x1="21.67%" x2="97.068%" y1="75.874%" y2="23.985%"><stop offset="13.23%" stop-color="#0064DF"></stop><stop offset="99.88%" stop-color="#0064E0"></stop></linearGradient><linearGradient id="lobe-icons-meta-2-_R_0_" x1="38.263%" x2="60.895%" y1="89.127%" y2="16.131%"><stop offset="1.47%" stop-color="#0072EC"></stop><stop offset="68.81%" stop-color="#0064DF"></stop></linearGradient><linearGradient id="lobe-icons-meta-3-_R_0_" x1="47.032%" x2="52.15%" y1="90.19%" y2="15.745%"><stop offset="7.31%" stop-color="#007CF6"></stop><stop offset="99.43%" stop-color="#0072EC"></stop></linearGradient><linearGradient id="lobe-icons-meta-4-_R_0_" x1="52.155%" x2="47.591%" y1="58.301%" y2="37.004%"><stop offset="7.31%" stop-color="#007FF9"></stop><stop offset="100%" stop-color="#007CF6"></stop></linearGradient><linearGradient id="lobe-icons-meta-5-_R_0_" x1="37.689%" x2="61.961%" y1="12.502%" y2="63.624%"><stop offset="7.31%" stop-color="#007FF9"></stop><stop offset="100%" stop-color="#0082FB"></stop></linearGradient><linearGradient id="lobe-icons-meta-6-_R_0_" x1="34.808%" x2="62.313%" y1="68.859%" y2="23.174%"><stop offset="27.99%" stop-color="#007FF8"></stop><stop offset="91.41%" stop-color="#0082FB"></stop></linearGradient><linearGradient id="lobe-icons-meta-7-_R_0_" x1="43.762%" x2="57.602%" y1="6.235%" y2="98.514%"><stop offset="0%" stop-color="#0082FB"></stop><stop offset="99.95%" stop-color="#0081FA"></stop></linearGradient><linearGradient id="lobe-icons-meta-8-_R_0_" x1="60.055%" x2="39.88%" y1="4.661%" y2="69.077%"><stop offset="6.19%" stop-color="#0081FA"></stop><stop offset="100%" stop-color="#0080F9"></stop></linearGradient><linearGradient id="lobe-icons-meta-9-_R_0_" x1="30.282%" x2="61.081%" y1="59.32%" y2="33.244%"><stop offset="0%" stop-color="#027AF3"></stop><stop offset="100%" stop-color="#0080F9"></stop></linearGradient><linearGradient id="lobe-icons-meta-10-_R_0_" x1="20.433%" x2="82.112%" y1="50.001%" y2="50.001%"><stop offset="0%" stop-color="#0377EF"></stop><stop offset="99.94%" stop-color="#0279F1"></stop></linearGradient><linearGradient id="lobe-icons-meta-11-_R_0_" x1="40.303%" x2="72.394%" y1="35.298%" y2="57.811%"><stop offset=".19%" stop-color="#0471E9"></stop><stop offset="100%" stop-color="#0377EF"></stop></linearGradient><linearGradient id="lobe-icons-meta-12-_R_0_" x1="32.254%" x2="68.003%" y1="19.719%" y2="84.908%"><stop offset="27.65%" stop-color="#0867DF"></stop><stop offset="100%" stop-color="#0471E9"></stop></linearGradient></defs></svg>',
        'xAI': '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"></path></svg>',
        'Z.ai': '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z"></path></svg>',
        'Moonshot': '<svg fill="currentColor" fill-rule="evenodd" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M1.052 16.916l9.539 2.552a21.007 21.007 0 00.06 2.033l5.956 1.593a11.997 11.997 0 01-5.586.865l-.18-.016-.044-.004-.084-.009-.094-.01a11.605 11.605 0 01-.157-.02l-.107-.014-.11-.016a11.962 11.962 0 01-.32-.051l-.042-.008-.075-.013-.107-.02-.07-.015-.093-.019-.075-.016-.095-.02-.097-.023-.094-.022-.068-.017-.088-.022-.09-.024-.095-.025-.082-.023-.109-.03-.062-.02-.084-.025-.093-.028-.105-.034-.058-.019-.08-.026-.09-.031-.066-.024a6.293 6.293 0 01-.044-.015l-.068-.025-.101-.037-.057-.022-.08-.03-.087-.035-.088-.035-.079-.032-.095-.04-.063-.028-.063-.027a5.655 5.655 0 01-.041-.018l-.066-.03-.103-.047-.052-.024-.096-.046-.062-.03-.084-.04-.086-.044-.093-.047-.052-.027-.103-.055-.057-.03-.058-.032a6.49 6.49 0 01-.046-.026l-.094-.053-.06-.034-.051-.03-.072-.041-.082-.05-.093-.056-.052-.032-.084-.053-.061-.039-.079-.05-.07-.047-.053-.035a7.785 7.785 0 01-.054-.036l-.044-.03-.044-.03a6.066 6.066 0 01-.04-.028l-.057-.04-.076-.054-.069-.05-.074-.054-.056-.042-.076-.057-.076-.059-.086-.067-.045-.035-.064-.052-.074-.06-.089-.073-.046-.039-.046-.039a7.516 7.516 0 01-.043-.037l-.045-.04-.061-.053-.07-.062-.068-.06-.062-.058-.067-.062-.053-.05-.088-.084a13.28 13.28 0 01-.099-.097l-.029-.028-.041-.042-.069-.07-.05-.051-.05-.053a6.457 6.457 0 01-.168-.179l-.08-.088-.062-.07-.071-.08-.042-.049-.053-.062-.058-.068-.046-.056a7.175 7.175 0 01-.027-.033l-.045-.055-.066-.082-.041-.052-.05-.064-.02-.025a11.99 11.99 0 01-1.44-2.402zm-1.02-5.794l11.353 3.037a20.468 20.468 0 00-.469 2.011l10.817 2.894a12.076 12.076 0 01-1.845 2.005L.657 15.923l-.016-.046-.035-.104a11.965 11.965 0 01-.05-.153l-.007-.023a11.896 11.896 0 01-.207-.741l-.03-.126-.018-.08-.021-.097-.018-.081-.018-.09-.017-.084-.018-.094c-.026-.141-.05-.283-.071-.426l-.017-.118-.011-.083-.013-.102a12.01 12.01 0 01-.019-.161l-.005-.047a12.12 12.12 0 01-.034-2.145zm1.593-5.15l11.948 3.196c-.368.605-.705 1.231-1.01 1.875l11.295 3.022c-.142.82-.368 1.612-.668 2.365l-11.55-3.09L.124 10.26l.015-.1.008-.049.01-.067.015-.087.018-.098c.026-.148.056-.295.088-.442l.028-.124.02-.085.024-.097c.022-.09.045-.18.07-.268l.028-.102.023-.083.03-.1.025-.082.03-.096.026-.082.031-.095a11.896 11.896 0 011.01-2.232zm4.442-4.4L17.352 4.59a20.77 20.77 0 00-1.688 1.721l7.823 2.093c.267.852.442 1.744.513 2.665L2.106 5.213l.045-.065.027-.04.04-.055.046-.065.055-.076.054-.072.064-.086.05-.065.057-.073.055-.07.06-.074.055-.069.065-.077.054-.066.066-.077.053-.06.072-.082.053-.06.067-.074.054-.058.073-.078.058-.06.063-.067.168-.17.1-.098.059-.056.076-.071a12.084 12.084 0 012.272-1.677zM12.017 0h.097l.082.001.069.001.054.002.068.002.046.001.076.003.047.002.06.003.054.002.087.005.105.007.144.011.088.007.044.004.077.008.082.008.047.005.102.012.05.006.108.014.081.01.042.006.065.01.207.032.07.012.065.011.14.026.092.018.11.022.046.01.075.016.041.01L14.7.3l.042.01.065.015.049.012.071.017.096.024.112.03.113.03.113.032.05.015.07.02.078.024.073.023.05.016.05.016.076.025.099.033.102.036.048.017.064.023.093.034.11.041.116.045.1.04.047.02.06.024.041.018.063.026.04.018.057.025.11.048.1.046.074.035.075.036.06.028.092.046.091.045.102.052.053.028.049.026.046.024.06.033.041.022.052.029.088.05.106.06.087.051.057.034.053.032.096.059.088.055.098.062.036.024.064.041.084.056.04.027.062.042.062.043.023.017c.054.037.108.075.161.114l.083.06.065.048.056.043.086.065.082.064.04.03.05.041.086.069.079.065.085.071c.712.6 1.353 1.283 1.909 2.031L7.222.994l.062-.027.065-.028.081-.034.086-.035c.113-.045.227-.09.341-.131l.096-.035.093-.033.084-.03.096-.031c.087-.03.176-.058.264-.085l.091-.027.086-.025.102-.03.085-.023.1-.026L9.04.37l.09-.023.091-.022.095-.022.09-.02.098-.021.091-.02.095-.018.092-.018.1-.018.091-.016.098-.017.092-.014.097-.015.092-.013.102-.013.091-.012.105-.012.09-.01.105-.01c.093-.01.186-.018.28-.024l.106-.008.09-.005.11-.006.093-.004.1-.004.097-.002.099-.002.197-.002z"></path></svg>',
    };

    var GROUPS = [
        { tier: 'essential', label: 'groupFast' },
        { tier: 'balanced', label: 'groupBalanced' },
        { tier: 'advanced', label: 'groupCapable' }
    ];

    function injectStyles() {
        if (document.getElementById('dmp-styles')) return;
        var css = [
            /* --accent has no global :root definition in the app (it lived only
               under .whatsapp-theme), so every var(--accent,#7c5cff) below fell
               to a stray purple. Bind it to the app's real theme color on the
               picker container so borders, tints and badges match the brand. */
            '.dmp-wrap{display:block;--accent:var(--theme-color,#6d6bd9);}',
            '.dmp-group{margin-block-start:14px;}',
            '.dmp-group:first-child{margin-block-start:0;}',
            '.dmp-group-title{font-size:0.72rem;letter-spacing:0.04em;text-transform:uppercase;',
            'color:var(--text-secondary);margin-block-end:8px;font-weight:600;}',
            /* auto-fit rather than a fixed count: at 320px this is one column,
               and it never needs a media query to stay readable. */
            '.dmp-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(172px,1fr));}',
            '.dmp-card{position:relative;display:flex;flex-direction:column;gap:8px;',
            'padding:12px 14px;border-radius:12px;cursor:pointer;text-align:start;',
            'background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.10);',
            'transition:border-color .15s ease, background .15s ease;min-inline-size:0;}',
            '.dmp-card:hover{border-color:rgba(255,255,255,0.24);}',
            '.dmp-card:focus-visible{outline:2px solid var(--accent,#7c5cff);outline-offset:2px;}',
            '.dmp-card[aria-pressed="true"]{border-color:var(--accent,#7c5cff);',
            'background:color-mix(in srgb, var(--accent,#7c5cff) 12%, transparent);}',
            ':root[data-theme="light"] .dmp-card{background:rgba(0,0,0,0.03);border-color:rgba(0,0,0,0.10);}',
            ':root[data-theme="light"] .dmp-card:hover{border-color:rgba(0,0,0,0.24);}',
            /* The light-theme .dmp-card rule above out-specifies the plain
               [aria-pressed] selected rule, so a selected card looked
               unselected in light mode (the app default). Re-assert the accent
               border + tint at matching specificity. */
            ':root[data-theme="light"] .dmp-card[aria-pressed="true"]{',
            'border-color:var(--accent,#6d6bd9);',
            'background:color-mix(in srgb, var(--accent,#6d6bd9) 12%, transparent);}',
            '.dmp-head{display:block;min-inline-size:0;}',
            '.dmp-titlerow{display:flex;align-items:center;gap:7px;min-inline-size:0;}',
            /* Vendor mark, exactly as published: sized by font-size since the
               SVGs are 1em x 1em. currentColor marks inherit the text color. */
            '.dmp-logo{display:inline-flex;flex-shrink:0;font-size:18px;',
            'color:var(--text-primary);line-height:1;}',
            /* min-inline-size:0 lets the name shrink instead of rendering at
               full intrinsic width under the absolutely-positioned badge at
               the grid's 172px floor (the badge used to paint over the name). */
            '.dmp-name{display:block;font-size:0.92rem;font-weight:600;line-height:1.25;',
            'color:var(--text-primary);overflow-wrap:break-word;min-inline-size:0;}',
            /* Honest cost flag for the premium tier - a word, not a price. */
            '.dmp-cost{align-self:flex-start;font-size:0.64rem;font-weight:600;',
            'padding:2px 8px;border-radius:999px;color:#b45309;',
            'background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.35);}',
            ':root:not([data-theme="light"]) .dmp-cost{color:#fbbf24;}',
            /* The real catalog id, small under the name — customers asked for
               the exact identifier, not a marketing alias. Always LTR: ids are
               latin even when the UI is Arabic. */
            '.dmp-id{display:block;direction:ltr;text-align:start;unicode-bidi:embed;',
            'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;',
            'font-size:0.66rem;color:var(--text-secondary);margin-block-start:3px;',
            'overflow-wrap:anywhere;}',
            '.dmp-desc{font-size:0.75rem;color:var(--text-secondary);line-height:1.45;}',
            '.dmp-card{padding-inline-end:14px;}',
            '.dmp-card:has(.dmp-badge) .dmp-head{padding-inline-end:76px;}',
            '.dmp-badge{position:absolute;inset-block-start:10px;inset-inline-end:10px;',
            'font-size:0.62rem;font-weight:600;padding:2px 7px;border-radius:999px;',
            'background:var(--accent,#7c5cff);color:#fff;white-space:nowrap;}',
            '.dmp-note{font-size:0.75rem;color:var(--text-secondary);padding:10px 0;}',
            /* The card is a button; strip the UA look without losing semantics. */
            '.dmp-card{appearance:none;font:inherit;color:inherit;inline-size:100%;}',
            /* A locked card stays fully readable; only the mark says why. */
            '.dmp-card.dmp-locked{border-style:dashed;}',
            '.dmp-plan{align-self:flex-start;display:inline-flex;align-items:center;gap:5px;',
            'font-size:0.64rem;font-weight:600;padding:2px 8px;border-radius:999px;',
            'color:var(--text-primary);background:color-mix(in srgb, var(--accent,#6d6bd9) 16%, transparent);',
            'border:1px solid color-mix(in srgb, var(--accent,#6d6bd9) 40%, transparent);}',
            '.dmp-lock-note{font-size:0.75rem;color:var(--text-secondary);margin-block-end:10px;line-height:1.5;}'
        ].join('');
        var style = document.createElement('style');
        style.id = 'dmp-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* The colored marks (Meta, Qwen, MiniMax, Gemini) define gradients in
     * <defs> with fixed ids. Inlined once per card across every agent tab,
     * those ids collide, and url(#id) then resolves against the FIRST copy in
     * the document - often inside a hidden tab, where the gradient is
     * unrenderable: Qwen and MiniMax painted nothing, Meta lost its colors.
     * Every instance therefore gets its own id namespace. */
    var LOGO_SEQ = 0;
    function logoHtml(vendor) {
        var svg = VENDOR_LOGOS[vendor];
        if (!svg) return '';
        if (svg.indexOf('_R_0_') === -1) return svg;
        return svg.replace(/_R_0_/g, 'dmpl' + (++LOGO_SEQ) + '_');
    }

    /* One card. `model` null means the Auto card.
     * Deliberately plain: the display name, the real catalog id underneath
     * (what the resolver and the bill actually use), and one sentence in
     * plain words about what the tier means. No meters, no chips, no jargon —
     * a shop owner with no AI knowledge must be able to choose. */
    function isLocked(model) {
        if (!model || PLAN_RANK === null) return false;
        var need = Number(model.min_plan_rank);
        if (!isFinite(need)) need = 1;
        return need > PLAN_RANK;
    }

    function cardHtml(key, model, selectedValue) {
        var value = model ? model.model_id : '';
        var isSel = String(selectedValue || '') === value;
        var locked = isLocked(model);
        var name = model ? model.display_name : tx('auto');
        var desc = model
            ? ((model.modality || 'text') === 'image' ? tx('tier_image') : tx('tier_' + model.tier))
            : tx('autoDesc');

        var html = '<button type="button" class="dmp-card' + (locked ? ' dmp-locked' : '') + '" role="radio"' +
            ' aria-checked="' + (isSel ? 'true' : 'false') + '"' +
            ' aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
            (locked ? ' aria-disabled="true"' : '') +
            ' aria-label="' + escapeHtml(locked ? name + ', ' + tx('paidOnly') : name) + '"' +
            ' data-dmp-key="' + escapeHtml(key) + '"' +
            ' data-dmp-value="' + escapeHtml(value) + '"' +
            (locked ? ' data-dmp-locked="1"' : '') + '>';

        if (!model) html += '<span class="dmp-badge">' + escapeHtml(tx('recommended')) + '</span>';
        else if (locked) html += '<span class="dmp-badge">' + escapeHtml(tx('paidOnly')) + '</span>';
        else if (isSel) html += '<span class="dmp-badge">' + escapeHtml(tx('usedNow')) + '</span>';

        var logo = model ? logoHtml(model.vendor) : null;
        html += '<span class="dmp-head">';
        html += '<span class="dmp-titlerow">';
        if (logo) html += '<span class="dmp-logo" aria-hidden="true">' + logo + '</span>';
        html += '<span class="dmp-name">' + escapeHtml(name) + '</span>';
        html += '</span>';
        if (model) html += '<span class="dmp-id">' + escapeHtml(model.model_id) + '</span>';
        html += '</span>';
        html += '<span class="dmp-desc">' + escapeHtml(desc) + '</span>';
        if (locked) {
            // For the plan that unlocks it, the premium mark replaces the cost
            // chip: on the trial "locked" and "high cost" are the same cards.
            html += '<span class="dmp-plan" data-feature="locked-model-cards">' +
                '<span aria-hidden="true">✦</span>' + escapeHtml(tx('starter')) + '</span>';
        } else if (model && model.high_cost) {
            html += '<span class="dmp-cost">' + escapeHtml(tx('highCost')) + '</span>';
        }
        html += '</button>';
        return html;
    }

    function render(key) {
        var mount = MOUNTS[key];
        if (!mount || !mount.el) return;
        var el = mount.el;

        if (!CATALOG) {
            // Null = never loaded, or the last load failed (now retryable).
            // A load that has finished-and-failed shows the error; one still
            // in flight shows the loading note.
            el.innerHTML = '<div class="dmp-note">' +
                escapeHtml(CATALOG_FAILED ? tx('failed') : tx('loading')) + '</div>';
            return;
        }

        var modality = mount.modality || 'text';
        var pool = CATALOG.filter(function (m) { return (m.modality || 'text') === modality; });
        if (pool.length === 0) {
            el.innerHTML = '<div class="dmp-note">' + escapeHtml(tx('failed')) + '</div>';
            return;
        }

        var html = '<div class="dmp-wrap" role="radiogroup" aria-label="' +
            escapeHtml(tx('pickerLabel')) + '" dir="' + (isRtl() ? 'rtl' : 'ltr') + '">';

        if (pool.some(isLocked)) {
            html += '<div data-feature-notice="locked-model-cards"></div>' +
                '<p class="dmp-lock-note">' + escapeHtml(tx('lockNote')) + '</p>';
        }

        // Auto always first: it is the right answer for most people and the
        // default the resolver falls back to.
        html += '<div class="dmp-group"><div class="dmp-grid">' +
            cardHtml(key, null, mount.value) + '</div></div>';

        if (modality === 'image') {
            // The image catalog is one flat group, not capability tiers.
            html += '<div class="dmp-group"><div class="dmp-group-title">' +
                escapeHtml(tx('groupImage')) + '</div><div class="dmp-grid">';
            pool.forEach(function (m) { html += cardHtml(key, m, mount.value); });
            html += '</div></div>';
        } else {
            GROUPS.forEach(function (g) {
                var rows = pool.filter(function (m) { return m.tier === g.tier; });
                if (!rows.length) return;
                html += '<div class="dmp-group"><div class="dmp-group-title">' +
                    escapeHtml(tx(g.label)) + '</div><div class="dmp-grid">';
                rows.forEach(function (m) { html += cardHtml(key, m, mount.value); });
                html += '</div></div>';
            });
        }

        html += '</div>';
        el.innerHTML = html;
    }

    // One delegated listener for every picker on the page, so re-rendering a
    // tab never leaves a stale handler behind.
    function onClick(ev) {
        var card = ev.target && ev.target.closest ? ev.target.closest('.dmp-card') : null;
        if (!card) return;
        var key = card.getAttribute('data-dmp-key');
        var mount = MOUNTS[key];
        if (!mount) return;
        var next = card.getAttribute('data-dmp-value') || '';
        if (card.getAttribute('data-dmp-locked') === '1') {
            // Never selects, never saves: the Upgrade Moment explains instead.
            var model = (CATALOG || []).filter(function (m) { return m.model_id === next; })[0];
            var name = model ? model.display_name : next;
            if (window.Entitlements && typeof window.Entitlements.openUpgradeModal === 'function') {
                window.Entitlements.openUpgradeModal('locked_model', {
                    title: tx('lockTitle'),
                    body: tx('lockBody').split('{model}').join(name),
                    ctaLabel: tx('seePlans'),
                    dismissLabel: tx('notNow')
                });
            }
            return;
        }
        if (next === mount.value) return;
        mount.value = next;
        mount.el.dataset.selectedModel = next;
        render(key);
        if (typeof mount.onChange === 'function') mount.onChange(next);
    }
    document.addEventListener('click', onClick);

    // Arrow-key movement inside the group, so this is usable without a mouse.
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' &&
            ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        var card = ev.target && ev.target.closest ? ev.target.closest('.dmp-card') : null;
        if (!card) return;
        var group = card.closest('.dmp-wrap');
        if (!group) return;
        var cards = Array.prototype.slice.call(group.querySelectorAll('.dmp-card'));
        var i = cards.indexOf(card);
        if (i === -1) return;
        var forward = (ev.key === 'ArrowDown') ||
            (ev.key === (isRtl() ? 'ArrowLeft' : 'ArrowRight'));
        var next = cards[i + (forward ? 1 : -1)];
        if (!next) return;
        ev.preventDefault();
        next.focus();
    });

    function loadCatalog(client) {
        // Only a non-empty catalog is a cached success. An empty result was a
        // FAILED load (network / RLS blip): caching it as CATALOG and short-
        // circuiting here left every picker for the rest of the session stuck
        // on "Could not load the model list", with no retry. Now a failure
        // leaves CATALOG null so the next call re-tries.
        if (CATALOG && CATALOG.length) return Promise.resolve(CATALOG);
        if (CATALOG_PROMISE) return CATALOG_PROMISE;
        CATALOG_FAILED = false;   // a fresh attempt: show the spinner, not the last error
        CATALOG_PROMISE = client
            .from('ai_models')
            .select('model_id, display_name, vendor, tier, sort_order, high_cost, modality, min_plan_rank')
            .eq('enabled', true)
            .order('sort_order', { ascending: true })
            .then(function (res) {
                var ok = res && !res.error && Array.isArray(res.data) && res.data.length > 0;
                // A failed / empty read must not wipe anyone's stored choice and
                // must stay retryable — render the note, leave CATALOG null.
                CATALOG = ok ? res.data : null;
                CATALOG_FAILED = !ok;
                CATALOG_PROMISE = null;
                Object.keys(MOUNTS).forEach(render);
                return CATALOG || [];
            })
            .catch(function () {
                CATALOG = null;
                CATALOG_FAILED = true;
                CATALOG_PROMISE = null;
                Object.keys(MOUNTS).forEach(render);
                return [];
            });
        return CATALOG_PROMISE;
    }

    /* mount({ key, el, value, onChange, modality }) — idempotent per key.
     * modality 'text' (default) or 'image' decides which catalog slice the
     * picker offers. */
    function mount(opts) {
        injectStyles();
        if (!opts || !opts.key || !opts.el) return;
        if (PLAN_RANK === null && window.Entitlements && window.Entitlements.data
            && typeof window.Entitlements.data.plan_rank === 'number') {
            PLAN_RANK = window.Entitlements.data.plan_rank;
        }
        var strValue = String(opts.value || '');
        MOUNTS[opts.key] = {
            el: opts.el,
            value: strValue,
            onChange: opts.onChange,
            modality: opts.modality === 'image' ? 'image' : 'text'
        };
        opts.el.dataset.selectedModel = strValue;
        render(opts.key);
    }

    function setValue(key, value) {
        if (!MOUNTS[key]) return;
        var strValue = String(value || '');
        MOUNTS[key].value = strValue;
        MOUNTS[key].el.dataset.selectedModel = strValue;
        render(key);
    }

    function getValue(key) {
        return MOUNTS[key] ? MOUNTS[key].value : '';
    }

    function setPlanRank(rank) {
        var next = (typeof rank === 'number' && isFinite(rank)) ? rank : null;
        if (next === PLAN_RANK) return;
        PLAN_RANK = next;
        Object.keys(MOUNTS).forEach(render);
        if (typeof window.paintFeatureBadges === 'function') {
            try { window.paintFeatureBadges(); } catch (e) { /* cosmetic */ }
        }
    }

    window.DigitiviaModelPicker = {
        loadCatalog: loadCatalog,
        mount: mount,
        setValue: setValue,
        getValue: getValue,
        setPlanRank: setPlanRank,
        // Exposed for tests and for re-rendering after a language switch.
        _render: render,
        _catalog: function () { return CATALOG; }
    };
}());
