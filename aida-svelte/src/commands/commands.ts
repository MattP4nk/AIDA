import { get } from 'svelte/store';
import { CommandRegistry } from './CommandRegistry';
import {
  addOutput,
  currentDirectory,
  user,
  networkAccess,
  setUser,
  getKnownServers,
  findServerByIP,
  connectToServer,
  clearOutput
} from '../stores/gameState';
import { Directory } from '../models/Directory';
import { TextFile } from '../models/File';

export function registerCommands(registry: CommandRegistry): void {
  // Change directory
  registry.register({
    name: 'cd',
    description: 'changes directory to specified directory',
    requiresArgument: true,
    execute: (input) => {
      const path = input?.substring(3).trim();
      if (!path) {
        addOutput('No directory specified');
        return;
      }

      const dir = get(currentDirectory);
      if (!dir) {
        addOutput('Error: No current directory');
        return;
      }

      const newDirectory = dir.getDirectory(path);
      if (newDirectory) {
        currentDirectory.set(newDirectory);
      } else {
        addOutput(`${path}: No such directory`);
      }
    }
  });

  // List known servers
  registry.register({
    name: 'know_servers',
    description: 'lists every server known',
    execute: () => {
      if (!get(networkAccess)) {
        addOutput("Invalid action. You don't have access to the network");
        return;
      }

      const servers = getKnownServers();
      servers.forEach(server => {
        addOutput(`${server.getName()} IP: ${server.getPath()}`);
      });
    }
  });

  // Create new folder
  registry.register({
    name: 'new_folder',
    description: 'creates a new folder in the current directory',
    requiresArgument: true,
    execute: (input) => {
      const folderName = input?.substring(11).trim();
      if (!folderName) {
        addOutput('Invalid action. Please choose a valid name for the folder.');
        return;
      }

      const dir = get(currentDirectory);
      if (dir) {
        dir.addDirectory(new Directory(folderName));
        addOutput(`Folder '${folderName}' created`);
      }
    }
  });

  // Create new file
  registry.register({
    name: 'new_file',
    description: 'creates a new text file in the current directory',
    requiresArgument: true,
    execute: (input) => {
      const fileName = input?.substring(9).trim();
      if (!fileName) {
        addOutput('Invalid action. Please choose a valid name for the file.');
        return;
      }

      const dir = get(currentDirectory);
      if (dir) {
        dir.addFile(new TextFile(fileName), fileName);
        addOutput(`File '${fileName}' created`);
      }
    }
  });

  // List directory contents
  registry.register({
    name: 'ls',
    description: 'lists directories and files in current directory',
    execute: () => {
      const dir = get(currentDirectory);
      if (dir) {
        addOutput(dir.getList());
      }
    }
  });

  // Create new user
  registry.register({
    name: 'new_user',
    description: 'creates a new user for the system',
    requiresArgument: true,
    execute: (input) => {
      const username = input?.substring(9).trim();
      if (!username) {
        addOutput('Invalid action. You must enter a valid user name');
        return;
      }

      setUser(username);
    }
  });

  // Connect to server
  registry.register({
    name: 'connect_to',
    description: 'connects to a new server',
    requiresArgument: true,
    execute: (input) => {
      if (!get(networkAccess)) {
        addOutput("You don't have access to the network");
        return;
      }

      const ip = input?.substring(11).trim();
      if (!ip) {
        addOutput('Not valid IP address.');
        return;
      }

      const server = findServerByIP(ip);
      if (server) {
        connectToServer(server);
        addOutput(`You are now connected to ${server.getName()} server. IP: ${server.getPath()}`);
      } else {
        addOutput('Not valid IP address.');
      }
    }
  });

  // Dir alias for ls
  registry.register({
    name: 'dir',
    description: null,
    execute: () => {
      const dir = get(currentDirectory);
      if (dir) {
        addOutput(dir.getList());
      }
    }
  });

  // Write to file
  registry.register({
    name: 'write_in',
    description: 'adds a new text line to the specified file',
    requiresArgument: true,
    execute: (input) => {
      const args = input?.substring(9).trim();
      if (!args) {
        addOutput('No file specified');
        return;
      }

      const parts = lineDivider(args);
      const name = parts[0];
      const text = parts[1];

      const dir = get(currentDirectory);
      if (!dir) return;

      const file = dir.getFile(name);
      if (file instanceof TextFile) {
        file.writeFile(text);
        addOutput(`Text written to ${name}`);
      } else {
        addOutput(`${name}: Not a text file or file does not exist`);
      }
    }
  });

  // Open file
  registry.register({
    name: 'open',
    description: 'opens the specified file',
    requiresArgument: true,
    execute: (input) => {
      const name = input?.substring(5).trim();
      if (!name) {
        addOutput('No file specified');
        return;
      }

      const dir = get(currentDirectory);
      if (!dir) return;

      const file = dir.getFile(name);
      if (typeof file === 'string') {
        window.open(file, '_blank');
      } else if (file instanceof TextFile) {
        const content = file.readFile();
        addOutput(`=== ${name} ===\n${content || '(empty file)'}`);
      } else {
        addOutput(`${name}: No such file`);
      }
    }
  });

  // Calculator
  registry.register({
    name: 'calculator',
    description: 'opens the calculator app',
    execute: () => {
      window.open('https://www.online-calculator.com/html5/online-calculator/index.php?v=10', '_blank');
    }
  });

  // Search
  registry.register({
    name: 'search',
    description: 'search the open network for a term',
    requiresArgument: true,
    execute: (input) => {
      const term = input?.substring(7).trim();
      if (!term) {
        addOutput('enter a valid term for search.');
        return;
      }

      const query = term.replace(/ /g, '+');
      window.open(`https://www.google.com/search?q=${query}`, '_blank');
    }
  });

  // Clear terminal
  registry.register({
    name: 'clear',
    description: 'clears the console',
    execute: () => {
      clearOutput();
    }
  });

  // Easter egg
  registry.register({
    name: 'xyzzy',
    description: null,
    execute: () => {
      addOutput('Nothing happens');
    }
  });

  // Help
  registry.register({
    name: 'help',
    description: 'returns this list',
    execute: () => {
      const commandList = registry.getCommandList();
      commandList.forEach(cmd => addOutput(cmd));
    }
  });
}

// Helper function to split input into filename and content
function lineDivider(line: string): [string, string] {
  let part1 = '';
  let part2 = '';
  let divided = false;

  for (const char of line) {
    if (!divided) {
      if (char !== ' ') {
        part1 += char;
      } else {
        divided = true;
      }
    } else {
      part2 += char;
    }
  }

  return [part1, part2];
}
