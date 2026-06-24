import fs from 'fs';
const content = fs.readFileSync('worker-entrypoint.ts', 'utf-8');
let depth = 0, s = false, t = false, sc = '', e = false;
for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  if (e) { e = false; continue; }
  if (ch === '\\') { e = true; continue; }
  if (!s && !t) {
    if (ch === '"' || ch === "'") { s = true; sc = ch; }
    else if (ch === '`') { t = true; }
    else if (ch === '{') { depth++; }
    else if (ch === '}') { depth--; }
  } else if (s && ch === sc) { s = false; }
  else if (t && ch === '`') { t = false; }
}
console.log('Depth:', depth);
