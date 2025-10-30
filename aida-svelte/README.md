# AIDA - Neurolink Terminal Simulator

A modern web-based terminal simulator game built with **Svelte**, **TypeScript**, and **Vite**. Experience a cyberpunk-themed hacking simulation where you navigate servers, manage files, and explore a fictional neural network.

## 🎮 About

AIDA (Advanced Intelligence Data Access) is an immersive terminal-based game that puts you in the role of a hacker exploring the Neurolink Network. Navigate between servers, manage files and directories, and uncover the mysteries of a futuristic computer system.

## ✨ Features

### Modern Tech Stack
- **Svelte 5** - Reactive, component-based UI with minimal boilerplate
- **TypeScript** - Full type safety for reliable code
- **Vite** - Lightning-fast development and optimized builds
- **Reactive State Management** - Svelte stores for elegant state handling

### Game Features
- 🖥️ **Authentic Terminal Experience** - Classic green-on-black hacker aesthetic
- 🌐 **Multi-Server Navigation** - Connect to different servers via IP addresses
- 📁 **Virtual File System** - Create folders, files, and navigate directories
- 🔒 **Network Access Control** - User authentication and permissions
- ⌨️ **Command History** - Navigate previous commands with arrow keys
- 📝 **Tab Completion** - Auto-complete commands by pressing Tab
- 🎨 **Responsive Design** - Works on desktop and mobile devices
- 🌓 **Light/Dark Mode Support** - Adapts to system preferences

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ and npm

### Installation

```bash
# Navigate to the project directory
cd aida-svelte

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🎯 Available Commands

| Command | Description |
|---------|-------------|
| `help` | Display all available commands |
| `new_user <name>` | Register a new user and gain network access |
| `know_servers` | List all known servers with their IP addresses |
| `connect_to <ip>` | Connect to a server using its IP address |
| `ls` / `dir` | List files and directories in current location |
| `cd <path>` | Change to specified directory |
| `new_folder <name>` | Create a new directory |
| `new_file <name>` | Create a new text file |
| `write_in <file> <text>` | Write text to a file |
| `open <file>` | Read the contents of a file |
| `search <term>` | Search the web for a term |
| `calculator` | Open web calculator |
| `clear` | Clear the terminal screen |
| `xyzzy` | Try it and see! |

## 🎮 How to Play

1. **Start the game** - You'll see a welcome message from the Neurolink Terminal
2. **Create a user** - Type `new_user YourName` to register and gain network access
3. **Explore servers** - Use `know_servers` to see available servers
4. **Connect to servers** - Use `connect_to <ip>` to access different systems
5. **Navigate the file system** - Use `ls`, `cd`, `new_folder`, `new_file` to interact
6. **Discover the story** - Explore files and servers to uncover the narrative

## 🏗️ Project Structure

```
aida-svelte/
├── src/
│   ├── models/           # TypeScript classes (Server, Directory, File)
│   ├── commands/         # Command registry and implementations
│   ├── stores/           # Svelte stores for state management
│   ├── components/       # Svelte components (Terminal)
│   ├── data/            # Game initialization and data
│   ├── App.svelte       # Main application component
│   └── main.ts          # Application entry point
├── index.html           # HTML template
└── package.json         # Project dependencies
```

## 🔧 Architecture Highlights

### Svelte Stores for State Management
Reactive stores handle all game state:
```typescript
// Real-time reactive updates
$: if ($outputLines.length) {
  scrollToBottom();
}
```

### Type-Safe Models
```typescript
class Server {
  name: string;
  encrypted: boolean;
  path: string;
  // ... fully typed methods
}
```

### Command Registry Pattern
Extensible command system:
```typescript
registry.register({
  name: 'command_name',
  description: 'What it does',
  execute: (input) => { /* logic */ }
});
```

## 🎨 Customization

### Adding New Commands

1. Edit `src/commands/commands.ts`
2. Register a new command:

```typescript
registry.register({
  name: 'mycommand',
  description: 'Does something cool',
  execute: (input) => {
    addOutput('Command executed!');
  }
});
```

### Creating New Servers

Edit `src/data/initializeGame.ts`:

```typescript
const newServer = new Server('MyServer');
newServer.setKnown();
newServer.addHome('root');
addServer(newServer);
```

### Styling

Modify `src/components/Terminal.svelte` styles or `src/app.css` for global changes.

## 📱 Mobile Support

The terminal is fully responsive and works on mobile devices. The interface adapts font sizes and spacing for smaller screens.

## 🛠️ Development

### Key Technologies

- **Svelte 5** - Component framework with incredible reactivity
- **TypeScript 5** - Type safety and modern JavaScript features
- **Vite 7** - Build tool with HMR and optimizations
- **ESLint** - Code quality and consistency

### Code Quality

- Fully typed with TypeScript
- Modern ES6+ syntax
- Component-based architecture
- Reactive state management
- Clean separation of concerns

## 🔮 Future Enhancements

Potential features to implement:
- Save/load game progress (localStorage)
- More servers with rich narrative content
- Encryption/decryption puzzles
- Achievement system
- Sound effects
- More interactive programs (port scanner, password cracker)
- Multiplayer capabilities
- Custom themes

## 📄 License

This project is open source. Feel free to modify and expand upon it!

## 🤝 Contributing

This is a learning project demonstrating modern web development with Svelte. Contributions and improvements are welcome!

## 🎓 Learning Resources

This project demonstrates:
- Svelte component development
- TypeScript class-based architecture
- Reactive state management with Svelte stores
- Event handling and keyboard interactions
- Responsive CSS design
- Modern build tooling with Vite

Perfect for learning Svelte while building something fun!

---

**Enjoy exploring the Neurolink Network!** 🚀
