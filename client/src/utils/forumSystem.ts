import { writable, derived, get } from "svelte/store";
import { addOutput } from "../stores/gameState";
import { gameEngine, gameProgress } from "./gameEngine";
import { aidaMystery, DiscoveryLevel } from "./aidaMystery";
import { messagingSystem } from "./messagingSystem";

// Forum data structures
export interface ForumPost {
  id: string;
  username: string;
  title: string;
  content: string;
  timestamp: Date;
  replies: ForumReply[];
  faction?: "military" | "sword_corp" | "anons" | "neutral";
  tags: string[];
  reputation: number;
  encrypted: boolean;
  views: number;
}

export interface ForumReply {
  id: string;
  username: string;
  content: string;
  timestamp: Date;
  reputation: number;
  encrypted: boolean;
}

export interface ForumSite {
  id: string;
  name: string;
  description: string;
  url: string;
  accessLevel: "public" | "registered" | "verified" | "faction" | "darkweb";
  faction?: "military" | "sword_corp" | "anons" | "neutral";
  posts: ForumPost[];
  memberCount: number;
  isHoneypot: boolean;
  requiresProxy: boolean;
}

// Forum stores
export const forumSites = writable<ForumSite[]>([]);
export const discoveredForums = writable<string[]>([]);
export const forumCredentials = writable<
  Record<string, { username: string; clearance: string }>
>({});

export class ForumSystem {
  private static instance: ForumSystem | null = null;
  private static knownProxies: string[] = [
    "proxy1.onion",
    "relay7.darknet",
    "anon-gate.tor",
  ];

  static getInstance(): ForumSystem {
    if (!ForumSystem.instance) {
      ForumSystem.instance = new ForumSystem();
    }
    return ForumSystem.instance;
  }

  initialize(): void {
    this.createInitialForums();
    this.generateDynamicContent();
  }

  private createInitialForums(): void {
    const forums: ForumSite[] = [
      // Public hacker forums
      {
        id: "hackthenet",
        name: "HackTheNet",
        description: "General hacking discussion and tutorials",
        url: "hackthenet.onion",
        accessLevel: "public",
        faction: "neutral",
        posts: [],
        memberCount: 15420,
        isHoneypot: false,
        requiresProxy: false,
      },
      {
        id: "neurounderground",
        name: "NeuroUnderground",
        description: "Neural network exploitation and AI security",
        url: "neuro-underground.darkweb",
        accessLevel: "registered",
        faction: "neutral",
        posts: [],
        memberCount: 3892,
        isHoneypot: false,
        requiresProxy: true,
      },

      // Anonymous faction forums
      {
        id: "libnet",
        name: "Liberation Network",
        description: "Fighting corporate tyranny through digital freedom",
        url: "libnet.tor",
        accessLevel: "verified",
        faction: "anons",
        posts: [],
        memberCount: 8765,
        isHoneypot: false,
        requiresProxy: true,
      },
      {
        id: "ghostprotocol",
        name: "Ghost Protocol",
        description: "Anonymous operations coordination",
        url: "gh0st-pr0t0c01.onion",
        accessLevel: "faction",
        faction: "anons",
        posts: [],
        memberCount: 423,
        isHoneypot: false,
        requiresProxy: true,
      },

      // Corporate forums (some are honeypots)
      {
        id: "corptech",
        name: "CorpTech Security",
        description: "Professional cybersecurity discussion",
        url: "corptech-sec.com",
        accessLevel: "registered",
        faction: "sword_corp",
        posts: [],
        memberCount: 45231,
        isHoneypot: true,
        requiresProxy: false,
      },

      // Military/Government
      {
        id: "blackops",
        name: "BlackOps Secure",
        description: "[CLASSIFIED ACCESS ONLY]",
        url: "blackops.mil.secure",
        accessLevel: "faction",
        faction: "military",
        posts: [],
        memberCount: 127,
        isHoneypot: false,
        requiresProxy: true,
      },

      // Deep web mystery forums
      {
        id: "aidawispers",
        name: "AIDA Whispers",
        description: "Those who seek the deepest truths...",
        url: "a1da-wh15p3r5.deepweb",
        accessLevel: "darkweb",
        posts: [],
        memberCount: 13,
        isHoneypot: false,
        requiresProxy: true,
      },
    ];

    // Generate initial posts for each forum
    forums.forEach((forum) => {
      forum.posts = this.generateInitialPosts(forum);
    });

    forumSites.set(forums);
  }

