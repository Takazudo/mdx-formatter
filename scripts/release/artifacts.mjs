// Pack the five release tarballs once, verify them, and record their
// integrity in a manifest. The publish job uploads exactly these files.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT_PACKAGE = '@takazudo/mdx-formatter';
export const MANIFEST_FILE = 'release-manifest.json';

// Machine codes: Mach-O cputype, ELF e_machine, PE Machine.
export const NATIVES = [
  {
    dir: 'npm/darwin-arm64',
    name: '@takazudo/mdx-formatter-darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    artifact: 'bindings-aarch64-apple-darwin/mdx-formatter-napi.darwin-arm64.node',
    format: 'macho',
  },
  {
    dir: 'npm/darwin-x64',
    name: '@takazudo/mdx-formatter-darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    artifact: 'bindings-x86_64-apple-darwin/mdx-formatter-napi.darwin-x64.node',
    format: 'macho',
  },
  {
    dir: 'npm/linux-x64-gnu',
    name: '@takazudo/mdx-formatter-linux-x64-gnu',
    os: 'linux',
    cpu: 'x64',
    artifact: 'bindings-x86_64-unknown-linux-gnu/mdx-formatter-napi.linux-x64-gnu.node',
    format: 'elf',
  },
  {
    dir: 'npm/win32-x64-msvc',
    name: '@takazudo/mdx-formatter-win32-x64-msvc',
    os: 'win32',
    cpu: 'x64',
    artifact: 'bindings-x86_64-pc-windows-msvc/mdx-formatter-napi.win32-x64-msvc.node',
    format: 'pe',
  },
];

export function integrityOf(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

/** Identify a native module by its header: { format, arch } or null. */
export function binaryFormat(buf) {
  if (!buf || buf.length < 64) return null;
  if (buf.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = buf.readUInt32LE(4);
    return {
      format: 'macho',
      arch: cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `0x${cpu.toString(16)}`,
    };
  }
  if (buf.readUInt32BE(0) === 0x7f454c46) {
    const machine = buf.readUInt16LE(18);
    return {
      format: 'elf',
      arch: machine === 0x3e ? 'x64' : machine === 0xb7 ? 'arm64' : `0x${machine.toString(16)}`,
    };
  }
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 6 > buf.length || buf.readUInt32BE(pe) !== 0x50450000) return null;
    const machine = buf.readUInt16LE(pe + 4);
    return {
      format: 'pe',
      arch: machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : `0x${machine.toString(16)}`,
    };
  }
  return null;
}

function hasWorkspaceProtocol(value) {
  return JSON.stringify(value).includes('workspace:');
}

/** Problems with the packed root package (empty list = OK). */
export function checkRootPackage(manifest, entries, version) {
  const problems = [];
  const has = (path) => entries.includes(`package/${path.replace(/^\.\//, '')}`);
  if (manifest.name !== ROOT_PACKAGE) problems.push(`name is ${manifest.name}`);
  if (manifest.version !== version)
    problems.push(`version is ${manifest.version}, expected ${version}`);
  if (hasWorkspaceProtocol(manifest))
    problems.push('packed package.json still contains workspace:');
  const optional = manifest.optionalDependencies ?? {};
  const expected = Object.fromEntries(NATIVES.map((n) => [n.name, version]));
  if (JSON.stringify(Object.keys(optional).sort()) !== JSON.stringify(Object.keys(expected).sort()))
    problems.push(`optionalDependencies are ${Object.keys(optional).join(', ') || 'empty'}`);
  for (const [name, range] of Object.entries(optional))
    if (range !== version)
      problems.push(`${name} is pinned to ${range}, expected exact ${version}`);
  for (const path of [
    'package.json',
    'README.md',
    'LICENSE',
    'format-stdin.js',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/browser.js',
    'dist/browser.d.ts',
    'dist/cli.js',
  ])
    if (!has(path)) problems.push(`missing ${path}`);
  if (manifest.bin?.['mdx-formatter'] !== './dist/cli.js')
    problems.push('bin mdx-formatter is not ./dist/cli.js');
  if (manifest.types && !has(manifest.types)) problems.push(`types ${manifest.types} not packed`);
  for (const [subpath, target] of Object.entries(manifest.exports ?? {}))
    for (const file of Object.values(target))
      if (!has(file)) problems.push(`exports ${subpath} -> ${file} not packed`);
  const stray = entries.filter((e) =>
    /\.node$|^package\/(src|crates|test|npm|doc|scripts)\//.test(e),
  );
  if (stray.length) problems.push(`unexpected files packed: ${stray.join(', ')}`);
  return problems;
}

