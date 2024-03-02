import fs from 'fs';
import path from 'path';

const moduleDir: string = path.dirname(new URL(import.meta.url).pathname);

export function saveObject(objectToSave: any, saveName: string): void {
  const filePath: string = path.join(moduleDir, `../cache/${saveName}`);
  fs.writeFileSync(filePath, JSON.stringify(objectToSave, null, 2), 'utf-8');
}

export function readObject(readName: string): any {
  const filePath: string = path.join(moduleDir, `../cache/${readName}`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    return [];
  }
}
