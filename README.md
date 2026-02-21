![Shot](https://github.com/devohmycode/SuperFlux/blob/master/src-tauri/icons/shot-01.png)
# SuperFlux

A fast, native desktop RSS reader with a resizable 3-panel layout, built-in Reddit comments, AI summaries, text-to-speech, and a collapsible bar mode. Built with Tauri 2 and React 19.

![Shot2](https://github.com/devohmycode/SuperFlux/blob/master/src-tauri/icons/shot-02.png)

## Features

### 3 Resizable Panels

The interface is split into three independently resizable columns with drag handles between them:

| Panel | Default Width | Content |
|-------|--------------|---------|
| **Sources** (left) | 18% | Feed tree organized by type, folders with drag-and-drop, unread counts, favorites, read later |
| **Feed** (center) | 32% | Article list with pagination, time grouping, 3 view modes (normal, compact, cards) |
| **Reader** (right) | 50% | Full article reader, AI summary, TTS, highlights, web view toggle, Reddit comments |

Each panel can be **closed individually** -- it collapses into a thin clickable strip. Toggle panels with keyboard shortcuts `1`, `2`, `3`. Panels resize freely by dragging the handles between them.

### Collapsible Bar Mode
![Shot5](https://github.com/devohmycode/SuperFlux/blob/master/src-tauri/icons/shot-05.png)
Click the collapse button in the title bar and the entire app shrinks into a **slim floating bar** that stays on your desktop. The bar displays:

- **Unread count**, favorites and read-later badges
- **Live weather** with auto-detected geolocation (temperature + weather icon)
- **Live clock** with date
- **Pin button** to keep the bar always on top of other windows

One click expands back to the full 3-panel layout.

### Reddit Feeds with Live Comments

Add any subreddit by typing `r/subredditname` in the add feed dialog. SuperFlux:

- Shows **comment count** on each post in the feed list
- Fetches **live comments** from Reddit's API when reading a post (sorted by best, up to 30 comments)
- Displays author, score, and relative timestamp for each comment inline
- Falls back to cached comment data if the API is unavailable

### 6 Source Types

| Source | Icon | Auto-detection |
|--------|------|----------------|
| Articles / Blogs | `◇` | Any RSS/Atom feed |
| Reddit | `⬡` | `r/name` shorthand or reddit.com URLs |
| YouTube | `▷` | Channel URLs, `@username` handles |
| Twitter / X | `✦` | `@username`, x.com, nitter instances |
| Mastodon | `🐘` | Mastodon / Fosstodon / Hachyderm instances |
| Podcasts | `🎙` | Auto-detected from `audio/*` enclosures |

### AI Summaries (Pro)

Summarize articles or entire feed digests with one click. Two LLM providers:

- **Ollama** (local) -- runs offline with `llama3.2:3b`, models can be pulled directly from Settings
- **Groq** (cloud) -- uses `llama-3.3-70b-versatile` for higher quality

Summary format is configurable: bullet points or paragraph.

### Text-to-Speech

Listen to articles with 3 TTS engine options:

- **Browser** -- Web Speech API, supports pause/resume, adjustable speed (0.5x-2x)
- **Native** -- OS-level TTS via Tauri, adjustable speed
- **ElevenLabs** -- cloud API with configurable voice and model

### Text Highlighting & Notes (Pro)

Select text in any article to highlight it with 5 colors (yellow, green, blue, pink, orange). Add notes to highlights. The highlights menu lists all highlights for the current article with click-to-scroll navigation.

### Podcast Player

Built-in audio player for podcast feeds with:

- Play/pause, skip -15s/+15s
- Speed toggle (0.5x, 1x, 1.25x, 1.5x, 2x)
- Seekable progress bar, volume slider
- Album artwork display

### Full Article Extraction

When RSS content is truncated, SuperFlux automatically fetches the full article from the original site using [Readability](https://github.com/mozilla/readability). A manual "Fetch from original site" button is also available.

### OPML Import

Drag-and-drop or browse to upload `.opml` / `.xml` files exported from any RSS reader. Auto-detects source type from URL patterns.

### RSS Provider Sync

Connect an external RSS service to import subscriptions and sync read status bidirectionally:

- **Miniflux** -- API key authentication
- **FreshRSS** -- Google Reader API
- **Feedbin** -- email/password
- **BazQux** -- Google Reader API compatible

### Cloud Sync

Sign in with a Supabase account to sync feeds, read/star/bookmark status across devices. Bidirectional sync with last-write-wins strategy, runs every 5 minutes.

### Appearance

- **3 themes**: Light, Sepia, Dark with animated circular transition effect
- **Window effects** (Windows): Mica, Acrylic, Blur, Tabbed with adjustable opacity
- **Custom frameless title bar** with minimize, maximize, collapse controls
![Shot4](https://github.com/devohmycode/SuperFlux/blob/master/src-tauri/icons/shot-04.png)
### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Toggle Sources panel |
| `2` | Toggle Feed panel |
| `3` | Toggle Reader panel |
| `↑` `↓` | Navigate articles |
| `Enter` | Open selected article |
| `S` | Toggle star/favorite |

## Pro Plan

SuperFlux is free with generous limits. The Pro plan (one-time purchase) unlocks:

- Unlimited AI summaries (article + feed digest)
- Text highlighting and notes
- 50+ feeds (vs limited in free)
- 10+ folders for organization
- Early access to new features

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | [Tauri v2](https://v2.tauri.app) (Rust) |
| Frontend | [React 19](https://react.dev/), TypeScript, [Vite 7](https://vite.dev/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/), CSS `color-mix()` |
| UI | [Radix UI](https://www.radix-ui.com/), Lucide icons, [Framer Motion](https://www.framer.com/motion/) |
| HTTP | reqwest (rustls) via Tauri commands |
| Auth & Sync | [Supabase](https://supabase.com/) |
| Payments | [LemonSqueezy](https://www.lemonsqueezy.com/) |
| AI | [Groq](https://groq.com/) / [Ollama](https://ollama.com/) |
| TTS | Web Speech API / Native OS / [ElevenLabs](https://elevenlabs.io/) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.77
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Starts Tauri dev mode which launches both Vite (port 5173) and the Rust backend.

### Build

```bash
npm run build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

## Project Structure

```
src/
  App.tsx                    # Root layout with 3-panel orchestration
  main.tsx                   # Entry point, window effect restoration
  types.ts                   # Feed, FeedItem, FeedCategory, TextHighlight types
  index.css                  # Full theme + window effect CSS
  components/
    SourcePanel.tsx           # Panel 1 -- feed tree, folders, sources
    FeedPanel.tsx             # Panel 2 -- article list, view modes, pagination
    ReaderPanel.tsx           # Panel 3 -- reader, web view, comments, TTS
    TitleBar.tsx              # Custom title bar with bar/collapse mode
    AudioPlayer.tsx           # Embedded podcast player
    SettingsModal.tsx         # Settings (account, provider, AI, TTS, appearance)
    UpgradeModal.tsx          # Pro upgrade and license activation
    AddFeedModal.tsx          # Add feed dialog with search
    AuthModal.tsx             # Sign in / sign up modal
    UserMenu.tsx              # User account menu
    ResizeHandle.tsx          # Drag handle between panels
    SyncButton.tsx            # Sync indicator
  services/
    rssService.ts             # RSS/Atom/Reddit/YouTube/Twitter fetching & parsing
    articleExtractor.ts       # Full-text extraction via Readability
    llmService.ts             # AI summary abstraction (Ollama / Groq)
    ttsService.ts             # TTS engine abstraction
    licenseService.ts         # Pro license activation via LemonSqueezy
    syncService.ts            # Supabase cloud sync logic
    feedSearchService.ts      # Feed discovery (Feedly, iTunes, Reddit)
    providerSync.ts           # External provider sync orchestration
    providers/
      miniflux.ts             # Miniflux API client
      googleReader.ts         # Google Reader API (FreshRSS, BazQux)
      feedbin.ts              # Feedbin API client
  hooks/
    useFeedStore.ts           # Feed & article state management
    useHighlightStore.ts      # Highlight persistence
    useResizablePanels.ts     # Panel resize logic
  contexts/
    AuthContext.tsx            # Supabase auth context
    ProContext.tsx             # Pro status management & caching

src-tauri/
  src/lib.rs                  # Tauri commands (fetch, HTTP, window effects, TTS, collapse)
  tauri.conf.json             # Window config (transparent, frameless)
  capabilities/default.json   # Permissions
```

## Configuration

All settings are accessible from the gear icon in the source panel footer:

- **Account** -- Supabase sign-in for cloud sync
- **Superflux Pro** -- License activation or purchase
- **Appearance** -- Window effect type and opacity
- **RSS Provider** -- Miniflux / FreshRSS / Feedbin / BazQux connection
- **AI / Summaries** -- LLM provider, model selection, summary format
- **Text-to-Speech** -- Engine selection, speed, ElevenLabs API config
- **OPML Import** -- Drag-and-drop file upload

Settings are persisted in `localStorage`.

## License

Proprietary. All rights reserved.