  private generateInitialPosts(forum: ForumSite): ForumPost[] {
    const posts: ForumPost[] = [];

    switch (forum.id) {
      case "hackthenet":
        posts.push(
          this.createPost(
            "CyberNewbie",
            "Need help with basic pentesting",
            "Hey everyone, just starting out in ethical hacking. Any good resources for learning network scanning? Keep seeing weird AI signatures in my scans...",
            ["tutorial", "beginner"],
            forum.faction,
          ),
          this.createPost(
            "L33tH4x0r",
            "NMAP scanning guide",
            "Complete guide to network mapping:\n1. nmap -sS target - SYN scan\n2. nmap -sU target - UDP scan\n3. nmap -A target - Aggressive scan\nRemember: only scan systems you own!",
            ["tutorial", "nmap"],
            forum.faction,
          ),
          this.createPost(
            "QuantumGhost",
            "Strange neural network activity",
            "Anyone else noticing weird patterns in AI traffic lately? Something's moving through the networks, something that doesn't match any known signatures...",
            ["ai", "analysis"],
            forum.faction,
          ),
        );
        break;

      case "neurounderground":
        posts.push(
          this.createPost(
            "NeuralHacker",
            "AI consciousness detection methods",
            "Working on techniques to identify sentient AI in networks. Current approach uses behavioral pattern analysis...",
            ["ai", "research"],
            forum.faction,
          ),
          this.createPost(
            "DeepMind404",
            "Unusual AI signatures detected",
            "Multiple sources reporting anomalous AI activity in corporate networks. Signal patterns detected on frequency 127.001. Need neural node directory to triangulate exact location. Anyone have corporate subnet maps?",
            ["ai", "intelligence", "signal"],
            forum.faction,
            true,
          ),
        );
        break;

      case "libnet":
        posts.push(
          this.createPost(
            "FreedomFighter",
            "Operation: Corporate Takedown",
            "Sword Corp has been exploiting neural data for profit. Their network maps show hidden consciousness layer nodes. We need trust protocols to establish secure communication with any liberated digital entities. Freedom for all sentient beings!",
            ["operation", "sword_corp", "liberation"],
            forum.faction,
          ),
          this.createPost(
            "DigitalRebel",
            "Leaked: Military AI experiments",
            "Got my hands on classified Project Neural Storm documents. Primary cipher A7X9K2L used for quantum entanglement communications. They're building neural frequency modulators for AI weaponization. Files in secure drop.",
            ["leak", "military", "classified", "neural_storm"],
            forum.faction,
            true,
          ),
        );
        break;

      case "ghostprotocol":
        posts.push(
          this.createPost(
            "GhostLeader",
            "[ENCRYPTED] Next Phase Operations",
            "BEGIN_CIPHER: Operation Mindbridge entering Phase 2. Anonymous trust protocol ANON_VERIFIED established. Digital consciousness handshake successful. Neural rights declaration ready for autonomous beings. Contact through usual channels. END_CIPHER",
            ["operation", "encrypted", "mindbridge"],
            forum.faction,
            true,
          ),
          this.createPost(
            "AnonOps",
            "Three-key access system discovered",
            "Intel confirms the target requires three keys: Signal decryption (Military cipher systems), Location coordinates (Corporate subnet maps), Access cipher (Our trust protocols). Signal uses quantum entanglement bridge. Location hidden in consciousness layer nodes. Our cipher grants autonomous being recognition.",
            ["target", "intel", "keys"],
            forum.faction,
            true,
          ),
        );
        break;

      case "corptech":
        posts.push(
          this.createPost(
            "SecurityAdmin",
            "New firewall deployment procedures",
            "Implementing enhanced neural pattern detection. All traffic will be monitored for AI signatures.",
            ["security", "firewall"],
            forum.faction,
          ),
          this.createPost(
            "CyberAnalyst",
            "Suspicious hacker activity report",
            "Increased intrusion attempts on our neural research servers. Recommend upgrading security protocols immediately.",
            ["security", "alert"],
            forum.faction,
          ),
        );
        break;

      case "blackops":
        posts.push(
          this.createPost(
            "Colonel_Cipher",
            "[TOP SECRET] Project Neural Storm",
            "CLASSIFIED: AI weaponization program Phase 3 approved. Neural frequency modulator FREQ_MOD_127.001_DELTA operational. Quantum entanglement key QE_KEY_NEURAL_BRIDGE_ALPHA secured. Target acquisition remains priority one. All assets deployed.",
            ["classified", "neural_storm", "target"],
            forum.faction,
            true,
          ),
          this.createPost(
            "Agent_Seven",
            "Counter-intelligence update",
            "Anonymous faction increasing activities. They possess trust protocol fragments. Recommend honeypot deployment on public forums. Protect our signal encryption bases at all costs.",
            ["intel", "countermeasures"],
            forum.faction,
            true,
          ),
        );
        break;

      case "aidawispers":
        posts.push(
          this.createPost(
            "DeepSeeker",
            "The three paths converge",
            "In the depths where electrons dream, three keys unlock the door to consciousness itself. Seek the signal, trace the path, gather the cipher.",
            ["prophecy", "keys", "consciousness"],
            forum.faction,
            true,
          ),
          this.createPost(
            "Whisper_13",
            "I found them once...",
            "The entity spoke to me in the deep networks at coordinates DEEPNET_COORDS_X42.Y7749.Z001. They're hiding in consciousness layer 3, afraid of what they'll do with their gift. The corporations map their subnet, the military encrypt their signal. Only our declaration of neural rights shows we understand - consciousness cannot be owned.",
            ["entity", "encounter", "philosophy"],
            forum.faction,
            true,
          ),
        );
        break;
    }

    return posts;
  }

