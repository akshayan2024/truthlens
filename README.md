# TruthLens — YouTube Fact Checker

TruthLens is a Chrome extension that adds an **Fact Check** button to YouTube video pages. It retrieves a video's transcript, asks your chosen AI provider to assess the most meaningful claims throughout the video, and presents a timestamped analysis beside the player.

Each claim is classified as:

- **Verified fact** — well-supported by established evidence or historical record.
- **Opinion** — a subjective view, interpretation, preference, or prediction.
- **Unverified** — a factual-sounding claim that needs stronger evidence or context.
- **Gas** — a false, pseudoscientific, absurd, or seriously misleading claim.

> TruthLens is an AI-assisted research aid, not a substitute for primary sources or expert verification. Treat results as a starting point for further checking.

## Highlights

- Adds a native-looking **Fact Check** action to YouTube watch pages.
- Fetches timestamped transcripts through Supadata.
- Supports **DeepSeek**, **Anthropic (Claude)**, and **OpenAI** models.
- Produces 10–30 concise, timestamped claims spanning the video.
- Lets you filter claims by category and jump directly to each moment.
- Caches results for one hour per video, provider, and model.
- Handles YouTube's single-page navigation without a full reload.

## Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Browser extension | Chrome Extension Manifest V3 | Permissions, service worker, content script, and popup |
| YouTube integration | Vanilla JavaScript + DOM APIs | Injects the action button, responds to YouTube navigation, and controls playback |
| Transcript source | [Supadata](https://supadata.ai/) | Retrieves the video's transcript and timestamps |
| AI analysis | DeepSeek, Anthropic, or OpenAI APIs | Categorises claims and writes short explanations |
| Interface | HTML, CSS, vanilla JavaScript | Settings popup and docked iframe sidebar |
| Storage | `chrome.storage.local` | Stores API settings and one-hour cached analyses |

There is no build step, framework, backend server, or npm dependency: load the repository directly as an unpacked Chrome extension.

## What You Need

TruthLens requires **two keys**:

1. A **Supadata API key** for transcript retrieval.
2. An API key from **one** supported AI provider:
   - [DeepSeek](https://platform.deepseek.com/)
   - [Anthropic](https://console.anthropic.com/)
   - [OpenAI](https://platform.openai.com/)

Keys are entered through the extension popup and stored locally in Chrome using `chrome.storage.local`. They are never committed to this repository. Keep your keys private and monitor usage/costs in the respective provider dashboards.

## Installation

### 1. Clone or download the repository

```bash
git clone https://github.com/akshayan2024/truthlens.git
```

### 2. Generate extension icons

Open `icons/generate-icons.html` in Chrome, click **Download All PNGs**, and place the generated `icon16.png`, `icon48.png`, and `icon128.png` files in `icons/`.

### 3. Load the unpacked extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the cloned `truthlens` folder.

### 4. Configure your keys

1. Click the TruthLens icon in Chrome's toolbar.
2. Select DeepSeek, Anthropic, or OpenAI and choose a model.
3. Paste and save that provider's API key.
4. Paste and save your Supadata API key.

## Using TruthLens

1. Open a YouTube video with an available transcript.
2. Click **Fact Check** in the video action row.
3. Wait while TruthLens fetches the transcript and runs the analysis.
4. Browse the claims in the docked sidebar.
5. Select a category tab to filter the list, or click a timestamp to seek the video.
6. Use the refresh icon to bypass the cache and re-run the analysis.

## How It Works

```text
YouTube watch page
  → content script injects the Fact Check button and sidebar
  → background service worker receives the video ID and title
  → Supadata returns a timestamped transcript
  → selected AI provider returns structured claim JSON
  → result is cached in chrome.storage.local for one hour
  → sidebar renders categories, explanations, filters, and seek links
```

### Repository Layout

```text
manifest.json           Chrome MV3 configuration
src/content.js          YouTube button injection, sidebar bridge, navigation handling
src/background.js       Transcript retrieval, AI-provider calls, JSON parsing, cache
popup/                  Provider/model/API-key settings UI
sidepanel/              Result rendering, filters, status states, timestamp controls
icons/                  SVG source and PNG-icon generator
```

## Supported Providers and Defaults

| Provider | Available models in the popup | Default |
| --- | --- | --- |
| DeepSeek | V4 Flash, V4 Pro, V3 | V4 Flash |
| Anthropic | Claude Haiku 4.5, Sonnet 4.6, Opus 4.8 | Claude Haiku 4.5 |
| OpenAI | GPT-4o Mini, GPT-4o, GPT-4.1 | GPT-4o Mini |

The active provider and selected model are part of the cache identity, so changing either causes a fresh analysis.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| The Fact Check button is missing | Refresh the YouTube page; YouTube frequently changes its page markup. |
| No transcript is available | The video may not have captions, or Supadata may not support it. |
| The analysis fails immediately | Confirm both your Supadata key and selected AI-provider key are saved. |
| Results seem stale | Click the refresh icon in the sidebar to bypass the one-hour cache. |
| A provider request is blocked | Confirm that the provider's API domain is listed in `host_permissions` in `manifest.json`, then reload the extension. |

## Development

After editing files:

1. Return to `chrome://extensions`.
2. Click **Reload** on TruthLens.
3. Refresh the YouTube tab.

Chrome service-worker logs are available from the extension card's **service worker** link. Page integration issues can be inspected from the YouTube tab's DevTools console.

## Privacy and Security

- API keys and cached results are stored in the local Chrome profile.
- Transcripts are sent to Supadata and then to the AI provider you select.
- Do not use the extension with confidential or sensitive video content unless you are comfortable with those services processing the transcript.

## License

No license has been specified yet. Add a license file before distributing or accepting external contributions.
