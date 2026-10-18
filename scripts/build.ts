/**
 * Build `dist/` — the thing that actually gets published as `@justcrawl/sdk`.
 *
 * Four outputs, and the reason for each (KTD-4):
 *
 *   dist/index.js    ESM bundle   — esbuild, `@scraperoute/error-types` inlined
 *   dist/index.cjs   CJS bundle   — same, for `require()` consumers
 *   dist/index.d.ts  types        — rolled up so no bare @scraperoute/* specifier survives
 *   dist/package.json manifest    — the PUBLIC name, `dependencies: {}`, Apache-2.0
 *
 * **Why the bundle inlines rather than depends.** `@scraperoute/error-types` is
 * `private: true` and will never exist on npm — a customer running
 * `npm install @justcrawl/sdk` would get a 404 for it. esbuild bundles by default
 * (the `--external:` flag is the inverse), so the JS half is free. The types are
 * the half that bites: `tsc` alone emits `import { JustcrawlErrorCode } from
 * '@scraperoute/error-types'` into the `.d.ts`, and every TypeScript consumer
 * then gets `TS2307: Cannot find module`. Hence the declaration rollup.
 *
 * **Why a generated manifest instead of publishing the source package.json.**
 * The workspace name must stay `@scraperoute/sdk-js` — both CI affected-package
 * loops build filters by concatenating `--filter=@scraperoute/$pkg`, so a
 * `@justcrawl/*` workspace name would silently match nothing (KTD-1). The
 * published name therefore only ever exists on this generated file, and
 * `private: true` on the source manifest makes a stray root-level publish fail
 * loudly rather than shipping the wrong thing.
 *
 * Run: pnpm --filter @scraperoute/sdk-js build
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PKG_ROOT, 'dist');

/**
 * Where the mirror's build inputs are staged.
 *
 * Under `dist/` so the repo's existing `dist/` gitignore covers it, and outside
 * the published `files` list so it never reaches a tarball.
 */
const MIRROR = join(DIST, 'mirror');

/** The npm name. Deliberately different from the workspace name — see KTD-1. */
export const PUBLIC_NAME = '@justcrawl/sdk';

/**
 * Exact build-tool versions the public mirror pins.
 *
 * Exact, not caret-ranged, and that is the point: provenance attests that npm
 * built the tarball from a given commit of the public repo, but it says nothing
 * about *what the build resolved* — a floating `^0.25.0` means a later publish
 * of the same source can produce different bytes. Pinning the direct build
 * inputs is what makes "built from this source" a claim you can act on.
 *
 * Be precise about the limit, because it is easy to overstate: these pin the
 * five DIRECT tools exactly, but their transitive deps still float. Only
 * `typescript` is genuinely dependency-free — `dts-bundle-generator` pulls
 * `yargs@^17.6.0`, `tsx` pulls `esbuild@~0.27.0` + `get-tsconfig@^4.7.5`,
 * `@types/node` pulls `undici-types@~8.3.0`, and esbuild carries 26 optional
 * platform binaries. Note too that tsx resolves its OWN esbuild, so the pin
 * below governs the bundling step, not tsx's.
 *
 * Deliberately not a `package-lock.json` — yet. A lockfile would close that
 * remaining gap and is the right eventual answer; it is not here because a
 * committed lockfile carries the package version in its root block, so every
 * release bump needs it regenerated or `npm ci` fails — a footgun with no gate
 * behind it. Generating it alongside this manifest (same generator, so the
 * version cannot drift) is the way in. Until then the publish workflow runs
 * `npm install --ignore-scripts`, so the floating tail cannot execute code.
 */
export const MIRROR_BUILD_DEPS: Record<string, string> = {
  '@types/node': '26.4.0',
  'dts-bundle-generator': '9.5.1',
  esbuild: '0.25.12',
  tsx: '4.21.0',
  typescript: '5.9.3',
};

/**
 * The specifier the mirrored sources import instead of `@scraperoute/error-types`.
 *
 * `mirror-sdk.sh` vendors that package's single source file to
 * `src/vendor/error-types.ts` and rewrites the two imports to this path. The
 * alternative — keeping the bare specifier and resolving it through a tsconfig
 * `paths` entry — would leave `@scraperoute/…` strings in the public tree, and
 * the mirror's leak scan treats any such specifier as a hard failure. Keeping
 * that control absolute is worth two rewritten import lines.
 */
