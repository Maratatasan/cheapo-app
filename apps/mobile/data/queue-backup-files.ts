import { File, type Directory } from 'expo-file-system';

export type QueueBackupFile = { name: string; bytes: Uint8Array };

const privateAccess = /cheapo_[A-Za-z0-9_-]{43}|["'](?:authorization|credential|token|accessToken|refreshToken)\\?["']\s*:|x-amz-(?:signature|credential|security-token)(?:=|%3d)/i;

export async function readQueueBackupFiles(directory: Directory, permitted: RegExp): Promise<QueueBackupFile[]> {
  if (!directory.exists) return [];
  const files: QueueBackupFile[] = [];
  for (const entry of directory.list().sort((a, b) => a.name.localeCompare(b.name))) {
    if (!permitted.test(entry.name)) continue;
    if (!(entry instanceof File) || entry.uri !== new File(directory, entry.name).uri || !entry.exists) {
      throw Error('A saved shopping queue file could not be read for backup.');
    }
    const bytes = await entry.bytes();
    if (privateAccess.test(new TextDecoder().decode(bytes))) {
      throw Error('A saved shopping queue file contains private access information. Export could not be prepared.');
    }
    files.push({ name: entry.name, bytes });
  }
  return files;
}
