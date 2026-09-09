const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- Public API ----------
// Login (staff roles + student/mentor/employer portal accounts)
app.use('/api/auth', require('./routes/auth'));
// Every form on the marketing site posts here — no auth, lands in the panel
app.use('/api/forms', require('./routes/intake'));

// ---------- Admin API (all authenticated + permission-gated) ----------
app.use('/api/admin/files', require('./routes/files'));
app.use('/api/admin/academics', require('./routes/academics'));
app.use('/api/admin/finance', require('./routes/finance'));
app.use('/api/admin/placement', require('./routes/placement'));
app.use('/api/admin/repository', require('./routes/repository'));
app.use('/api/admin/support', require('./routes/support'));
app.use('/api/admin/settings', require('./routes/settings'));
app.use('/api/admin/staff', require('./routes/staff'));
app.use('/api/admin/audit', require('./routes/audit'));
app.use('/api/notifications', require('./routes/notifications'));
// Mounted last: it owns the bare /api/admin/* paths and would otherwise
// swallow the more specific routers above.
app.use('/api/admin', require('./routes/admin'));

// ---------- Static hosting ----------
// The admin panel is the whole product of this repo, so it's served at root.
// storage/ is deliberately NOT static — identity documents are only reachable
// through the authenticated, audited route in routes/repository.js.
app.use('/', express.static(path.join(__dirname, 'admin-panel')));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong.' });
});

/**
 * Overdue fee sweep. Runs hourly so "Payment Overdue" alerts appear on their
 * own rather than waiting for someone to open the Finance tab. Each
 * installment only ever raises one alert — see sweepOverdue().
 */
const { readDB, writeDB } = require('./lib/db');
const { sweepOverdue } = require('./routes/finance');

function runSweep() {
  try {
    const db = readDB();
    const raised = sweepOverdue(db, null);
    if (raised) {
      writeDB(db);
      console.log(`[sweep] raised ${raised} overdue payment alert(s)`);
    }
  } catch (err) {
    console.error('[sweep] failed:', err.message);
  }
}
setInterval(runSweep, 60 * 60 * 1000);
setTimeout(runSweep, 10_000);

app.listen(PORT, () => {
  console.log('Byte Morphix admin panel running:');
  console.log(`  Admin panel   → http://localhost:${PORT}/`);
  console.log(`  API base      → http://localhost:${PORT}/api`);
  console.log(`  Public forms  → POST http://localhost:${PORT}/api/forms/<formKey>`);
});
