import { glob } from 'glob';

export async function discoverFiles(
  patterns: string[],
  ignorePatterns: string[],
): Promise<string[]> {
  // Find all matching files
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: ignorePatterns,
      nodir: true,
    });
    files.push(...matches);
  }

  // Remove duplicates
  return [...new Set(files)];
}
