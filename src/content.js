// TruthLens Content Script

(function () {
  'use strict';

  const SIDEBAR_WIDTH = '460px';
  let sidebarOpen   = false;
  let isProcessing  = false;
  let currentVideoId = null;
  let heartbeatTimer = null;
  let sidebarReady   = false;
  let readyResolvers = [];

  // ─── Sidebar ─────────────────────────────────────────────────────────────────

  function createSidebar() {
    document.getElementById('ytfc-container')?.remove();
    sidebarReady = false; // fresh iframe → wait for its SIDEBAR_READY handshake

    const container = document.createElement('div');
    container.id = 'ytfc-container';
    Object.assign(container.style, {
      position:   'fixed',
      top:        '56px',
      right:      '0',
      width:      SIDEBAR_WIDTH,
      height:     'calc(100vh - 56px)',
      zIndex:     '2147483647',
      transform:  'translateX(100%)',
      transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
      borderLeft: '1px solid #272727',
      boxShadow:  '-12px 0 40px rgba(0,0,0,0.7)',
    });

    const iframe = document.createElement('iframe');
    iframe.id  = 'ytfc-frame';
    iframe.src = chrome.runtime.getURL('sidepanel/index.html');
    Object.assign(iframe.style, { width: '100%', height: '100%', border: 'none', display: 'block' });

    container.appendChild(iframe);
    document.body.appendChild(container);
    window.addEventListener('message', onSidebarMessage);
    return container;
  }

  function openSidebar() {
    const c = document.getElementById('ytfc-container') || createSidebar();
    requestAnimationFrame(() => { c.style.transform = 'translateX(0)'; });
    // Dock: reserve space on the right so YouTube's content reflows left and the
    // panel sits beside the video rather than floating over the recommendations.
    document.documentElement.classList.add('ytfc-open');
    sidebarOpen = true;
    setButtonActive(true);
  }

  function closeSidebar() {
    const c = document.getElementById('ytfc-container');
    if (c) c.style.transform = 'translateX(100%)';
    document.documentElement.classList.remove('ytfc-open');
    sidebarOpen  = false;
    isProcessing = false;
    setButtonActive(false);
  }

  // Page-push: shift YouTube's content container left by the panel width while open.
  // Targets #page-manager (below the masthead) so the fixed top bar is untouched.
  function injectPushStyle() {
    if (document.getElementById('ytfc-push-style')) return;
    const style = document.createElement('style');
    style.id = 'ytfc-push-style';
    style.textContent = `
      html.ytfc-open ytd-page-manager#page-manager {
        margin-right: ${SIDEBAR_WIDTH} !important;
        transition: margin-right 0.32s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function postToSidebar(type, data) {
    document.getElementById('ytfc-frame')?.contentWindow?.postMessage({ type, data }, '*');
  }

  function onSidebarMessage(event) {
    if (!event.data?.type) return;
    if (event.data.type === 'SIDEBAR_READY')    { markSidebarReady(); return; }
    if (event.data.type === 'CLOSE_SIDEBAR')    { closeSidebar(); return; }
    if (event.data.type === 'RERUN_FACT_CHECK') { runFactCheck({ force: true }); return; }
    if (event.data.type === 'SEEK_TO_TIME') {
      const v = document.querySelector('video');
      if (v) v.currentTime = event.data.data.time;
    }
  }

  // ── Sidebar readiness handshake ──
  // The iframe posts SIDEBAR_READY once its script has loaded. We hold off on
  // posting FACT_CHECK_START until then so the loading screen is never missed.
  function markSidebarReady() {
    sidebarReady = true;
    readyResolvers.forEach(r => r());
    readyResolvers = [];
  }

  function whenSidebarReady() {
    if (sidebarReady) return Promise.resolve();
    // Resolve on ready, but never hang — fall through after 1.5s as a safety net.
    return Promise.race([
      new Promise(resolve => readyResolvers.push(resolve)),
      new Promise(resolve => setTimeout(resolve, 1500)),
    ]);
  }

  // ─── Button injection ─────────────────────────────────────────────────────────
  //
  // Selector priority (YouTube changes its DOM regularly, so we try several):
  //   1. #top-level-buttons-computed  — the actual flex row of Share/Clip/Save buttons
  //   2. ytd-menu-renderer            — the menu component wrapping those buttons
  //   3. #actions-inner               — container one level up
  //   4. #actions                     — outermost actions div
  //
  // We append a <div> wrapper so YouTube's CSS doesn't mutate our element.

  const BUTTON_SELECTORS = [
    'ytd-watch-metadata #top-level-buttons-computed',
    '#above-the-fold #top-level-buttons-computed',
    '#top-level-buttons-computed',
    'ytd-watch-metadata ytd-menu-renderer',
    '#actions-inner',
    '#actions',
  ];

  function injectButton() {
    // Already injected and still connected
    const existing = document.getElementById('ytfc-btn-wrapper');
    if (existing?.isConnected) return true;

    // Remove detached wrapper if any
    existing?.remove();

    let target = null;
    for (const sel of BUTTON_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) { target = el; break; }
    }
    if (!target) return false;

    const wrapper = document.createElement('div');
    wrapper.id = 'ytfc-btn-wrapper';
    wrapper.style.cssText = 'display:inline-flex;align-items:center;flex-shrink:0;margin-left:8px;';

    const btn = document.createElement('button');
    btn.id = 'ytfc-btn';
    btn.title = 'TruthLens — Run Fact Checker';
    btn.setAttribute('aria-label', 'Run Fact Checker');
    btn.setAttribute('aria-pressed', 'false');

    // Prominent styling: solid red pill so it's unmistakeable in the button row
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #cc0000;
      border: none;
      border-radius: 18px;
      color: #ffffff;
      cursor: pointer;
      font-family: "Roboto","Arial",sans-serif;
      font-size: 14px;
      font-weight: 500;
      height: 36px;
      padding: 0 16px;
      transition: background 0.15s, transform 0.1s;
      white-space: nowrap;
      outline: none;
      letter-spacing: 0.01em;
    `;

    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 12l2 2 4-4"/>
        <circle cx="12" cy="12" r="9"/>
      </svg>
      <span class="ytfc-label">Fact Check</span>
    `;

    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) btn.style.background = '#aa0000';
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.disabled && !sidebarOpen) btn.style.background = '#cc0000';
    });
    btn.addEventListener('click', onButtonClick);

    wrapper.appendChild(btn);
    target.appendChild(wrapper);
    return true;
  }

  function setButtonActive(active) {
    const btn = document.getElementById('ytfc-btn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(active));
    btn.style.background = active ? '#880000' : '#cc0000';
  }

  function setButtonLoading(loading) {
    const btn = document.getElementById('ytfc-btn');
    if (!btn) return;
    const lbl = btn.querySelector('.ytfc-label');
    if (lbl) lbl.textContent = loading ? 'Checking…' : 'Fact Check';
    btn.disabled = loading;
    btn.style.background = loading ? '#555' : (sidebarOpen ? '#880000' : '#cc0000');
  }

  // Transcript fetching is now fully handled by the background service worker
  // via Supadata API — content.js just passes the videoId.

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function getVideoId() {
    return new URL(window.location.href).searchParams.get('v');
  }

  function getVideoTitle() {
    return (
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string')?.textContent?.trim() ||
      document.title.replace(' - YouTube', '').trim() ||
      'YouTube Video'
    );
  }

  // ─── Fact-check flow ──────────────────────────────────────────────────────────

  // Toolbar button: toggles the sidebar closed when idle, otherwise runs a check.
  function onButtonClick() {
    if (sidebarOpen && !isProcessing) { closeSidebar(); return; }
    if (isProcessing) return;
    runFactCheck({ force: false });
  }

  // Runs the fact-check flow. force=true bypasses the background cache
  // (used by the sidebar's refresh button).
  async function runFactCheck({ force = false } = {}) {
    if (isProcessing) return;

    const videoId    = getVideoId();
    const videoTitle = getVideoTitle();
    if (!videoId) return;

    openSidebar();
    await whenSidebarReady();

    postToSidebar('FACT_CHECK_START', { videoTitle });
    setButtonLoading(true);
    isProcessing   = true;
    currentVideoId = videoId;

    try {
      // Transcript fetching + AI analysis both handled by background (via Supadata)
      chrome.runtime.sendMessage(
        { type: 'FACT_CHECK', data: { videoId, videoTitle, force } },
        response => {
          isProcessing = false;
          setButtonLoading(false);

          // Drop stale responses if the user navigated to another video meanwhile
          if (getVideoId() !== videoId) return;

          if (chrome.runtime.lastError || !response) {
            postToSidebar('FACT_CHECK_ERROR', { message: 'Extension error. Reload the page and try again.' });
            return;
          }
          if (response.error)  postToSidebar('FACT_CHECK_ERROR',   { message: response.error });
          else if (response.claims) postToSidebar('FACT_CHECK_RESULTS', response);
        }
      );
    } catch (err) {
      isProcessing = false;
      setButtonLoading(false);
      if (getVideoId() === videoId) postToSidebar('FACT_CHECK_ERROR', { message: err.message });
    }
  }

  // ─── Navigation + persistence ─────────────────────────────────────────────────

  function onVideoChange() {
    if (!getVideoId()) return;

    // Button is likely in a freshly-rendered DOM — remove stale reference
    document.getElementById('ytfc-btn-wrapper')?.remove();
    isProcessing = false;
    currentVideoId = getVideoId();

    postToSidebar('VIDEO_CHANGED', { videoTitle: getVideoTitle() });
    tryInjectButton();
  }

  // Heartbeat: if YouTube removes the button (re-render, navigation), put it back
  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (window.location.href.includes('/watch')) injectButton();
    }, 2000);
  }

  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(onVideoChange, 800);
  });

  // Fallback URL watcher
  let lastHref = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      if (window.location.href.includes('/watch')) setTimeout(onVideoChange, 1200);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Init ─────────────────────────────────────────────────────────────────────

  function tryInjectButton(attempts = 20) {
    if (injectButton()) return;
    if (attempts > 0) setTimeout(() => tryInjectButton(attempts - 1), 400);
  }

  function init() {
    if (!window.location.href.includes('/watch')) return;
    injectPushStyle();
    createSidebar();
    tryInjectButton();
    startHeartbeat();
    currentVideoId = getVideoId();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
