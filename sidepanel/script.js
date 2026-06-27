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
let activeFilter = 'verified';

// ─── DOM refs ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  videoTitle:       $('video-title'),
  statusBadge:      $('status-badge'),
  filterTabs:       $('filter-tabs'),
  credMeter:        $('credibility-meter'),
  credFill:         $('cred-fill'),
  credNeedle:       $('cred-needle'),
  credVerdict:      $('cred-verdict'),
  content:          $('content'),
  stateIdle:        $('state-idle'),
  stateLoading:     $('state-loading'),
  stateError:       $('state-error'),
  claimsList:       $('claims-list'),
  errorMsg:         $('error-msg'),
  summaryText:      $('summary-text'),
  ctVerified:       $('ct-verified'),
  ctOpinion:        $('ct-opinion'),
  ctUnverified:     $('ct-unverified'),
  ctGas:            $('ct-gas'),
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
  hideMeter();

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

  els.ctVerified.textContent   = counts.verified;
  els.ctOpinion.textContent    = counts.opinion;
  els.ctUnverified.textContent = counts.unverified;
  els.ctGas.textContent        = counts.gas;

  setStatus('complete', `${claims.length} Claims`);

  els.filterTabs.hidden = false;
  updateMeter(counts);

  if (summary) {
    els.summaryText.textContent = summary;
    els.summaryText.classList.remove('hidden');
  }

  activeFilter = 'verified';
  document.querySelectorAll('.tab').forEach(t => {
    const isVerified = t.dataset.filter === 'verified';
    t.classList.toggle('active', isVerified);
    t.setAttribute('aria-selected', isVerified ? 'true' : 'false');
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
  hideMeter();
  allClaims = [];
  activeFilter = 'verified';
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === 'verified');
  });
}

// ─── Credibility meter ───────────────────────────────────────────────────────

function calcCredScore(counts) {
  const { verified, opinion, unverified, gas } = counts;
  const total = verified + opinion + unverified + gas;
  if (total === 0) return 50;
  // Weighted: gas is the heaviest drag, verified the biggest lift
  const raw = (verified * 3) + (opinion * 1) - (unverified * 2) - (gas * 4);
  const max =  total * 3;
  const min = -total * 4;
  return Math.round(((raw - min) / (max - min)) * 100);
}

function updateMeter(counts) {
  const score = calcCredScore(counts);
  const pct   = `${score}%`;

  els.credFill.style.width   = pct;
  els.credNeedle.style.left  = pct;

  let label, cls;
  if      (score < 28) { label = 'Hyped';    cls = 'verdict-hyped';    }
  else if (score < 48) { label = 'Misleading'; cls = 'verdict-hyped';  }
  else if (score < 58) { label = 'Mixed';     cls = 'verdict-mixed';    }
  else if (score < 78) { label = 'Balanced';  cls = 'verdict-balanced'; }
  else                 { label = 'Credible';  cls = 'verdict-credible'; }

  els.credVerdict.textContent = label;
  els.credVerdict.className   = `cred-verdict ${cls}`;
  els.credMeter.hidden        = false;
}

function hideMeter() {
  els.credMeter.hidden = true;
  els.credFill.style.width  = '50%';
  els.credNeedle.style.left = '50%';
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

  const sourceHtml = claim.source?.url
    ? `<a class="source-link" href="${esc(claim.source.url)}" target="_blank" rel="noopener" title="${esc(claim.source.title || claim.source.url)}">
         <span class="source-icon" aria-hidden="true">↗</span>${esc(domain(claim.source.url))}
       </a>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="entry-no">№&nbsp;${no}</span>
      <span class="cat-tag"><span class="glyph" aria-hidden="true">${meta.glyph}</span>${esc(meta.label)}</span>
      ${tsHtml}
    </div>
    <p class="claim-text">${esc(claim.claim)}</p>
    <p class="claim-note">${esc(claim.explanation)}</p>
    ${sourceHtml}
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

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

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
