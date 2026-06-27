// TruthLens Background Service Worker
// Agentic pipeline: AI drives all searches via tool use, categorizes from evidence only

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildTranscriptText(transcript) {
  let text = transcript.map(s => `[${formatTime(s.start)}] ${s.text}`).join('\n');
  if (text.length > 240000) text = text.slice(0, 240000);
  return text;
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function parseJsonResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response. Please try again.');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.claims)) throw new Error('Unexpected response structure. Please try again.');
  return parsed;
}

// ─── Credible domains ─────────────────────────────────────────────────────────

const CREDIBLE_DOMAINS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk',
  'theguardian.com', 'nytimes.com', 'washingtonpost.com',
  'ft.com', 'economist.com', 'bloomberg.com', 'wsj.com',
  'nature.com', 'science.org', 'pubmed.ncbi.nlm.nih.gov',
  'who.int', 'cdc.gov', 'nih.gov', 'mayoclinic.org', 'nejm.org',
  'snopes.com', 'factcheck.org', 'politifact.com', 'fullfact.org',
  'en.wikipedia.org', 'britannica.com',
];

function isCredible(url) {
  const d = extractDomain(url);
  return CREDIBLE_DOMAINS.some(c => d === c || d.endsWith('.' + c));
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const SEARCH_TOOL_OPENAI = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web to find evidence for or against a specific claim. Call this before categorising any factual claim. You may call it multiple times with different queries if initial results are poor or ambiguous.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Specific search query. Be precise — include key terms, dates where relevant, and "fact check" if helpful.'
        }
      },
      required: ['query']
    }
  }
};

const SEARCH_TOOL_ANTHROPIC = {
  name: 'web_search',
  description: 'Search the web to find evidence for or against a specific claim. Call this before categorising any factual claim. You may call it multiple times with different queries if initial results are poor.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Specific search query. Be precise — include key terms, dates where relevant.'
      }
    },
    required: ['query']
  }
};

// ─── Agent system prompt ──────────────────────────────────────────────────────

function buildAgentSystemPrompt(videoTitle) {
  return `You are a rigorous fact-checker analysing a YouTube video. You have a web_search tool.

Video: "${videoTitle}"

YOUR PROCESS:
1. Read the full transcript and identify 10–30 significant, checkable factual claims
2. For each factual claim, call web_search to find evidence — search multiple times with different queries if the first result is poor or off-topic
3. Only after searching, categorise the claim based on what the search found
4. Opinion claims do not require searching — judge them on content alone

CATEGORIES:
- "verified"   — Directly supported by credible search evidence
- "opinion"    — Subjective view, preference, interpretation, or prediction
- "unverified" — No clear evidence after 2–3 searches, or results are mixed/inconclusive
- "gas"        — Directly contradicted by credible search evidence; demonstrably false

CREDIBLE SOURCES (weight these highly): ${CREDIBLE_DOMAINS.slice(0, 12).join(', ')}

RULES:
- Never categorise a claim as "verified" or "gas" without search evidence
- A claim confirmed only by a non-credible source should be "unverified"
- A claim contradicted by a credible source is "gas" even if a low-quality source supports it
- Do not use training knowledge to determine verified/gas — only search evidence counts

FINAL OUTPUT: When all claims are researched, return this exact JSON (no markdown fences):
{
  "claims": [
    {
      "claim": "claim text under 100 chars",
      "category": "verified|opinion|unverified|gas",
      "explanation": "under 150 chars — cite the source domain",
      "timestamp": 123,
      "source": { "title": "...", "url": "https://..." }
    }
  ],
  "summary": "1–2 sentence overall assessment of this video's factual accuracy."
}`;
}

// ─── Format Tavily results for AI consumption ─────────────────────────────────

function formatSearchResults(results, query) {
  if (!results?.length) return `No results found for: "${query}"`;
  return results.map((r, i) => {
    const trust = r.credible ? '[CREDIBLE]' : '[UNVERIFIED SOURCE]';
    return `[${i + 1}] ${trust} ${r.domain}\nTitle: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}`;
  }).join('\n\n');
}

// ─── Tavily search ────────────────────────────────────────────────────────────

async function searchTavily(query, apiKey) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:        apiKey,
      query,
      search_depth:   'basic',
      max_results:    3,
      days:           365,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map(r => ({
    title:    r.title,
    url:      r.url,
    domain:   extractDomain(r.url),
    snippet:  (r.content || '').slice(0, 300),
    credible: isCredible(r.url),
  }));
}

// ─── OpenAI-style agentic loop (DeepSeek + OpenAI) ───────────────────────────