/** Problems with one packed platform package (empty list = OK). */
export function checkNativePackage(spec, manifest, entries, binary, version) {
  const problems = [];
  if (manifest.name !== spec.name) problems.push(`name is ${manifest.name}, expected ${spec.name}`);
  if (manifest.version !== version)
    problems.push(`version is ${manifest.version}, expected ${version}`);
  if (JSON.stringify(manifest.os) !== JSON.stringify([spec.os]))
    problems.push(`os is ${JSON.stringify(manifest.os)}`);
  if (JSON.stringify(manifest.cpu) !== JSON.stringify([spec.cpu]))
    problems.push(`cpu is ${JSON.stringify(manifest.cpu)}`);
  if (manifest.main !== 'mdx-formatter-napi.node') problems.push(`main is ${manifest.main}`);
  if (hasWorkspaceProtocol(manifest)) problems.push('packed package.json contains workspace:');
  const files = [...entries].sort();
  if (
    JSON.stringify(files) !==
    JSON.stringify(['package/mdx-formatter-napi.node', 'package/package.json'])
  )
    problems.push(`tarball contains ${files.join(', ')}`);
  const detected = binaryFormat(binary);
  if (!detected) problems.push('binary header is not a recognised native module');
  else if (detected.format !== spec.format || detected.arch !== spec.cpu)
    problems.push(
      `binary is ${detected.format}/${detected.arch}, expected ${spec.format}/${spec.cpu}`,
    );
  return problems;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts,
  });
}

export function readTarball(file) {
  const entries = run('tar', ['-tzf', file]).split('\n').filter(Boolean);
  const manifest = JSON.parse(run('tar', ['-xzOf', file, 'package/package.json']));
  const binary = entries.includes('package/mdx-formatter-napi.node')
    ? execFileSync('tar', ['-xzOf', file, 'package/mdx-formatter-napi.node'], {
        maxBuffer: 256 * 1024 * 1024,
      })
    : null;
  return { entries, manifest, binary };
}

