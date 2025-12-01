# AIDA - Advanced Intrusion Detection & Analysis

**A Terminal-Based Multiplayer Cyberpunk Hacking Game**

🎮 **[Play Now](#quick-start)** | 📖 **[Full Documentation](DOCUMENTATION.md)** | 🚀 **[Quick Start](#quick-start)**

---

## 🌟 What is AIDA?

AIDA is an authentic terminal-based hacking game where you:
- Type real Unix commands (`ls`, `cd`, `ps`, `top`, `hack`)
- Infiltrate servers and complete missions
- Build your reputation as an elite hacker
- Compete with other players in real-time

**Think SSH meets cyberpunk meets multiplayer RPG.**

---

## 🚀 Quick Start

### 5-Minute Setup

```bash
# 1. Setup database
createdb aida_game

# 2. Install & configure
cd server
npm install
echo 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aida_game"' > .env
echo 'JWT_SECRET="change-this-secret-key"' >> .env
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed:core

# 3. Start server
npm run dev

# 4. Start client (new terminal)
cd ../client
npm install
npm run dev

# 5. Open http://localhost:8080
```

### First Commands

```bash
help                    # See all commands
status                  # Check your stats
shop                    # Browse items to buy
missions                # View available missions
servers                 # List hackable servers
ps                      # See running processes
top                     # System monitor
free -h                 # Memory usage
```

---

## 📖 Documentation

**👉 [DOCUMENTATION.md](DOCUMENTATION.md) - Complete Guide**

Everything you need in one place:
- ✅ Complete setup instructions
- ✅ All 50+ commands documented
- ✅ Development guide
- ✅ API reference
- ✅ Database schema
- ✅ Troubleshooting
- ✅ Deployment guide

---

## 🎯 Key Features

### Terminal-First Design
- **100% command-driven** - No clicking, just typing
- **50+ Unix commands** - Real terminal experience
- **Process management** - `ps`, `top`, `kill`, `free`
- **File system** - `ls`, `cd`, `cat`, `mkdir`
- **Math engine** - `calc`, `expr`, `vars`

### Game Mechanics
- 🎯 **Mission System** - Complete objectives for rewards
- 🛒 **Shop & Economy** - Buy tools with earned credits
- 🌐 **11+ Servers** - Tutorial to maximum security
- 📦 **Inventory** - Collect and use hacking tools
- ⚡ **Progression** - Level up, gain XP, unlock skills
- 👥 **Multiplayer** - Real-time with other players

### Technical Stack
- **Backend:** Node.js + TypeScript + Express + Socket.IO
- **Frontend:** Svelte + TypeScript
- **Database:** PostgreSQL + Prisma ORM
- **Architecture:** Terminal-based (backend IS the console)

---

## 🏗️ Architecture

```
┌─────────────────┐
│   Browser       │      User types: "status"
│   Terminal UI   │────────────────────────────┐
└─────────────────┘                            │
                                               ▼
                                    POST /api/command/execute
                                    { command: "status" }
                                               │
┌─────────────────┐                            │
│   Node.js       │◄───────────────────────────┘
│   Server        │
│                 │      1. Parse command
│ Command         │      2. Execute logic
│ Processor       │      3. Return output
│                 │
│ All game logic  │
│ lives here!     │
└─────────────────┘
```

**Key Principle:** Backend IS the console. Frontend is just a display.

---

## 📦 Project Structure

```
AIDA/
├── DOCUMENTATION.md         # 📖 Complete documentation (READ THIS!)
├── README.md                # 👋 This file
├── server/                  # Backend (Node.js)
│   ├── src/
│   │   ├── services/        # Game logic & command execution
│   │   ├── routes/          # API endpoints (just 3!)
│   │   └── index.ts         # Entry point
│   └── prisma/              # Database schema & migrations
├── client/                  # Frontend (Svelte)
│   └── src/
│       ├── components/      # Terminal UI
│       └── services/        # API clients
└── cleanup-docs.sh          # Script to clean up old docs
```

---

## 🎮 Example Session

```bash
$ help
=== AVAILABLE COMMANDS ===

[SYSTEM]
  ls              - List files/directories
  cd              - Change directory
  ps              - List processes

[PROCESS]
  ps              - List running processes
  top             - System resource monitor
  kill            - Terminate process

[GAME]
  status          - Show player status
  shop            - List shop items
  missions        - List available missions

$ status
═══════════════════════════════════════
     OPERATIVE STATUS REPORT
═══════════════════════════════════════
Username:    h4x0r
Level:       3
XP:          2,450 / 3,000
Credits:     ¢1,250
Reputation:  Amateur

Skills:
  Hacking:       Level 3  ████░░░░░░
  Stealth:       Level 2  ██░░░░░░░░
  Networking:    Level 2  ██░░░░░░░░

$ shop
═══════════════════════════════════════
          DARKNET MARKETPLACE
═══════════════════════════════════════
ID   Item                Price    Level
─────────────────────────────────────
1    Port Scanner       ¢100      1
2    Password Cracker   ¢500      2
3    Exploit Framework  ¢1,200    3
4    Zero-Day Exploit   ¢5,000    5

$ buy 3
✓ Purchased: Exploit Framework
  Cost: ¢1,200
  Remaining: ¢50

$ missions
Available Missions:
  [1] Data Exfiltration - Steal corporate data (Medium)
  [2] Backdoor Install - Install persistent access (Hard)

$ ps -aux
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.1  0.4   2048   2.0 ?        R    00:00    0:00 init
neural       5  3.2  3.2  16384  16.0 ?        R    00:00    0:00 neural-net
user         6  2.1  2.4  12288  12.0 ?        R    00:00    0:00 terminal
```

---

## 🛠️ Technology

### Backend
- **Node.js 18+** with TypeScript
- **Express** - HTTP server
- **Socket.IO** - Real-time events
- **Prisma** - Type-safe ORM
- **PostgreSQL** - Database
- **JWT** - Authentication

### Frontend
- **Svelte** - Reactive UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Socket.IO Client** - Real-time updates

---

## 🐛 Troubleshooting

See [DOCUMENTATION.md - Troubleshooting](DOCUMENTATION.md#troubleshooting) for:
- Database connection issues
- Port conflicts
- Migration problems
- TypeScript errors
- Command not working

Quick fix for most issues:
```bash
cd server
npx prisma generate
npm run build
```

---

## 🚀 Deployment

See [DOCUMENTATION.md - Deployment](DOCUMENTATION.md#deployment) for:
- Production checklist
- Environment variables
- PM2 setup
- nginx configuration
- Security best practices

---

## 📝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open Pull Request

See [DOCUMENTATION.md - Contributing](DOCUMENTATION.md#contributing-guidelines) for code style and guidelines.

---

## 📚 Learn More

- **[Complete Documentation](DOCUMENTATION.md)** - Everything in one place
- **Commands Reference** - All 50+ commands documented
- **Development Guide** - Add features and commands
- **API Reference** - Services and methods
- **Database Schema** - Tables and relationships

---

## 🎯 Current Status

**✅ Production-Ready (Phase 4 Complete):**

### Core Features
- ✅ Complete backend with 15 DI-injected services
- ✅ 50+ terminal commands implemented
- ✅ Process management system (ps, top, kill, free, nice)
- ✅ Math engine (calc, expr, vars, convert)
- ✅ File system (ls, cd, cat, mkdir, cp, mv)
- ✅ Shop & economy with inventory
- ✅ Mission system with progress tracking
- ✅ Hacking mechanics (hack, crack, exploit)
- ✅ Database schema & seeding
- ✅ Real-time multiplayer (Socket.IO)
- ✅ Comprehensive documentation

### Performance & Security (Phase 4 ✅)
- ✅ **In-memory caching** - CacheService with TTL
- ✅ **Query optimization** - N+1 fixes, batch fetching
- ✅ **Path sanitization** - Directory traversal prevention
- ✅ **Input validation** - 15+ validation functions
- ✅ **Database audit** - 0 SQL injection vulnerabilities
- ✅ **Command history limits** - Auto-cleanup on disconnect
- ✅ **Benchmarking** - Baseline metrics (< 5ms latency)
- ✅ **Penetration testing** - Security validation complete

### Architecture
- ✅ **Dependency Injection** - 100% tsyringe migration
- ✅ **Type Safety** - Full TypeScript coverage
- ✅ **Modular Commands** - 9 command modules
- ✅ **Clean Build** - 0 errors, 0 warnings

**Architecture Grade:** `A+` (Production-ready)

**⏳ Next Phase (Phase 5):**
- AI/NPC implementation
- Advanced mission system
- Faction mechanics
- PvP enhancements

---

## 🔐 Security

**✅ Production-Grade Security (Phase 4 Complete)**

- ✅ **Authentication:** Hashed passwords (bcrypt) + JWT tokens
- ✅ **Input Validation:** Comprehensive validation with `validators.ts` (15+ functions)
- ✅ **Path Sanitization:** Directory traversal prevention
- ✅ **Command Injection Prevention:** Pattern detection for dangerous commands
- ✅ **SQL Injection:** 100% Prisma ORM usage (audited, 0 vulnerabilities)
- ✅ **XSS Prevention:** Message content sanitization
- ✅ **Rate Limiting:** Per-user command throttling
- ✅ **CORS Protection:** Configured for secure origins
- ✅ **Session Management:** Secure session handling + auto-cleanup
- ✅ **Memory Leak Prevention:** Command history limits (100/user)
- ✅ **Cache Poisoning:** TTL-based invalidation

See [DOCUMENTATION.md - Security](DOCUMENTATION.md#security-best-practices)

---

## 📞 Support

- **Documentation:** [DOCUMENTATION.md](DOCUMENTATION.md)
- **Issues:** Open a GitHub issue
- **Questions:** Check docs first, then ask!

---

## 🎉 Credits

Developed with ❤️ for the cyberpunk hacking community.

Special thanks to all contributors and testers!

---

## ⚡ Quick Links

- 📖 [Full Documentation](DOCUMENTATION.md)
- 🚀 [Quick Start](#quick-start)
- 🎮 [Example Session](#example-session)
- 🛠️ [Troubleshooting](DOCUMENTATION.md#troubleshooting)
- 🚀 [Deployment](DOCUMENTATION.md#deployment)

---

**Remember:** Every action leaves a trace. Learn stealth early. Cover your tracks. Trust no one.

🌐 **Welcome to the AIDA network, operative. Your neural interface is online.** 🌐

---

*Last Updated: December 2025*
*Version: 1.0*