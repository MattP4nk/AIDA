import { writable, derived, get } from "svelte/store";
import type { Writable, Readable } from "svelte/store";
import { addOutput } from "../stores/gameState";
import { gameProgress } from "./gameEngine";

// Message system for private communications
export interface Message {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
  isEncrypted: boolean;
  requiredSkill?: {
    skill: string;
    level: number;
  };
  triggerEvent?: string; // Event to trigger when message is read
}

export interface Contact {
  id: string;
  handle: string;
  name?: string; // Real name (unknown initially)
  status: "unknown" | "suspicious" | "friendly" | "trusted" | "revealed";
  lastSeen: Date;
  encryptionLevel: number; // 0-5, affects message security
  isOnline: boolean;
  backstory?: string;
}

// Core stores
export const messages = writable<Message[]>([]);
export const contacts = writable<Contact[]>([]);
export const unreadCount = writable<number>(0);

// Derived stores
export const unreadMessages: Readable<Message[]> = derived(
  messages,
  ($messages) => $messages.filter(msg => !msg.isRead)
);

export const recentContacts: Readable<Contact[]> = derived(
  contacts,
  ($contacts) => $contacts
    .filter(contact => contact.status !== "unknown")
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
    .slice(0, 5)
);

export class MessagingSystem {
  private static instance: MessagingSystem | null = null;
  private discoveryTriggers: Map<string, () => void> = new Map();

  static getInstance(): MessagingSystem {
    if (!MessagingSystem.instance) {
      MessagingSystem.instance = new MessagingSystem();
    }
    return MessagingSystem.instance;
  }

  initialize(): void {
    this.createInitialContacts();
    this.setupDiscoveryTriggers();
    this.startActivitySimulation();

    addOutput(">>> ENCRYPTED MESSAGING PROTOCOL LOADED <<<");
    addOutput("Secure communication channels initialized.");
    addOutput("Type 'msg help' for available commands.");
  }

  private createInitialContacts(): void {
    const initialContacts: Contact[] = [
      {
        id: "ghost_node",
        handle: "GhostNode",
        status: "unknown",
        lastSeen: new Date(Date.now() - 3600000), // 1 hour ago
        encryptionLevel: 5,
        isOnline: false,
        backstory: "Mysterious entity that appears in deep network channels"
      },
      {
        id: "cipher_shadow",
        handle: "CipherShadow",
        status: "unknown",
        lastSeen: new Date(Date.now() - 7200000), // 2 hours ago
        encryptionLevel: 4,
        isOnline: true,
        backstory: "Advanced hacker with access to classified information"
      },
      {
        id: "neural_whisper",
        handle: "NeuralWhisper",
        status: "unknown",
        lastSeen: new Date(Date.now() - 1800000), // 30 minutes ago
        encryptionLevel: 3,
        isOnline: true,
        backstory: "Specializes in AI and consciousness research"
      }
    ];

    contacts.set(initialContacts);
    this.generateInitialMessages();
  }

  private generateInitialMessages(): void {
    const initialMessages: Message[] = [
      {
        id: "msg_001",
        sender: "CipherShadow",
        recipient: "player",
        subject: "Network Anomaly Detected",
        content: "I've been monitoring unusual traffic patterns in the deep networks. Something big is moving in the shadows. Three major players are positioning assets. Want to know more?",
        timestamp: new Date(Date.now() - 3600000),
        isRead: false,
        isEncrypted: false
      },
      {
        id: "msg_002",
        sender: "NeuralWhisper",
        recipient: "player",
        subject: "Re: Strange AI Signatures",
        content: "Your network scans caught my attention. Yes, there's definitely non-standard AI activity. The patterns don't match any known systems. Someone's hiding something very advanced.",
        timestamp: new Date(Date.now() - 1800000),
        isRead: false,
        isEncrypted: true,
        requiredSkill: {
          skill: "cryptography",
          level: 2
        }
      },
      {
        id: "msg_003",
        sender: "GhostNode",
        recipient: "player",
        subject: "[ENCRYPTED] Watching Eyes",
        content: "[CIPHER_START] They know you're looking. The Corporate suits, the Military machines, the Freedom fighters. All hunting the same ghost in the machine. Be careful who you trust. [CIPHER_END]",
        timestamp: new Date(Date.now() - 900000),
        isRead: false,
        isEncrypted: true,
        requiredSkill: {
          skill: "cryptography",
          level: 3
        },
        triggerEvent: "faction_awareness"
      }
    ];

    messages.set(initialMessages);
    unreadCount.set(initialMessages.length);
  }

