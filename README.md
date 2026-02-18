# SuperFlux

Lecteur RSS moderne et natif, construit avec **Tauri v2**, **React 19** et **TypeScript**. Interface trois panneaux inspiree des lecteurs de flux classiques, avec effets de fenetre natifs, resumes IA et synchronisation multi-providers.

## Fonctionnalites

### Lecture
- **Layout trois panneaux** -- Sources, liste des articles, lecteur -- avec panneaux redimensionnables (poignees + raccourcis `1` `2` `3`)
- **Multi-sources** -- Articles (RSS/Atom), Reddit, YouTube, Podcasts, Mastodon, Twitter/X
- **Modes de lecture** -- Contenu parse, extraction complete (Readability), vue web integree (proxy backend pour contourner X-Frame-Options)
- **Lecteur audio** -- Lecture inline des enclosures podcast
- **Surlignage de texte** -- Selection, 5 couleurs, annotations
- **Favoris & Lire plus tard** -- Etoiles et signets pour acces rapide
- **Import OPML** -- Migration depuis d'autres lecteurs

### IA
- **Resumes d'articles** -- Via Groq (Llama) ou endpoint LLM configurable
- **Format** au choix : puces ou paragraphe

### Sync & Providers
- **Sync cloud Supabase** -- Flux, statut de lecture, etoiles et signets synchronises entre appareils
- **Sync provider RSS** -- Connexion a Miniflux, FreshRSS (Google Reader API) ou Feedbin pour sync bidirectionnelle
- **Recherche de flux** -- Decouverte par URL ou mot-cle

### Apparence
- **Theme sombre / clair** avec toggle anime
- **Effets de fenetre** (Windows) -- Mica, Acrylic, Blur, Tabbed avec opacite ajustable (1-100%)
- **Barre de titre custom** avec mode collapse (bandeau 52px)
- **Fenetre transparente** avec persistance du backdrop DWM au deplacement/redimensionnement

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Shell | [Tauri v2](https://v2.tauri.app) (Rust) |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4, CSS custom avec `color-mix()` |
| UI | Radix UI, Lucide icons, Framer Motion |
| HTTP | reqwest (rustls) via commandes Tauri |
| Auth & Sync | Supabase |
| IA | Groq API / endpoints LLM custom |

## Structure du projet

```
src/
  App.tsx                    # Layout principal 3 panneaux
  main.tsx                   # Point d'entree, restauration des effets fenetre
  types.ts                   # Types Feed, FeedItem, FeedCategory
  index.css                  # Theme complet + CSS effets de fenetre
  components/
    SourcePanel.tsx           # Panneau 1 -- arbre de flux, dossiers, sources
    FeedPanel.tsx             # Panneau 2 -- liste d'articles
    ReaderPanel.tsx           # Panneau 3 -- lecteur, vue web, audio
    TitleBar.tsx              # Barre de titre custom avec collapse
    SettingsModal.tsx         # Parametres (compte, provider, IA, apparence)
    AddFeedModal.tsx          # Dialogue d'ajout de flux
    AudioPlayer.tsx           # Lecteur podcast
    AuthModal.tsx             # Modal connexion/inscription
    UserMenu.tsx              # Menu utilisateur
    ResizeHandle.tsx          # Separateur de panneaux
    SyncButton.tsx            # Indicateur de sync
  services/
    rssService.ts             # Parsing RSS/Atom/Reddit/YouTube
    articleExtractor.ts       # Extraction de contenu complet (Readability)
    llmService.ts             # Abstraction resumes LLM
    groqService.ts            # Integration API Groq
    syncService.ts            # Logique sync Supabase
    providerSync.ts           # Orchestration sync provider
    feedSearchService.ts      # Decouverte de flux
    providers/
      miniflux.ts             # Client API Miniflux
      googleReader.ts         # Google Reader API (FreshRSS)
      feedbin.ts              # Client API Feedbin
  hooks/
    useFeedStore.ts           # Gestion d'etat flux & articles
    useHighlightStore.ts      # Persistance des surlignages
    useResizablePanels.ts     # Logique de redimensionnement
  contexts/
    AuthContext.tsx            # Contexte auth Supabase

src-tauri/
  src/lib.rs                  # Commandes Tauri (fetch, HTTP, effets fenetre, collapse)
  tauri.conf.json             # Config fenetre (transparent, decorations: false)
  capabilities/default.json   # Permissions
```

## Demarrage

### Prerequis

- [Node.js](https://nodejs.org) >= 18
- [Rust](https://rustup.rs) >= 1.77
- [Prerequis Tauri v2](https://v2.tauri.app/start/prerequisites/) pour votre plateforme

### Installation

```bash
git clone https://github.com/user/superflux.git
cd superflux
npm install
```

### Developpement

```bash
npm run dev
```

Lance `tauri dev` qui demarre Vite (port 5173) et le backend Rust simultanement.

### Build

```bash
npm run build
```

Produit les installeurs specifiques a la plateforme dans `src-tauri/target/release/bundle/`.

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| `1` | Afficher/masquer le panneau Sources |
| `2` | Afficher/masquer le panneau Feed |
| `3` | Afficher/masquer le panneau Lecteur |

## Configuration

Tous les parametres sont accessibles depuis l'icone engrenage dans la barre de titre :

- **Compte** -- Connexion Supabase pour sync cloud
- **Provider RSS** -- Connexion Miniflux / FreshRSS / Feedbin
- **IA / Resumes** -- Cle API Groq, modele LLM, format de resume
- **Apparence** -- Type d'effet de fenetre et opacite

Les parametres sont persistes dans `localStorage`.

## Licence

MIT
