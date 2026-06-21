// TruthLens Background Service Worker
// Multi-provider fact-checking: DeepSeek, Anthropic, OpenAI

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildPrompts(transcript, videoTitle) {
  // Cover the entire video. Only guard against pathologically long transcripts
  // (multi-hour streams) that would blow the model's context window — the budget
  // below is large enough to hold a full ~4-hour transcript intact.
  const MAX_CHARS = 240000;
  let transcriptText = transcript
    .map(s => `[${formatTime(s.start)}] ${s.text}`)
    .join('\n');

  let truncated = false;
  if (transcriptText.length > MAX_CHARS) {
    transcriptText = transcriptText.slice(0, MAX_CHARS);
    truncated = true;
  }

  const system = `You are a rigorous fact-checker. Analyse YouTube video transcripts and return structured JSON only — no prose, no markdown fences.`;

  const user = `Fact-check this YouTube video transcript.

Video: "${videoTitle}"

CATEGORY DEFINITIONS:
- "verified"   — Well-established, accurate claim per scientific consensus or historical record
- "opinion"    — Subjective view, preference, interpretation, or prediction
- "unverified" — Factual-sounding claim that is disputed, lacks evidence, or needs more research
- "gas"        — Factually wrong, pseudoscientific, absurd, or egregiously misleading

INSTRUCTIONS:
1. Cover the ENTIRE video. Identify the most significant claims across the whole
   transcript — beginning, middle, AND end — not just the opening. Aim for
   10–30 claims, scaling up for longer videos so coverage stays even throughout.
2. Keep "claim" under 100 characters (direct quote or tight paraphrase)
3. Keep "explanation" under 150 characters
4. Set "timestamp" to seconds from the nearest [M:SS] marker in the transcript${truncated ? '\n5. NOTE: the transcript was truncated at the end due to length; assess what is provided.' : ''}

Return exactly this JSON structure:
{
  "claims": [
    {
      "claim": "claim text",
      "category": "verified|opinion|unverified|gas",
      "explanation": "brief reason",
      "timestamp": 123.4
    }
  ],
  "summary": "1–2 sentence overall assessment of this video's factual accuracy."
}

Transcript:
${transcriptText}`;

  return { system, user };
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Extract every complete {...} object from a (possibly truncated) array body.
// Used to salvage claims when the model's JSON got cut off at the token limit.
function salvageClaims(text) {
  const claims = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; }
    else if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const obj = tryParse(text.slice(objStart, i + 1));
        if (obj && obj.claim && obj.category) claims.push(obj);
        objStart = -1;
      }
    }
  }
  return claims;
}

function parseJsonResponse(text) {
  const raw = (text || '').trim();
  console.log('[TruthLens] AI response length:', raw.length, '| head:', raw.slice(0, 120));

  if (!raw) {
    throw new Error('The model returned an empty response. Try re-running, or switch models in the popup.');
  }

  // Drop any markdown code fences the model may have wrapped the JSON in.
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  const start = s.indexOf('{');
  if (start === -1) throw new Error('Could not parse AI response (no JSON found). Please try again.');
  s = s.slice(start);

  // 1) Whole object, as-is.
  let parsed = tryParse(s);
  // 2) Trim trailing prose after the last brace.
  if (!parsed) {
    const end = s.lastIndexOf('}');
    if (end !== -1) parsed = tryParse(s.slice(0, end + 1));
  }
  // 3) Truncated JSON — salvage whatever complete claims we can.
  if (!parsed || !Array.isArray(parsed.claims)) {
    const salvaged = salvageClaims(s);
    if (salvaged.length) {
      const sumMatch = s.match(/"summary"\s*:\s*"([^"]*)"/);
      console.warn('[TruthLens] Recovered', salvaged.length, 'claims from truncated/invalid JSON.');
      return { claims: salvaged, summary: sumMatch ? sumMatch[1] : '' };
    }
  }

  if (!parsed) throw new Error('Could not parse AI response. Please try again.');
  if (!Array.isArray(parsed.claims)) throw new Error('Unexpected response structure. Please try again.');
  return parsed;
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function callDeepSeek(transcript, videoTitle, apiKey, model) {
  if (!apiKey) throw new Error('No DeepSeek API key. Click the TruthLens icon to add one.');
  const { system, user } = buildPrompts(transcript, videoTitle);

  const isReasoner = model === 'deepseek-v4-pro';
  // deepseek-v4-flash is the default fast model
  const resolvedModel = model || 'deepseek-v4-flash';

  const body = {
    model: resolvedModel,
    max_tokens: 8000,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   }
    ],
    // json_object mode not available when thinking is enabled
    ...(!isReasoner && { response_format: { type: 'json_object' } }),
    ...(isReasoner  && { reasoning_effort: 'high', thinking: { type: 'enabled' } })
  };

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API error: ${res.status}`);
  }

  const data = await res.json();
  return parseJsonResponse(data.choices?.[0]?.message?.content || '');
}

async function callAnthropic(transcript, videoTitle, apiKey, model) {
  if (!apiKey) throw new Error('No Anthropic API key. Click the TruthLens icon to add one.');
  const { system, user } = buildPrompts(transcript, videoTitle);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error: ${res.status}`);
  }

  const data = await res.json();
  return parseJsonResponse(data.content?.[0]?.text || '');
}

