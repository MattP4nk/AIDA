import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class SocialCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "msg",
    "mail",
    "inbox",
    "forum",
    "darkweb",
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
      case "darkweb":
        return await this.handleDarkweb(command, context);
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

  // ... getCommandInfo() ...

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

    const { messageService } = await import("../messageService");
    const result = await messageService.sendPrivateMessage(
      userId,
      recipient.id,
      {
        content,
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
    const recipientUsername = command.args[0];
    const subject = command.args[1];
    const content = command.args.slice(2).join(" ");

    if (!recipientUsername || !subject || !content) {
      return {
        success: false,
        output: "Usage: mail <username> <subject> <message>",
        timestamp: new Date(),
      };
    }

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

    const { messageService } = await import("../messageService");
    const result = await messageService.sendPrivateMessage(
      userId,
      recipient.id,
      {
        content,
        subject,
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
    const { messageService } = await import("../messageService");
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

    const output = messages.map(
      (msg: any) =>
        `[${msg.isRead ? " " : "*"}] ${msg.senderUsername}: ${msg.subject || "(No Subject)"} - ${msg.content.substring(0, 30)}...`,
    );

    return {
      success: true,
      output: ["Inbox:", ...output],
      data: result.data,
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

      const output = contacts.map(
        (c: any) => `- ${c.contact?.username || c.handle} (${c.status})`,
      );
      return {
        success: true,
        output: ["Contacts:", ...output],
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
    _command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    return {
      success: false,
      output: "Forum not yet implemented. Coming soon!",
      timestamp: new Date(),
    };
  }

  private async handleDarkweb(
    _command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    return {
      success: false,
      output: "Darkweb access not yet implemented. Coming soon!",
      timestamp: new Date(),
    };
  }

  private async handleProxy(
    _command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    return {
      success: false,
      output: "Proxy management not yet implemented. Coming soon!",
      timestamp: new Date(),
    };
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
            ({
              id,
              username,
              isOnline,
              unreadCount,
              lastMessagePreview,
            }) => ({
              id,
              username,
              isOnline,
              unreadCount,
              lastMessagePreview,
            }),
          ),
        },
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