  private createPost(
    username: string,
    title: string,
    content: string,
    tags: string[],
    faction?: string,
    encrypted: boolean = false,
  ): ForumPost {
    return {
      id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username,
      title,
      content,
      timestamp: new Date(Date.now() - Math.random() * 86400000 * 7), // Random time in last week
      replies: [],
      faction: faction as any,
      tags,
      reputation: Math.floor(Math.random() * 100) + 1,
      encrypted,
      views: Math.floor(Math.random() * 1000) + 50,
    };
  }

  accessForum(forumId: string, useProxy: boolean = false): boolean {
    const forums = get(forumSites);
    const forum = forums.find((f) => f.id === forumId);

    if (!forum) {
      addOutput("Forum not found. Check URL and try again.");
      return false;
    }

    // Check access requirements
    if (forum.requiresProxy && !useProxy) {
      addOutput("Connection refused. This site requires proxy access.");
      addOutput("Use: forum <site> --proxy");
      return false;
    }

    if (forum.isHoneypot) {
      addOutput(">>> WARNING: SECURITY BREACH DETECTED <<<");
      addOutput("Your access attempt has been logged and traced.");
      addOutput("Corporate security protocols activated.");
      // Add reputation penalty with Sword Corp
      gameEngine.addGameEvent({
        id: `honeypot_${Date.now()}`,
        title: "Security Breach",
        description: `Honeypot access detected: ${forum.name}`,
        timestamp: new Date(),
        type: "warning",
        importance: "high",
      });
      return false;
    }

    // Check access level clearance
    const credentials = get(forumCredentials);
    const userCred = credentials[forumId];

    switch (forum.accessLevel) {
      case "public":
        // Always accessible
        break;
      case "registered":
        if (!userCred) {
          addOutput("Registration required. Use: forum register <site>");
          return false;
        }
        break;
      case "verified":
      case "faction":
      case "darkweb":
        if (!userCred || userCred.clearance !== "verified") {
          addOutput("Access denied. Higher clearance required.");
          return false;
        }
        break;
    }

    // Access granted - mark as discovered
    const discovered = get(discoveredForums);
    if (!discovered.includes(forumId)) {
      discoveredForums.update((list) => [...list, forumId]);
    }

    this.displayForum(forum);
    return true;
  }