async function callOpenAI(transcript, videoTitle, apiKey, model) {
  if (!apiKey) throw new Error('No OpenAI API key. Click the TruthLens icon to add one.');
  const { system, user } = buildPrompts(transcript, videoTitle);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  return parseJsonResponse(data.choices?.[0]?.message?.content || '');
}

// ─── Supadata transcript fetch ────────────────────────────────────────────────

async function fetchTranscript(videoId) {
  const { supadataApiKey } = await chrome.storage.local.get('supadataApiKey');

  if (!supadataApiKey) {
    throw new Error(
      'No Supadata API key. Open the TruthLens popup and add your key from supadata.ai'
    );
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(
    `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}`,
    {
      headers: {
        'x-api-key': supadataApiKey,
      },
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (res.status === 404) throw new Error('No transcript available for this video.');
  if (res.status === 401) throw new Error('Invalid Supadata API key. Check your key in the TruthLens popup.');
  if (res.status === 429) throw new Error('Supadata rate limit hit. Please wait a moment and try again.');
  if (!res.ok) throw new Error(`Supadata error: ${res.status}`);

  const data = await res.json();

  // Log actual response shape so it's inspectable in the service worker console
  console.log('[TruthLens] Supadata response keys:', Object.keys(data));

  // ── Try timestamped segment arrays under various field names ──
  // Supadata's /v1/transcript returns the segment array under "content"
  // (each chunk: {text, offset, duration}). Older/alt shapes used
  // "transcript", "chunks", or "segments" — try them all.
  const segArray = Array.isArray(data.content)    ? data.content
    : Array.isArray(data.transcript) ? data.transcript
    : Array.isArray(data.chunks)     ? data.chunks
    : Array.isArray(data.segments)   ? data.segments
    : null;

  if (segArray && segArray.length > 0) {
    const segs = segArray.map(seg => {
      // offset is in ms; start/startTime may be in seconds already
      const start = seg.offset   != null ? seg.offset / 1000
        : seg.startMs != null    ? seg.startMs / 1000
        : seg.start   != null    ? seg.start
        : 0;
      const text = String(seg.text ?? seg.content ?? '').trim();
      return { start, text };
    }).filter(s => s.text);

    if (segs.length > 0) return segs;
  }

  // ── Fallback: plain text in content / text field ──
  // Ensure it's actually a string before passing it on.
  const raw = data.content ?? data.text ?? data.transcript;
  if (raw) {
    const plain = typeof raw === 'string' ? raw.trim()
      : Array.isArray(raw)               ? raw.map(c => (typeof c === 'string' ? c : String(c.text ?? c))).join(' ').trim()
      : null;
    if (plain) return [{ start: 0, text: plain }];
  }

  throw new Error('Supadata returned an empty transcript for this video.');
}

// ─── AI dispatcher ────────────────────────────────────────────────────────────

async function runFactCheck(transcript, videoTitle) {
  const stored = await chrome.storage.local.get([
    'provider', 'selectedModel',
    'deepseekApiKey', 'anthropicApiKey', 'openaiApiKey'
  ]);

  const provider = stored.provider || 'deepseek';
  const model    = stored.selectedModel || '';

  switch (provider) {
    case 'deepseek':  return callDeepSeek(transcript, videoTitle, stored.deepseekApiKey, model);
    case 'anthropic': return callAnthropic(transcript, videoTitle, stored.anthropicApiKey, model);
    case 'openai':    return callOpenAI(transcript, videoTitle, stored.openaiApiKey, model);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FACT_CHECK') return false;

  const { videoId, videoTitle, force } = message.data;
  const cacheKey = `fc_${videoId}`;

  chrome.storage.local.get([cacheKey, 'provider', 'selectedModel'], async (stored) => {
    const cached   = stored[cacheKey];
    const cacheTag = `${stored.provider || 'deepseek'}:${stored.selectedModel || ''}`;

    // A forced re-run (refresh button) skips the cache and re-analyses fresh.
    if (!force && cached && cached.tag === cacheTag && Date.now() - cached.cachedAt < 3_600_000) {
      sendResponse({ claims: cached.claims, summary: cached.summary });
      return;
    }

    try {
      const transcript = await fetchTranscript(videoId);
      const result     = await runFactCheck(transcript, videoTitle);

      chrome.storage.local.set({
        [cacheKey]: { ...result, tag: cacheTag, cachedAt: Date.now() }
      });
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });

  return true;
});