async function runOpenAIAgent(transcriptText, systemPrompt, apiKey, model, endpoint, tavilyKey) {
  const isReasoner = model === 'deepseek-v4-pro';
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: `Fact-check this transcript:\n\n${transcriptText}` }
  ];

  const MAX_ITERS = 25;
  let searchCount = 0;

  for (let i = 0; i < MAX_ITERS; i++) {
    const body = {
      model,
      messages,
      max_tokens: 8000,
      ...(isReasoner
        ? { reasoning_effort: 'high', thinking: { type: 'enabled' } }
        : { tools: [SEARCH_TOOL_OPENAI], tool_choice: 'auto' }
      ),
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const msg  = data.choices?.[0]?.message;
    if (!msg) throw new Error('Empty response from AI.');

    messages.push(msg);

    // No tool calls → agent finished
    if (!msg.tool_calls?.length) {
      return parseJsonResponse(msg.content || '');
    }

    // Execute tool calls (may be batched)
    const toolResults = await Promise.all(
      msg.tool_calls.map(async tc => {
        if (tc.function?.name !== 'web_search') return null;
        const args    = JSON.parse(tc.function.arguments || '{}');
        searchCount++;
        const results = tavilyKey ? await searchTavily(args.query, tavilyKey) : [];
        return {
          role:         'tool',
          tool_call_id: tc.id,
          content:      formatSearchResults(results, args.query),
        };
      })
    );

    toolResults.filter(Boolean).forEach(r => messages.push(r));
  }

  throw new Error('Agent exceeded search limit — try a shorter video or re-run.');
}

// ─── Anthropic agentic loop ───────────────────────────────────────────────────

async function runAnthropicAgent(transcriptText, systemPrompt, apiKey, model, tavilyKey) {
  const messages = [
    { role: 'user', content: `Fact-check this transcript:\n\n${transcriptText}` }
  ];

  const MAX_ITERS = 25;

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      model || 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system:     systemPrompt,
        tools:      [SEARCH_TOOL_ANTHROPIC],
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
    }

    const data = await res.json();

    // Accumulate assistant turn
    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      const textBlock = data.content.find(b => b.type === 'text');
      return parseJsonResponse(textBlock?.text || '');
    }

    if (data.stop_reason !== 'tool_use') {
      throw new Error(`Unexpected stop reason: ${data.stop_reason}`);
    }

    // Execute tool calls in parallel
    const toolResults = await Promise.all(
      data.content
        .filter(b => b.type === 'tool_use' && b.name === 'web_search')
        .map(async b => {
          const results = tavilyKey ? await searchTavily(b.input.query, tavilyKey) : [];
          return {
            type:        'tool_result',
            tool_use_id: b.id,
            content:     formatSearchResults(results, b.input.query),
          };
        })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Agent exceeded search limit — try a shorter video or re-run.');
}

// ─── Single-pass fallback (no Tavily key) ─────────────────────────────────────

function buildSinglePassPrompts(transcript, videoTitle) {
  let transcriptText = buildTranscriptText(transcript);
  const truncated    = transcript.map(s => s.text).join(' ').length > 240000;

  const system = `You are a rigorous fact-checker. Analyse YouTube video transcripts and return structured JSON only — no prose, no markdown fences.`;

  const user = `Fact-check this YouTube video transcript.

Video: "${videoTitle}"

CATEGORIES:
- "verified"   — Well-established, accurate claim per scientific consensus or historical record
- "opinion"    — Subjective view, preference, interpretation, or prediction
- "unverified" — Factual-sounding claim that is disputed, lacks evidence, or needs more research
- "gas"        — Factually wrong, pseudoscientific, absurd, or egregiously misleading

INSTRUCTIONS:
1. Cover the ENTIRE video — claims from beginning, middle, AND end. Aim for 10–30.
2. Keep "claim" under 100 characters
3. Keep "explanation" under 150 characters
4. Set "timestamp" to seconds from the nearest [M:SS] marker${truncated ? '\n5. NOTE: transcript was truncated due to length.' : ''}

Return exactly:
{
  "claims": [
    { "claim": "...", "category": "verified|opinion|unverified|gas", "explanation": "...", "timestamp": 123 }
  ],
  "summary": "1–2 sentence overall assessment."
}

Transcript:
${transcriptText}`;

  return { system, user };
}

