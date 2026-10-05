import { lstatSync } from 'node:fs';

/** Presence disables paid work. Permission/I/O failures fail closed. No file
 * contents are read and no path is logged. The path is operator configuration. */
export function aiKillSwitch(file: string | undefined): () => boolean {
  return () => {
    if (!file) return false;
    try {
      lstatSync(file);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  };
}
