#!/usr/bin/env node

/**
 * Simple stdin formatter wrapper for use in pipelines
 * Usage: cat file.md | ./format-stdin.js > formatted.md
 *
 * This is designed for Claude Code and other tools that need to format
 * markdown/MDX content via shell pipelines.
 */

import { format } from './src/index.js';

// Read from stdin
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Main function
async function main() {
  const input = await readStdin();
  try {
    const formatted = await format(input);
    process.stdout.write(formatted);
  } catch (error) {
    // On error, output the original content to prevent data loss
    process.stderr.write(`Format error: ${error.message}\n`);
    process.stdout.write(input);
    process.exit(1);
  }
}

main();
