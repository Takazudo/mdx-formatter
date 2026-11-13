import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  MANIFEST_FILE,
  NATIVES,
  ROOT_PACKAGE,
  binaryFormat,
  checkNativePackage,
  checkRootPackage,
  integrityOf,
  loadVerifiedManifest,
} from './artifacts.mjs';

export function fakeBinary(format, arch) {
  const buf = Buffer.alloc(256);
  if (format === 'macho') {
    buf.writeUInt32LE(0xfeedfacf, 0);
    buf.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  } else if (format === 'elf') {
    buf.writeUInt32BE(0x7f454c46, 0);
    buf.writeUInt16LE(arch === 'x64' ? 0x3e : 0xb7, 18);
  } else {
    buf.write('MZ', 0);
    buf.writeUInt32LE(0x80, 0x3c);
    buf.writeUInt32BE(0x50450000, 0x80);
    buf.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 0x84);
  }
  return buf;
}

const V = '1.3.1';
const rootEntries = [
  'package.json',
  'README.md',
  'LICENSE',
  'format-stdin.js',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/browser.js',
  'dist/browser.d.ts',
  'dist/cli.js',
].map((f) => `package/${f}`);
const rootManifest = () => ({
  name: ROOT_PACKAGE,
  version: V,
  types: 'dist/index.d.ts',
  bin: { 'mdx-formatter': './dist/cli.js' },
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './browser': { types: './dist/browser.d.ts', default: './dist/browser.js' },
  },
  optionalDependencies: Object.fromEntries(NATIVES.map((n) => [n.name, V])),
});

test('native headers identify OS format and architecture', () => {
  assert.deepEqual(binaryFormat(fakeBinary('macho', 'arm64')), { format: 'macho', arch: 'arm64' });
  assert.deepEqual(binaryFormat(fakeBinary('macho', 'x64')), { format: 'macho', arch: 'x64' });
  assert.deepEqual(binaryFormat(fakeBinary('elf', 'x64')), { format: 'elf', arch: 'x64' });
  assert.deepEqual(binaryFormat(fakeBinary('pe', 'x64')), { format: 'pe', arch: 'x64' });
  assert.equal(binaryFormat(Buffer.from('not a binary')), null);
});

test('packed root must pin exact native versions with no workspace: left', () => {
  assert.deepEqual(checkRootPackage(rootManifest(), rootEntries, V), []);
  const ws = rootManifest();
  ws.optionalDependencies[NATIVES[0].name] = `workspace:${V}`;
  assert.match(checkRootPackage(ws, rootEntries, V).join('\n'), /workspace:/);
  const range = rootManifest();
  range.optionalDependencies[NATIVES[1].name] = `^${V}`;
  assert.match(checkRootPackage(range, rootEntries, V).join('\n'), /expected exact/);
  const missing = rootManifest();
  delete missing.optionalDependencies[NATIVES[2].name];
  assert.match(checkRootPackage(missing, rootEntries, V).join('\n'), /optionalDependencies are/);
  assert.match(
    checkRootPackage(
      rootManifest(),
      rootEntries.filter((e) => !e.endsWith('cli.js')),
      V,
    ).join('\n'),
    /missing dist\/cli.js/,
  );
  assert.match(
    checkRootPackage(rootManifest(), [...rootEntries, 'package/crates/x.node'], V).join('\n'),
    /unexpected files/,
  );
  assert.match(
    checkRootPackage({ ...rootManifest(), version: '1.3.0' }, rootEntries, V).join('\n'),
    /version is 1.3.0/,
  );
});

test('packed natives must match name, version, os/cpu, files and binary header', () => {
  const entries = ['package/package.json', 'package/mdx-formatter-napi.node'];
  for (const spec of NATIVES) {
    const manifest = {
      name: spec.name,
      version: V,
      os: [spec.os],
      cpu: [spec.cpu],
      main: 'mdx-formatter-napi.node',
    };
    assert.deepEqual(
      checkNativePackage(spec, manifest, entries, fakeBinary(spec.format, spec.cpu), V),
      [],
      spec.name,
    );
    assert.match(
      checkNativePackage(
        spec,
        manifest,
        entries,
        fakeBinary(spec.format, 'arm64' === spec.cpu ? 'x64' : 'arm64'),
        V,
      ).join(),
      /binary is/,
    );
    assert.match(
      checkNativePackage(
        spec,
        { ...manifest, version: '1.3.0' },
        entries,
        fakeBinary(spec.format, spec.cpu),
        V,
      ).join(),
      /version is 1.3.0/,
    );
    assert.match(
      checkNativePackage(
        spec,
        manifest,
        [...entries, 'package/extra'],
        fakeBinary(spec.format, spec.cpu),
        V,
      ).join(),
      /tarball contains/,
    );
  }
  const linux = NATIVES.find((n) => n.os === 'linux');
  const darwin = fakeBinary('macho', 'x64');
  assert.match(
    checkNativePackage(
      linux,
      {
        name: linux.name,
        version: V,
        os: ['linux'],
        cpu: ['x64'],
        main: 'mdx-formatter-napi.node',
      },
      entries,
      darwin,
      V,
    ).join(),
    /macho\/x64, expected elf\/x64/,
  );
});

test('manifest load rejects tampered tarballs, wrong version/sha and wrong order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  const sha = 'e'.repeat(40);
  const packages = [...NATIVES.map((n) => n.name), ROOT_PACKAGE].map((name, i) => {
    const file = `p${i}.tgz`;
    writeFileSync(join(dir, file), `bytes-${i}`);
    return { name, file, integrity: integrityOf(Buffer.from(`bytes-${i}`)) };
  });
  const write = (m) => writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(m));
  write({ version: V, sha, packages });
  assert.equal(loadVerifiedManifest(dir, { version: V, sha }).packages.length, 5);
  assert.throws(() => loadVerifiedManifest(dir, { version: '1.3.2', sha }), /manifest version/);
  assert.throws(
    () => loadVerifiedManifest(dir, { version: V, sha: 'f'.repeat(40) }),
    /manifest sha/,
  );
  write({ version: V, sha, packages: [packages[4], ...packages.slice(0, 4)] });
  assert.throws(() => loadVerifiedManifest(dir, { version: V, sha }), /natives then root/);
  write({ version: V, sha, packages });
  writeFileSync(join(dir, 'p2.tgz'), 'swapped');
  assert.throws(() => loadVerifiedManifest(dir, { version: V, sha }), /p2.tgz: integrity/);
});
