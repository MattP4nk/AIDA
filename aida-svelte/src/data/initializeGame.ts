import { Server } from '../models/Server';
import { Directory } from '../models/Directory';
import { addServer, currentServer, currentDirectory, connectToServer } from '../stores/gameState';

export function initializeGame(): void {
  // Create AIDA server
  const aidaServer = new Server('aida');
  addServer(aidaServer);

  // Create home server
  const homeServer = new Server('home');
  homeServer.setKnown();
  homeServer.addHome('desktop');
  const desktop = homeServer.getHome();

  if (desktop) {
    desktop.addDirectory(new Directory('trash'));
  }

  addServer(homeServer);

  // Create gate server
  const gateServer = new Server('Gate');
  gateServer.setKnown();
  gateServer.addHome('gate');
  addServer(gateServer);

  // Set initial server and directory
  connectToServer(homeServer);
}