/** The committed mirror dependency tree, restamped by {@link buildMirrorLock}. */
export const MIRROR_LOCK_SOURCE = 'mirror-package-lock.json';

export const VENDORED_ERROR_TYPES = './vendor/error-types.js';

/**
 * The mirror repository, and the string npm provenance matches **character for
 * character**. A case difference here fails the publish, not the build, so it is
 * asserted in `publish-manifest.pack.test.ts` rather than trusted.
 */
export const REPOSITORY_URL = 'https://github.com/justcrawl-io/justcrawl-sdk-js';

/** Files copied verbatim into `dist/`. `CLAUDE.md` is deliberately absent. */
const COPIED_FILES = ['README.md', 'LICENSE'];

/**
 * Build the published manifest.
 *
 * Independent semver (R3): the version comes from the source `package.json`'s
 * hand-maintained `version` field and is **not** the repo's `vX.Y.Z.W` — an SDK
 * consumer's semver expectations have nothing to do with the platform's release
 * cadence.
 */
export function buildManifest(
  sourcePkg: { version: string },
  options: { forMirror?: boolean } = {},
): Record<string, unknown> {
  const mirrorOnly = options.forMirror === true
    ? {
        // The mirror repo IS the build, so its manifest must be able to run one.
        // `--out .` puts index.js/index.cjs/index.d.ts at the repo root, exactly
        // where `main`/`module`/`types`/`files` below already point — so the
        // published tarball has the same layout it had when the mirror shipped
        // prebuilt files. Only how it is produced changes.
        scripts: { build: 'tsx scripts/build.ts --out .' },
        devDependencies: { ...MIRROR_BUILD_DEPS },
      }
    : {};

  return {
    name: PUBLIC_NAME,
    version: sourcePkg.version,
    description: 'The official TypeScript SDK for the JustCrawl scraping orchestration API',
    license: 'Apache-2.0',
    author: 'JustCrawl',
    homepage: 'https://docs.justcrawl.io',
    repository: { type: 'git', url: `git+${REPOSITORY_URL}.git` },
    bugs: { url: `${REPOSITORY_URL}/issues` },
    keywords: ['justcrawl', 'scraping', 'crawler', 'api', 'sdk', 'proxy', 'extraction'],
    type: 'module',
    main: './index.cjs',
    module: './index.js',
    types: './index.d.ts',
    exports: {
      '.': {
        types: './index.d.ts',
        import: './index.js',
        require: './index.cjs',
      },
      './package.json': './package.json',
    },
    files: ['index.js', 'index.cjs', 'index.d.ts', 'README.md', 'LICENSE'],
    // The whole point (R2). error-types is bundled, not depended on.
    dependencies: {},
    engines: { node: '>=20.3.0' },
    sideEffects: false,
    publishConfig: { access: 'public', provenance: true },
    ...mirrorOnly,
  };
}

function bundle(format: 'esm' | 'cjs', outfile: string): void {
  esbuild.buildSync({
    entryPoints: [join(PKG_ROOT, 'src/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format,
    // No sourcemaps (R2): they would ship internal repo paths to customers, and
    // the bundle is not minified, so they buy little.
    sourcemap: false,
    minify: false,
    legalComments: 'inline',
  });
}

/**
 * Roll the `.d.ts` up into one file with `@scraperoute/*` types inlined.
 *
 * `--external-inlines` is the load-bearing flag: without it the rollup keeps the
 * bare specifier and ships a broken type surface.
 */
function buildTypes(outDir: string): void {
  // Invoked through the package's own `node_modules/.bin` rather than
  // `pnpm exec`. This same script runs in the public mirror, where the toolchain
  // is npm and `pnpm` is not installed — and both package managers link a
  // dependency's bin to exactly this path, so one spelling works in both.
  execFileSync(
    join(PKG_ROOT, 'node_modules/.bin/dts-bundle-generator'),
    [
      '--out-file',
      join(outDir, 'index.d.ts'),
      // A no-op in the mirror, where the specifier has already been rewritten to
      // a relative vendored path (relative imports are always inlined). Kept
      // unconditional so the two trees run one code path.
      '--external-inlines',
      '@scraperoute/error-types',
      '--no-banner',
      '--project',
      join(PKG_ROOT, 'tsconfig.json'),
      join(PKG_ROOT, 'src/index.ts'),
    ],
    { cwd: PKG_ROOT, stdio: 'inherit' },
  );
}

/**
 * The flattened tsconfig the mirror builds against.
 *
 * The in-repo `tsconfig.json` extends `../../../tsconfig.base.json`, which does
 * not exist outside the monorepo, so the mirror needs its own. Generated rather
 * than hand-maintained in two places: the settings that matter to the output —
 * `target`, `module`, `strict`, and especially the explicit `types: ["node"]`
 * that dts-bundle-generator's separate compiler host needs — must not drift from
 * what the in-repo build type-checks against.
 */
export const MIRROR_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    declaration: true,
    rootDir: '.',
    types: ['node'],
  },
  include: ['src', 'scripts'],
  exclude: ['node_modules'],
};

