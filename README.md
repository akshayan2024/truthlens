# TruthLens — YouTube Fact Checker

TruthLens is a Chrome extension that adds a **Fact Check** button to YouTube video pages. It fetches the video transcript, runs an agentic AI pipeline that searches the live web for evidence on every claim, and presents a timestamped, source-backed analysis in a sidebar docked beside the player.

Each claim is classified as:

- **Verified Fact** — directly supported by credible web evidence found during this run.
- **Opinion** — a subjective view, interpretation, preference, or prediction.
- **Unverified** — a factual-sounding claim where no clear evidence was found after searching.
- **Gas** — directly contradicted by credible web evidence; demonstrably false or seriously misleading.

**Verdicts are based on live web search results only — AI training data is never used to reach a fact verdict.**

> TruthLens is an AI-assisted research aid, not a substitute for primary sources or expert verification.

---

## Highlights

- Injects a native-looking **Fact Check** button into the YouTube action row.
- Fetches full timestamped transcripts via [Supadata](https://supadata.ai/).
- **Agentic pipeline**: the AI drives its own web searches using tool calling — it crafts queries, searches multiple times per claim if needed, and only categorises once it has evidence.
- Web verification via [Tavily](https://tavily.com/) — 3 results per claim, filtered to the last 365 days.
- Sources tagged `[CREDIBLE]` or `[UNVERIFIED SOURCE]` before the AI sees them; credible sources (Reuters, BBC, Nature, CDC, Snopes, etc.) carry more weight.
- **Credibility meter** — a Hyped ↔ Helpful score derived from the claim mix, shown above the results.
- Supports **DeepSeek**, **Anthropic (Claude)**, and **OpenAI** models.
- Produces 10–30 concise, timestamped claims spanning the full video.
- Filter claims by category; click any timestamp to seek the video.
- Results cached for one hour per video, provider, and model.
- Handles YouTube's single-page navigation without a full reload.

---

## Stack

| Layer | Technology | Purpose |
|---|---|---|
| Browser extension | Chrome MV3 | Permissions, service worker, content script, popup |
| YouTube integration | Vanilla JS + DOM | Button injection, SPA navigation, playback control |
| Transcript source | [Supadata](https://supadata.ai/) | Server-side transcript fetch with timestamps |
| Web verification | [Tavily](https://tavily.com/) | Live web search — 3 results per claim, recency-filtered |
| AI agent | DeepSeek / Anthropic / OpenAI | Tool-call loop: searches Tavily, categorises from evidence |
| Interface | HTML, CSS, Vanilla JS | Settings popup + docked iframe sidebar |
| Storage | `chrome.storage.local` | API keys and one-hour cached analyses |

No build step, framework, backend server, or npm dependency. Load the repo directly as an unpacked extension.

---

## What You Need

TruthLens requires **three API keys**:

1. **Supadata** — transcript retrieval → [supadata.ai](https://supadata.ai/)
2. **One AI provider** — the agent that fact-checks:
   - [DeepSeek](https://platform.deepseek.com/)
   - [Anthropic](https://console.anthropic.com/)
   - [OpenAI](https://platform.openai.com/)
3. **Tavily** — live web search for evidence → [tavily.com](https://tavily.com/)

> Without a Tavily key the extension falls back to a single-pass AI analysis using training knowledge only. Adding Tavily is strongly recommended — it's what prevents the AI from making up verdicts.

Keys are stored locally via `chrome.storage.local` and never committed to this repository.

---

## Installation

### 1. Clone or download

```bash
git clone https://github.com/akshayan2024/truthlens.git
```

### 2. Generate icons

Open `icons/generate-icons.html` in Chrome, click **Download All PNGs**, and place `icon16.png`, `icon48.png`, and `icon128.png` in `icons/`.

### 3. Load as unpacked extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the cloned folder

### 4. Configure keys

1. Click the TruthLens toolbar icon
2. Select your AI provider and model, paste your API key, save
3. Under **Transcript Source**, paste your Supadata key, save
4. Under **Web Verification**, paste your Tavily key, save

---

## Usage

1. Open a YouTube video with an available transcript.
2. Click **Fact Check** in the video action row (below the title).
3. TruthLens fetches the transcript, runs the agentic pipeline, and populates the sidebar.
4. The **credibility meter** at the top gives an overall Hyped ↔ Helpful verdict.
5. Filter by **Fact / Opinion / Unverified / Gas** tabs.
6. Click any timestamp (↳ M:SS) to seek the video to that moment.
7. Click a source link (↗ domain.com) to open the web evidence.
8. Use the **refresh icon** to bypass the cache and re-run.

---

## How It Works

```
YouTube page
  → content.js injects the Fact Check button and sidebar iframe
  → user clicks Fact Check
  → background.js fetches the timestamped transcript via Supadata
  → agentic loop begins:
      AI identifies a claim
      AI calls web_search(query) → Tavily returns 3 results tagged [CREDIBLE] or [UNVERIFIED]
      AI searches again if results are poor
      AI categorises the claim from search evidence only
      loop repeats for all claims (up to 25 Tavily calls)
  → hard enforcement: any claim with no search results → forced "unverified"
  → result cached in chrome.storage.local for one hour
  → sidebar renders credibility meter, filter tabs, and claim cards with sources
```

### Fallback (no Tavily key)

The AI analyses the transcript in a single pass using training knowledge. Verdicts will be less reliable and may reflect the model's training cutoff rather than current facts.

---

## Repository Layout

```
manifest.json          Chrome MV3 configuration and permissions
src/
  content.js           Button injection, sidebar bridge, SPA navigation, heartbeat
  background.js        Transcript fetch, agentic loop, Tavily search, cache
popup/
  popup.html           Settings UI
  popup.js             Provider/model/key management
sidepanel/
  index.html           Sidebar structure
  script.js            Result rendering, filters, credibility meter, timestamps
  style.css            Research field-notebook design system
icons/                 SVG source and PNG icon generator
```

---

## Supported Models

| Provider | Models | Default |
|---|---|---|
| DeepSeek | V4 Flash ★, V4 Pro (reasoner), V3 | V4 Flash |
| Anthropic | Claude Haiku 4.5, Sonnet 4.6, Opus 4.8 | Claude Haiku 4.5 |
| OpenAI | GPT-4o Mini, GPT-4o, GPT-4.1 | GPT-4o Mini |

Provider + model are part of the cache key — switching either triggers a fresh analysis.

**Note on DeepSeek V4 Pro:** the reasoner model does not support tool calling. It falls back to single-pass analysis (no Tavily searches).

---

## Source Credibility

Tavily results are tagged before being shown to the AI:

- `[CREDIBLE]` — domain is on TruthLens's credibility list (Reuters, AP, BBC, Nature, CDC, WHO, Snopes, FactCheck.org, NEJM, Wikipedia, Britannica, etc.)
- `[UNVERIFIED SOURCE]` — everything else

The AI is instructed: a claim confirmed only by an unverified source → `unverified`. A claim contradicted by a credible source → `gas` even if a low-quality source agrees. No evidence at all → `unverified`, enforced in code after the AI responds.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Fact Check button missing | Refresh the YouTube page; YouTube changes its markup frequently |
| No transcript available | The video may have no captions, or Supadata may not support it |
| Analysis fails immediately | Confirm all three keys are saved in the popup |
| Results seem outdated | Click the refresh icon to bypass the one-hour cache |
| All claims return "unverified" | Your Tavily key may be missing or rate-limited — check the popup |
| Provider request blocked | Confirm the provider's domain is in `host_permissions` in `manifest.json`, then reload the extension |

---

## Development

After editing any file:

1. Go to `chrome://extensions`
2. Click **Reload** on TruthLens
3. Refresh the YouTube tab

Service worker logs: click the **service worker** link on the extension card.  
Sidebar logs: open DevTools on the YouTube tab → Sources → find the sidebar iframe.

---

## Privacy

- API keys and cached results stay in your local Chrome profile (`chrome.storage.local`).
- Video transcripts are sent to Supadata and then to your chosen AI provider.
- Claim text is sent to Tavily for web search.
- Do not use TruthLens with confidential or sensitive video content unless you are comfortable with those third-party services processing the transcript.

---

## License

No license specified. Add one before distributing or accepting external contributions.
