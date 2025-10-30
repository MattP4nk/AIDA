export interface Command {
  name: string;
  description: string | null;
  execute: (input?: string) => void;
  requiresArgument?: boolean;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private commandList: string[] = [];

  register(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);

    if (command.description) {
      this.commandList.push(`${command.name} - ${command.description}`);
    }
  }

  execute(input: string): boolean {
    const trimmedInput = input.trim();
    if (!trimmedInput) return false;

    const lowerInput = trimmedInput.toLowerCase();
    const spaceIndex = lowerInput.indexOf(' ');

    let commandName = lowerInput;
    let args = '';

    if (spaceIndex > 0) {
      commandName = lowerInput.substring(0, spaceIndex);
      args = trimmedInput.substring(spaceIndex + 1);
    }

    const command = this.commands.get(commandName);

    if (command) {
      if (command.requiresArgument && !args) {
        return false;
      }
      command.execute(args || trimmedInput);
      return true;
    }

    return false;
  }

  getCommandList(): string[] {
    return [...this.commandList];
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }
}
