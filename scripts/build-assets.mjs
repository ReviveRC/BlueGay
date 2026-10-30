await import('./build-diagnostics.mjs');
await import('./build-previews.mjs');
const fs=await import('node:fs/promises');
await fs.copyFile('LICENSE','dist/LICENSE.txt');
await fs.copyFile('THIRD-PARTY-NOTICES.md','dist/THIRD-PARTY-NOTICES.md');
