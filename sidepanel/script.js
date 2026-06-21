// TruthLens Sidebar Script
// Renders fact-check results; communicates with content.js via postMessage

'use strict';

const CATEGORY_META = {
  verified:   { glyph: '✓', label: 'Verified Fact' },
  opinion:    { glyph: '◊', label: 'Opinion'       },
  unverified: { glyph: '?', label: 'Unverified'    },
  gas:        { glyph: '✕', label: 'Gas'           }
};

let allClaims = [];
let activeFilter = 'all';

// ─── DOM refs ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  videoTitle:   $('video-title'),
  statusBadge:  $('status-badge'),
  filterTabs:   $('filter-tabs'),
  content:      $('content'),
  stateIdle:    $('state-idle'),
  stateLoading: $('state-loading'),
  stateError:   $('state-error'),
  claimsList:   $('claims-list'),
  errorMsg:     $('error-msg'),
  summaryText:  $('summary-text'),
  ctAll:        $('ct-all'),
  ctVerified:   $('ct-verified'),
  ctOpinion:    $('ct-opinion'),
  ctUnverified: $('ct-unverified'),
  ctGas:        $('ct-gas'),
};

// ─── State transitions ───────────────────────────────────────────────────────

function showScreen(name) {
  const screens = ['stateIdle', 'stateLoading', 'stateError', 'claimsList'];
  screens.forEach(s => {
    const el = els[s];
    if (el) el.classList.toggle('hidden', s !== name);
  });
}

function setStatus(type, text) {
  els.statusBadge.className = `status-badge status-${type}`;
  els.statusBadge.textContent = text;
}

// ─── Message handlers ────────────────────────────────────────────────────────

function handleStart({ videoTitle }) {
  els.videoTitle.textContent = videoTitle || '—';
  els.videoTitle.title = videoTitle || '';

  refreshBtn.classList.add('spinning');
  refreshBtn.disabled = true;
  setStatus('loading', 'Reading');
  showScreen('stateLoading');

  els.filterTabs.hidden = true;
  els.summaryText.classList.add('hidden');

  allClaims = [];
}

function stopRefreshSpin() {
  refreshBtn.classList.remove('spinning');
  refreshBtn.disabled = false;
}

function handleResults({ claims = [], summary = '' }) {
  stopRefreshSpin();
  allClaims = claims;

  // Count per category — rendered inline in the index/filter row
  const counts = { verified: 0, opinion: 0, unverified: 0, gas: 0 };
  claims.forEach(c => { if (counts[c.category] !== undefined) counts[c.category]++; });

  els.ctAll.textContent        = claims.length;
  els.ctVerified.textContent   = counts.verified;
  els.ctOpinion.textContent    = counts.opinion;
  els.ctUnverified.textContent = counts.unverified;
  els.ctGas.textContent        = counts.gas;

  setStatus('complete', `${claims.length} Claims`);

  els.filterTabs.hidden = false;

  if (summary) {
    els.summaryText.textContent = summary;
    els.summaryText.classList.remove('hidden');
  }

  activeFilter = 'all';
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === 'all');
    t.setAttribute('aria-selected', t.dataset.filter === 'all' ? 'true' : 'false');
  });

  renderClaims();
  showScreen('claimsList');
}

function handleError({ message }) {
  stopRefreshSpin();
  els.errorMsg.textContent = message || 'An unexpected error occurred.';
  setStatus('error', 'ERROR');
  showScreen('stateError');
}

function handleVideoChanged({ videoTitle }) {
  stopRefreshSpin();
  els.videoTitle.textContent = videoTitle || '—';
  els.videoTitle.title = videoTitle || '';
  setStatus('idle', 'Ready');
  showScreen('stateIdle');
  els.filterTabs.hidden = true;
  els.summaryText.classList.add('hidden');
  allClaims = [];
  activeFilter = 'all';
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === 'all');
  });
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderClaims() {
  const list = els.claimsList;
  list.innerHTML = '';

  const visible = activeFilter === 'all'
    ? allClaims
    : allClaims.filter(c => c.category === activeFilter);

  if (visible.length === 0) {
    list.innerHTML = `<p class="no-results">NO ${activeFilter.toUpperCase()} CLAIMS FOUND</p>`;
    return;
  }

  visible.forEach((claim, i) => {
    const card = buildCard(claim, i);
    list.appendChild(card);
  });
}

function buildCard(claim, index) {
  const meta = CATEGORY_META[claim.category] ?? { glyph: '·', label: 'Unknown' };
  const ts   = typeof claim.timestamp === 'number' ? claim.timestamp : null;

  const card = document.createElement('article');
  card.className = `claim-card ${claim.category}`;
  card.style.animationDelay = `${Math.min(index * 45, 400)}ms`;
  card.setAttribute('aria-label', `${meta.label}: ${claim.claim}`);

  const no = String(index + 1).padStart(2, '0');
  const tsHtml = ts !== null
    ? `<button class="ts-btn" data-time="${ts}" title="Jump to ${fmt(ts)} in video">↳ ${fmt(ts)}</button>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="entry-no">№&nbsp;${no}</span>
      <span class="cat-tag"><span class="glyph" aria-hidden="true">${meta.glyph}</span>${esc(meta.label)}</span>
      ${tsHtml}
    </div>
    <p class="claim-text">${esc(claim.claim)}</p>
    <p class="claim-note">${esc(claim.explanation)}</p>
  `;

  const tsBtn = card.querySelector('.ts-btn');
  if (tsBtn) {
    tsBtn.addEventListener('click', () => {
      window.parent.postMessage(
        { type: 'SEEK_TO_TIME', data: { time: claim.timestamp } },
        '*'
      );
    });
  }

  return card;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

// ─── Event listeners ─────────────────────────────────────────────────────────

// Filter tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.filter === activeFilter) return;
    activeFilter = tab.dataset.filter;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    renderClaims();
  });
});

// Close button
$('close-btn').addEventListener('click', () => {
  window.parent.postMessage({ type: 'CLOSE_SIDEBAR' }, '*');
});

// Refresh button
const refreshBtn = $('refresh-btn');
refreshBtn.addEventListener('click', () => {
  if (refreshBtn.classList.contains('spinning')) return;
  window.parent.postMessage({ type: 'RERUN_FACT_CHECK' }, '*');
});

// postMessage from content.js
window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  const { type, data } = event.data ?? {};

  switch (type) {
    case 'FACT_CHECK_START':   handleStart(data);        break;
    case 'FACT_CHECK_RESULTS': handleResults(data);      break;
    case 'FACT_CHECK_ERROR':   handleError(data);        break;
    case 'VIDEO_CHANGED':      handleVideoChanged(data); break;
  }
});

// Tell the content script the sidebar is loaded and ready to receive events.
window.parent.postMessage({ type: 'SIDEBAR_READY' }, '*');
