import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  npmRegistry,
  publishExactVersion,
  releaseTags,
  repairLatest,
  synchronizeRelease,
} from './tags.mjs';

const [action, ...args] = process.argv.slice(2);
const registry = npmRegistry();
try {
  if (action === 'channel') {
    console.log(releaseTags(args[0])[0]);
  } else if (action === 'publish-platforms' || action === 'publish-root') {
    const [version, tag] = args;
    if (!version || !tag || releaseTags(version)[0] !== tag)
      throw new Error('Invalid publish version or tag');
    const dirs =
      action === 'publish-root'
        ? ['.']
        : ['npm/darwin-arm64', 'npm/darwin-x64', 'npm/linux-x64-gnu', 'npm/win32-x64-msvc'];
    for (const dir of dirs) {
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).name;
      const executable = dir === '.' ? 'pnpm' : 'npm';
      const flags =
        dir === '.'
          ? ['publish', '--access', 'public', '--tag', tag, '--no-git-checks', '--provenance']
          : ['publish', '--access', 'public', '--tag', tag, '--provenance'];
      const outcome = await publishExactVersion(registry, pkg, version, () =>
        execFileSync(executable, flags, { cwd: dir, stdio: 'inherit' }),
      );
      console.log(`${pkg}@${version}: ${outcome}`);
    }
  } else if (action === 'sync') {
    await synchronizeRelease(registry, args[0]);
  } else if (action === 'repair') {
    const target = args.find((arg) => !arg.startsWith('--'));
    await repairLatest(registry, target, { dryRun: args.includes('--dry-run'), log: console.log });
  } else if (action === 'version') {
    console.log(JSON.parse(readFileSync('package.json', 'utf8')).version);
  } else {
    throw new Error('Usage: tags-cli.mjs channel|sync|repair|version [version] [--dry-run]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