function packInto(cwd, out, tool) {
  const before = new Set(readdirSync(out));
  run(tool, ['pack', '--pack-destination', out], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  const created = readdirSync(out).filter((f) => f.endsWith('.tgz') && !before.has(f));
  if (created.length !== 1)
    throw new Error(`${tool} pack in ${cwd} produced ${created.length} tarballs`);
  return join(out, created[0]);
}

/**
 * Copy the four native binaries into npm/*, pack natives with npm and the root
 * with pnpm (which rewrites workspace:X.Y.Z to X.Y.Z), verify every tarball and
 * write release-manifest.json. The root build (tsc) and tests must already
 * have run against the shipped Linux binary.
 */
export function packRelease({
  version,
  sha,
  out,
  bindings,
  runId = null,
  runAttempt = null,
  root = '.',
}) {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length) throw new Error(`${out} must be empty`);
  const problems = [];
  const entries = [];
  for (const spec of NATIVES) {
    copyFileSync(join(bindings, spec.artifact), join(root, spec.dir, 'mdx-formatter-napi.node'));
    const file = packInto(resolve(root, spec.dir), resolve(out), 'npm');
    const t = readTarball(file);
    problems.push(
      ...checkNativePackage(spec, t.manifest, t.entries, t.binary, version).map(
        (p) => `${spec.name}: ${p}`,
      ),
    );
    entries.push({
      name: spec.name,
      file: file.split('/').pop(),
      integrity: integrityOf(readFileSync(file)),
    });
  }
  const rootFile = packInto(resolve(root), resolve(out), 'pnpm');
  const t = readTarball(rootFile);
  problems.push(
    ...checkRootPackage(t.manifest, t.entries, version).map((p) => `${ROOT_PACKAGE}: ${p}`),
  );
  entries.push({
    name: ROOT_PACKAGE,
    file: rootFile.split('/').pop(),
    integrity: integrityOf(readFileSync(rootFile)),
  });
  if (problems.length)
    throw new Error(`Packed tarballs failed verification:\n- ${problems.join('\n- ')}`);
  const manifest = { version, sha, runId, runAttempt, packages: entries };
  writeFileSync(join(out, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Load the manifest and prove each tarball on disk still has its recorded integrity. */
export function loadVerifiedManifest(dir, { version, sha }) {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8'));
  if (manifest.version !== version)
    throw new Error(`manifest version ${manifest.version} != ${version}`);
  if (manifest.sha !== sha) throw new Error(`manifest sha ${manifest.sha} != ${sha}`);
  const names = manifest.packages.map((p) => p.name);
  const expected = [...NATIVES.map((n) => n.name), ROOT_PACKAGE];
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error(`manifest packages are ${names.join(', ')}; expected natives then root`);
  for (const entry of manifest.packages) {
    const actual = integrityOf(readFileSync(join(dir, entry.file)));
    if (actual !== entry.integrity)
      throw new Error(`${entry.file}: integrity ${actual} != manifest ${entry.integrity}`);
  }
  return manifest;
}

/**
 * Install the packed root tarball (runtime deps from npm, optional deps
 * omitted), unpack the packed linux-x64-gnu tarball beside it, and run the
 * library and CLI from that install. Exercises the bytes that will ship.
 */
export function smokeTestPacked(dir, manifest) {
  const rootEntry = manifest.packages.find((p) => p.name === ROOT_PACKAGE);
  const linux = manifest.packages.find((p) => p.name === '@takazudo/mdx-formatter-linux-x64-gnu');
  const work = mkdtempSync(join(tmpdir(), 'mdx-formatter-smoke-'));
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'smoke', private: true, type: 'module' }),
  );
  run(
    'npm',
    [
      'install',
      '--omit=optional',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      resolve(dir, rootEntry.file),
    ],
    {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const target = join(work, 'node_modules/@takazudo/mdx-formatter-linux-x64-gnu');
  mkdirSync(target, { recursive: true });
  run('tar', ['-xzf', resolve(dir, linux.file), '-C', target, '--strip-components=1']);
  const installed = JSON.parse(
    readFileSync(join(work, 'node_modules/@takazudo/mdx-formatter/package.json'), 'utf8'),
  );
  if (installed.version !== manifest.version)
    throw new Error(`installed version ${installed.version}`);
  writeFileSync(join(work, 'input.md'), '# Title\nText\n- a\n- b\n');
  const formatted = run(
    'node',
    [
      '--input-type=module',
      '-e',
      "import { format } from '@takazudo/mdx-formatter'; process.stdout.write(await format('# Title\\nText\\n- a\\n- b\\n'));",
    ],
    { cwd: work },
  );
  if (!formatted.startsWith('# Title\n\nText'))
    throw new Error(`unexpected format() output: ${JSON.stringify(formatted)}`);
  run('node', ['node_modules/@takazudo/mdx-formatter/dist/cli.js', '--write', 'input.md'], {
    cwd: work,
  });
  run('node', ['node_modules/@takazudo/mdx-formatter/dist/cli.js', '--check', 'input.md'], {
    cwd: work,
  });
  if (readFileSync(join(work, 'input.md'), 'utf8') !== formatted)
    throw new Error('CLI output differs from format()');
  return { work, formatted };
}
