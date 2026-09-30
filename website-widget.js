(function () {
  'use strict';

  var MESSAGE_READY = 'DIGITIVIA_CHAT_READY';
  var MESSAGE_INIT = 'DIGITIVIA_CHAT_INIT';
  var MESSAGE_TOGGLED = 'DIGITIVIA_CHAT_TOGGLED';
  var MESSAGE_LAUNCHER_SIZE = 'DIGITIVIA_CHAT_LAUNCHER_SIZE';
  // The frame is a transparent overlay on the host site, so any pixel it
  // covers is a pixel the merchant's own page cannot receive clicks on.
  // Keep the closed frame hugging the launcher (58px + room for its shadow).
  var CLOSED_WIDTH = 76;
  var CLOSED_HEIGHT = 76;
  // Same shadow/hover-scale allowance as CLOSED_WIDTH - 58, applied to a
  // measured pill width when launcherText widens the launcher beyond a circle.
  var LAUNCHER_SHADOW_PADDING = 18;
  var OPEN_WIDTH = 400;
  var OPEN_HEIGHT = 750;
  var EDGE_GAP = 16;
  var VIEWPORT_MARGIN = EDGE_GAP * 2;
  var DEFAULT_REQUEST_TIMEOUT_MS = 360000;

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var widgetKey = script && script.dataset ? (script.dataset.widgetKey || '') : '';
  var srcBase = script && script.src ? new URL(script.src, window.location.href) : new URL(window.location.href);
  var widgetUrl = new URL('chatwindow.html', srcBase.href);
  var widgetOrigin = widgetUrl.origin;
  var primaryColor = script && script.dataset ? String(script.dataset.primaryColor || '').trim() : '';
  var config = {
    widgetKey: widgetKey,
    webhookUrl: script.dataset.webhookUrl || new URL('webhook/website_chat_digitivia', srcBase.origin + '/').href,
    requestTimeoutMs: readRequestTimeoutMs(script && script.dataset ? script.dataset : {}),
    title: script.dataset.title || '',
    launcherText: script.dataset.launcherText || '',
    subtitle: script.dataset.subtitle || '',
    firstMessage: script.dataset.firstMessage || '',
    defaultTheme: script.dataset.theme || '',
    position: script.dataset.position || '',
    forcedDir: script.dataset.dir || '',
    ctaLabel: script.dataset.ctaLabel || '',
    ctaUrl: 'https://digitivia.com',
    poweredByLabel: 'Powered by Digitivia',
    blockedTitle: script.dataset.blockedTitle || '',
    blockedMessage: script.dataset.blockedMessage || '',
    theme: buildThemeConfig(primaryColor),
    hostOrigin: window.location.origin || '',
    hostPageUrl: window.location.href || '',
    // the widget renders in an iframe, so it cannot read the store page's
    // language itself - pass it through so labels can localise
    hostLang: (document.documentElement.getAttribute('lang') || navigator.language || ''),
    hostDir: (document.documentElement.getAttribute('dir') || ''),
    embeddedFrame: true,
    previewMode: false
  };

  var frame = null;
  var isOpen = false;
  var hasRevealedFrame = false;
  var measuredClosedWidth = null;

  function mountWidgetFrame() {
    if (frame || !document.body) return;

    frame = document.createElement('iframe');
    frame.setAttribute('title', 'Digitivia Website Widget');
    frame.setAttribute('aria-label', 'Digitivia Website Widget');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('allowtransparency', 'true');
    frame.src = widgetUrl.href;
    frame.style.position = 'fixed';
    frame.style.zIndex = '2147483000';
    frame.style.display = 'block';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.style.overflow = 'hidden';
    frame.style.colorScheme = 'normal';
    frame.style.maxWidth = '100vw';
    frame.style.maxHeight = '100vh';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.transition = 'opacity 120ms ease';
    applyFramePosition(frame);
    applyFrameSize(false);

    window.addEventListener('message', onWidgetMessage);
    window.addEventListener('resize', onViewportResize);
    window.addEventListener('orientationchange', onViewportResize);
    if (window.visualViewport) {
      // keyboard show/hide and pinch-zoom both surface here
      window.visualViewport.addEventListener('resize', onViewportResize);
      window.visualViewport.addEventListener('scroll', onViewportResize);
    }
    frame.addEventListener('load', function () {
      applyFrameSize(isOpen);
    });

    document.body.appendChild(frame);
  }

  function applyFramePosition(targetFrame) {
    // data-position is a PHYSICAL corner. It must not flip on RTL pages, so
    // the gap lives on the frame here rather than on logical properties
    // inside the widget.
    var position = config.position || 'bottom-right';
    var gap = EDGE_GAP + 'px';
    var bottomGap = 'calc(env(safe-area-inset-bottom, 0px) + ' + gap + ')';

    if (position.indexOf('left') !== -1) {
      targetFrame.style.left = gap;
      targetFrame.style.right = 'auto';
    } else {
      targetFrame.style.right = gap;
      targetFrame.style.left = 'auto';
    }

    if (position.indexOf('top') !== -1) {
      targetFrame.style.top = gap;
      targetFrame.style.bottom = 'auto';
    } else {
      targetFrame.style.bottom = bottomGap;
      targetFrame.style.top = 'auto';
    }
  }

  function onWidgetMessage(event) {
    if (!frame || event.source !== frame.contentWindow || !isAllowedWidgetOrigin(event.origin)) return;
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === MESSAGE_READY) {
      postInitConfig();
      revealFrame();
      applyFrameSize(isOpen);
      return;
    }

    if (event.data.type === MESSAGE_LAUNCHER_SIZE) {
      var measuredWidth = Number(event.data.width);
      if (measuredWidth > 0) {
        measuredClosedWidth = Math.ceil(measuredWidth) + LAUNCHER_SHADOW_PADDING;
        applyFrameSize(isOpen);
      }
      return;
    }

    if (event.data.type === MESSAGE_TOGGLED) {
      isOpen = !!event.data.isOpen;
      applyFrameSize(isOpen);
    }
  }

  function postInitConfig() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: MESSAGE_INIT,
      config: config
    }, getMessageTargetOrigin(widgetOrigin, widgetUrl.protocol));
  }

  function onViewportResize() {
    applyFrameSize(isOpen);
  }

  function applyFrameSize(openState) {
    if (!frame) return;
    var size = openState ? getOpenFrameSize() : getClosedFrameSize();
    frame.style.width = size.width + 'px';
    frame.style.height = size.height + 'px';
  }

  function getClosedFrameSize() {
    return {
      width: measuredClosedWidth || CLOSED_WIDTH,
      height: CLOSED_HEIGHT
    };
  }

  // On phones the soft keyboard shrinks visualViewport, not innerHeight, so
  // sizing off innerHeight leaves the composer hidden behind the keyboard.
  function getViewportSize() {
    var vv = window.visualViewport;
    if (vv && vv.width && vv.height) {
      return { width: Math.round(vv.width), height: Math.round(vv.height) };
    }
    return {
      width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
      height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
    };
  }

  function getOpenFrameSize() {
    var viewport = getViewportSize();

    return {
      width: clampDimension(OPEN_WIDTH, viewport.width - VIEWPORT_MARGIN, CLOSED_WIDTH),
      height: clampDimension(OPEN_HEIGHT, viewport.height - VIEWPORT_MARGIN, CLOSED_HEIGHT)
    };
  }

  function clampDimension(target, maxValue, minValue) {
    var upperBound = Math.max(minValue, maxValue);
    return Math.max(minValue, Math.min(target, upperBound));
  }

  function revealFrame() {
    if (!frame || hasRevealedFrame) return;
    hasRevealedFrame = true;
    frame.style.opacity = '1';
    frame.style.pointerEvents = 'auto';
  }

  function isAllowedWidgetOrigin(origin) {
    if (widgetUrl.protocol === 'file:') {
      return origin === 'null' || origin === '';
    }
    return origin === widgetOrigin;
  }

  function getMessageTargetOrigin(origin, protocol) {
    if (protocol === 'file:' || !origin || origin === 'null') {
      return '*';
    }
    return origin;
  }

  function buildThemeConfig(color) {
    if (!color) return {};
    // send the brand colour only - chatwindow derives the strong/soft/bubble
    // tokens from it so every surface stays on-brand
    return {
      '--chat-accent': color
    };
  }

  function readRequestTimeoutMs(dataset) {
    var candidates = [
      toMilliseconds(dataset.requestTimeoutMs, 1),
      toMilliseconds(dataset.timeoutMs, 1),
      toMilliseconds(dataset.requestTimeoutSeconds, 1000),
      toMilliseconds(dataset.timeoutSeconds, 1000),
      toMilliseconds(dataset.requestTimeoutMinutes, 60000),
      toMilliseconds(dataset.timeoutMinutes, 60000)
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] > 0) return candidates[i];
    }

    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  function toMilliseconds(value, multiplier) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.round(parsed * multiplier);
  }

  if (document.body) {
    mountWidgetFrame();
  } else {
    document.addEventListener('DOMContentLoaded', mountWidgetFrame, { once: true });
  }
})();