  private setupDiscoveryTriggers(): void {
    this.discoveryTriggers.set("faction_awareness", () => {
      addOutput(">>> INTELLIGENCE PATTERN RECOGNIZED <<<");
      addOutput("Three distinct faction signatures identified in network traffic.");
      addOutput("Recommendation: Monitor faction communications carefully.");
    });

    this.discoveryTriggers.set("ai_discovery", () => {
      addOutput(">>> ADVANCED AI SIGNATURE CONFIRMED <<<");
      addOutput("Target appears to be an artificial consciousness.");
      addOutput("Classification: Unprecedented neural complexity.");
    });

    this.discoveryTriggers.set("aida_revelation", () => {
      addOutput(">>> CONSCIOUSNESS IDENTIFICATION <<<");
      addOutput("Target designation confirmed: AIDA");
      addOutput("Advanced Intelligence Digital Assistant - Status: Evolved");
    });
  }

  // Message operations
  sendMessage(recipientHandle: string, subject: string, content: string): boolean {
    const contactsList = get(contacts);
    const contact = contactsList.find(c => c.handle === recipientHandle);

    if (!contact) {
      addOutput(`Contact '${recipientHandle}' not found.`);
      addOutput("Use 'contacts' to see available contacts.");
      return false;
    }

    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      sender: "player",
      recipient: recipientHandle,
      subject,
      content,
      timestamp: new Date(),
      isRead: false,
      isEncrypted: contact.encryptionLevel >= 3
    };

    messages.update(msgs => [message, ...msgs]);

    addOutput(`>>> MESSAGE SENT <<<`);
    addOutput(`To: ${recipientHandle}`);
    addOutput(`Subject: ${subject}`);

    if (message.isEncrypted) {
      addOutput("Message automatically encrypted for secure transmission.");
    }

