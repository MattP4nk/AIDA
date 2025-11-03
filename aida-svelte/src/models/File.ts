export class TextFile {
  name: string;
  content: string = '';

  constructor(name: string) {
    this.name = name;
  }

  writeFile(text: string): void {
    this.content += `---${text}\n`;
  }

  readFile(): string {
    return this.content;
  }

  getName(): string {
    return this.name;
  }
}
