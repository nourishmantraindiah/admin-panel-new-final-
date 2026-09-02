const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// In the standalone admin-panel build, the code editor edits the admin
// panel's OWN front-end files (index.html / styles.css / app.js) rather than
// a full website's source — there is no separate "site" in this repo.
const EDITABLE_DIR = path.join(__dirname, '..', 'admin-panel');
const ALLOWED_EXTENSIONS = ['.html', '.css', '.js', '.json', '.md', '.txt'];

router.use(requireAuth('admin'));

function safePath(name) {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name) return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return null;
  const full = path.join(EDITABLE_DIR, base);
  if (!full.startsWith(EDITABLE_DIR)) return null;
  return full;
}

router.get('/', (req, res) => {
  const files = fs.readdirSync(EDITABLE_DIR)
    .filter(f => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(EDITABLE_DIR, f));
      return { name: f, size: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(files);
});

router.get('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return res.status(400).json({ error: 'Invalid or disallowed file name.' });
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found.' });
  res.json({ name: req.params.name, content: fs.readFileSync(full, 'utf-8') });
});

router.put('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return res.status(400).json({ error: 'Invalid or disallowed file name.' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'Content must be a string.' });

  if (fs.existsSync(full)) {
    const backupDir = path.join(EDITABLE_DIR, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(full, path.join(backupDir, `${req.params.name}.${stamp}.bak`));
  }

  fs.writeFileSync(full, content, 'utf-8');
  res.json({ ok: true, name: req.params.name, bytes: Buffer.byteLength(content, 'utf-8') });
});

router.post('/', (req, res) => {
  const { name, content } = req.body;
  const full = safePath(name);
  if (!full) return res.status(400).json({ error: 'Invalid or disallowed file name.' });
  if (fs.existsSync(full)) return res.status(409).json({ error: 'A file with that name already exists.' });
  fs.writeFileSync(full, content || '', 'utf-8');
  res.status(201).json({ ok: true, name });
});

router.delete('/:name', (req, res) => {
  const full = safePath(req.params.name);
  if (!full) return res.status(400).json({ error: 'Invalid or disallowed file name.' });
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found.' });

  const backupDir = path.join(EDITABLE_DIR, '.backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(full, path.join(backupDir, `${req.params.name}.${stamp}.deleted.bak`));

  fs.unlinkSync(full);
  res.json({ ok: true });
});

module.exports = router;
