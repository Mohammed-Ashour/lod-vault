// Fixture-only browser capture, without a server or access to a real vault.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { loadSharedStore, runScripts } = require('../tests/helpers/loaders');
const out = path.resolve(process.argv[2] || 'dist/tag-overflow');
fs.mkdirSync(out, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-overflow-'));
const host = loadSharedStore();
runScripts(host.context, ['scripts/activity.js', 'scripts/decks.js']);
const entries = [{ id: 'HAUS1', word: 'Haus', favorite: true, translations: { en: ['house'] } }];
const base = host.store.buildExportHtml(entries, { includeInlineScript: false });
const scripts = ['activity.js', 'decks.js', 'vault-tags.js'].map(f => fs.readFileSync(`scripts/${f}`, 'utf8')).join('\n');
for (const overflow of [false, true]) {
  const org = { t: { home: [['HAUS1'], Date.now()] }, k: {} };
  if (overflow) {
    for (let i = 0; i < 160; i++) org.k[`deck${i}`] = [{ name: 'Saved practice deck number ' + i, f: { tag: 'home' } }, Date.now()];
    for (let i = 0; i < 30; i++) org.t[`deleted${i}`] = [[], Date.now()];
  }
  const html = base.replace('</body>', `<script>globalThis.chrome={storage:{local:{get:async()=>({'lodVault.tags':${JSON.stringify(org)}})}}};\n${scripts}\nLodVaultVaultTags.attach(document,{entriesById:new Map(${JSON.stringify(entries)}.map(e=>[e.id,e]))});</script></body>`);
  const file = path.join(temp, 'fixture.html');
  fs.writeFileSync(file, html);
  execFileSync(process.env.CHROME_PATH || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=2000', '--window-size=1000,720', `--user-data-dir=${temp}/profile`, `--screenshot=${out}/${overflow ? 'overflow' : 'normal'}.png`, `file://${file}`], { stdio: 'ignore' });
}
execFileSync('ffmpeg', ['-y', '-framerate', '1/2', '-pattern_type', 'glob', '-i', `${out}/*.png`, '-vf', 'scale=800:-1', '-loop', '0', `${out}/tag-overflow.gif`], { stdio: 'ignore' });
fs.rmSync(temp, { recursive: true, force: true });
console.log(out);