/**
 * The committed dependency tree for the mirror, restamped for this release.
 *
 * The tree itself is committed (`mirror-package-lock.json`) rather than
 * resolved at build time: it is the thing under review — 79 packages with
 * integrity hashes — and generating it during the build would need the network
 * and would defeat the point by re-floating on every run.
 *
 * What is NOT committed is the identity block. A lockfile's root entry repeats
 * the package's own `name` and `version`, and `npm ci` refuses to run when
 * those disagree with `package.json` — so a committed lockfile would go stale
 * at the first release bump, with nothing to catch it until a publish failed.
 * Stamping it from the same `sourcePkg` that produces the manifest is what
 * makes the two incapable of disagreeing.
 */
export function buildMirrorLock(sourcePkg: { version: string }): Record<string, unknown> {
  const lock = JSON.parse(readFileSync(join(PKG_ROOT, MIRROR_LOCK_SOURCE), 'utf8')) as {
    name: string;
    version: string;
    packages: Record<string, { name?: string; version?: string; devDependencies?: Record<string, string> }>;
  };
  lock.name = PUBLIC_NAME;
  lock.version = sourcePkg.version;
  const root = lock.packages[''];
  root.name = PUBLIC_NAME;
  root.version = sourcePkg.version;
  // The pins are single-sourced from MIRROR_BUILD_DEPS, so a bump there cannot
  // silently leave the lockfile's declared range behind. (The RESOLVED tree
  // still has to be regenerated by hand — see the package CLAUDE.md.)
  root.devDependencies = { ...MIRROR_BUILD_DEPS };
  return lock;
}

/** `--out <dir>`, resolved against the package root. Defaults to `dist`. */
function outDirFromArgv(argv: string[]): string {
  const i = argv.indexOf('--out');
  if (i === -1) return DIST;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error('--out needs a directory argument');
  }
  return join(PKG_ROOT, value);
}

function main(argv: string[]): void {
  const outDir = outDirFromArgv(argv);
  const intoDist = outDir === DIST;

  // Only safe to wipe when it is the build's own directory. With `--out .` — how
  // the mirror builds — this would delete the source tree it is building from.
  if (intoDist) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  bundle('esm', join(outDir, 'index.js'));
  bundle('cjs', join(outDir, 'index.cjs'));
  buildTypes(outDir);

  const sourcePkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as { version: string };

  if (intoDist) {
    // In the mirror the manifest is already the repo's own `package.json` — the
    // file the build was invoked through. Rewriting it mid-build would be both
    // pointless and destructive.
    writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(buildManifest(sourcePkg), null, 2)}\n`, 'utf8');
    for (const file of COPIED_FILES) cpSync(join(PKG_ROOT, file), join(outDir, file));

    // Stage the two files that differ between the private tree and the public
    // one, for `mirror-sdk.sh` to copy. Generated here rather than committed so
    // the mirror's manifest cannot drift from the published manifest above.
    mkdirSync(MIRROR, { recursive: true });
    writeFileSync(
      join(MIRROR, 'package.json'),
      `${JSON.stringify(buildManifest(sourcePkg, { forMirror: true }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(join(MIRROR, 'tsconfig.json'), `${JSON.stringify(MIRROR_TSCONFIG, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(MIRROR, 'package-lock.json'),
      `${JSON.stringify(buildMirrorLock(sourcePkg), null, 2)}\n`,
      'utf8',
    );
  }

  console.log(`built ${PUBLIC_NAME}@${sourcePkg.version} → ${intoDist ? 'dist/' : outDir}`);
}

// Importable by the manifest test without running a build.
if (process.argv[1] !== undefined && process.argv[1].endsWith('build.ts')) {
  main(process.argv.slice(2));
}
