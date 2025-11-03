import { TextFile } from './File';

export type FileType = TextFile | string;

export class Directory {
  name: string;
  private files: Record<string, FileType> = {};
  private directories: Record<string, Directory> = {};
  private fileList: string[] = [];
  private directoryList: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  addFile(file: FileType, name: string): void {
    this.files[name.toLowerCase()] = file;
    this.fileList.push(name);
  }

  getFile(name: string): FileType | undefined {
    return this.files[name.toLowerCase()];
  }

  addDirectory(directory: Directory): void {
    directory.setParent(this);
    this.directories[directory.getName().toLowerCase()] = directory;
    this.directoryList.push(directory.getName());
  }

  getDirectory(path: string): Directory | null {
    // Remove trailing slashes
    while (path.lastIndexOf('/') === path.length - 1) {
      path = path.substring(0, path.length - 1);
    }

    // Remove leading slashes
    let index = path.indexOf('/');
    while (index === 0) {
      path = path.substring(1, path.length);
      index = path.indexOf('/');
    }

    // Navigate through path
    if (index > 0) {
      const directory = path.substring(0, index).toLowerCase();
      if (directory in this.directories) {
        path = path.substring(index + 1, path.length);
        return this.directories[directory].getDirectory(path);
      }
    } else {
      const directory = path.toLowerCase();
      if (directory in this.directories) {
        return this.directories[directory];
      }
    }

    return null;
  }

  setParent(parent: Directory): void {
    this.directories['..'] = parent;
  }

  private makeList(): string {
    this.fileList.sort();
    this.directoryList.sort();

    let list = '';

    // Add directories first
    for (const dir of this.directoryList) {
      list += `${dir}/\n`;
    }

    // Add files
    for (const file of this.fileList) {
      list += `${file}\n`;
    }

    return list;
  }

  getList(): string {
    return this.makeList();
  }

  getFileList(): string[] {
    return [...this.fileList];
  }

  getDirectoryList(): string[] {
    return [...this.directoryList];
  }
}
