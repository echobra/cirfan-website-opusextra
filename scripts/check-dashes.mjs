// scripts/check-dashes.mjs
// House style: no em dashes or en dashes anywhere in the site's source.
// Runs before every build (npm run build) and fails the build if one is found.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['src', 'public'];
const exts = new Set(['.astro', '.md', '.mdx', '.ts', '.js', '.mjs', '.css', '.html', '.json', '.txt', '.svg', '.webmanifest']);
// U+2014 em dash, U+2013 en dash, U+2015 horizontal bar
const banned = /[\u2013\u2014\u2015]/;
const found = [];

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (exts.has(extname(name))) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (banned.test(line)) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
  }
};

roots.forEach(walk);

if (found.length) {
  console.error('\nEm or en dash found. Rewrite these lines:\n');
  found.forEach((f) => console.error('  ' + f));
  console.error('');
  process.exit(1);
}
console.log('Copy check passed: no em or en dashes.');
