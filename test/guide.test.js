// The guide: the docs/ folder, which the documentation site shows under Apps. These tests catch
// on your PC what a reader would otherwise find: a guide with no title, a link that leads nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

/** Every .md file of docs/, as paths like "sharing.md" or "admin/roles.md". */
function pagesOf(dir = DOCS, base = '') {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) found.push(...pagesOf(path.join(dir, e.name), rel));
    else if (/\.md$/i.test(e.name)) found.push(rel);
  }
  return found.sort();
}

/** A page's text without its settings (between two --- lines at the top) and without its code. */
function textOf(rel) {
  return fs.readFileSync(path.join(DOCS, rel), 'utf8').replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

test('the guide has a first page, and each page has one title', () => {
  assert.ok(fs.existsSync(path.join(DOCS, 'index.md')), 'docs/index.md is the guide\'s first page');
  for (const rel of pagesOf()) {
    const raw = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    const titles = (textOf(rel).match(/^# \S.*$/gm) || []).length;
    const named = /^---\r?\n[\s\S]*?^title:\s*\S/m.test(raw);
    assert.ok(titles <= 1, `docs/${rel} has ${titles} "# titles": keep one, and use ## for the parts`);
    assert.ok(titles === 1 || named, `docs/${rel} needs a "# Title" line, or a title: setting at its top`);
  }
});

test('every link and picture of the guide leads to a file', () => {
  for (const rel of pagesOf()) {
    for (const [, ref] of textOf(rel).matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
      // Another site, a place on the same page, or a page of the documentation site itself.
      if (ref.startsWith('#') || ref.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
      const target = path.resolve(DOCS, path.dirname(rel), decodeURIComponent(ref.split(/[?#]/)[0]));
      assert.ok(target.startsWith(ROOT + path.sep) && fs.existsSync(target), `docs/${rel}: "${ref}" leads nowhere`);
    }
  }
});