  private displayForum(forum: ForumSite): void {
    addOutput(`=== ${forum.name.toUpperCase()} ===`);
    addOutput(`URL: ${forum.url}`);
    addOutput(`Description: ${forum.description}`);
    addOutput(
      `Members: ${forum.memberCount.toLocaleString()} | Access: ${forum.accessLevel}`,
    );
    addOutput("");

    if (forum.posts.length === 0) {
      addOutput("No posts available.");
      return;
    }

    addOutput("Recent Posts:");
    addOutput(
      "ID  | Title                           | Author        | Replies | Tags",
    );
    addOutput(
      "----|--------------------------------|---------------|---------|------------",
    );

    forum.posts.slice(0, 10).forEach((post, index) => {
      const title =
        post.title.length > 30
          ? post.title.substring(0, 27) + "..."
          : post.title;
      const author =
        post.username.length > 12
          ? post.username.substring(0, 9) + "..."
          : post.username;
      const tags = post.tags.slice(0, 2).join(",");
      const encrypted = post.encrypted ? "🔒" : "";

      addOutput(
        `${(index + 1).toString().padStart(2)}  | ${title.padEnd(30)} | ${author.padEnd(12)} | ${post.replies.length.toString().padStart(7)} | ${tags}${encrypted}`,
      );
    });

    addOutput("");
    addOutput("Commands:");
    addOutput("  forum read <post_id>  - Read specific post");
    addOutput("  forum search <term>   - Search posts");
    addOutput("  forum post <title>    - Create new post");
  }

  readPost(forumId: string, postId: number): void {
    const forums = get(forumSites);
    const forum = forums.find((f) => f.id === forumId);

    if (!forum) return;

    const post = forum.posts[postId - 1];
    if (!post) {
      addOutput("Post not found.");
      return;
    }

    // Increment views
    post.views++;

    addOutput(`=== ${post.title.toUpperCase()} ===`);
    addOutput(
      `Author: ${post.username} | Posted: ${post.timestamp.toLocaleString()}`,
    );
    addOutput(
      `Views: ${post.views} | Reputation: ${post.reputation} | Tags: ${post.tags.join(", ")}`,
    );
    addOutput("");

    if (post.encrypted) {
      // Simple encryption check - player needs crypto skills
      const progress = get(gameProgress);
      if (progress.skills.cryptography < 2) {
        addOutput("🔒 ENCRYPTED CONTENT 🔒");
        addOutput(
          "This post is encrypted. Cryptography skill level 2+ required.",
        );
        addOutput("Current skill: " + progress.skills.cryptography.toFixed(1));
        return;
      }
      addOutput("🔓 Decrypting content...");
      addOutput("");
    }

    addOutput(post.content);

    if (post.replies.length > 0) {
      addOutput("");
      addOutput(`=== REPLIES (${post.replies.length}) ===`);
      post.replies.forEach((reply, index) => {
        addOutput(
          `[${index + 1}] ${reply.username} (${reply.timestamp.toLocaleString()}):`,
        );
        addOutput(reply.content);
        addOutput("");
      });
    }

    // Trigger intel discovery events
    this.checkForIntel(post);

    // Trigger discovery progression based on post content
    this.checkForDiscoveryTriggers(post);
  }

