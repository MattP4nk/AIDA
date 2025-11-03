import { Directory } from './Directory';

export class Server {
  name: string;
  entryLevel: Directory | null = null;
  known: boolean = false;
  encrypted: boolean = false;
  path: string;

  constructor(name: string) {
    this.name = name;
    this.path = this.generateIPAddress();
  }

  private generateIPAddress(): string {
    const random = (max: number) => Math.floor(Math.random() * max);
    return `${random(200)}.${random(200)}.${random(200)}.${random(200)}`;
  }

  setKnown(): void {
    this.known = true;
  }

  setEncryption(): void {
    if (!this.encrypted) {
      this.encrypted = true;
    }
  }

  getPath(): string {
    return this.path;
  }

  getName(): string {
    return this.name;
  }

  getHome(): Directory | null {
    return this.entryLevel;
  }

  addHome(homeName: string): void {
    const newHome = new Directory(homeName);
    this.entryLevel = newHome;
  }
}
