import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class GameCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "status",
    "skills",
    "missions",
    "accept",
    "abandon",
    "progress",
    "scripts",
    "shop",
    "buy",
    "sell",
    "use",
    "players",
    "who",
    "whois",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "status":
          return await this.handleStatus(command, context);
        case "skills":
          return await this.handleSkills(command, context);
        case "missions":
          return await this.handleMissions(command, context);
        case "accept":
          return await this.handleAccept(command, context);
        case "abandon":
          return await this.handleAbandon(command, context);
        case "progress":
          return await this.handleProgress(command, context);
        case "scripts":
          return await this.handleInventory(command, context);
        case "shop":
          return await this.handleShop(command, context);
        case "buy":
          return await this.handleBuy(command, context);
        case "sell":
          return await this.handleSell(command, context);
        case "use":
          return await this.handleUse(command, context);
        case "players":
          return await this.handlePlayers(command, context);
        case "who":
          return await this.handleWho(command, context);
        case "whois":
          return await this.handleWhois(command, context);
        default:
          return {
            success: false,
            output: `Game command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Game command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "status",
        category: "game",
        description: "Display player status and progress",
        usage: "status",
        examples: ["status"],
      },
      {
        command: "skills",
        category: "game",
        description: "Show player skills and levels",
        usage: "skills",
        examples: ["skills"],
      },
      {
        command: "missions",
        category: "game",
        description: "List available missions",
        usage: "missions",
        examples: ["missions"],
      },
      {
        command: "accept",
        category: "game",
        description: "Accept a mission",
        usage: "accept <mission_id>",
        examples: ["accept mission_001"],
      },
      {
        command: "abandon",
        category: "game",
        description: "Abandon a mission",
        usage: "abandon <mission_id>",
        examples: ["abandon mission_001"],
      },
      {
        command: "progress",
        category: "game",
        description: "Show mission progress",
        usage: "progress",
        examples: ["progress"],
      },
      {
        command: "scripts",
        category: "game",
        description: "Show player inventory/scripts",
        usage: "scripts",
        examples: ["scripts"],
      },
      {
        command: "shop",
        category: "game",
        description: "Browse the darknet marketplace",
        usage: "shop [category] [search]",
        examples: ["shop", "shop EXPLOIT", "shop exploit scanner"],
      },
      {
        command: "buy",
        category: "game",
        description: "Purchase an item from the shop",
        usage: "buy <item_id> [quantity]",
        examples: ["buy port_scanner", "buy firewall 2"],
      },
      {
        command: "sell",
        category: "game",
        description: "Sell an item from inventory",
        usage: "sell <item_id> [quantity]",
        examples: ["sell old_script", "sell exploit_v1 3"],
      },
      {
        command: "use",
        category: "game",
        description: "Use an item from inventory",
        usage: "use <item_id>",
        examples: ["use health_pack", "use skill_boost"],
      },
      {
        command: "players",
        category: "game",
        description: "List all online players",
        usage: "players",
        examples: ["players"],
      },
      {
        command: "who",
        category: "game",
        description: "Show players on current server",
        usage: "who",
        examples: ["who"],
      },
      {
        command: "whois",
        category: "game",
        description: "Get detailed player information",
        usage: "whois <username>",
        examples: ["whois h4x0r", "whois admin"],
      },
    ];
  }

  private async handleStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const user = await context.db.client.user.findUnique({
      where: { id: context.userId },
      include: { progress: true },
    });

    if (!user || !user.progress) {
      return {
        success: false,
        output: "User data not found",
        timestamp: new Date(),
      };
    }

    const output = [
      "=== PLAYER STATUS ===",
      `Username: ${user.username}`,
      `Home IP: ${user.homeIp}`,
      `Level: ${user.progress.level}`,
      `Experience: ${user.progress.experience}`,
      `Credits: $${user.progress.credits}`,
      "",
      "=== FACTION REPUTATION ===",
      `Military: ${user.progress.repMilitary}`,
      `Sword Corp: ${user.progress.repSwordCorp}`,
      `Anonymous: ${user.progress.repAnons}`,
      `Neutral: ${user.progress.repNeutral}`,
    ].join("\n");

    return {
      success: true,
      output,
      data: { user, progress: user.progress },
      timestamp: new Date(),
    };
  }

  private async handleSkills(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });

    if (!progress) {
      return {
        success: false,
        output: "Player progress not found",
        timestamp: new Date(),
      };
    }

    const output = [
      "=== PLAYER SKILLS ===",
      `Hacking: ${progress.hacking}/100`,
      `Networking: ${progress.networking}/100`,
      `Cryptography: ${progress.cryptography}/100`,
      `Stealth: ${progress.stealth}/100`,
      `Social Engineering: ${progress.socialEng}/100`,
      `Forensics: ${progress.forensics}/100`,
    ].join("\n");

    return {
      success: true,
      output,
      data: { skills: progress },
      timestamp: new Date(),
    };
  }

  private async handleMissions(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionService = context.services.missionService;
    const missions = await missionService.getPlayerMissions(context.userId);

    return {
      success: true,
      output: this.formatMissionList(missions),
      data: missions,
      timestamp: new Date(),
    };
  }

  private async handleAccept(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionId = command.args?.[0];

    if (!missionId) {
      return {
        success: false,
        output: "Usage: accept <mission_id>",
        timestamp: new Date(),
      };
    }

    const missionService = context.services.missionService;
    await missionService.acceptMission(context.userId, missionId);

    return {
      success: true,
      output: "Mission accepted",
      timestamp: new Date(),
    };
  }

  private async handleAbandon(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionId = command.args?.[0];

    if (!missionId) {
      return {
        success: false,
        output: "Usage: abandon <mission_id>",
        timestamp: new Date(),
      };
    }

    const missionService = context.services.missionService;
    await missionService.abandonMission(context.userId, missionId);

    return {
      success: true,
      output: "Mission abandoned",
      timestamp: new Date(),
    };
  }

  private async handleProgress(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionService = context.services.missionService;
    const missions = await missionService.getPlayerMissions(
      context.userId,
      "assigned",
    );

    return {
      success: true,
      output: this.formatMissionProgress(missions),
      data: missions,
      timestamp: new Date(),
    };
  }

  private async handleInventory(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
    const inventory = await shopService.getPlayerInventory(context.userId);
    const bonuses = await shopService.getPlayerBonuses(context.userId);

    if (inventory.length === 0) {
      return {
        success: true,
        output: "Your scripts folder is empty. Type 'shop' to browse items.",
        timestamp: new Date(),
      };
    }

    let output = "=== SCRIPTS ===\n\n";

    // Group by category
    const categories = new Map<string, typeof inventory>();
    inventory.forEach((item: any) => {
      const cat = item.item.category;
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(item);
    });

    categories.forEach((items, category) => {
      output += `--- ${category} ---\n`;
      items.forEach((invItem: any) => {
        const qty = invItem.quantity > 1 ? ` (x${invItem.quantity})` : "";
        output += `• ${invItem.item.name}${qty}\n`;
        output += `  ${invItem.item.description}\n`;
        if (invItem.item.effects) {
          const effects = Object.entries(invItem.item.effects)
            .filter(([_, val]) => val && (val as number) > 0)
            .map(([key, val]) => `${key}: +${val}`)
            .join(", ");
          if (effects) output += `  Effects: ${effects}\n`;
        }
        output += "\n";
      });
    });

    // Show total bonuses
    output += "=== TOTAL BONUSES ===\n";
    if (bonuses.hackingBonus) output += `Hacking: +${bonuses.hackingBonus}\n`;
    if (bonuses.stealthBonus) output += `Stealth: +${bonuses.stealthBonus}\n`;
    if (bonuses.speedBonus) output += `Speed: +${bonuses.speedBonus}\n`;
    if (bonuses.detectionReduction)
      output += `Detection Reduction: -${(bonuses.detectionReduction * 100).toFixed(0)}%\n`;
    if (bonuses.successRateIncrease)
      output += `Success Rate: +${(bonuses.successRateIncrease * 100).toFixed(0)}%\n`;

    return {
      success: true,
      output,
      data: { inventory, bonuses },
      timestamp: new Date(),
    };
  }

  private async handleShop(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });

    if (!progress) {
      return {
        success: false,
        output: "Player progress not found",
        timestamp: new Date(),
      };
    }

    const category = command.args?.[0]?.toUpperCase();
    const search = command.args?.slice(1).join(" ");

    let items = shopService.getAllItems();

    // Filter by player level
    items = items.filter((item: any) => item.requiredLevel <= progress.level);

    // Filter by category if provided
    if (category) {
      items = items.filter((item: any) => item.category === category);
    }

    // Search if provided
    if (search) {
      items = shopService.searchItems(search);
    }

    if (items.length === 0) {
      return {
        success: true,
        output: "No items found matching your criteria.",
        timestamp: new Date(),
      };
    }

    let output = "=== DARKNET MARKETPLACE ===\n\n";
    output += `Credits Available: ${progress.credits}\n`;
    output += `Level: ${progress.level}\n\n`;

    if (category) {
      output += `Category: ${category}\n\n`;
    }

    // Group by category
    const categories = new Map<string, typeof items>();
    items.forEach((item: any) => {
      const cat = item.category;
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(item);
    });

    categories.forEach((catItems, cat) => {
      output += `--- ${cat} ---\n`;
      catItems.forEach((item: any) => {
        const canBuy = progress.credits >= item.price;
        const price = canBuy
          ? `${item.price}¢`
          : `${item.price}¢ [INSUFFICIENT FUNDS]`;
        output += `[${item.id}] ${item.name} - ${price}\n`;
        output += `  ${item.description}\n`;
        output += `  Rarity: ${item.rarity} | Level: ${item.requiredLevel}\n`;
        if (item.effects) {
          const effects = Object.entries(item.effects)
            .filter(([_, val]) => val && (val as number) > 0)
            .map(([key, val]) => `${key}: +${val}`)
            .join(", ");
          if (effects) output += `  Effects: ${effects}\n`;
        }
        output += "\n";
      });
    });

    output += "Usage: buy <item_id> [quantity]\n";
    output += "       shop <category> - Filter by category\n";

    return {
      success: true,
      output,
      data: { items, credits: progress.credits },
      timestamp: new Date(),
    };
  }

  private async handleBuy(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args?.[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: buy <item_id> [quantity]",
        timestamp: new Date(),
      };
    }

    const quantity = parseInt(command.args?.[1] || "1");

    const shopService = context.services.shopService;
    const result = await shopService.purchaseItem(context.userId, itemId, quantity);

    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
  }

  private async handleSell(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args?.[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: sell <item_id> [quantity]",
        timestamp: new Date(),
      };
    }

    const quantity = parseInt(command.args?.[1] || "1");

    const shopService = context.services.shopService;
    const result = await shopService.sellItem(context.userId, itemId, quantity);

    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
  }

  private async handleUse(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args?.[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: use <item_id>",
        timestamp: new Date(),
      };
    }

    const shopService = context.services.shopService;
    const result = await shopService.useItem(context.userId, itemId);

    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
  }

  private async handlePlayers(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const presenceService = context.services.playerPresenceService;

    const output = presenceService.formatOnlinePlayersList();
    const players = presenceService.getOnlinePlayers();

    return {
      success: true,
      output,
      data: { players, count: players.length },
      timestamp: new Date(),
    };
  }

  private async handleWho(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Get current server connection
    const connection = await context.db.client.serverConnection.findFirst({
      where: {
        userId: context.userId,
        disconnectedAt: null,
      },
      include: {
        server: true,
      },
      orderBy: {
        connectedAt: "desc",
      },
    });

    if (!connection) {
      return {
        success: false,
        output: "You are not connected to any server.",
        timestamp: new Date(),
      };
    }

    const presenceService = context.services.playerPresenceService;
    const output = presenceService.formatServerOccupancy(connection.serverId);

    return {
      success: true,
      output,
      data: {
        serverId: connection.serverId,
        serverName: connection.server.name,
      },
      timestamp: new Date(),
    };
  }

  private async handleWhois(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetUsername = command.args?.[0];

    if (!targetUsername) {
      return {
        success: false,
        output: "Usage: whois <username>",
        timestamp: new Date(),
      };
    }

    const presenceService = context.services.playerPresenceService;

    // Find player by username
    const player = presenceService.findPlayerByUsername(targetUsername);

    if (!player) {
      return {
        success: false,
        output: `Player '${targetUsername}' not found or is offline.`,
        timestamp: new Date(),
      };
    }

    // Get detailed info
    const details = await presenceService.getPlayerDetails(player.userId);

    if (!details) {
      return {
        success: false,
        output: "Failed to retrieve player information.",
        timestamp: new Date(),
      };
    }

    // Format output
    let output = `=== PLAYER INFO: ${details.username} ===\n\n`;
    output += `Level: ${details.level}\n`;
    output += `Reputation: ${details.reputation}\n`;
    output += `Credits: ${details.credits}\n`;
    output += `Member Since: ${details.joinedAt.toLocaleDateString()}\n\n`;

    output += `--- Skills ---\n`;
    output += `Hacking: ${details.skills.hacking}\n`;
    output += `Stealth: ${details.skills.stealth}\n`;
    output += `Networking: ${details.skills.networking}\n`;
    output += `Cryptography: ${details.skills.cryptography}\n`;
    output += `Social Engineering: ${details.skills.socialEng}\n`;
    output += `Forensics: ${details.skills.forensics}\n\n`;

    output += `--- Stats ---\n`;
    output += `Total Hacks: ${details.totalHacks}\n`;
    output += `Successful: ${details.successfulHacks}\n`;
    output += `Success Rate: ${details.totalHacks > 0 ? Math.round((details.successfulHacks / details.totalHacks) * 100) : 0}%\n\n`;

    if (details.currentServerName) {
      output += `Current Location: ${details.currentServerName}\n`;
    } else {
      output += `Current Location: Not connected\n`;
    }

    if (details.achievements.length > 0) {
      output += `\n--- Achievements ---\n`;
      details.achievements.forEach((ach: string) => {
        output += `• ${ach}\n`;
      });
    }

    return {
      success: true,
      output,
      data: details,
      timestamp: new Date(),
    };
  }

  // Helper methods
  private formatMissionList(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No missions available";
    }

    let output = "📋 Missions:\n\n";

    missions.forEach((mission: any) => {
      output += `[${mission.id}] ${mission.title}\n`;
      output += `  Status: ${mission.status}\n`;
      output += `  Difficulty: ${mission.difficulty}\n`;

      if (mission.reward) {
        output += `  Reward: ${mission.reward.credits} credits, ${mission.reward.experience} XP\n`;
      }

      if (mission.expiresAt) {
        const expires = new Date(mission.expiresAt);
        output += `  Expires: ${expires.toLocaleString()}\n`;
      }

      output += "\n";
    });

    return output;
  }

  private formatMissionProgress(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No active missions";
    }

    let output = "📊 Mission Progress:\n\n";

    missions.forEach((mission: any) => {
      output += `${mission.title}\n`;

      if (mission.objectives && mission.objectives.length > 0) {
        output += "Objectives:\n";
        mission.objectives.forEach((obj: any) => {
          const status = obj.completed ? "✅" : "⏳";
          const progress =
            obj.current && obj.target ? ` (${obj.current}/${obj.target})` : "";
          output += `  ${status} ${obj.description}${progress}\n`;
        });
      }

      output += "\n";
    });

    return output;
  }
}
