import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  sanitizeMessageContent,
  validateMessageContent,
} from "../../utils/validators";
import {
  render,
  list,
  multiPanel,
  infoBox,
  helpPanel,
  statusCard,
  HelpEntry,
} from "./asciiBox";

export class SocialCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "msg",
    "mail",
    "inbox",
    "forum",
    "proxy",
    "chat",
    "contact",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    switch (command.command) {
      case "msg":
        return await this.handleMsg(command, context);
      case "mail":
        return await this.handleMail(command, context);
      case "inbox":
        return await this.handleInbox(command, context);
      case "contact":
        return await this.handleContact(command, context);
      case "chat":
        return await this.handleChatCommand(command, context);
      case "forum":
        return await this.handleForum(command, context);
      case "proxy":
        return await this.handleProxy(command, context);
      default:
        return {
          success: false,
          output: [`Unknown social command: ${command.command}`],
          timestamp: new Date(),
        };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "msg",
        category: "social",
        description: "Send a quick private message to another player",
        usage: "msg <username> <message>",
        examples: [
          "msg alice Hey, how are you?",
          "msg bob Check out this hack!",
        ],
      },
      {
        command: "mail",
        category: "social",
        description: "Send a formal email with subject",
        usage: "mail <username> <subject> <message>",
        examples: [
          "mail admin Report Found a bug in the system",
          "mail colleague Meeting Tomorrow's briefing at 10AM",
        ],
      },
      {
        command: "inbox",
        category: "social",
        description: "Check your inbox for new messages",
        usage: "inbox",
        examples: ["inbox"],
      },
      {
        command: "contact",
        category: "social",
        description: "Manage your contact list",
        usage: "contact [list|add|remove] [username]",
        examples: ["contact list", "contact add alice", "contact remove bob"],
      },
      {
        command: "chat",
        category: "social",
        description: "Real-time chat with other players",
        usage: "chat [history <contactId>]",
        examples: ["chat", "chat history user-123"],
      },
      {
        command: "forum",
        category: "social",
        description:
          "[Social 5] Access darknet forums and underground networks",
        usage: "forum [scan|access|register|post|read|search]",
        examples: [
          "forum scan",
          "forum access hackthenet",
          "forum post <id> <title> <content>",
        ],
      },
      {
        command: "proxy",
        category: "social",
        description:
          "[Network 10] Manage proxy connections for secure darkweb access",
        usage: "proxy [list|connect|disconnect|status]",
        examples: ["proxy list", "proxy connect proxy1", "proxy status"],
      },
    ];
  }

  private async handleMsg(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId } = context;
    const recipientUsername = command.args[0];
    const content = command.args.slice(1).join(" ");

    if (!recipientUsername || !content) {
      return {
        success: false,
        output: "Usage: msg <username> <message>",
        timestamp: new Date(),
      };
    }

    // Validate and sanitize content
    const contentValidation = validateMessageContent(content);
    if (!contentValidation.isValid) {
      return {
        success: false,
        output: contentValidation.error || "Invalid message content",
        timestamp: new Date(),
      };
    }

    const sanitizedContent = sanitizeMessageContent(content);

    const { db } = context;
    const recipient = await db.client.user.findFirst({
      where: { username: recipientUsername },
    });

    if (!recipient) {
      return {
        success: false,
        output: `User '${recipientUsername}' not found`,
        timestamp: new Date(),
      };
    }

    const messageService = context.services.messageService;
    const result = await messageService.sendPrivateMessage(
      userId,
      recipient.id,
      {
        content: sanitizedContent,
        subject: "", // Empty subject for chat/msg
        messageType: "private",
      },
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleMail(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId } = context;
    const subCommand = command.args[0]?.toLowerCase();

    // Handle subcommands
    if (subCommand === "sent") {
      const messageService = context.services.messageService;
      const result = await messageService.getSentMessages(userId, {
        limit: 20,
      });

      if (!result.success || !result.data) {
        return {
          success: false,
          output: "Failed to retrieve sent messages",
          timestamp: new Date(),
        };
      }

      const messages = result.data.messages;
      if (messages.length === 0) {
        return {
          success: true,
          output: "Sent box is empty",
          data: { messages: [] },
          timestamp: new Date(),
        };
      }

      const items = messages.map(
        (msg: any) =>
          `To ${msg.recipientUsername}: ${msg.subject || "(No Subject)"} - ${msg.content.substring(0, 30)}...`,
      );

      return {
        success: true,
        output: render(list("SENT MESSAGES", items, 50)).split("\n"),
        data: result.data,
        timestamp: new Date(),
      };
    }

    if (subCommand === "read") {
      const messageId = command.args[1];
      if (!messageId) {
        return {
          success: false,
          output: "Usage: mail read <messageId>",
          timestamp: new Date(),
        };
      }

      const messageService = context.services.messageService;
      const result = await messageService.markAsRead(messageId, userId);

      return {
        success: result.success,
        output: result.message,
        timestamp: new Date(),
      };
    }

    if (subCommand === "delete") {
      const messageId = command.args[1];
      if (!messageId) {
        return {
          success: false,
          output: "Usage: mail delete <messageId>",
          timestamp: new Date(),
        };
      }

      const messageService = context.services.messageService;
      const result = await messageService.deleteMessage(messageId, userId);

      return {
        success: result.success,
        output: result.message,
        timestamp: new Date(),
      };
    }

    // Default: Send mail
    // Usage: mail <username> <subject> <message>
    const recipientUsername = command.args[0];
    const subject = command.args[1];
    const content = command.args.slice(2).join(" ");

    if (!recipientUsername || !subject || !content) {
      return {
        success: false,
        output: [
          "Usage: mail <username> <subject> <message>",
          "       mail sent",
          "       mail read <id>",
          "       mail delete <id>",
        ],
        timestamp: new Date(),
      };
    }

    // Validate and sanitize content
    const contentValidation = validateMessageContent(content);
    if (!contentValidation.isValid) {
      return {
        success: false,
        output: contentValidation.error || "Invalid message content",
        timestamp: new Date(),
      };
    }

    const sanitizedContent = sanitizeMessageContent(content);
    const sanitizedSubject = sanitizeMessageContent(subject);

    const { db } = context;
    const recipient = await db.client.user.findFirst({
      where: { username: recipientUsername },
    });

    if (!recipient) {
      return {
        success: false,
        output: `User '${recipientUsername}' not found`,
        timestamp: new Date(),
      };
    }

    const messageService = context.services.messageService;
    const result = await messageService.sendPrivateMessage(
      userId,
      recipient.id,
      {
        content: sanitizedContent,
        subject: sanitizedSubject,
        messageType: "private",
      },
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleInbox(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId } = context;
    const messageService = context.services.messageService;
    const result = await messageService.getInbox(userId, { limit: 10 });

    if (!result.success || !result.data) {
      return {
        success: false,
        output: "Failed to retrieve inbox",
        timestamp: new Date(),
      };
    }

    const messages = result.data.messages;
    if (messages.length === 0) {
      return {
        success: true,
        output: "Inbox is empty",
        timestamp: new Date(),
      };
    }

    const items = messages.map(
      (msg: any) =>
        `[${msg.isRead ? " " : "*"}] ${msg.senderUsername}: ${msg.subject || "(No Subject)"} - ${msg.content.substring(0, 30)}...`,
    );

    return {
      success: true,
      output: render(list("INBOX", items, 50)).split("\n"),
      data: result.data,
      openDialog: "mail",
      timestamp: new Date(),
    };
  }

  private async handleContact(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId, db } = context;
    const action = command.args[0]?.toLowerCase() || "list";
    const targetUsername = command.args[1];

    if (action === "list") {
      const contacts = await db.client.contact.findMany({
        where: { userId },
        include: { contact: true },
      });

      if (contacts.length === 0) {
        return {
          success: true,
          output: "No contacts found.",
          timestamp: new Date(),
        };
      }

      const items = contacts.map(
        (c: any) => `${c.contact?.username || c.handle} (${c.status})`,
      );
      return {
        success: true,
        output: render(list("CONTACTS", items, 44)).split("\n"),
        openDialog: "chat", // Contacts often managed in chat UI
        timestamp: new Date(),
      };
    }

    if (action === "add") {
      if (!targetUsername) {
        return {
          success: false,
          output: "Usage: contact add <username>",
          timestamp: new Date(),
        };
      }

      const target = await db.client.user.findFirst({
        where: { username: targetUsername },
      });

      if (!target) {
        return {
          success: false,
          output: "User not found",
          timestamp: new Date(),
        };
      }

      // Check if already exists
      const existing = await db.client.contact.findFirst({
        where: { userId, contactUserId: target.id },
      });

      if (existing) {
        return {
          success: false,
          output: "Contact already exists",
          timestamp: new Date(),
        };
      }

      await db.client.contact.create({
        data: {
          userId,
          contactUserId: target.id,
          handle: target.username,
          status: "pending",
        },
      });

      return {
        success: true,
        output: `Added ${targetUsername} to contacts`,
        timestamp: new Date(),
      };
    }

    if (action === "remove") {
      if (!targetUsername) {
        return {
          success: false,
          output: "Usage: contact remove <username>",
          timestamp: new Date(),
        };
      }

      const target = await db.client.user.findFirst({
        where: { username: targetUsername },
      });

      if (!target) {
        return {
          success: false,
          output: "User not found",
          timestamp: new Date(),
        };
      }

      await db.client.contact.deleteMany({
        where: { userId, contactUserId: target.id },
      });

      return {
        success: true,
        output: `Removed ${targetUsername} from contacts`,
        timestamp: new Date(),
      };
    }

    return {
      success: false,
      output: "Usage: contact [list|add|remove] [username]",
      timestamp: new Date(),
    };
  }

  private async handleForum(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId } = context;
    const subCommand = command.args[0]?.toLowerCase();

    const forumService = context.services.forumService;

    try {
      // forum (no args) - list discovered forums
      if (!subCommand) {
        const forums = await forumService.getDiscoveredForums(userId);

        if (forums.length === 0) {
          return {
            success: true,
            output: [
              "No forums discovered yet.",
              "Use 'forum scan' to search for forums.",
            ],
            timestamp: new Date(),
          };
        }

        const sections = forums.map((forum: any) => {
          const rows: Array<{ label: string; value: string }> = [
            { label: "Description:  ", value: forum.description },
            { label: "Security:     ", value: `${forum.securityLevel}` },
            { label: "Members:      ", value: `${forum._count?.members || 0}` },
            { label: "Posts:        ", value: `${forum._count?.posts || 0}` },
          ];
          if (forum.requiresProxy)
            rows.push({ label: "", value: "[!] Requires proxy connection" });
          if (forum.isHoneypot)
            rows.push({ label: "", value: "[!] WARNING: Potential honeypot" });
          return { heading: `[${forum.id}] ${forum.name}`, rows };
        });

        const output = multiPanel("DISCOVERED FORUMS", sections, 46);

        return {
          success: true,
          output: render(output).split("\n"),
          data: { forums },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum scan - discover new forums
      if (subCommand === "scan") {
        const useProxy = command.args.includes("--proxy");
        const result = await forumService.scanForForums(userId, useProxy);

        const rows: Array<{ label: string; value: string }> = [
          {
            label: "Found:           ",
            value: `${result.forums.length} forums`,
          },
          { label: "New discoveries:  ", value: `${result.newDiscoveries}` },
        ];

        if (result.requiresHigherSkills.length > 0) {
          rows.push({ label: "", value: "" });
          rows.push({ label: "Requires higher skills:", value: "" });
          result.requiresHigherSkills.forEach((f: string) =>
            rows.push({ label: "  - ", value: f }),
          );
        }

        const output = infoBox("FORUM SCAN RESULTS", rows, 44);

        return {
          success: true,
          output: render(output).split("\n"),
          data: { scanResult: result },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum access <forumId> - access a specific forum
      if (subCommand === "access") {
        const forumId = command.args[1];
        if (!forumId) {
          return {
            success: false,
            output: "Usage: forum access <forumId> [--proxy]",
            timestamp: new Date(),
          };
        }

        const useProxy = command.args.includes("--proxy");
        const access = await forumService.accessForum(
          userId,
          forumId,
          useProxy,
        );

        const infoRows: Array<{ label: string; value: string }> = [
          { label: "", value: access.forum.description },
          {
            label: "Members:       ",
            value: `${access.forum._count?.members || 0}`,
          },
          {
            label: "Posts:         ",
            value: `${access.forum._count?.posts || 0}`,
          },
          {
            label: "Member Status: ",
            value: access.isMember ? "✓ Registered" : "✗ Not registered",
          },
        ];

        if (access.requiresProxy) {
          infoRows.push({ label: "", value: "[!] Requires proxy connection" });
        }

        if (access.isHoneypot) {
          infoRows.push({
            label: "",
            value: "[!] WARNING: This may be a honeypot!",
          });
        }

        const postRows: Array<{ label: string; value: string }> = [];
        access.posts.slice(0, 5).forEach((post: any) => {
          postRows.push({
            label: `  [${post.id}] `,
            value: `${post.title} (by ${post.authorHandle})`,
          });
        });

        const cmdRows: Array<{ label: string; value: string }> = [
          { label: "forum read <postId>", value: "  Read a post" },
        ];
        if (access.isMember) {
          cmdRows.push({
            label: "forum post <title> <content>",
            value: "  Create a post",
          });
        } else {
          cmdRows.push({
            label: `forum register ${forumId} <handle>`,
            value: "  Register",
          });
        }

        const sections = [
          { rows: infoRows },
          { heading: "RECENT POSTS", rows: postRows },
          { heading: "COMMANDS", rows: cmdRows },
        ];

        const output = multiPanel(access.forum.name, sections, 48);

        return {
          success: true,
          output: render(output).split("\n"),
          data: { access },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum register <forumId> <handle> - register on a forum
      if (subCommand === "register") {
        const forumId = command.args[1];
        const handle = command.args[2];

        if (!forumId || !handle) {
          return {
            success: false,
            output: "Usage: forum register <forumId> <handle>",
            timestamp: new Date(),
          };
        }

        await forumService.registerForumAccount(userId, forumId, handle);

        return {
          success: true,
          output: `✓ Successfully registered on forum as '${handle}'`,
          data: { forumId, handle },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum post <forumId> <title> <content> - create a post
      if (subCommand === "post") {
        const forumId = command.args[1];
        const title = command.args[2];
        const content = command.args.slice(3).join(" ");

        if (!forumId || !title || !content) {
          return {
            success: false,
            output: "Usage: forum post <forumId> <title> <content>",
            timestamp: new Date(),
          };
        }

        const post = await forumService.createPost(
          userId,
          forumId,
          title,
          content,
        );

        return {
          success: true,
          output: [
            `✓ Post created successfully`,
            `Title: ${post.title}`,
            `Post ID: ${post.id}`,
          ],
          data: { post },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum read <forumId> <postId> - read a specific post
      if (subCommand === "read") {
        const forumId = command.args[1];
        const postId = command.args[2];

        if (!forumId || !postId) {
          return {
            success: false,
            output: "Usage: forum read <forumId> <postId>",
            timestamp: new Date(),
          };
        }

        const post = await forumService.readPost(userId, forumId, postId);

        const metaRows: Array<{ label: string; value: string }> = [
          { label: "Author:  ", value: post.authorHandle },
          {
            label: "Date:    ",
            value: new Date(post.createdAt).toLocaleString(),
          },
          { label: "Views:   ", value: `${post.viewCount}` },
        ];

        const contentRows: Array<{ label: string; value: string }> = [
          { label: "", value: post.content },
        ];

        if (post.storyRelevant) {
          contentRows.push({ label: "", value: "" });
          contentRows.push({
            label: "",
            value: "[*] This post contains story-relevant information",
          });
        }

        if (post.keyFragmentId) {
          contentRows.push({ label: "", value: "" });
          contentRows.push({
            label: "",
            value: "[KEY] This post contains a key fragment!",
          });
        }

        const sections = [
          { rows: metaRows },
          { heading: "CONTENT", rows: contentRows },
        ];

        const output = multiPanel(post.title, sections, 48);

        return {
          success: true,
          output: render(output).split("\n"),
          data: { post },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // forum search <forumId> <query> - search posts
      if (subCommand === "search") {
        const forumId = command.args[1];
        const query = command.args.slice(2).join(" ");

        if (!forumId || !query) {
          return {
            success: false,
            output: "Usage: forum search <forumId> <query>",
            timestamp: new Date(),
          };
        }

        const posts = await forumService.searchPosts(userId, forumId, query);

        if (posts.length === 0) {
          return {
            success: true,
            output: "No posts found matching your search.",
            timestamp: new Date(),
          };
        }

        const items = posts.map(
          (post: any) =>
            `[${post.id}] ${post.title} (by ${post.authorHandle}) - ${post.content.substring(0, 40)}...`,
        );

        const output = list(
          `SEARCH RESULTS (${posts.length} found)`,
          items,
          50,
        );

        return {
          success: true,
          output: render(output).split("\n"),
          data: { posts },
          openDialog: "forum",
          timestamp: new Date(),
        };
      }

      // Unknown subcommand
      const entries: HelpEntry[] = [
        { command: "forum", description: "List discovered forums" },
        { command: "forum scan [--proxy]", description: "Scan for forums" },
        { command: "forum access <id>", description: "Access a forum" },
        {
          command: "forum register <id> <handle>",
          description: "Register on a forum",
        },
        {
          command: "forum post <id> <title> <content>",
          description: "Create a post",
        },
        { command: "forum read <id> <postId>", description: "Read a post" },
        { command: "forum search <id> <query>", description: "Search posts" },
      ];

      return {
        success: false,
        output: render(helpPanel("FORUM COMMANDS", entries, 50)).split("\n"),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: `Forum error: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  private async handleProxy(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId } = context;
    const subCommand = command.args[0]?.toLowerCase();

    const forumService = context.services.forumService;

    try {
      // proxy list - show available proxy servers
      if (subCommand === "list" || !subCommand) {
        const proxies = await forumService.listProxyServers(userId);

        const speedMap: Record<string, string> = {
          slow: "Slow",
          medium: "Medium",
          fast: "Fast",
        };

        const sections = proxies.map((proxy: any) => {
          const status = proxy.status === "active" ? "ONLINE" : "OFFLINE";
          const speed = speedMap[proxy.speed] || "Unknown";
          return {
            heading: `[${proxy.id}] ${proxy.name}`,
            rows: [
              { label: "Location:   ", value: proxy.location },
              { label: "Status:     ", value: status },
              {
                label: "Anonymity:  ",
                value: `${"█".repeat(proxy.anonymityLevel)}${"░".repeat(5 - proxy.anonymityLevel)} (${proxy.anonymityLevel}/5)`,
              },
              { label: "Speed:      ", value: speed },
            ],
          };
        });

        const output = multiPanel("AVAILABLE PROXY SERVERS", sections, 46);
        output.push(" Use 'proxy connect <id>' to establish connection");

        return {
          success: true,
          output: render(output).split("\n"),
          data: { proxies },
          timestamp: new Date(),
        };
      }

      // proxy connect <id> - connect to a proxy
      if (subCommand === "connect") {
        const proxyId = command.args[1];

        if (!proxyId) {
          return {
            success: false,
            output: "Usage: proxy connect <proxy_id>",
            timestamp: new Date(),
          };
        }

        const connection = await forumService.connectToProxy(userId, proxyId);

        const lines = infoBox(
          "PROXY CONNECTED",
          [
            { label: "Status:    ", value: "✓ Connected" },
            { label: "Server:    ", value: connection.proxyServer },
            { label: "Location:  ", value: connection.location },
            {
              label: "Expires:   ",
              value: new Date(connection.expiresAt).toLocaleString(),
            },
            { label: "", value: "" },
            { label: "", value: "You can now access proxy-required forums." },
          ],
          46,
        );

        return {
          success: true,
          output: render(lines).split("\n"),
          data: { connection },
          timestamp: new Date(),
        };
      }

      // proxy disconnect - disconnect from proxy
      if (subCommand === "disconnect") {
        await forumService.disconnectProxy(userId);

        return {
          success: true,
          output: "✓ Disconnected from proxy server",
          timestamp: new Date(),
        };
      }

      // proxy status - check current connection
      if (subCommand === "status") {
        const status = await forumService.getProxyStatus(userId);

        if (!status.connected) {
          const lines = statusCard(
            "PROXY STATUS",
            [
              { label: "Connected:  ", value: "✗ No" },
              { label: "", value: "" },
              { label: "", value: "Use 'proxy list' to see available servers" },
            ],
            44,
          );

          return {
            success: true,
            output: render(lines).split("\n"),
            data: { status },
            timestamp: new Date(),
          };
        }

        const lines = statusCard(
          "PROXY STATUS",
          [
            { label: "Connected:  ", value: "✓ Yes" },
            { label: "Server:     ", value: `${status.proxyServer || "N/A"}` },
            { label: "Location:   ", value: `${status.location || "N/A"}` },
            {
              label: "Expires:    ",
              value: status.expiresAt
                ? new Date(status.expiresAt).toLocaleString()
                : "N/A",
            },
          ],
          44,
        );

        return {
          success: true,
          output: render(lines).split("\n"),
          data: { status },
          timestamp: new Date(),
        };
      }

      // Unknown subcommand
      const entries: HelpEntry[] = [
        { command: "proxy list", description: "Show available proxy servers" },
        { command: "proxy connect <id>", description: "Connect to a proxy" },
        { command: "proxy disconnect", description: "Disconnect from proxy" },
        { command: "proxy status", description: "Check connection status" },
      ];

      return {
        success: false,
        output: render(helpPanel("PROXY COMMANDS", entries, 50)).split("\n"),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: `Proxy error: ${(error as Error).message}`,
        timestamp: new Date(),
      };
    }
  }

  private async handleChatCommand(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId, db } = context;
    const subCommand = command.args[0]?.toLowerCase();

    if (subCommand === "history") {
      const contactId = command.args[1];

      if (!contactId) {
        return {
          success: false,
          output: ["Usage: chat history <contactId>"],
          timestamp: new Date(),
        };
      }

      try {
        // Get current user data
        const currentUser = await db.client.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });

        const allMessages = await db.client.message.findMany({
          where: {
            OR: [
              { senderId: userId, recipientId: contactId },
              { senderId: contactId, recipientId: userId },
            ],
            subject: "",
          },
          include: {
            sender: { select: { id: true, username: true } },
            recipient: { select: { id: true, username: true } },
          },
          orderBy: { timestamp: "desc" },
          take: 100,
        });

        await db.client.message.updateMany({
          where: {
            recipientId: userId,
            senderId: contactId,
            isRead: false,
            subject: "",
          },
          data: {
            isRead: true,
          },
        });

        function getUsername(user: any, fallback: string) {
          return user?.username ?? fallback;
        }

        const contactUsername = command.args[2] || "Contact";
        const formattedMessages = allMessages.map((msg: any) => ({
          id: msg.id,
          senderId: msg.senderId,
          senderUsername: getUsername(
            msg.sender,
            msg.senderId === userId
              ? currentUser?.username || "You"
              : contactUsername,
          ),
          recipientId: msg.recipientId,
          recipientUsername: getUsername(
            msg.recipient,
            msg.recipientId === userId
              ? currentUser?.username || "You"
              : contactUsername,
          ),
          content: msg.content,
          timestamp: msg.timestamp,
          isRead: msg.isRead,
        }));

        return {
          success: true,
          output: [
            `Retrieved ${formattedMessages.length} messages with contact`,
          ],
          data: {
            messages: formattedMessages,
          },
          openDialog: "chat",
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          success: false,
          output: ["Failed to load chat history"],
          error: (error as Error).message,
          timestamp: new Date(),
        };
      }
    }
    if (!subCommand) {
      const chatMessages = await db.client.message.findMany({
        where: {
          OR: [{ senderId: userId }, { recipientId: userId }],
          subject: "",
        },
        include: {
          sender: { select: { id: true, username: true } },
          recipient: { select: { id: true, username: true } },
        },
        orderBy: { timestamp: "desc" },
        take: 100,
      });

      const contactMap = new Map<string, any>();

      const dbContacts = await db.client.contact.findMany({
        where: { userId },
        include: {
          contact: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      for (const dbContact of dbContacts) {
        if (!contactMap.has(dbContact.contactUserId)) {
          contactMap.set(dbContact.contactUserId, {
            id: dbContact.contactUserId,
            username: dbContact.contact?.username || dbContact.handle,
            isOnline: false,
          });
        }
      }

      for (const msg of chatMessages) {
        if (msg.senderId !== userId && !contactMap.has(msg.senderId)) {
          contactMap.set(msg.senderId, {
            id: msg.senderId,
            username: msg.sender?.username || "Unknown",
            isOnline: false,
          });
        }
        if (msg.recipientId !== userId && !contactMap.has(msg.recipientId)) {
          contactMap.set(msg.recipientId, {
            id: msg.recipientId,
            username: msg.recipient?.username || "Unknown",
            isOnline: false,
          });
        }
      }

      const contacts = Array.from(contactMap.values());

      await Promise.all(
        contacts.map(async (contact) => {
          // Count unread messages
          const unreadCount = await db.client.message.count({
            where: {
              senderId: contact.id,
              recipientId: userId,
              isRead: false,
              subject: "",
            },
          });
          contact.unreadCount = unreadCount;

          const lastMsg = await db.client.message.findFirst({
            where: {
              OR: [
                { senderId: userId, recipientId: contact.id },
                { senderId: contact.id, recipientId: userId },
              ],
              subject: "",
            },
            orderBy: { timestamp: "desc" },
            select: { content: true },
          });
          contact.lastMessagePreview = lastMsg?.content || "";
        }),
      );

      return {
        success: true,
        output: ["Chat contacts loaded."],
        data: {
          contacts: contacts.map(
            ({ id, username, isOnline, unreadCount, lastMessagePreview }) => ({
              id,
              username,
              isOnline,
              unreadCount,
              lastMessagePreview,
            }),
          ),
        },
        openDialog: "chat",
        timestamp: new Date(),
      };
    }

    return {
      success: false,
      output: ["Unknown chat command"],
      timestamp: new Date(),
    };
  }
}
