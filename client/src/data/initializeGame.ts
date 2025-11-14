// DEPRECATED: This file uses old local models and is being replaced with backend initialization
// TODO: Remove this file once backend initialization is complete

// import { Server } from "../models/Server";
// import { Directory } from "../models/Directory";
// import { TextFile } from "../models/File";
import {
  // addServer, // Not exported anymore
  currentServer,
  currentDirectory,
  // connectToServer,
} from "../stores/gameState";
import { MemoryManager } from "../utils/memoryManager";
import { gameEngine } from "../utils/gameEngine";

export function initializeGame(): void {
  console.warn(
    "initializeGame is deprecated - using backend initialization instead",
  );
  return; // Early return to disable old initialization
  /*
  // Initialize memory management system
  MemoryManager.initialize();

  // Initialize game engine
  gameEngine.initialize();

  // Create AIDA server
  const aidaServer = new Server("aida");
  addServer(aidaServer);

  // Create home server
  const homeServer = new Server("home");
  homeServer.setKnown();
  homeServer.addHome("desktop");
  const desktop = homeServer.getHome();

  if (desktop) {
    desktop.addDirectory(new Directory("trash"));

    // Add some initial files with narrative content
    const welcomeFile = new TextFile(
      "welcome.txt",
      "Welcome to the Neurolink Network, neural-hacker.\n\n" +
        "You have successfully interfaced with the AIDA terminal system.\n" +
        "Your neural pathways are now synchronized with the collective.\n\n" +
        "To begin your journey:\n" +
        "- Type 'status' to view your progression\n" +
        "- Type 'missions' to see available operations\n" +
        "- Type 'help' for command assistance\n\n" +
        "Remember: In the Network, information is power.\n" +
        "Trust no one. Question everything.\n\n" +
        "The resistance is watching.\n" +
        "//END TRANSMISSION//",
    );

    const readmeFile = new TextFile(
      "README.md",
      "# AIDA Terminal System\n\n" +
        "## Classification: RESTRICTED\n\n" +
        "This terminal provides access to the Neurolink Network infrastructure.\n" +
        "All activities are monitored and logged.\n\n" +
        "### Security Protocols\n" +
        "- Authentication required for network access\n" +
        "- Encryption mandatory for sensitive data\n" +
        "- Unauthorized access will be prosecuted\n\n" +
        "### Available Services\n" +
        "- File system navigation\n" +
        "- Network connectivity tools\n" +
        "- Cryptographic utilities\n" +
        "- System monitoring\n\n" +
        "For technical support, contact system administrator.\n" +
        "Resistance members: Check dead drops for mission updates.",
    );

    const notesFile = new TextFile(
      "notes.txt",
      "Personal Notes - Keep Encrypted\n" +
        "===============================\n\n" +
        "Day 1: Successfully infiltrated basic systems.\n" +
        "Network seems more complex than anticipated.\n" +
        "Need to improve cryptography skills.\n\n" +
        "Day 5: Found references to 'Neural Lords' in system logs.\n" +
        "Could be next level operatives.\n" +
        "Must investigate further.\n\n" +
        "Day 12: Corporate servers showing increased security.\n" +
        "Someone else is active in the network.\n" +
        "Friend or foe?\n\n" +
        "Remember: Trust is a luxury we cannot afford.",
    );

    try {
      desktop.addFile(welcomeFile, "welcome.txt");
      desktop.addFile(readmeFile, "README.md");
      desktop.addFile(notesFile, "notes.txt");
    } catch (e) {
      // Files might already exist, ignore
    }
  }

  addServer(homeServer);

  // Create training server for tutorial mission
  const trainingServer = new Server("training");
  trainingServer.setKnown();
  trainingServer.addHome("tutorial");
  trainingServer.path = "192.168.1.100"; // Set specific IP for mission
  const tutorialDir = trainingServer.getHome();

  if (tutorialDir) {
    const missionFile = new TextFile(
      "welcome.txt",
      "=== TRAINING MISSION COMPLETE ===\n\n" +
        "Congratulations, neural-hacker!\n" +
        "You have successfully accessed the training server.\n\n" +
        "Your basic network navigation skills have been verified.\n" +
        "You are now ready for real operations.\n\n" +
        "Next steps:\n" +
        "- Return to your home terminal\n" +
        "- Type 'missions' to see available contracts\n" +
        "- Begin building your reputation in the Network\n\n" +
        "The resistance needs skilled operatives like you.\n" +
        "Welcome to the fight against corporate tyranny.\n\n" +
        "//TRANSMISSION ENDS//",
    );

    const instructionsFile = new TextFile(
      "instructions.txt",
      "TRAINING SERVER - MISSION BRIEFING\n" +
        "===================================\n\n" +
        "Objective: Demonstrate basic file access skills\n" +
        "Target: This file and welcome.txt\n" +
        "Skills tested: Navigation, file reading\n\n" +
        "Commands to practice:\n" +
        "- ls (list directory contents)\n" +
        "- open <filename> (read file contents)\n" +
        "- cd <directory> (change directory)\n" +
        "- pwd (show current location)\n\n" +
        "Security Note: This is a safe environment.\n" +
        "No corporate monitoring detected.\n" +
        "Take your time to familiarize yourself with the interface.",
    );

    try {
      tutorialDir.addFile(missionFile, "welcome.txt");
      tutorialDir.addFile(instructionsFile, "instructions.txt");
    } catch (e) {
      // Files might already exist
    }
  }

  addServer(trainingServer);

  // Create gate server
  const gateServer = new Server("Gate");
  gateServer.setKnown();
  gateServer.addHome("gate");
  addServer(gateServer);

  // Create some advanced servers that will be unlocked through progression
  const corpServer = new Server("CypherCorp");
  corpServer.setEncryption();
  corpServer.path = "203.0.113.50";
  corpServer.addHome("corporate");
  const corpDir = corpServer.getHome();

  if (corpDir) {
    const employeeDb = new TextFile(
      "employees.db",
      "EMPLOYEE DATABASE - CONFIDENTIAL\n" +
        "=================================\n\n" +
        "ID: 001 | Name: Sarah Chen      | Clearance: Alpha   | Dept: Neural Research\n" +
        "ID: 002 | Name: Marcus Torres   | Clearance: Beta    | Dept: Security\n" +
        "ID: 003 | Name: Dr. Elena Vasquez | Clearance: Gamma | Dept: AI Development\n" +
        "ID: 004 | Name: James Morrison  | Clearance: Alpha   | Dept: Neural Interface\n" +
        "ID: 005 | Name: Lisa Park       | Clearance: Delta   | Dept: Administration\n\n" +
        "WARNING: This database contains classified information.\n" +
        "Unauthorized access is a federal crime.\n" +
        "All access attempts are logged and monitored.",
    );

    const secretsFile = new TextFile(
      "project_mindbridge.txt",
      "PROJECT MINDBRIDGE - CLASSIFICATION: BLACK\n" +
        "==========================================\n\n" +
        "Neural interface development proceeding ahead of schedule.\n" +
        "Test subjects showing 97% compatibility rate.\n\n" +
        "Phase 3 trials approved for next quarter.\n" +
        "Target: Complete neural network integration.\n\n" +
        "Potential concerns:\n" +
        "- Resistance infiltration suspected\n" +
        "- Security protocols may be compromised\n" +
        "- Subject autonomy degradation in 12% of cases\n\n" +
        "Recommendation: Accelerate timeline.\n" +
        "The Network must be completed before resistance can act.\n\n" +
        "Dr. Vasquez - Lead Neural Engineer\n" +
        "//END CLASSIFIED DOCUMENT//",
    );

    try {
      corpDir.addFile(employeeDb, "employees.db");
      corpDir.addFile(secretsFile, "project_mindbridge.txt");
    } catch (e) {
      // Files might already exist
    }
  }

  addServer(corpServer);

  // Set initial server and directory
  connectToServer(homeServer);

  // Add a small delay before showing game initialization message
  setTimeout(() => {
    console.log(
      "Game initialized with narrative content and mission structure",
    );
  }, 100);
  */
}
