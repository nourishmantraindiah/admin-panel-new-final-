const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- API routes ----------
// Admin-only login (no student/mentor/employer roles in this build)
app.use('/api/auth', require('./routes/auth'));
// Full admin control: site content, leads, webinar, students/mentors/employers, settings
app.use('/api/admin', require('./routes/admin'));
// Code editor — scoped to this repo's own admin-panel/ files (see routes/files.js)
app.use('/api/admin/files', require('./routes/files'));

// ---------- Static hosting ----------
// The admin panel is the whole product of this repo, so it's served at the root.
app.use('/', express.static(path.join(__dirname, 'admin-panel')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Byte Morphix admin panel running:`);
  console.log(`  Admin panel   → http://localhost:${PORT}/`);
  console.log(`  API base      → http://localhost:${PORT}/api`);
});