async function callProviderSinglePass(system, user, stored) {
  const provider = stored.provider || 'deepseek';
  const model    = stored.selectedModel || '';

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': stored.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      model || 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `Anthropic ${res.status}`); }
    const d = await res.json();
    return parseJsonResponse(d.content?.[0]?.text || '');
  }

  // DeepSeek + OpenAI share the same shape
  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.deepseek.com/chat/completions';
  const apiKey  = provider === 'openai' ? stored.openaiApiKey : stored.deepseekApiKey;
  const isReasoner = model === 'deepseek-v4-pro';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || (provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-v4-flash'),
      max_tokens: 8000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      ...(!isReasoner && { response_format: { type: 'json_object' } }),
      ...(isReasoner  && { reasoning_effort: 'high', thinking: { type: 'enabled' } }),
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API ${res.status}`); }
  const d = await res.json();
  return parseJsonResponse(d.choices?.[0]?.message?.content || '');
}

// ─── Supadata transcript fetch ────────────────────────────────────────────────

async function fetchTranscript(videoId) {
  const { supadataApiKey } = await chrome.storage.local.get('supadataApiKey');
  if (!supadataApiKey) throw new Error('No Supadata API key. Open the TruthLens popup and add your key from supadata.ai');

  const res = await fetch(
    `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { headers: { 'x-api-key': supadataApiKey }, signal: AbortSignal.timeout(60_000) }
  );

  if (res.status === 404) throw new Error('No transcript available for this video.');
  if (res.status === 401) throw new Error('Invalid Supadata API key. Check your key in the TruthLens popup.');
  if (res.status === 429) throw new Error('Supadata rate limit hit. Please wait a moment and try again.');
  if (!res.ok)            throw new Error(`Supadata error: ${res.status}`);

  const data = await res.json();
  console.log('[TruthLens] Supadata response keys:', Object.keys(data));

  const segArray = Array.isArray(data.content)    ? data.content
    : Array.isArray(data.transcript) ? data.transcript
    : Array.isArray(data.chunks)     ? data.chunks
    : Array.isArray(data.segments)   ? data.segments
    : null;

  if (segArray?.length) {
    const segs = segArray.map(seg => ({
      start: seg.offset != null ? seg.offset / 1000 : seg.startMs != null ? seg.startMs / 1000 : seg.start ?? 0,
      text:  String(seg.text ?? seg.content ?? '').trim(),
    })).filter(s => s.text);
    if (segs.length) return segs;
  }

  const raw = data.content ?? data.text ?? data.transcript;
  if (raw) {
    const plain = typeof raw === 'string' ? raw.trim()
      : Array.isArray(raw) ? raw.map(c => typeof c === 'string' ? c : String(c.text ?? c)).join(' ').trim()
      : null;
    if (plain) return [{ start: 0, text: plain }];
  }

  throw new Error('Supadata returned an empty transcript for this video.');
}

// ─── Main orchestration ───────────────────────────────────────────────────────

async function runFactCheck(transcript, videoTitle) {
  const stored = await chrome.storage.local.get([
    'provider', 'selectedModel',
    'deepseekApiKey', 'anthropicApiKey', 'openaiApiKey', 'tavilyApiKey',
  ]);

  const tavilyKey  = stored.tavilyApiKey;
  const provider   = stored.provider || 'deepseek';
  const model      = stored.selectedModel || '';

  // ── No Tavily: single-pass, AI categorizes from training knowledge ──
  if (!tavilyKey) {
    const { system, user } = buildSinglePassPrompts(transcript, videoTitle);
    return callProviderSinglePass(system, user, stored);
  }

  // ── Agentic: AI drives all searches, categorizes only from evidence ──
  const transcriptText = buildTranscriptText(transcript);
  const systemPrompt   = buildAgentSystemPrompt(videoTitle);

  switch (provider) {
    case 'anthropic':
      if (!stored.anthropicApiKey) throw new Error('No Anthropic API key. Click the TruthLens icon to add one.');
      return runAnthropicAgent(transcriptText, systemPrompt, stored.anthropicApiKey, model, tavilyKey);

    case 'openai':
      if (!stored.openaiApiKey) throw new Error('No OpenAI API key. Click the TruthLens icon to add one.');
      return runOpenAIAgent(
        transcriptText, systemPrompt,
        stored.openaiApiKey, model || 'gpt-4o-mini',
        'https://api.openai.com/v1/chat/completions',
        tavilyKey
      );

    case 'deepseek':
    default:
      if (!stored.deepseekApiKey) throw new Error('No DeepSeek API key. Click the TruthLens icon to add one.');
      return runOpenAIAgent(
        transcriptText, systemPrompt,
        stored.deepseekApiKey, model || 'deepseek-v4-flash',
        'https://api.deepseek.com/chat/completions',
        tavilyKey
      );
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
