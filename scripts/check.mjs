// `npm run check` - syntax-check every JS file with `node --check` (ES module mode via package.json "type").
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'screenshots') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(ent.name)) files.push(p);
  }
}
walk(ROOT);

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${path.relative(ROOT, f)}\n${r.stderr}`);
  }
}
console.log(`node --check: ${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
