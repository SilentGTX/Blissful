// Creates node_modules/@blissful/core -> ../../packages/blissful-core.
//
// Why this exists: the app consumes the shared `@blissful/core` package as
// SOURCE via a Metro alias (`extraNodeModules` in metro.config.js). That alias
// works for the dev server but NOT for the release bundle (`expo export:embed`),
// so `gradlew assembleRelease` fails with "Unable to resolve module
// @blissful/core". A real node_modules entry (this junction/symlink) makes
// standard resolution find it (its package.json `main` is `src/index.ts`).
// Idempotent; runs on `postinstall` and via `npm run link:core`.
const fs = require('fs');
const path = require('path');

const linkDir = path.resolve(__dirname, '..', 'node_modules', '@blissful');
const linkPath = path.join(linkDir, 'core');
const target = path.resolve(__dirname, '..', '..', '..', 'packages', 'blissful-core');

try {
  if (!fs.existsSync(target)) {
    console.warn('[link-core] target not found, skipping:', target);
    process.exit(0);
  }
  fs.mkdirSync(linkDir, { recursive: true });
  if (fs.existsSync(linkPath)) {
    // Already linked (or stale) — leave a valid link alone, replace a broken one.
    try {
      if (fs.existsSync(path.join(linkPath, 'src', 'index.ts'))) process.exit(0);
    } catch { /* fall through to recreate */ }
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  // 'junction' works on Windows without admin; it's treated as a dir symlink on posix.
  fs.symlinkSync(target, linkPath, 'junction');
  console.log('[link-core] linked @blissful/core ->', target);
} catch (err) {
  console.warn('[link-core] failed (non-fatal):', err.message);
}
