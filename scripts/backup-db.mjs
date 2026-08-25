import Database from 'better-sqlite3';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const backupDirectory = path.join(dataDirectory, 'backups');
const source = path.join(dataDirectory, 'cultanime.db');
const retention = Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION || '14', 10) || 14);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDirectory, `cultanime-${stamp}.db`);

await mkdir(backupDirectory, { recursive: true });
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(destination);
} finally {
  database.close();
}

const backups = (await readdir(backupDirectory))
  .filter(name => /^cultanime-.*\.db$/.test(name))
  .sort()
  .reverse();
for (const expired of backups.slice(retention)) await unlink(path.join(backupDirectory, expired));
console.log(`Database backup created: ${destination}`);