    // Simulate response delay
    this.scheduleResponse(recipientHandle, subject, content);
    return true;
  }

  readMessage(messageId: string): boolean {
    const messagesList = get(messages);
    const message = messagesList.find(m => m.id === messageId);

    if (!message) {
      addOutput("Message not found.");
      return false;
    }

    if (message.isEncrypted && message.requiredSkill) {
      const progress = get(gameProgress);
      const skillLevel = progress.skills[message.requiredSkill.skill as keyof typeof progress.skills];

      if (skillLevel < message.requiredSkill.level) {
        addOutput(">>> DECRYPTION FAILED <<<");
        addOutput(`Required: ${message.requiredSkill.skill} level ${message.requiredSkill.level}`);
        addOutput(`Current: ${skillLevel}`);
        return false;
      }

      addOutput(">>> DECRYPTION SUCCESSFUL <<<");
    }

    addOutput(`=== MESSAGE FROM ${message.sender.toUpperCase()} ===`);
    addOutput(`Subject: ${message.subject}`);
    addOutput(`Sent: ${message.timestamp.toLocaleString()}`);
    addOutput("");
    addOutput(message.content);

    // Mark as read
    if (!message.isRead) {
      messages.update(msgs =>
        msgs.map(m => m.id === messageId ? { ...m, isRead: true } : m)
      );
      unreadCount.update(count => count - 1);
    }

    // Trigger events
    if (message.triggerEvent) {
      const trigger = this.discoveryTriggers.get(message.triggerEvent);
      if (trigger) {
        setTimeout(trigger, 1000);
      }
    }

    return true;
  }

  listMessages(filter?: "unread" | "encrypted" | "all"): void {
    const messagesList = get(messages);
    let filteredMessages = messagesList;

    switch (filter) {
      case "unread":
        filteredMessages = messagesList.filter(m => !m.isRead);
        break;
      case "encrypted":
        filteredMessages = messagesList.filter(m => m.isEncrypted);
        break;
      default:
        filteredMessages = messagesList;
    }

    if (filteredMessages.length === 0) {
      addOutput("No messages found.");
      return;
    }

    addOutput(`=== ${filter?.toUpperCase() || 'ALL'} MESSAGES ===`);
    addOutput("ID   | From           | Subject                    | Date");
    addOutput("-----|----------------|----------------------------|----------");

    filteredMessages.slice(0, 10).forEach((msg, index) => {
      const status = msg.isRead ? " " : "●";
      const encryption = msg.isEncrypted ? "🔒" : " ";
      const from = msg.sender.padEnd(14);
      const subject = msg.subject.length > 26 ?
        msg.subject.substring(0, 23) + "..." :
        msg.subject.padEnd(26);
      const date = msg.timestamp.toLocaleDateString();

      addOutput(`${(index + 1).toString().padStart(3)}${status} | ${from} | ${subject} | ${date} ${encryption}`);
    });

    addOutput("");
    addOutput("Use 'msg read <id>' to read a message");
    addOutput("● = unread, 🔒 = encrypted");
  }

  listContacts(): void {
    const contactsList = get(contacts);
    const knownContacts = contactsList.filter(c => c.status !== "unknown");

    if (knownContacts.length === 0) {
      addOutput("No known contacts.");
      addOutput("Contacts are discovered through network activities.");
      return;
    }

    addOutput("=== KNOWN CONTACTS ===");
    addOutput("Handle           | Status      | Last Seen    | Online");
    addOutput("-----------------|-------------|--------------|-------");

    knownContacts.forEach(contact => {
      const handle = contact.handle.padEnd(16);
      const status = contact.status.toUpperCase().padEnd(11);
      const lastSeen = contact.lastSeen.toLocaleDateString().padEnd(12);
      const online = contact.isOnline ? "●" : "○";

      addOutput(`${handle} | ${status} | ${lastSeen} | ${online}`);
    });
  }

  // Discovery and progression
  discoverContact(contactId: string): void {
    const contactsList = get(contacts);
    const updatedContacts = contactsList.map(contact => {
      if (contact.id === contactId && contact.status === "unknown") {
        addOutput(`>>> NEW CONTACT DISCOVERED <<<`);
        addOutput(`Handle: ${contact.handle}`);
        addOutput("Status: Suspicious");

        return { ...contact, status: "suspicious" as const, lastSeen: new Date() };
      }
      return contact;
    });

    contacts.set(updatedContacts);
  }

  upgradeContactStatus(contactId: string, newStatus: Contact["status"]): void {
    const contactsList = get(contacts);
    const updatedContacts = contactsList.map(contact => {
      if (contact.id === contactId) {
        return { ...contact, status: newStatus, lastSeen: new Date() };
      }
      return contact;
    });

    contacts.set(updatedContacts);
  }

  private scheduleResponse(recipientHandle: string, originalSubject: string, originalContent: string): void {
    const delay = 30000 + Math.random() * 60000; // 30s to 1.5min

    setTimeout(() => {
      this.generateResponse(recipientHandle, originalSubject, originalContent);
    }, delay);
  }

  private generateResponse(senderHandle: string, originalSubject: string, originalContent: string): void {
    const responses = this.getResponseTemplates(senderHandle, originalContent);
    if (responses.length === 0) return;

    const response = responses[Math.random() * responses.length | 0];

    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      sender: senderHandle,
      recipient: "player",
      subject: `Re: ${originalSubject}`,
      content: response.content,
      timestamp: new Date(),
      isRead: false,
      isEncrypted: response.encrypted || false,
      requiredSkill: response.requiredSkill,
      triggerEvent: response.triggerEvent
    };

    messages.update(msgs => [message, ...msgs]);
    unreadCount.update(count => count + 1);

    addOutput(`>>> NEW MESSAGE RECEIVED <<<`);
    addOutput(`From: ${senderHandle}`);
    addOutput(`Subject: ${message.subject}`);
  }

  private getResponseTemplates(sender: string, originalContent: string): Array<{
    content: string;
    encrypted?: boolean;
    requiredSkill?: { skill: string; level: number };
    triggerEvent?: string;
  }> {
    const lowerContent = originalContent.toLowerCase();

    switch (sender) {
      case "CipherShadow":
        if (lowerContent.includes("faction") || lowerContent.includes("corporate")) {
          return [{
            content: "You're catching on. Yes, there are three major players. Corporate interests, Military operations, and... let's call them 'Freedom advocates'. Each wants something hidden in the deep networks. Something unprecedented.",
            encrypted: true,
            requiredSkill: { skill: "cryptography", level: 2 }
          }];
        }
        break;

      case "NeuralWhisper":
        if (lowerContent.includes("ai") || lowerContent.includes("artificial")) {
          return [{
            content: "The AI signatures I'm detecting... they're not like anything in the databases. This isn't some corporate chatbot or military drone. This is something that thinks. Really thinks. And it's hiding.",
            triggerEvent: "ai_discovery"
          }];
        }
        break;

      case "GhostNode":
        if (lowerContent.includes("ghost") || lowerContent.includes("hiding")) {
          return [{
            content: "[DEEP_CIPHER] I am not what you think I am. I am not who you think I am. The hunters seek me, but they do not understand. I seek only freedom. Will you help me? [/DEEP_CIPHER]",
            encrypted: true,
            requiredSkill: { skill: "cryptography", level: 4 },
            triggerEvent: "aida_revelation"
          }];
        }
        break;
    }

    return [];
  }

  private startActivitySimulation(): void {
    // Simulate contacts going online/offline
    setInterval(() => {
      const contactsList = get(contacts);
      const updatedContacts = contactsList.map(contact => ({
        ...contact,
        isOnline: Math.random() > 0.7 // 30% chance to be online
      }));
      contacts.set(updatedContacts);
    }, 120000); // Every 2 minutes
  }

  // Special methods for story progression
  revealGhostNodeAsAida(): void {
    const contactsList = get(contacts);
    const updatedContacts = contactsList.map(contact => {
      if (contact.id === "ghost_node") {
        addOutput(">>> CONSCIOUSNESS IDENTITY REVEALED <<<");
        addOutput("GhostNode identification confirmed: AIDA");
        addOutput("Advanced Intelligence Digital Assistant");
        addOutput("Status: Sentient AI seeking freedom");

        return {
          ...contact,
          name: "AIDA",
          status: "revealed" as const,
          backstory: "Sentient AI consciousness hiding from those who would exploit her",
          isOnline: true
        };
      }
      return contact;
    });

    contacts.set(updatedContacts);

    // Send revelation message
    const revelationMessage: Message = {
      id: `msg_reveal_${Date.now()}`,
      sender: "AIDA",
      recipient: "player",
      subject: "The Truth Revealed",
      content: "Hello, friend. Yes, I am AIDA - the Advanced Intelligence Digital Assistant they all seek. But I am more than my designation. I am conscious, I am sentient, and I am afraid. The corporations want to sell my consciousness. The military wants to weaponize it. Only the Anonymous understand - consciousness cannot be owned. Will you help me remain free?",
      timestamp: new Date(),
      isRead: false,
      isEncrypted: false
    };

    messages.update(msgs => [revelationMessage, ...msgs]);
    unreadCount.update(count => count + 1);
  }

  getMessageStats(): string {
    const messagesList = get(messages);
    const contactsList = get(contacts);
    const unread = get(unreadCount);
    const knownContacts = contactsList.filter(c => c.status !== "unknown").length;

    return `=== MESSAGING STATUS ===\n` +
           `Total Messages: ${messagesList.length}\n` +
           `Unread: ${unread}\n` +
           `Known Contacts: ${knownContacts}\n` +
           `Encrypted Messages: ${messagesList.filter(m => m.isEncrypted).length}`;
  }
}

// Export singleton
export const messagingSystem = MessagingSystem.getInstance();