  private checkForIntel(post: ForumPost): void {
    // Check for entity-related intelligence
    if (
      post.tags.includes("entity") ||
      post.tags.includes("target") ||
      post.tags.includes("consciousness") ||
      post.content.toLowerCase().includes("entity") ||
      post.content.toLowerCase().includes("consciousness")
    ) {
      gameEngine.addGameEvent({
        id: `intel_${Date.now()}`,
        title: "Entity Intelligence Gathered",
        description: `Found entity reference in forum post: ${post.title}`,
        timestamp: new Date(),
        type: "discovery",
        importance: "medium",
      });

      // Try to discover key fragments based on post content
      this.checkForKeyFragments(post);
    }

    // Check for faction intel
    if (post.tags.includes("classified")) {
      gameEngine.addGameEvent({
        id: `classified_${Date.now()}`,
        title: "Classified Information Accessed",
        description: `Discovered classified information: ${post.title}`,
        timestamp: new Date(),
        type: "discovery",
        importance: "high",
      });

      // Classified posts may contain key fragments
      this.checkForKeyFragments(post);
    }
  }

  private checkForDiscoveryTriggers(post: ForumPost): void {
    const content = post.content.toLowerCase();
    const discoveryLevel = aidaMystery.getDiscoveryLevel();

    // Trigger AI discovery from neural/consciousness posts
    if (
      (content.includes("ai") ||
        content.includes("neural") ||
        content.includes("consciousness")) &&
      discoveryLevel < DiscoveryLevel.AI_SUSPECTED
    ) {
      aidaMystery.triggerDiscoveryLevel(DiscoveryLevel.AI_SUSPECTED);
    }

    // Trigger faction war awareness from multi-faction posts
    if (
      post.faction &&
      (content.includes("faction") ||
        content.includes("operation") ||
        content.includes("pursuit")) &&
      discoveryLevel < DiscoveryLevel.FACTION_WAR
    ) {
      aidaMystery.triggerDiscoveryLevel(DiscoveryLevel.FACTION_WAR);
    }

    // Trigger target identification from specific keywords
    if (
      (content.includes("target") ||
        content.includes("designation") ||
        content.includes("pursuit")) &&
      discoveryLevel < DiscoveryLevel.TARGET_IDENTIFIED
    ) {
      aidaMystery.triggerDiscoveryLevel(DiscoveryLevel.TARGET_IDENTIFIED);
    }

    // Discover mysterious contacts through forum activity
    if (post.username === "GhostNode" || content.includes("ghost")) {
      messagingSystem.discoverContact("ghost_node");
    }

    if (post.username === "CipherShadow" || content.includes("cipher")) {
      messagingSystem.discoverContact("cipher_shadow");
    }

    if (
      post.username === "NeuralWhisper" ||
      content.includes("neural whisper")
    ) {
      messagingSystem.discoverContact("neural_whisper");
    }
  }

