# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

SuperFlux is a desktop RSS reader built with **Tauri v2** (Rust backend) + **React 19** / TypeScript / Vite 7 frontend. It features a 3-panel layout, AI summaries, TTS, podcast player, and cloud sync via Supabase. The app runs as a native desktop app; the Rust backend handles all HTTP requests (bypassing CORS), window effects, native TTS, and system info.

## Commands

### Development
```
npm run dev          # Full Tauri dev mode (Vite + Rust backend)
npm run dev:app      # Frontend only (Vite on port 5173, no Tauri)
npm run dev:proxy    # CORS proxy server on port 3001 (for browser-only dev)
```

When developing UI-only changes without Rust, run `dev:app` + `dev:proxy` together. The `tauriFetch.ts` abstraction auto-detects whether Tauri runtime is available and falls back to the proxy.

### Build & Lint
```
npm run build            # Full Tauri build (frontend + Rust → installer)
npm run build:frontend   # TypeScript check + Vite build only
npm run lint             # ESLint on all .ts/.tsx files
```

No test framework is configured.

## Architecture

### Dual Runtime: Tauri vs Browser

The critical abstraction is `src/lib/tauriFetch.ts`. It exposes `fetchViaBackend()` and `httpRequest()` that:
- In Tauri: invoke Rust commands (`fetch_url`, `http_request`) which use a shared reqwest client with proper User-Agent headers per domain (Reddit/YouTube need specific handling)
- In browser: proxy through `localhost:3001` (proxy-server.js)

All network-dependent services **must** use these helpers, never raw `fetch()` for external URLs.

### State Management

No state library — state lives in custom hooks and React context:
- `useFeedStore` (hooks/) — all feed/item CRUD, stored in localStorage. Exposes `FeedStoreCallbacks` for sync integration.
- `useHighlightStore` (hooks/) — text highlight persistence
- `useResizablePanels` (hooks/) — 3-panel layout geometry
- `useCommands` (hooks/) — command palette registration
- `AuthContext` — Supabase auth (email, OAuth via separate Tauri window with PKCE)
- `ProContext` — license/Pro status with 24h cache

State is persisted to **localStorage** under `superflux_*` keys. `fullContent` is stripped before saving items to avoid blowing the quota.

### Sync Architecture (3 layers)

1. **SyncService** (`services/syncService.ts`) — Supabase cloud sync. Debounces item updates, ensures parent feeds exist before upserting items (FK constraint). Uses `superflux-sync-update` custom event to notify UI of remote changes.
2. **ProviderSync** (`services/providerSync.ts`) — bidirectional sync with external RSS providers (Miniflux, FreshRSS, Feedbin, BazQux). Manages `remoteId` mapping between local and provider IDs.
3. **Provider implementations** (`services/providers/`) — implement the `RSSProvider` interface from `types.ts`. Factory pattern via `createProvider()` in `index.ts`.

`App.tsx` wires these together through `FeedStoreCallbacks`: feed/item changes trigger both SyncService and ProviderSync pushes.

### Rust Backend (`src-tauri/src/lib.rs`)

Key Tauri commands:
- `fetch_url` / `http_request` — HTTP with domain-specific headers, shared connection pool
- `collapse_window` / `expand_window` — bar mode with saved geometry
- `set_window_effect` — Windows Mica/Acrylic/Blur with DWM repaint workaround
- `tts_speak` / `tts_stop` — native OS TTS via the `tts` crate
- `tts_speak_elevenlabs` — cloud TTS, returns base64 MP3
- `open_auth_window` — separate Tauri window for OAuth flow, communicates back via `auth-callback` event
- `get_cpu_usage` / `get_memory_usage` / `get_net_speed` — system info via sysinfo

Android builds compile but stub out window/TTS commands (`#[cfg(not(target_os = "android"))]`).

### Supabase Schema

Migrations in `supabase/migrations/`. Core tables: `profiles`, `feeds` (composite PK: `id, user_id`), `feed_items` (FK to feeds with composite key), `user_settings`, `bookmarks`, `editor_documents`, `notes`. All tables have RLS policies scoped to `auth.uid()`.

### Services Layer

- `rssService.ts` — parses RSS/Atom/Reddit JSON/YouTube feeds, resolves YouTube @handles to channel IDs
- `llmService.ts` — AI summaries via Ollama (local) or Groq (cloud), prompts in French
- `ttsService.ts` — TTS abstraction (browser Web Speech / native Tauri / ElevenLabs)
- `articleExtractor.ts` — full-text extraction via @mozilla/readability
- `licenseService.ts` — LemonSqueezy license activation
- `bookmarkService.ts` / `noteService.ts` / `editorDocService.ts` — Supabase CRUD for additional features

### App Modes

The app has 5 brand modes (controlled by `brandMode` state in `App.tsx`): `flux` (RSS reader), `note` (notes), `bookmark` (web bookmarks), `editor` (rich text editor with TipTap), `draw` (drawing canvas). Each mode swaps the 3-panel content.

## Environment Variables

Required in `.env` for full functionality:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — Supabase project
- `VITE_GROQ_API_KEY` — Groq API (optional, for cloud AI summaries)

## Conventions

- UI text and LLM prompts are in **French**
- Path alias: `@/*` → `./src/*`
- Styling: Tailwind CSS v4 with `color-mix()`, themes via CSS classes (`dark`, `sepia`, `amoled`)
- UI components: mix of Radix UI primitives and custom shadcn/ui components in `src/components/ui/`
- Icons: Lucide React
- Animations: Framer Motion
- Feed sources are typed as `FeedSource`: `article | reddit | youtube | twitter | mastodon | podcast`
- Each source has default icon/color in `sourceDefaults` (defined in both `useFeedStore` and `providerSync` — intentionally duplicated to avoid circular deps)
