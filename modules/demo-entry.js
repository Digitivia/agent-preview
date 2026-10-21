// Preview-only entry to the UI Demo Mode (demo/). A small link in the bottom-start corner, drawn ONLY on the preview
// site (digitivia.github.io). On any other host this file does nothing, so it is harmless if it is ever promoted
// together with index.html. The demo itself is a separate static page that makes no request to any backend.
(function () {
    'use strict';
    if (location.hostname !== 'digitivia.github.io' || window.top !== window.self) return;
    function draw() {
        try {
            if (document.getElementById('demo-entry')) return;
            const base = location.pathname.replace(/[^/]*$/, '');
            const ar = (document.documentElement.lang || '').toLowerCase().indexOf('ar') === 0;
            const a = document.createElement('a');
            a.id = 'demo-entry';
            a.href = base + 'demo/';
            a.textContent = ar ? 'عرض الواجهة التجريبي' : 'UI Demo';
            a.title = ar ? 'نسخة تفاعلية بدون أي اتصال بالنظام الحقيقي' : 'Interactive demo, no connection to the real system';
            a.setAttribute('data-preview-only', 'true');
            a.style.cssText = 'position:fixed;inset-block-end:12px;inset-inline-start:12px;z-index:40;padding:6px 12px;border-radius:999px;background:#18174e;color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-decoration:none;border:1px solid rgba(255,255,255,.35);opacity:.9';
            document.body.appendChild(a);
        } catch (_) { /* decorative: never block the app */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw); else draw();
})();
