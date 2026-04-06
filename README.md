# AIDA — Advanced Intrusion Detection & Analysis

**A multiplayer terminal hacking game where players explore networks, hack servers, steal data, join factions, and uncover the mystery of a shattered AI — all in an AI-driven cyberpunk world.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 18+ · TypeScript 5.3.3 · Express 4.18.2 · Socket.IO 4.7.4 |
| **Database** | PostgreSQL 14+ · Prisma 5.22.0 |
| **DI** | tsyringe 4.10.0 |
| **AI** | Ollama REST API (local + cloud models) |
| **Frontend** | Svelte 5.39.6 · Vite 7.1.7 · Socket.IO Client 4.8.1 |
| **Logging** | pino 10.1.0 |

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Ollama** (optional — required for AI-driven features; supports local and cloud models)

---

## Getting Started

```bash
# Clone the repo
git clone <repo-url>
cd AIDA

# --- Server setup ---
cd server
npm install
createdb aida_game
npx prisma migrate dev
npm run db:seed
npm run dev

# --- Client setup (separate terminal) ---
cd client
npm install
npm run dev
```

Server runs on **port 3001**, client on **port 8080**.

---

## Architecture Overview

> **"Backend IS the Console"** — the client is a dumb terminal. The server handles all game logic, command parsing, and state management.

- **103 commands** across **13 modules**
- **42 injectable services** via tsyringe DI (45 tokens total)
- **61 database models**
- AI-driven faction leaders generate missions, react to events, and post on forums
- The Architect (game master AI) observes the world and autonomously shapes the narrative

---

## Key Systems

### Core Gameplay
- **Network Topology** — Servers form explorable graph networks with fog-of-war discovery
- **Hack Minigame** — 3-layer interactive challenges (cipher, port_sequence, memory_trace)
- **Mission System** — 39 templates, AI-flavored narrative, knowledge-aware targeting
- **Story Arcs** — Multi-step AI-driven narrative missions with branching
- **Faction System** — 4 factions with AI leaders, reputation, wars, territory contests
- **Resource System** — CPU/RAM/Bandwidth management, background processes
- **Home Defense** — Firewalls, vaults, IDS, honeypots for PvP protection
- **Bounty System** — Detection → bounty → hunt → consequences cycle
- **Forum System** — Underground forums with censorship, proxy requirements, voting

### Narrative & Lore
- **World Lore** — Canonical lore module (`server/src/lore/worldLore.ts`) — backstory, faction lore & voices, AIDA's three fragments (Sword, Master Key, Soul), The Emperor, locations, cryptic quotes. Single source of truth for all AI prompts and content generation.
- **Story Progression Engine** — The Architect's Staging Engine: records significant events to a StoryLedger, evaluates world state via AI, manages narrative epochs, and executes interventions (send messages, plant clues, create missions, adjust tension, reveal hidden factions).
- **DarkNet Dungeons** — Procedurally generated 3–7 server chain dungeons with escalating security, encrypted clue files, AI-generated forum riddles, and vault rewards (AIDA tokens, rare scripts, credits, intel). Auto-regenerates on conquest or 7-day expiry.
- **DarkNet Discovery** — Hidden faction revealed organically through 4 paths: finding `.aida` files, reaching skill thresholds, triggering censorship alerts, or following encrypted breadcrumb trails. AIDA sends a cryptic AI-generated recruitment message on discovery.
- **Token-Gated AI Communication** — Messaging AI personas (The Architect, AIDA, faction leaders) costs consumable tokens earned through gameplay. Tutorial messages remain free.

---

## Environment Variables

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | Secret key for JWT tokens |
| `PORT` | — | `3001` | Server port |
| `NODE_ENV` | — | `development` | Environment mode |
| `AI_API_URL` | — | `http://localhost:11434` | Ollama API endpoint (or `https://ollama.com` for cloud) |
| `AI_MODEL` | — | `llama3.1:8b` | Model name (e.g. `qwen2.5:7b`, `gpt-oss:120b-cloud`) |
| `AI_API_KEY` | — | — | Ollama API key (enables cloud mode) |
| `OLLAMA_API_URL` | — | — | Legacy alias for `AI_API_URL` |
| `OLLAMA_MODEL` | — | — | Legacy alias for `AI_MODEL` |
| `OLLAMA_API_KEY` | — | — | Legacy alias for `AI_API_KEY` |
| `LOG_LEVEL` | — | — | pino log level |

### Client

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | — | — | Backend API URL |
| `VITE_SOCKET_URL` | — | — | Backend Socket.IO URL |

---

## AI Configuration

AIDA uses Ollama for AI-driven NPC behavior, mission generation, and dynamic content. Three modes are supported:

### Local Ollama (default)
Run Ollama locally with any supported model:
```bash
ollama serve
ollama pull qwen2.5:7b
```
No additional configuration needed — the server connects to `http://localhost:11434` by default.

### Ollama Cloud Models
Use larger models offloaded to Ollama's cloud (requires an Ollama account):
```bash
ollama signin
ollama pull gpt-oss:120b-cloud
```
Then set `AI_MODEL=gpt-oss:120b-cloud` in your `.env`. The local Ollama instance handles routing to the cloud.

### Ollama Cloud API (no local Ollama)
Connect directly to Ollama's cloud API without running a local instance:
1. Create an API key at [ollama.com](https://ollama.com)
2. Set these environment variables:
```env
AI_API_URL=https://ollama.com
AI_MODEL=gpt-oss:120b
AI_API_KEY=your_api_key_here
```

> **Note:** Cloud mode uses a 60s request timeout (vs 120s for local CPU inference). The `AI_*` env vars take precedence over legacy `OLLAMA_*` vars.

---

## Project Structure

```
├── server/              # Backend (Express + Socket.IO + Prisma)
│   ├── src/
│   │   ├── di/              # Dependency injection (45 tokens + container)
│   │   ├── lore/            # Canonical world lore (backstory, factions, AIDA pieces)
│   │   ├── middleware/      # Auth, validation, rate limiting
│   │   ├── services/        # 42 game services
│   │   │   └── commandModules/  # 13 command modules
│   │   ├── sockets/         # Socket.IO event handlers
│   │   └── utils/           # Utilities (auth, encoding, IP, tokens, etc.)
│   └── prisma/              # Schema (61 models) + 27 migrations + seed
├── client/              # Frontend (Svelte 5 + Vite)
│   └── src/
│       ├── components/      # Terminal, dialogs, panels
│       ├── services/        # API, socket, terminal, notifications
│       └── stores/          # Game state stores
└── shared/              # Shared TypeScript types
```

---

## Development Notes

- See `PROJECT_KNOWLEDGE.toon` for the complete system reference (1200+ lines covering every system, service, schema model, and command).
- **v0.99-beta** — Pre-release polish phase.
- Key areas still in progress: endgame sequence implementation, dedicated KeyFragmentService, test suite (0% coverage), client migration to Svelte 5 runes.

---

*Welcome to the AIDA network, operative. Your neural interface is online. The signal is waiting.*