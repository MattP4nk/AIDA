# AIDA - Advanced Intrusion Detection & Analysis

**A Terminal-Based Multiplayer Hacking Game**

Version: 1.0  
Last Updated: December 2024

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Project Health Status](#project-health-status)
4. [Setup & Installation](#setup--installation)
5. [Commands Reference](#commands-reference)
6. [Development Guide](#development-guide)
7. [Project Structure](#project-structure)
8. [Services & API](#services--api)
9. [Database Schema](#database-schema)
10. [Troubleshooting](#troubleshooting)
11. [Deployment](#deployment)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### 5-Minute Setup

```bash
# 1. Clone and setup database
createdb aida_game

# 2. Configure server
cd server
npm install
cat > .env << EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/aida_game"
JWT_SECRET="your-secret-key-change-this"
PORT=3001
EOF

# 3. Initialize database
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed:core

# 4. Start server
npm run dev

# 5. Setup client (new terminal)
cd ../client
npm install
npm run dev

# 6. Open browser
# Navigate to http://localhost:8080
```

### First Commands

```bash
help                    # See all commands
status                  # Check your stats
shop                    # Browse items
missions                # View objectives
servers                 # List available servers
```

---

## 🏗️ Architecture

### Core Principle: Backend IS the Console

AIDA uses a **terminal-based architecture** where:
- **Frontend** = Dumb terminal (display only)
- **Backend** = The actual console (all logic)
- **Commands** = Primary interface (not REST endpoints)

```
┌─────────────────┐
│   Browser       │
│   Terminal UI   │
│   - Input       │
│   - Output      │
└────────┬────────┘
         │
         │ POST /api/command/execute
         │ { command: "status" }
         │
         ▼
┌─────────────────┐
│   Node.js       │
│   Server        │
│   - Parse       │
│   - Execute     │
│   - Return      │
└─────────────────┘
```

### Routes (Only 3!)

```
POST /api/command/execute    ← ALL commands go here
POST /api/auth/login         ← Authentication
POST /api/auth/register      ← User registration
GET  /health                 ← Health check
```

**Everything is a command** - no separate REST routes for game actions.

### Session-Based Architecture

Each user gets:
- Isolated process tree (simulated Unix system)
- Memory management (128MB per session)
- File system (virtual filesystem per server)
- Command history
- Auto-cleanup after 30min inactivity

---

## 🏥 Project Health Status

**Last Audit:** November 28, 2024  
**Overall Status:** ✅ Modular Refactoring **COMPLETE**  
**Architecture Compliance:** 95% → **Working towards 100%**

### Server Status: ✅ **EXCELLENT** - Refactoring Complete

**Routes:** ✅ Clean
- ✅ Only 3 routes: `auth.ts`, `command.ts`, and `health`
- ✅ No legacy REST endpoints
- ✅ Architecture: Backend IS the console

**Services:** ✅ Complete (14 services)
- ✅ `commandProcessor.ts` - **Refactored** (~750 lines, down from 3100!)
- ✅ `memoryService.ts` - Process management
- ✅ `hackService.ts` - Hacking mechanics (now supports exploit, backdoor, rootkit)
- ✅ `missionService.ts` - Mission system
- ✅ `shopService.ts` - Shop & inventory
- ✅ `progressService.ts` - XP & levels
- ✅ `fileService.ts` - Virtual filesystem
- ✅ `messageService.ts` - Messaging (used by social commands)
- ✅ `forumService.ts` - Forum system
- ✅ `serverService.ts` - Server management
- ✅ `eventService.ts` - Event system
- ✅ `gameStateManager.ts` - Game state
- ✅ `ipService.ts` - IP generation
- ✅ `playerPresenceService.ts` - Online tracking

**Command Modules:** ✅ **ALL 9 MODULES COMPLETE**
- ✅ `commandModules/systemCommands.ts` - 11 commands (ls, cd, pwd, cat, etc.) + `getCommandInfo()`
- ✅ `commandModules/fileCommands.ts` - 5 commands (upload, download, encrypt) + `getCommandInfo()`
- ✅ `commandModules/socialCommands.ts` - **7 commands (msg, mail, inbox, contact, chat, forum, proxy) + `getCommandInfo()`**
- ✅ `commandModules/processCommands.ts` - 9 commands (ps, top, kill, free) + `getCommandInfo()`
- ✅ `commandModules/mathCommands.ts` - 8 commands (calc, expr, vars) + `getCommandInfo()`
- ✅ `commandModules/networkCommands.ts` - 6 commands (scan, connect) + `getCommandInfo()`
- ✅ `commandModules/hackCommands.ts` - **5 commands (hack, crack, exploit, backdoor, rootkit) + `getCommandInfo()`**
- ✅ `commandModules/gameCommands.ts` - 14 commands (status, missions, shop) + `getCommandInfo()`
- ✅ `commandModules/helpCommands.ts` - 4 commands (help, man, history, stats) + `getCommandInfo()`

**Modularization Progress:** ✅ **100% - ALL COMMANDS MODULAR**

**Recent Achievements (Nov 28, 2024):**
- ✅ Implemented `getCommandInfo()` in all 9 modules for dynamic command discovery
- ✅ Refactored `commandProcessor.ts` to use dynamic module-based routing
- ✅ Removed 2000+ lines of legacy code from `commandProcessor.ts`
- ✅ Implemented missing hack commands (exploit, backdoor, rootkit)
- ✅ Implemented all social commands (msg, mail, inbox, contact, chat)
- ✅ **Implemented complete forum command** (scan, access, register, post, read, search)
- ✅ **Implemented complete proxy command** (list, connect, disconnect, status)
- ✅ Removed redundant darkweb command (covered by forum system)
- ✅ Cleaned up client forumSystem.ts (965 lines → 103 lines, UI-only)
- ✅ Added `HackMethod.ROOTKIT` to shared types
- ✅ Build passes with 0 errors

**Build:** ✅ Clean
- ✅ TypeScript compiles without errors
- ✅ No warnings
- ✅ All imports resolve correctly
- ✅ All 9 modules have consistent interfaces

**Known Technical Debt:**
- ⚠️ **12 TODO items** across services (see [Technical Debt](#technical-debt))
- ⚠️ **Session management** disabled in 3 locations (needs re-enabling)
- ⚠️ **Mixed export patterns** (default vs named) - needs standardization
- ⚠️ **GameStateManager** missing inventory/missions/notifications integration

### Client Status: ⚠️ GOOD (Needs Cleanup)

**Architecture:** ✅ Mostly Compliant
- ✅ `services/terminal.ts` - Single command interface
- ✅ `services/api.ts` - HTTP client
- ✅ `services/socket.ts` - WebSocket events
- ✅ No `commands/` directory (good!)

**Components:** ✅ Clean + New Dialogs
- ✅ `Terminal.svelte` - Terminal UI
- ✅ `AuthDialog.svelte` - Authentication
- ✅ `AsciiDialog.svelte` - Base dialog component
- ✅ `ChatDialog.svelte` - Chat/messaging
- ✅ `MailDialog.svelte` - Mail/inbox (if exists)

**Issues Found:** ⚠️ 2-3 files need cleanup

1. **client/src/utils/memoryManager.ts** (16KB)
   - ❌ Frontend memory simulation (not needed)
   - ✅ Backend handles this via memoryService
   - **Action:** DELETE

2. ~~**client/src/utils/forumSystem.ts**~~ ✅ **CLEANED** (965 lines → 103 lines)
   - ✅ Removed all game logic (forum creation, posts, honeypots, intel, key fragments)
   - ✅ Now UI-state-only (~3KB)
   - ✅ Fully compliant with terminal architecture

3. **client/src/utils/messagingSystem.ts** (24KB)
   - ⚠️ Client-side message logic
   - ✅ Backend has messageService
   - **Action:** REVIEW - reduce to UI state only

4. **client/src/utils/gameEngine.ts** (if exists)
   - ❌ Client-side game engine
   - **Action:** DELETE

### Compliance with Architecture

**✅ What's Working:**
- ✅ Backend IS the console (100% compliant)
- ✅ All commands go through `/api/command/execute`
- ✅ No client-side command handlers
- ✅ Terminal service is a dumb display layer
- ✅ Services are all server-side
- ✅ Process management fully on backend
- ✅ **NEW:** Dynamic command discovery via modules
- ✅ **NEW:** Modular command system complete

**⚠️ What Needs Attention:**
- ⚠️ Client utils have leftover game logic (~70KB)
- ⚠️ Session management needs re-enabling
- ⚠️ Service export patterns need standardization
- ⚠️ 12 TODOs need resolution

### Architecture Grade: **B+** → **A-** (after Phase 1 fixes)

**Current State:**
- Server: 100% compliant with terminal-first architecture
- Command System: 100% modular and complete
- Client: 85% compliant (legacy utils remain)
- Build: Clean, 0 errors
- Documentation: Being updated

**Next Steps:** See [Recommended Action Plan](#recommended-action-plan)

---

## � Technical Debt

**Last Updated:** November 28, 2024

### High Priority Items

#### 1. Session Management Integration
**Status:** ⚠️ Disabled  
**Impact:** Critical - Security bypass  
**Effort:** 1-2 days

**Problem:** Session validation is disabled in multiple locations with TODO comments.

**Affected Files:**
- `commandProcessor.ts:213` - Session check disabled  
- `commandProcessor.ts:224` - Re-enable needed
- `systemCommands.ts:23` - Session check disabled

**Action Items:**
- [ ] Re-enable session validation in `validateCommand()`
- [ ] Inject `gameStateManager` into `CommandProcessor` constructor
- [ ] Update `systemCommands.handleListDirectory()` to use session  
- [ ] Test all commands with session validation enabled

#### 2. Service Export Pattern Standardization
**Status:** ⚠️ Mixed patterns  
**Impact:** Medium - Developer confusion  
**Effort:** 1 day

**Problem:** Inconsistent export patterns across services (default vs named exports).

**Services to Update:**
- [ ] `shopService.ts` → Change to named export
- [ ] `missionService.ts` → Change to named export
- [ ] `serverService.ts` → Change to named export

**Migration Strategy:**
```typescript
// Before (default export)
class ShopService {
  private static instance: ShopService;
  static getInstance() { ... }
}
export default ShopService;

// After (named export - consistent)
class ShopService {
  private static instance: ShopService;
  static getInstance() { ... }
}
export const shop Service = ShopService.getInstance();
```

#### 3. GameStateManager Feature Integration
**Status:** ⚠️ TODOs present  
**Impact:** Medium - Missing features  
**Effort:** 2-3 days

**Missing Integrations (`gameStateManager.ts`):**
- Line 263: `inventory: []` - TODO: Connect to ShopService
- Line 264: `missions: []` - TODO: Connect to MissionService  
- Line 265: `notifications: []` - TODO: Connect to EventService
- Line 267: `totalPlayTime: 0` - TODO: Calculate from session data

**Action:**
```typescript
// Connect to existing services
inventory: await shopService.getUserInventory(userId),
missions: await MissionService.getInstance().getUserMissions(userId),
notifications: await eventService.getUserNotifications(userId),
totalPlayTime: calculatePlayTime(sessionData),
```

### Medium Priority Items

#### 4. ProgressService Backup System
**Status:** ⚠️ Not implemented  
**Impact:** Low - Nice to have  
**Effort:** 2-3 days

**Locations:**
- Lines 284, 300 in `progressService.ts`

**Action:**
- [ ] Add `ProgressBackup` model to Prisma schema
- [ ] Implement backup storage logic
- [ ] Implement restore functionality

#### 5. Configuration Centralization
**Status:** ⚠️ Magic numbers present  
**Impact:** Low - Maintenance burden  
**Effort:** 1 day

**Examples:**
- `gameStateManager.ts:490` - Timeout hardcoded (60 min)
- Various rate limits scattered

**Action:**
- [ ] Move all timeouts to `config/environment.ts`
- [ ] Centralize rate limit configurations
- [ ] Document all configurable values

### Low Priority Items

#### 6. Client Utility Cleanup
**Status:** ⚠️ Legacy code remains  
**Impact:** Low - Not blocking  
**Effort:** 2-3 days

**Files to Clean:**
- [ ] Delete `client/src/utils/memoryManager.ts` (16KB) - Fully redundant
- [ ] Delete `client/src/utils/gameEngine.ts` (if exists)
- [ ] Reduce `client/src/utils/messagingSystem.ts` to UI state only
- [ ] Reduce `client/src/utils/forumSystem.ts` to UI state only

#### 7. Performance Optimizations
**Status:** 💡 Future improvement  
**Impact:** Low - Performance gain  
**Effort:** Ongoing

**Recommendations:**
- [ ] Add Redis caching for frequently accessed data
- [ ] Implement command history size limits + LRU eviction
- [ ] Optimize database queries (use `select` vs `include`)
- [ ] Add database query profiling

#### 8. Security Hardening
**Status:** 💡 Future improvement  
**Impact:** Medium - Additional security  
**Effort:** 1 week

**Recommendations:**
- [ ] Add path sanitization for file commands
- [ ] Review and audit all raw SQL queries
- [ ] Add comprehensive input validation
- [ ] Implement command injection prevention

### Summary

| Priority | Items | Total Effort |
|----------|-------| -------------|
| High | 3 | 4-6 days |
| Medium | 2 | 3-4 days |
| Low | 3 | Ongoing |
| **TOTAL** | **8** | **7-10 days + ongoing** |

---

## 🎯 Recommended Action Plan

**Last Updated:** November 28, 2024  
**Based On:** Server Architecture Analysis

### Phase 1: Critical Fixes (1-2 days)

**Goal:** Re-enable security and standardize patterns

**Tasks:**
1. ✅ **Re-enable Session Management**
   - Inject `gameStateManager` into `CommandProcessor`
   - Remove all `if (false)` checks
   - Enable session validation in 3 locations
   - Test with integration tests

2. ✅ **Standardize Service Exports**
   - Update `shopService`, `missionService`, `serverService`
   - Update all import statements in dependent files
   - Verify build passes (`npm run build`)
   - Update documentation

**Acceptance Criteria:**
- [ ] All session checks active
- [ ] All service exports use named pattern
- [ ] Build passes with 0 errors
- [ ] No circular dependency warnings

### Phase 2: Complete TODOs (3-5 days)

**Goal:** Close technical debt items

**Tasks:**
1. ✅ **GameStateManager Integration**
   - Connect inventory to ShopService
   - Connect missions to MissionService
   - Connect notifications to EventService
   - Implement totalPlayTime calculation
   - Add configuration for timeouts

2. ✅ **ProgressService Backup**
   - Design `ProgressBackup` Prisma model
   - Run migration
   - Implement backup logic
   - Implement restore logic
   - Add tests

**Acceptance Criteria:**
- [ ] All gameStateManager TODOs resolved
- [ ] Backup system functional
- [ ] All timeouts configurable
- [ ] Tests pass

### Phase 3: Architecture Improvements (1 week)

**Goal:** Improve long-term maintainability

**Tasks:**
1. 💡 **Dependency Injection (Optional)**
   - Evaluate DI containers (tsyringe, InversifyJS)
   - Design dependency graph
   - Refactor service initialization
   - Migrate to DI pattern

2. 💡 **Service Registry (Optional)**
   - Create central service locator
   - Eliminate circular dependencies
   - Simplify import patterns
   - Update documentation

**Acceptance Criteria:**
- [ ] No circular dependencies
- [ ] Cleaner initialization code
- [ ] Easier testing
- [ ] Documentation updated

### Phase 4: Performance & Security (Ongoing)

**Goal:** Production-ready hardening

**Tasks:**
1. ✅ **Client Cleanup**
   - Delete redundant utils
   - Reduce logic to UI state only
   - Verify terminal architecture compliance

2. ✅ **Performance**
   - Add Redis caching
   - Implement history limits
   - Optimize database queries
   - Profile and benchmark

3. ✅ **Security**
   - Add path sanitization
   - Audit raw queries
   - Comprehensive input validation
   - Penetration testing

**Acceptance Criteria:**
- [ ] Client 100% compliant
- [ ] Response times < 100ms
- [ ] Security audit passes
- [ ] Load testing complete

### Success Metrics

**Phase 1 Complete:**
- Architecture Grade: **B+** → **A-**
- Technical Debt: 12 → 9 items
- Security: Critical gaps closed

**Phase 2 Complete:**
- Architecture Grade: **A-** → **A**
- Technical Debt: 9 → 5 items
- Feature Completeness: 95% → 98%

**Phase 3 Complete:**
- Architecture Grade: **A** → **A+**
- Technical Debt: 5 → 2 items (only low priority)
- Maintainability: Excellent

**Phase 4 Complete:**
- Production Ready: ✅
- Performance: Optimized
- Security: Hardened
- Architecture: World-class

### Priority Recommendation

**Start with Phase 1** - Critical for security and consistency. Should be completed before any new feature development.

---

## �🛠️ Setup & Installation

### System Requirements

**Minimum:**
- CPU: 2 cores
- RAM: 4GB
- Storage: 10GB
- OS: Linux, macOS, or Windows (WSL recommended)

**Recommended:**
- CPU: 4+ cores
- RAM: 8GB+
- Storage: 20GB SSD
- OS: Linux or macOS

### Detailed Setup

#### 1. Database Setup

```bash
# Create database
createdb aida_game

# Or with custom settings
createdb -U postgres -h localhost aida_game
```

#### 2. Server Configuration

Create `.env` file in `server/` directory:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/aida_game"

# Authentication
JWT_SECRET="your-very-secret-key-change-this-in-production"
JWT_EXPIRES_IN="24h"

# Server
PORT=3001
NODE_ENV=development

# CORS (adjust for production)
CLIENT_URL="http://localhost:8080"

# Rate Limiting
RATE_LIMIT_WINDOW=1000
RATE_LIMIT_MAX=10
```

#### 3. Install Dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

#### 4. Database Migration & Seeding

```bash
cd server

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# Seed core data (servers, items, missions)
npm run db:seed:core

# Seed test users (optional)
npm run db:seed:users
```

#### 5. Verify Installation

```bash
cd server
npm run build        # Should succeed
npm test            # Should pass (if tests exist)
./test-core-systems.sh  # Run system tests
```

#### 6. Start Development

```bash
# Terminal 1: Server
cd server
npm run dev

# Terminal 2: Client
cd client
npm run dev

# Terminal 3: Database GUI (optional)
cd server
npx prisma studio
```

---

## 📖 Commands Reference

### System Commands (File Operations)

```bash
ls [path] [-la]              # List files/directories
cd <path>                    # Change directory
pwd                          # Print working directory
cat <file>                   # Read file contents
rm <file>                    # Delete file
mkdir <path>                 # Create directory
touch <file>                 # Create empty file
cp <source> <dest>           # Copy file
mv <source> <dest>           # Move/rename file
echo <text> [> file]         # Display text or write to file
write <file> <content>       # Write content to file
```

### Process Management Commands

```bash
ps [-a] [-u] [-f]            # List processes
top                          # Real-time system monitor
free [-h]                    # Memory usage
uptime                       # System uptime and load
kill [-SIGNAL] <PID>         # Terminate process
pkill <pattern>              # Kill by name
pgrep [-l] <pattern>         # Find processes
nice -n <N> <PID>            # Set process priority
renice <N> <PID>             # Change priority
```

### Math & Logic Commands

```bash
calc <expression>            # Calculate expressions
expr <expression>            # Alias for calc
vars                         # List variables
set <name> <value>           # Set variable
unset <name>                 # Delete variable
math                         # Show math functions
convert <val> <from> to <to> # Unit conversion
random [min] [max]           # Random numbers
```

### Network Commands

```bash
scan [range]                 # Scan network
servers                      # List known servers
connect <ip>                 # Connect to server
disconnect                   # Disconnect from server
traceroute <ip>              # Trace route
probe <ip>                   # Probe server info
```

### Hacking Commands

```bash
hack [target]                # Attempt hack
crack <password>             # Crack password
exploit <target>             # Exploit vulnerability
backdoor <target>            # Install backdoor
rootkit <target>             # Install rootkit
```

### Game Commands

```bash
status                       # Show player status
skills                       # Show skill levels
missions                     # List missions
accept <id>                  # Accept mission
abandon <id>                 # Abandon mission
progress                     # Mission progress
inventory                    # Show inventory
shop                         # List shop items
buy <id>                     # Buy item
sell <id>                    # Sell item
use <item>                   # Use item
players                      # List online players
who                          # Who is online
whois <username>             # User info
```

### Social Commands

```bash
msg <user> <text>            # Send quick private message
mail <user> <subject> <msg>  # Send formal email
inbox                        # Check inbox
contact [list|add|remove]    # Manage contacts
chat [history <id>]          # Real-time chat
forum [scan|access|post]     # Access darknet forums
proxy [list|connect|status]  # Manage proxy connections
```

### Help Commands

```bash
help [category]              # Show available commands
man <command>                # Show command manual
history [limit]              # Command history
clear                        # Clear terminal
stats                        # Command usage stats
```

---

## 💻 Development Guide

### Project Structure

```
AIDA/
├── server/                  # Backend (Node.js + Express)
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── services/       # Business logic
│   │   │   ├── commandProcessor.ts      # 🔧 Command router (being refactored)
│   │   │   ├── commandModules/          # ✨ Modular command handlers
│   │   │   │   ├── interface.ts         # Module interface
│   │   │   │   ├── systemCommands.ts    # ✅ System commands (ls, cd, cat, etc.)
│   │   │   │   ├── fileCommands.ts      # ✅ File commands (upload, encrypt, etc.)
│   │   │   │   └── socialCommands.ts    # ⚠️ Social commands (chat, mail, etc.)
│   │   │   ├── memoryService.ts         # Process management
│   │   │   ├── hackService.ts           # Hacking mechanics
│   │   │   ├── missionService.ts        # Mission system
│   │   │   ├── shopService.ts           # Shop & inventory
│   │   │   ├── progressService.ts       # XP & levels
│   │   │   ├── fileService.ts           # Virtual filesystem
│   │   │   ├── messageService.ts        # Private messaging
│   │   │   ├── forumService.ts          # Forum system
│   │   │   └── ...                      # 14 services total
│   │   ├── routes/         # API endpoints
│   │   │   ├── command.ts  # Command execution
│   │   │   └── auth.ts     # Authentication
│   │   ├── middleware/     # Express middleware
│   │   ├── database/       # Database client
│   │   ├── types/          # TypeScript types
│   │   └── utils/          # Utilities
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   ├── migrations/     # DB migrations
│   │   └── seed/           # Seed data
│   └── package.json
│
├── client/                  # Frontend (Svelte)
│   ├── src/
│   │   ├── App.svelte      # Main app
│   │   ├── components/     # UI components
│   │   │   ├── Terminal.svelte        # Terminal UI
│   │   │   ├── AuthDialog.svelte      # Login/register
│   │   │   ├── MailDialog.svelte      # Mail interface
│   │   │   ├── ChatDialog.svelte      # Chat interface
│   │   │   └── ForumDialog.svelte     # Forum browser
│   │   ├── services/       # API clients
│   │   │   ├── api.ts      # HTTP client
│   │   │   ├── terminal.ts # Terminal service
│   │   │   └── socket.ts   # WebSocket handling
│   │   ├── stores/         # State management
│   │   └── utils/          # Utilities
│   └── package.json
│
├── shared/                  # Shared types & utilities
├── DOCUMENTATION.md         # This file
└── PROJECT_STATUS.md        # Current project state & refactoring status
```

### Adding a New Command

1. **Update Command Processor**

```typescript
// server/src/services/commandProcessor.ts

// 1. Add to command category
private readonly GAME_COMMANDS = new Set([
  // ... existing commands
  "newcommand"
]);

// 2. Add handler in executeGameCommand()
case "newcommand": {
  return await this.handleNewCommand(userId, command);
}

// 3. Implement handler
private async handleNewCommand(
  userId: string,
  command: Command
): Promise<CommandResult> {
  // Your logic here
  return {
    success: true,
    output: "Command executed!",
    timestamp: new Date(),
  };
}
```

2. **Add to Help System**

```typescript
// In getAvailableCommands() method
{
  command: "newcommand",
  category: "game",
  description: "Does something cool",
  usage: "newcommand <arg>",
  examples: ["newcommand test"]
}
```

3. **Test**

```bash
# In terminal
newcommand test
```

### Command Modules (New Pattern)

**Status:** 🔧 Refactoring in Progress (29% complete)

We are migrating from monolithic command handlers to modular command handlers. See `PROJECT_STATUS.md` for detailed progress.

**Module Structure:**

1. **Create Module File**

```typescript
// server/src/services/commandModules/myCommands.ts
import { CommandModule, CommandContext } from './interface';
import { Command, CommandResult } from '../../../../shared/types';

export class MyCommandsModule implements CommandModule {
  public commands: Set<string> = new Set(['cmd1', 'cmd2', 'cmd3']);

  public async execute(
    command: Command,
    context: CommandContext
  ): Promise<CommandResult> {
    switch (command.command) {
      case 'cmd1':
        return await this.handleCmd1(command, context);
      
      default:
        return {
          success: false,
          output: `Unknown command: ${command.command}`,
          timestamp: new Date()
        };
    }
  }

  private async handleCmd1(
    command: Command,
    context: CommandContext
  ): Promise<CommandResult> {
    const { userId, db, fileService } = context;
    return {
      success: true,
      output: 'Command executed!',
      timestamp: new Date()
    };
  }
}
```

2. **Register Module**

```typescript
// In commandProcessor.ts initializeModules()
private initializeModules() {
  this.registerModule(new MyCommandsModule());
}
```

**Benefits:** Better code organization, easier testing, clear separation of concerns

**See Also:** `PROJECT_STATUS.md` for complete refactoring status


### Adding a New Service

1. **Create Service File**

```typescript
// server/src/services/myService.ts

import { db } from '../database/client';
import { EventEmitter } from 'events';

class MyService extends EventEmitter {
  async doSomething(userId: string) {
    // Your logic
    this.emit('something:done', { userId });
    return result;
  }
}

export const myService = new MyService();
```

2. **Use in Command Processor**

```typescript
import { myService } from './myService';

// In command handler
const result = await myService.doSomething(userId);
```

### Database Changes

```bash
# 1. Modify schema
# Edit server/prisma/schema.prisma

# 2. Create migration
cd server
npx prisma migrate dev --name description_of_change

# 3. Update seed data if needed
# Edit server/prisma/seed/core.ts

# 4. Regenerate client
npx prisma generate
```

### Testing

```typescript
// server/src/__tests__/myService.test.ts

import { myService } from '../services/myService';

describe('MyService', () => {
  it('should do something', async () => {
    const result = await myService.doSomething('user123');
    expect(result).toBeDefined();
  });
});
```

Run tests:
```bash
cd server
npm test
```

---

## 🗄️ Services & API

### Core Services

#### commandProcessor.ts
**Purpose:** Parse and execute all terminal commands  
**Key Methods:**
- `parseCommand(userId, rawInput)` - Parse command string
- `validateCommand(userId, parsed)` - Validate permissions
- `executeCommand(userId, parsed)` - Execute command
- `getCommandHistory(userId)` - Get history
- `getAvailableCommands(userId)` - List commands

#### memoryService.ts
**Purpose:** Simulate Unix process management per session  
**Key Methods:**
- `initializeSession(sessionId, userId)` - Setup session
- `spawnProcess(sessionId, name, command, user)` - Create process
- `killProcess(sessionId, pid, signal)` - Terminate process
- `getProcesses(sessionId)` - List processes
- `getMemoryInfo(sessionId)` - Memory stats
- `cleanupSession(sessionId)` - Cleanup

**Note:** This is a simulation for gameplay, not real OS processes.

#### hackService.ts
**Purpose:** Hacking mechanics and server intrusion  
**Key Methods:**
- `attemptHack(userId, serverId, method)` - Hack server
- `crackPassword(userId, serverId, password)` - Crack password
- `installBackdoor(userId, serverId)` - Install backdoor
- `calculateSuccess(userId, server, tools)` - Success rate

#### missionService.ts
**Purpose:** Mission system and objectives  
**Key Methods:**
- `getAvailableMissions(userId)` - List missions
- `acceptMission(userId, missionId)` - Accept mission
- `abandonMission(userId, missionId)` - Abandon mission
- `checkProgress(userId, missionId)` - Check progress
- `completeMission(userId, missionId)` - Complete mission

#### shopService.ts
**Purpose:** Shop and inventory management  
**Key Methods:**
- `getShopItems(userId)` - List shop items
- `buyItem(userId, itemId, quantity)` - Purchase item
- `sellItem(userId, itemId, quantity)` - Sell item
- `getInventory(userId)` - Get player inventory
- `useItem(userId, itemId)` - Use consumable

#### progressService.ts
**Purpose:** Player progression, XP, and skills  
**Key Methods:**
- `addXP(userId, amount, source)` - Award XP
- `checkLevelUp(userId)` - Check for level up
- `getPlayerProgress(userId)` - Get progress
- `addSkillXP(userId, skill, amount)` - Add skill XP
- `saveProgress(userId)` - Save to database

#### fileService.ts
**Purpose:** Virtual file system per server  
**Key Methods:**
- `listDirectory(userId, serverId, path)` - List files
- `readFile(userId, serverId, path)` - Read file
- `writeFile(userId, serverId, path, content)` - Write file
- `deleteFile(userId, serverId, path)` - Delete file
- `createDirectory(userId, serverId, path)` - Make directory

### Command Flow

```
1. User types: "status"
   ↓
2. POST /api/command/execute
   ↓
3. commandProcessor.parseCommand()
   → { command: "status", args: [], isValid: true }
   ↓
4. commandProcessor.validateCommand()
   → { valid: true }
   ↓
5. commandProcessor.executeCommand()
   → Routes to executeGameCommand()
   → Calls progressService.getPlayerProgress()
   ↓
6. progressService queries database
   ↓
7. Format output as text
   ↓
8. Return: { success: true, output: [...], exitCode: 0 }
   ↓
9. Client displays output in terminal
```

---

## 🗃️ Database Schema

### Core Tables

#### User
```prisma
model User {
  id            String   @id @default(uuid())
  username      String   @unique
  email         String   @unique
  passwordHash  String
  createdAt     DateTime @default(now())
  lastLogin     DateTime?
  
  progress      Progress?
  inventory     InventoryItem[]
  missions      MissionProgress[]
  hackAttempts  HackAttempt[]
  messages      Message[]
}
```

#### Progress
```prisma
model Progress {
  id              String   @id @default(uuid())
  userId          String   @unique
  level           Int      @default(1)
  xp              Int      @default(0)
  credits         Int      @default(1000)
  reputation      Int      @default(0)
  
  // Skills
  hackingSkill    Int      @default(1)
  stealthSkill    Int      @default(1)
  networkingSkill Int      @default(1)
  cryptoSkill     Int      @default(1)
  socialSkill     Int      @default(1)
  forensicsSkill  Int      @default(1)
  
  user            User     @relation(...)
}
```

#### Server
```prisma
model Server {
  id          String   @id @default(uuid())
  name        String
  ip          String   @unique
  difficulty  Int      @default(1)
  securityLevel Int    @default(1)
  ports       Int[]
  
  isCompromised Boolean @default(false)
  backdoorInstalled Boolean @default(false)
  
  files       File[]
  hackAttempts HackAttempt[]
}
```

#### ShopItem
```prisma
model ShopItem {
  id          String   @id @default(uuid())
  name        String   @unique
  description String
  price       Int
  type        ItemType
  rarity      Rarity
  
  effects     Json     // { hackBonus: 10, ... }
  requirements Json    // { level: 5, ... }
  
  purchases   InventoryItem[]
}
```

#### Mission
```prisma
model Mission {
  id          String   @id @default(uuid())
  title       String
  description String
  type        MissionType
  difficulty  Int
  
  objectives  Json     // [{ type: "hack", target: "..." }]
  rewards     Json     // { xp: 500, credits: 1000 }
  
  progress    MissionProgress[]
}
```

### Key Relationships

```
User (1) ←→ (1) Progress
User (1) ←→ (N) InventoryItem ←→ (1) ShopItem
User (1) ←→ (N) MissionProgress ←→ (1) Mission
User (1) ←→ (N) HackAttempt ←→ (1) Server
Server (1) ←→ (N) File
```

### Seeding Data

```bash
# Seed core game data
npm run db:seed:core

# This creates:
# - 11 servers (tutorial → maximum security)
# - 20+ shop items
# - 10+ missions
# - Default skills and progression data
```

---

## 🐛 Troubleshooting

### Common Issues

#### Database Connection Failed
```
Error: Can't reach database server
```

**Solutions:**
1. Check PostgreSQL is running: `pg_isready`
2. Verify DATABASE_URL in `.env`
3. Check database exists: `psql -l | grep aida_game`
4. Test connection: `psql $DATABASE_URL`

#### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3001
```

**Solutions:**
1. Kill existing process: `lsof -ti:3001 | xargs kill -9`
2. Or change PORT in `.env`

#### Prisma Client Not Generated
```
Error: @prisma/client did not initialize yet
```

**Solution:**
```bash
cd server
npx prisma generate
```

#### Migration Failed
```
Error: Migration failed to apply
```

**Solutions:**
1. Reset database: `npx prisma migrate reset` (DEV ONLY)
2. Check migration status: `npx prisma migrate status`
3. Force deploy: `npx prisma migrate deploy`

#### TypeScript Errors
```
Error: Cannot find module ...
```

**Solutions:**
1. Clean build: `rm -rf dist && npm run build`
2. Reinstall: `rm -rf node_modules && npm install`
3. Check tsconfig.json paths

#### Command Not Working
```
Command not found: mycommand
```

**Check:**
1. Is command in COMMAND_SETS in commandProcessor?
2. Is handler implemented in execute*Command() methods?
3. Check spelling and case (commands are lowercase)
4. Try `help` to see available commands

#### Session Not Initializing
```
Error: Session not initialized
```

**Solutions:**
1. Memory service might not be initialized
2. Check `getOrCreateSession()` in commandProcessor
3. Verify user is authenticated

---

## 🚀 Deployment

### Production Checklist

**Security:**
- [ ] Change JWT_SECRET to strong random string
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Enable security headers
- [ ] Disable Prisma Studio in production

**Database:**
- [ ] Use managed PostgreSQL service
- [ ] Enable SSL connections
- [ ] Set up backups
- [ ] Configure connection pooling
- [ ] Run migrations: `npx prisma migrate deploy`

**Server:**
- [ ] Set up reverse proxy (nginx/Apache)
- [ ] Configure PM2 or systemd
- [ ] Set up logging (Winston/Pino)
- [ ] Configure monitoring
- [ ] Set up error tracking (Sentry)

**Client:**
- [ ] Build for production: `npm run build`
- [ ] Serve static files
- [ ] Configure CDN (optional)
- [ ] Enable gzip compression

### Environment Variables (Production)

```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/aida_game?sslmode=require"

# Security
JWT_SECRET="very-long-random-secret-minimum-32-characters"
JWT_EXPIRES_IN="24h"

# Server
NODE_ENV="production"
PORT=3001

# CORS
CLIENT_URL="https://your-domain.com"

# Rate Limiting
RATE_LIMIT_WINDOW=1000
RATE_LIMIT_MAX=10

# Logging
LOG_LEVEL="info"
```

### Build Commands

```bash
# Server
cd server
npm install --production
npx prisma generate
npx prisma migrate deploy
npm run build

# Client
cd client
npm install --production
npm run build
```

### PM2 Setup

```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start server/dist/index.js --name aida-server

# Save configuration
pm2 save

# Auto-start on boot
pm2 startup
```

### nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Client
    location / {
        root /path/to/client/public;
        try_files $uri $uri/ /index.html;
    }
    
    # API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket
    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 📚 Additional Resources

### Key Files
- `server/src/services/commandProcessor.ts` - Command execution
- `server/src/services/memoryService.ts` - Process management
- `server/prisma/schema.prisma` - Database schema
- `client/src/components/Terminal.svelte` - Terminal UI

### Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run db:seed:core` - Seed core data
- `npm test` - Run tests
- `npx prisma studio` - Database GUI

### Useful Commands
```bash
# View database
npx prisma studio

# Reset database (DEV ONLY!)
npx prisma migrate reset

# Generate Prisma client
npx prisma generate

# Create migration
npx prisma migrate dev --name description

# View logs
pm2 logs aida-server
```

---

## 🎮 Game Features

### Economy System
- Start with 1,000 credits
- Earn credits by hacking servers and completing missions
- Buy tools, exploits, and upgrades from shop
- Sell unwanted items for 50% value

### Progression System
- Level 1-10+ with skill-based advancement
- Six core skills: Hacking, Stealth, Networking, Cryptography, Social Engineering, Forensics
- XP gained from successful hacks and mission completion
- Higher levels unlock better equipment and harder targets

### Server Network
- **Tutorial** (Level 1-2): Learn basics
- **Corporate** (Level 3-5): Medium security
- **Research** (Level 6-7): Specialized
- **Government** (Level 8-9): High security
- **Financial** (Level 10): Maximum difficulty

### Shop Items
- **Basic Tools** (100-750¢): Scanners, crackers, cleaners
- **Advanced Software** (1,200-2,000¢): Exploits, rootkits
- **Elite Gear** (5,000-10,000¢): Zero-days, quantum tools
- **Consumables**: Boosters, multipliers

---

## 🔐 Security Best Practices

### For Development
- Never commit `.env` files
- Use strong JWT secrets
- Keep dependencies updated
- Use prepared statements (Prisma does this)
- Validate all inputs
- Sanitize outputs

### For Production
- Use HTTPS everywhere
- Enable rate limiting
- Set up monitoring and alerts
- Regular security audits
- Keep logs for investigation
- Backup database regularly

---

## 📝 Contributing Guidelines

### Code Style
- TypeScript for all code
- ESLint for linting
- Prettier for formatting
- Meaningful variable names
- Comments for complex logic

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/my-feature
```

### Commit Messages
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Maintenance

---

## 🎨 Social Features Architecture

### Overview

The social system uses **ASCII dialog overlays** that appear over the terminal. Commands like `inbox`, `chat`, and `forum` trigger these dialogs rather than simple text output.

### Dialog System

**Components:**
- `MailDialog.svelte` - Mail/Inbox interface
- `ChatDialog.svelte` - Real-time chat interface  
- `ForumDialog.svelte` - Forum browser interface
- `AsciiDialog.svelte` - Base reusable ASCII dialog component

**Dialog Flow:**
```
USER:    inbox
         ↓
CLIENT:  POST /api/command/execute { command: "inbox" }
         ↓
SERVER:  commandProcessor → return { openDialog: "mail", data: {...} }
         ↓
CLIENT:  Terminal receives response → opens MailDialog component
         ↓
DIALOG:  Fetches messages, displays ASCII UI, allows interaction
         ↓
USER:    Interacts with dialog (keyboard/mouse)
         ↓
DIALOG:  Makes API calls to backend services (send message, etc.)
```

### Backend Services

**messageService.ts** - Private messaging
- `sendPrivateMessage()` - Send DM to user
- `getInbox()` - Fetch user's messages
- `markAsRead()` - Mark message as read
- `deleteMessage()` - Delete message
- Real-time delivery via WebSocket

**forumService.ts** - Forum networks
- `scanForums()` - Discover available forums
- `accessForum()` - Enter forum (requires proxy for darkweb)
- `createPost()` - Make new thread
- `replyToPost()` - Reply to existing thread
- `upvotePost()` - Vote on content
- Honeypot detection system

### Database Schema

**Messages:**
```prisma
model Message {
  id              String
  senderId        String
  recipientId     String
  subject         String
  content         String
  isEncrypted     Boolean
  encryptionLevel Int?
  messageType     String // "private", "system", "mission"
}
```

**Forums:**
```prisma
model Forum {
  id            String
  name          String
  url           String
  securityLevel Int // 1-5 (1=public, 5=deep web)
  requiresProxy Boolean
  isHoneypot    Boolean
}

model Post {
  id           String
  forumId      String
  title        String
  content      String
  authorHandle String
  isEncrypted  Boolean
}
```

### ASCII Dialog Design

**Mail/Inbox Dialog:**
```
╔════════════════════════════════════════════════════════════╗
║ [INBOX] - SecureComm v2.3.1                          [X]   ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  [1] CipherShadow      - RE: The Job           [NEW] 2h   ║
║  [2] System            - Mission Update              5h   ║
║  [3] NeuralWhisper     - Found something...          1d   ║
║                                                            ║
║  [C]ompose  [R]eply  [D]elete  [ESC] Close                ║
╚════════════════════════════════════════════════════════════╝
```

**Chat Dialog:**
```
╔════════════════════════════════════════════════════════════╗
║ [CHAT] - SecureComm v2.3.1                           [X]   ║
╠═══════════════╦════════════════════════════════════════════╣
║ CONTACTS      ║ @CipherShadow                              ║
║               ╠════════════════════════════════════════════╣
║ CipherShadow ●║ [23:15] CipherShadow: Meet me at proxy7   ║
║ NeuralWhisper ║ [23:17] You: On my way                     ║
║ GhostNode     ║ [23:20] CipherShadow: Bring encryption     ║
║ System        ║                                            ║
║               ║                                            ║
║               ║                                            ║
║               ╠════════════════════════════════════════════╣
║               ║ > _                                        ║
╚═══════════════╩════════════════════════════════════════════╝
```

**Forum Dialog (Y2K Aesthetic):**
```
╔════════════════════════════════════════════════════════════╗
║ [FORUM] - Underground BBS                            [X]   ║
╠════════════════════════════════════════════════════════════╣
║ >> TECH TALK >> Encryption Methods                        ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║ Posted by: 1337h4x0r        Date: 2024-11-15 23:45       ║
║ Subject: New AES-512 bypass discovered                    ║
║ ──────────────────────────────────────────────────────────║
║                                                            ║
║ Found a critical flaw in the new crypto standard.         ║
║ Details in encrypted attachment. Need help testing.       ║
║                                                            ║
║ [Attachment: exploit.enc - Requires Crypto Level 4]       ║
║                                                            ║
║ ╾─ Reply from: CipherKing (15 min ago)                    ║
║    I'm in. DM me the details.                             ║
║                                                            ║
║ [R]eply  [B]ack  [N]ext Thread  [ESC] Close               ║
╚════════════════════════════════════════════════════════════╝
```

### Implementation Phases

**Phase 1: Mail/Inbox Dialog** (Start Here)
1. Create `AsciiDialog.svelte` base component
2. Create `MailDialog.svelte` with message list
3. Update `commandProcessor.ts` to return `{ openDialog: "mail" }`
4. Add dialog state management in `Terminal.svelte`
5. Implement compose/reply functionality
6. Add real-time message notifications

**Phase 2: Chat Dialog**
1. Create `ChatDialog.svelte` with split layout
2. Add contact list sidebar
3. Implement real-time message streaming via WebSocket
4. Add typing indicators
5. Online/offline status for contacts

**Phase 3: Forum Dialog**
1. Create `ForumDialog.svelte` with retro aesthetic
2. Implement forum list and thread browsing
3. Add post reading and reply system
4. Integrate with proxy system for darkweb forums
5. Add honeypot warnings and consequences

**Phase 4: Polish & Features**
1. Add keyboard shortcuts (Tab, Arrow keys, ESC)
2. Implement message encryption/decryption UI
3. Add ASCII art animations for transitions
4. Contact discovery and management
5. Notification system integration

## 📞 Support

### Getting Help
1. Check this documentation
2. Search existing issues
3. Ask in discussions
4. Open a new issue

### Reporting Bugs
Include:
- Description of issue
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Environment details

---

## 🎉 Credits

Developed with ❤️ for the cyberpunk hacking community.

**Remember:** Every action leaves a trace. Learn stealth early. Cover your tracks. Trust no one.

🌐 Welcome to the AIDA network, operative. Your neural interface is online. 🌐

---

*Last Updated: December 2024*
*Version: 1.0*