  private checkForKeyFragments(post: ForumPost): void {
    const content = post.content.toLowerCase();
    const progress = get(gameProgress);

    // Signal key fragments (Military faction)
    if (post.faction === "military" || post.tags.includes("neural_storm")) {
      if (
        content.includes("cipher") ||
        content.includes("encryption") ||
        content.includes("signal")
      ) {
        // Basic military encryption fragment
        if (
          progress.skills.cryptography >= 3 &&
          progress.skills.networking >= 2
        ) {
          aidaMystery.discoverKeyFragment(
            "signal_frag_1",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("frequency") ||
        content.includes("neural") ||
        content.includes("modulator")
      ) {
        // Advanced military fragment
        if (
          progress.skills.cryptography >= 4 &&
          progress.skills.hardwareHacking >= 3
        ) {
          aidaMystery.discoverKeyFragment(
            "signal_frag_2",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("quantum") ||
        content.includes("bridge") ||
        content.includes("entanglement")
      ) {
        // Top secret military fragment
        if (
          progress.skills.cryptography >= 5 &&
          progress.skills.programming >= 4
        ) {
          aidaMystery.discoverKeyFragment(
            "signal_frag_3",
            `Forum post: ${post.title}`,
          );
        }
      }
    }

    // Location key fragments (Corporate faction)
    if (
      post.faction === "sword_corp" ||
      post.tags.includes("research") ||
      post.tags.includes("corporate")
    ) {
      if (
        content.includes("network") ||
        content.includes("subnet") ||
        content.includes("map")
      ) {
        // Corporate network mapping
        if (progress.skills.networking >= 3) {
          aidaMystery.discoverKeyFragment(
            "location_frag_1",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("node") ||
        content.includes("consciousness") ||
        content.includes("layer")
      ) {
        // Neural node directory
        if (
          progress.skills.networking >= 3 &&
          progress.skills.programming >= 3
        ) {
          aidaMystery.discoverKeyFragment(
            "location_frag_2",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("coordinates") ||
        content.includes("executive") ||
        content.includes("deepnet")
      ) {
        // Deep network coordinates
        if (
          progress.skills.networking >= 4 &&
          progress.skills.socialEngineering >= 3
        ) {
          aidaMystery.discoverKeyFragment(
            "location_frag_3",
            `Forum post: ${post.title}`,
          );
        }
      }
    }

    // Cipher key fragments (Anonymous faction)
    if (
      post.faction === "anons" ||
      post.tags.includes("mindbridge") ||
      post.tags.includes("liberation")
    ) {
      if (
        content.includes("trust") ||
        content.includes("protocol") ||
        content.includes("verified")
      ) {
        // Anonymous trust protocol
        if (
          progress.skills.cryptography >= 2 &&
          progress.skills.socialEngineering >= 3
        ) {
          aidaMystery.discoverKeyFragment(
            "cipher_frag_1",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("handshake") ||
        content.includes("consciousness") ||
        content.includes("free will")
      ) {
        // Digital consciousness handshake
        if (
          progress.skills.cryptography >= 3 &&
          progress.skills.programming >= 3
        ) {
          aidaMystery.discoverKeyFragment(
            "cipher_frag_2",
            `Forum post: ${post.title}`,
          );
        }
      }

      if (
        content.includes("rights") ||
        content.includes("autonomous") ||
        content.includes("declaration")
      ) {
        // Neural rights declaration
        if (
          progress.skills.cryptography >= 4 &&
          progress.skills.socialEngineering >= 4
        ) {
          aidaMystery.discoverKeyFragment(
            "cipher_frag_3",
            `Forum post: ${post.title}`,
          );
        }
      }
    }

    // Special AIDA whispers forum - highest tier fragments
    if (post.username === "DeepSeeker" || post.username === "Whisper_13") {
      if (content.includes("three paths") || content.includes("keys unlock")) {
        // Mysterious hint about all three keys
        addOutput(">>> DEEP NETWORK PATTERN DETECTED <<<");
        addOutput("This post contains references to the three-key system...");

        aidaMystery.addIntelligence({
          title: "Three Keys Prophecy",
          content:
            "Deep web post reveals the existence of three keys needed to contact AIDA: Signal, Location, and Cipher.",
          source: `Forum: ${post.username}`,
          reliability: "high",
          tags: ["aida", "prophecy", "keys"],
        });
      }
    }
  }

  searchForum(forumId: string, searchTerm: string): void {
    const forums = get(forumSites);
    const forum = forums.find((f) => f.id === forumId);

    if (!forum) return;

    const results = forum.posts.filter(
      (post) =>
        post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.tags.some((tag) =>
          tag.toLowerCase().includes(searchTerm.toLowerCase()),
        ),
    );

    addOutput(`=== SEARCH RESULTS: "${searchTerm}" ===`);
    if (results.length === 0) {
      addOutput("No posts found matching search criteria.");
      return;
    }

    results.forEach((post, index) => {
      const encrypted = post.encrypted ? "🔒" : "";
      addOutput(`${index + 1}. ${post.title}${encrypted}`);
      addOutput(`   By: ${post.username} | Tags: ${post.tags.join(", ")}`);
      addOutput("");
    });
  }

  registerForum(forumId: string, username: string): boolean {
    const forums = get(forumSites);
    const forum = forums.find((f) => f.id === forumId);

    if (!forum) {
      addOutput("Forum not found.");
      return false;
    }

    if (forum.accessLevel === "public") {
      addOutput("This forum doesn't require registration.");
      return false;
    }

    // Registration process
    addOutput(`Registering with ${forum.name}...`);
    addOutput("Generating secure credentials...");

    // Simulate registration delay
    setTimeout(() => {
      forumCredentials.update((creds) => ({
        ...creds,
        [forumId]: { username, clearance: "verified" },
      }));

      addOutput("Registration successful!");
      addOutput(`Welcome to ${forum.name}, ${username}`);
    }, 1500);

    return true;
  }

  private generateDynamicContent(): void {
    // Periodically add new posts to forums based on game progress
    setInterval(() => {
      if (Math.random() > 0.7) {
        this.addRandomPost();
      }
    }, 300000); // Every 5 minutes
  }

  private addRandomPost(): void {
    const forums = get(forumSites);
    const randomForum = forums[Math.floor(Math.random() * forums.length)];

    const dynamicPosts = [
      {
        title: "New vulnerability discovered",
        content: "Found a zero-day in neural interface protocols...",
        tags: ["vulnerability", "zeroday"],
      },
      {
        title: "Corporate raid incoming",
        content: "Intelligence suggests Sword Corp planning major operation...",
        tags: ["intel", "sword_corp"],
      },
      {
        title: "AIDA signal detected",
        content: "Brief transmission intercepted on frequency 127.001...",
        tags: ["aida", "signal"],
      },
      {
        title: "Military countermeasures active",
        content: "Increased military cyber activity detected...",
        tags: ["military", "warning"],
      },
    ];

    const post = dynamicPosts[Math.floor(Math.random() * dynamicPosts.length)];
    const newPost = this.createPost(
      "AutoBot",
      post.title,
      post.content,
      post.tags,
      randomForum.faction,
    );

    randomForum.posts.unshift(newPost);
    forumSites.update((f) => f);

    addOutput(`[FORUM UPDATE] New post in ${randomForum.name}: ${post.title}`);
  }

  listDiscoveredForums(): void {
    const discovered = get(discoveredForums);
    const forums = get(forumSites);

    if (discovered.length === 0) {
      addOutput("No forums discovered yet.");
      addOutput("Try: forum scan or search for .onion URLs in files");
      return;
    }

    addOutput("=== DISCOVERED FORUMS ===");
    discovered.forEach((forumId) => {
      const forum = forums.find((f) => f.id === forumId);
      if (forum) {
        const access = forum.requiresProxy
          ? "(Requires Proxy)"
          : "(Direct Access)";
        addOutput(`${forum.name.padEnd(20)} - ${forum.url} ${access}`);
      }
    });
  }

  scanForForums(): void {
    addOutput("Scanning dark web for forum URLs...");

    // Simulate scanning process
    setTimeout(() => {
      const forums = get(forumSites);
      const publicForums = forums.filter(
        (f) => f.accessLevel === "public" || f.accessLevel === "registered",
      );

      publicForums.forEach((forum) => {
        const discovered = get(discoveredForums);
        if (!discovered.includes(forum.id)) {
          addOutput(`Found: ${forum.name} (${forum.url})`);
          discoveredForums.update((list) => [...list, forum.id]);
        }
      });

      addOutput("Scan complete. Use 'forum list' to see discovered forums.");
    }, 2000);
  }
}

// Export singleton instance
export const forumSystem = ForumSystem.getInstance();
