/* =========================================================================
   Byte Morphix Admin — panel modules
   Every panel registers a loader on BM.loaders keyed by its data-panel name.
   ========================================================================= */
(function () {
  'use strict';

  const {
    api, toast, esc, fmtDate, fmtDateTime, money, lakh, timeAgo, titleCase,
    openModal, openSheet, confirmDialog, empty, fillSelect,
    can, loadLookups, selectPanel, openStudentDrawer, refreshNotifications,
    loaders, $, $$
  } = window.BM;

  const cache = () => window.BM.cache;
  const me = () => window.BM.me;
  const pill = (v, cls) => `<span class="pill ${esc(cls || v)}">${esc(titleCase(v))}</span>`;
  const tbody = sel => $(sel + ' tbody');

  /** Wires up click handlers declared as data-attributes in a rendered table. */
  function bind(root, attr, handler) {
    (typeof root === 'string' ? $(root) : root)
      .querySelectorAll(`[${attr}]`)
      .forEach(el => el.addEventListener('click', () => handler(el.getAttribute(attr), el)));
  }

  const courseOptions = () => (cache().courses || []).map(c => ({ value: c.id, label: c.name }));
  const batchOptions = () => (cache().batches || []).map(b => ({ value: b.id, label: `${b.name} (${b.courseName})` }));
  const studentOptions = () => (cache().students || []).map(s => ({ value: s.id, label: `${s.name} — ${s.email}` }));
  const staffOptions = () => (cache().staff || []).map(s => ({ value: s.id, label: `${s.name} (${s.roleLabel})` }));

  /* ======================================================================
     OVERVIEW
     ====================================================================== */

  loaders.overview = async () => {
    const d = await api('/admin/overview');

    const cards = [
      ['leads', 'Total leads', '', 'leads'],
      ['newLeads', 'New leads', d.newLeads ? 'alert' : '', 'leads'],
      ['students', 'Students', '', 'students'],
      ['activeStudents', 'Active students', 'good', 'students'],
      ['mentors', 'Mentors', '', 'mentors'],
      ['employers', 'Employers', '', 'employers'],
      ['batches', 'Batches', '', 'batches'],
      ['classesToday', 'Classes today', 'info', 'classes'],
      ['outstandingFees', 'Outstanding fees', d.outstandingFees ? 'alert' : 'good', 'finance'],
      ['openQueries', 'Open queries', d.openQueries ? 'alert' : '', 'queries'],
      ['openDisputes', 'Open disputes', d.openDisputes ? 'alert' : '', 'disputes'],
      ['newForms', 'New form entries', d.newForms ? 'alert' : '', 'forms'],
      ['pendingDocuments', 'Docs to verify', d.pendingDocuments ? 'alert' : '', 'repository'],
      ['placedStudents', 'Students placed', 'good', 'placement'],
      ['webinarRegistrations', 'Webinar signups', '', 'webinar'],
      ['pendingCorrections', 'Payout corrections', d.pendingCorrections ? 'alert' : '', 'mentors']
    ].filter(([, , , panel]) => {
      const nav = $(`.nav-item[data-panel="${panel}"]`);
      return nav && !nav.classList.contains('locked');
    });

    $('#overviewStats').innerHTML = cards.map(([key, label, cls, panel]) => {
      const value = key === 'outstandingFees' ? money(d[key]) : (d[key] ?? 0);
      return `<div class="stat-card clickable ${cls}" data-goto="${panel}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
    }).join('');
    bind('#overviewStats', 'data-goto', panel => selectPanel(panel));

    const todo = [];
    if (d.newLeads) todo.push([`${d.newLeads} lead(s) haven't been contacted`, 'leads']);
    if (d.newForms) todo.push([`${d.newForms} form submission(s) unread`, 'forms']);
    if (d.pendingDocuments) todo.push([`${d.pendingDocuments} identity document(s) awaiting verification`, 'repository']);
    if (d.openQueries) todo.push([`${d.openQueries} query ticket(s) open`, 'queries']);
    if (d.openDisputes) todo.push([`${d.openDisputes} dispute(s) unresolved`, 'disputes']);
    if (d.outstandingFees) todo.push([`${money(d.outstandingFees)} in fees still outstanding`, 'finance']);
    if (d.pendingCorrections) todo.push([`${d.pendingCorrections} mentor payout correction(s) pending`, 'mentors']);

    $('#overviewTodo').innerHTML = todo.length
      ? todo.map(([text, panel]) => `<div class="register-row"><span class="name">${esc(text)}</span>
          <button class="btn btn-ghost btn-xs" data-goto2="${panel}">Open</button></div>`).join('')
      : '<div class="empty-state">Nothing needs your attention. Nice.</div>';
    bind('#overviewTodo', 'data-goto2', panel => selectPanel(panel));

    if (can('audit.read')) {
      const log = await api('/admin/audit?limit=8').catch(() => ({ items: [] }));
      $('#overviewActivity').innerHTML = log.items.length ? `<div class="timeline">${log.items.map(l => `
        <div class="tl-item"><div class="tl-when">${esc(timeAgo(l.at))}</div>
        <div class="tl-what"><b>${esc(l.actorName)}</b> ${esc(titleCase(l.action))} — ${esc(l.entity)} ${esc(l.label || '')}</div></div>`).join('')}</div>`
        : '<div class="empty-state">No activity recorded yet.</div>';
    } else {
      $('#overviewActivity').innerHTML = '<div class="empty-state">Activity log is restricted to Super Admins.</div>';
    }
  };

  /* ======================================================================
     LEADS
     ====================================================================== */

  let leadsData = [];

  loaders.leads = async () => {
    leadsData = await api('/admin/leads');
    renderLeads();
  };

  function renderLeads() {
    const q = ($('#leadSearch').value || '').toLowerCase();
    const st = $('#leadStatusFilter').value;
    const rows = leadsData.slice().reverse()
      .filter(l => !st || l.status === st)
      .filter(l => !q || [l.name, l.email, l.phone].join(' ').toLowerCase().includes(q));

    tbody('#leadsTable').innerHTML = rows.length ? rows.map(l => `
      <tr>
        <td class="strong">${esc(l.name)}</td><td>${esc(l.email)}</td><td>${esc(l.phone)}</td>
        <td>${esc(l.track || '—')}</td><td class="muted">${esc(l.source || 'website')}</td>
        <td>${pill(l.status)}</td><td class="nowrap">${esc(fmtDate(l.createdAt))}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-xs" data-lead-status="${esc(l.id)}">Status</button>
          <button class="btn btn-danger btn-xs" data-lead-del="${esc(l.id)}">Delete</button>
        </td>
      </tr>`).join('') : empty(8, 'No leads match that filter.');

    bind('#leadsTable', 'data-lead-status', async id => {
      const lead = leadsData.find(l => l.id === id);
      const v = await openModal('Update Lead', [
        { key: 'status', label: 'Status', type: 'select', options: ['new', 'contacted', 'qualified', 'enrolled', 'lost'] },
        { key: 'message', label: 'Notes', type: 'textarea' }
      ], lead);
      if (!v) return;
      await api('/admin/leads/' + id, { method: 'PUT', body: v });
      toast('Lead updated.', 'success');
      loaders.leads();
    });
    bind('#leadsTable', 'data-lead-del', async id => {
      if (!confirmDialog('Delete this lead permanently?')) return;
      await api('/admin/leads/' + id, { method: 'DELETE' });
      loaders.leads();
    });
  }
  ['#leadSearch', '#leadStatusFilter'].forEach(s => $(s).addEventListener('input', renderLeads));

  /* ======================================================================
     FORM SUBMISSIONS
     ====================================================================== */

  loaders.forms = async () => {
    $('#formsEndpointHint').innerHTML =
      `Point any form on your website at <span class="mono">POST ${esc(location.origin)}/api/forms/&lt;form-name&gt;</span> ` +
      `and it appears here. No backend change needed for a new form. Known names (<span class="mono">apply</span>, ` +
      `<span class="mono">query</span>, <span class="mono">dispute</span>, <span class="mono">webinar</span>, ` +
      `<span class="mono">callback</span>) also create the matching record automatically.`;

    const keys = await api('/admin/support/forms/keys');
    $('#formsStats').innerHTML = keys.length ? keys.map(k =>
      `<div class="stat-card ${k.unread ? 'alert' : ''}"><b>${k.total}</b><span>${esc(k.formName)}${k.unread ? ` · ${k.unread} new` : ''}</span></div>`
    ).join('') : '<div class="stat-card"><b>0</b><span>No submissions yet</span></div>';

    fillSelect('#formKeyFilter', keys.map(k => ({ id: k.formKey, name: k.formName })), { placeholder: 'All forms' });
    await renderForms();
  };

  async function renderForms() {
    const params = new URLSearchParams();
    if ($('#formKeyFilter').value) params.set('formKey', $('#formKeyFilter').value);
    if ($('#formStatusFilter').value) params.set('status', $('#formStatusFilter').value);
    const list = await api('/admin/support/forms?' + params);

    tbody('#formsTable').innerHTML = list.length ? list.map(f => {
      const summary = Object.entries(f.fields).filter(([k]) => !['name', 'email'].includes(k))
        .slice(0, 3).map(([k, v]) => `${titleCase(k)}: ${String(v).slice(0, 40)}`).join(' · ');
      return `<tr>
        <td class="strong">${esc(f.formName)}</td>
        <td>${esc(f.fields.name || '—')}<br><span class="muted">${esc(f.fields.email || f.fields.phone || '')}</span></td>
        <td class="muted">${esc(summary || '—')}</td>
        <td class="muted mono">${esc((f.pageUrl || '').replace(/^https?:\/\//, '').slice(0, 30) || '—')}</td>
        <td>${pill(f.status)}</td><td class="nowrap">${esc(timeAgo(f.submittedAt))}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-xs" data-form-view="${esc(f.id)}">View</button>
          ${f.convertedLeadId ? '' : `<button class="btn btn-ghost btn-xs" data-form-lead="${esc(f.id)}">→ Lead</button>`}
          <button class="btn btn-danger btn-xs" data-form-del="${esc(f.id)}">Delete</button>
        </td></tr>`;
    }).join('') : empty(7, 'No submissions yet. Post a test to /api/forms/contact to see one appear.');

    bind('#formsTable', 'data-form-view', async id => {
      const f = list.find(x => x.id === id);
      const rows = Object.entries(f.fields).map(([k, v]) =>
        `<div class="kv"><label>${esc(titleCase(k))}</label><b>${esc(v)}</b></div>`).join('');
      openSheet(f.formName, `
        <div class="kv-grid">${rows}</div>
        <div class="kv-grid" style="margin-top:14px;">
          <div class="kv"><label>Page</label><b>${esc(f.pageUrl || '—')}</b></div>
          <div class="kv"><label>Received</label><b>${esc(fmtDateTime(f.submittedAt))}</b></div>
          <div class="kv"><label>IP</label><b class="mono">${esc(f.ip || '—')}</b></div>
        </div>`, [
        { label: 'Mark actioned', cls: 'btn-primary', onClick: async () => {
          await api('/admin/support/forms/' + id, { method: 'PUT', body: { status: 'actioned' } });
          toast('Marked actioned.', 'success'); renderForms();
        } },
        { label: 'Mark spam', onClick: async () => {
          await api('/admin/support/forms/' + id, { method: 'PUT', body: { status: 'spam' } });
          renderForms();
        } }
      ]);
      if (f.status === 'new') await api('/admin/support/forms/' + id, { method: 'PUT', body: { status: 'read' } });
    });

    bind('#formsTable', 'data-form-lead', async id => {
      await api(`/admin/support/forms/${id}/convert-to-lead`, { method: 'POST' });
      toast('Converted to a lead.', 'success');
      renderForms();
    });
    bind('#formsTable', 'data-form-del', async id => {
      if (!confirmDialog('Delete this submission?')) return;
      await api('/admin/support/forms/' + id, { method: 'DELETE' });
      renderForms();
    });
  }
  ['#formKeyFilter', '#formStatusFilter'].forEach(s => $(s).addEventListener('change', renderForms));

  /* ======================================================================
     QUERIES
     ====================================================================== */

  const QUERY_CATEGORIES = ['admission', 'course', 'fees', 'technical', 'certificate', 'placement', 'mentor', 'general'];

  loaders.queries = async () => {
    fillSelect('#queryCat', QUERY_CATEGORIES.map(c => ({ id: c, name: titleCase(c) })), { placeholder: 'All categories' });
    await renderQueries();
  };

  async function renderQueries() {
    const params = new URLSearchParams();
    if ($('#querySt').value) params.set('status', $('#querySt').value);
    if ($('#queryCat').value) params.set('category', $('#queryCat').value);
    const list = await api('/admin/support/queries?' + params);

    tbody('#queriesTable').innerHTML = list.length ? list.map(q => `
      <tr>
        <td class="mono">${esc(q.ticketNo)}</td>
        <td class="strong">${esc(q.subject)}</td>
        <td>${esc(q.name || '—')}<br><span class="muted">${esc(titleCase(q.raisedByType))}</span></td>
        <td>${esc(titleCase(q.category))}</td><td>${pill(q.priority)}</td>
        <td>${pill(q.sla, q.sla === 'breached' ? 'breached' : q.sla === 'at_risk' ? 'at_risk' : 'good')}</td>
        <td>${pill(q.status)}</td><td class="muted">${esc(q.assigneeName || 'Unassigned')}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-xs" data-q-open="${esc(q.id)}">Open</button></td>
      </tr>`).join('') : empty(9, 'No query tickets.');

    bind('#queriesTable', 'data-q-open', id => openQuery(id));
  }
  ['#querySt', '#queryCat'].forEach(s => $(s).addEventListener('change', renderQueries));

  async function openQuery(id) {
    const q = await api('/admin/support/queries/' + id);
    const thread = (q.thread || []).map(m => `
      <div class="thread-msg ${m.internal ? 'internal' : ''}">
        <div class="who"><b>${esc(m.byName)}</b>${m.internal ? '<span class="pill">Internal note</span>' : ''}<span>${esc(timeAgo(m.at))}</span></div>
        ${esc(m.message)}
      </div>`).join('') || '<div class="empty-state">No replies yet.</div>';

    const sheet = openSheet(`${q.ticketNo} — ${q.subject}`, `
      <div class="kv-grid" style="margin-bottom:16px;">
        <div class="kv"><label>From</label><b>${esc(q.name || '—')}</b></div>
        <div class="kv"><label>Email</label><b>${esc(q.email || '—')}</b></div>
        <div class="kv"><label>Phone</label><b>${esc(q.phone || '—')}</b></div>
        <div class="kv"><label>Channel</label><b>${esc(titleCase(q.channel))}</b></div>
        <div class="kv"><label>Category</label><b>${esc(titleCase(q.category))}</b></div>
        <div class="kv"><label>Raised</label><b>${esc(fmtDateTime(q.createdAt))}</b></div>
      </div>
      <div class="card" style="margin-bottom:16px;"><b>Original message</b><p style="margin-top:8px;">${esc(q.message)}</p></div>
      <h4 style="font-size:13px;margin-bottom:10px;">Thread</h4>${thread}
      <div class="field"><label>Add a reply</label><textarea id="qReply" rows="3" placeholder="Type your response…"></textarea></div>
      <label class="checkbox-row"><input type="checkbox" id="qInternal"> Internal note (not sent to the requester)</label>
    `, [
      { label: 'Send reply', cls: 'btn-primary', onClick: async overlay => {
        const msg = overlay.querySelector('#qReply').value.trim();
        if (!msg) { toast('Write something first.', 'error'); return true; }
        await api(`/admin/support/queries/${id}/reply`, { method: 'POST', body: { message: msg, internal: overlay.querySelector('#qInternal').checked } });
        toast('Reply added.', 'success'); renderQueries();
      } },
      { label: 'Update status', onClick: async () => {
        const v = await openModal('Update Ticket', [
          { key: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
          { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
          { key: 'assignedTo', label: 'Assign to', type: 'select', options: staffOptions(), placeholder: 'Unassigned' }
        ], q);
        if (!v) return;
        await api('/admin/support/queries/' + id, { method: 'PUT', body: v });
        toast('Ticket updated.', 'success'); renderQueries();
      } }
    ]);
    return sheet;
  }

  $('#addQueryBtn').addEventListener('click', async () => {
    const v = await openModal('Log a Query', [
      { key: 'name', label: 'Name' }, { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'raisedByType', label: 'They are a', type: 'select', options: ['student', 'mentor', 'employer', 'visitor'] },
      { key: 'category', label: 'Category', type: 'select', options: QUERY_CATEGORIES },
      { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
      { key: 'channel', label: 'Came in via', type: 'select', options: ['phone', 'email', 'whatsapp', 'walk_in', 'admin'] },
      { key: 'subject', label: 'Subject' },
      { key: 'message', label: 'Message', type: 'textarea' }
    ], { priority: 'normal' }, { validate: v => !v.subject || !v.message ? 'Subject and message are required.' : null });
    if (!v) return;
    await api('/admin/support/queries', { method: 'POST', body: v });
    toast('Query logged.', 'success');
    loaders.queries();
  });

  /* ======================================================================
     DISPUTES
     ====================================================================== */

  const DISPUTE_TYPES = ['payment', 'refund', 'attendance', 'assessment', 'mentor_payout', 'placement', 'conduct', 'other'];

  loaders.disputes = async () => {
    fillSelect('#dispType', DISPUTE_TYPES.map(t => ({ id: t, name: titleCase(t) })), { placeholder: 'All types' });
    await renderDisputes();
  };

  async function renderDisputes() {
    const params = new URLSearchParams();
    if ($('#dispSt').value) params.set('status', $('#dispSt').value);
    if ($('#dispType').value) params.set('type', $('#dispType').value);
    const list = await api('/admin/support/disputes?' + params);

    tbody('#disputesTable').innerHTML = list.length ? list.map(d => `
      <tr>
        <td class="mono">${esc(d.caseNo)}</td><td>${esc(titleCase(d.type))}</td>
        <td class="strong">${esc(d.subject)}</td>
        <td>${esc(d.raisedByName || '—')}<br><span class="muted">${esc(titleCase(d.raisedByType))}</span></td>
        <td>${d.amount ? esc(money(d.amount)) : '—'}</td>
        <td>${pill(d.severity, d.severity === 'critical' ? 'critical' : d.severity === 'high' ? 'at_risk' : '')}</td>
        <td>${pill(d.status)}</td><td class="muted">${d.ageDays}d</td>
        <td class="row-actions"><button class="btn btn-ghost btn-xs" data-d-open="${esc(d.id)}">Open</button></td>
      </tr>`).join('') : empty(9, 'No disputes on record.');

    bind('#disputesTable', 'data-d-open', id => openDispute(list.find(x => x.id === id)));
  }
  ['#dispSt', '#dispType'].forEach(s => $(s).addEventListener('change', renderDisputes));

  function openDispute(d) {
    const thread = (d.thread || []).map(m => `
      <div class="thread-msg ${m.internal ? 'internal' : ''}">
        <div class="who"><b>${esc(m.byName)}</b><span>${esc(timeAgo(m.at))}</span></div>${esc(m.message)}
      </div>`).join('') || '<div class="empty-state">No case notes yet.</div>';

    openSheet(`${d.caseNo} — ${d.subject}`, `
      <div class="kv-grid" style="margin-bottom:16px;">
        <div class="kv"><label>Type</label><b>${esc(titleCase(d.type))}</b></div>
        <div class="kv"><label>Raised by</label><b>${esc(d.raisedByName || '—')} (${esc(titleCase(d.raisedByType))})</b></div>
        <div class="kv"><label>Amount in question</label><b>${d.amount ? esc(money(d.amount)) : '—'}</b></div>
        <div class="kv"><label>Severity</label><b>${esc(titleCase(d.severity))}</b></div>
        <div class="kv"><label>Status</label><b>${esc(titleCase(d.status))}</b></div>
        <div class="kv"><label>Opened</label><b>${esc(fmtDateTime(d.createdAt))}</b></div>
      </div>
      <div class="card" style="margin-bottom:16px;"><b>Description</b><p style="margin-top:8px;">${esc(d.description)}</p>
      ${d.resolution ? `<p style="margin-top:12px;"><b>Resolution:</b> ${esc(d.resolution)}</p>` : ''}</div>
      <h4 style="font-size:13px;margin-bottom:10px;">Case notes</h4>${thread}
      <div class="field"><label>Add a note</label><textarea id="dNote" rows="3"></textarea></div>
    `, [
      { label: 'Add note', cls: 'btn-primary', onClick: async overlay => {
        const msg = overlay.querySelector('#dNote').value.trim();
        if (!msg) { toast('Write something first.', 'error'); return true; }
        await api(`/admin/support/disputes/${d.id}/note`, { method: 'POST', body: { message: msg } });
        toast('Note added.', 'success'); renderDisputes();
      } },
      { label: 'Resolve / update', onClick: async () => {
        const v = await openModal('Update Dispute', [
          { key: 'status', label: 'Status', type: 'select', options: ['open', 'investigating', 'awaiting_response', 'escalated', 'resolved', 'rejected'] },
          { key: 'severity', label: 'Severity', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
          { key: 'assignedTo', label: 'Assign to', type: 'select', options: staffOptions(), placeholder: 'Unassigned' },
          { key: 'resolution', label: 'Resolution / outcome', type: 'textarea' }
        ], d, { subtitle: 'Resolving or rejecting notifies whoever raised it.' });
        if (!v) return;
        await api('/admin/support/disputes/' + d.id, { method: 'PUT', body: v });
        toast('Dispute updated.', 'success'); renderDisputes();
      } }
    ]);
  }

  $('#addDisputeBtn').addEventListener('click', async () => {
    const v = await openModal('Raise a Dispute', [
      { key: 'type', label: 'Type', type: 'select', options: DISPUTE_TYPES },
      { key: 'raisedByType', label: 'Raised by', type: 'select', options: ['student', 'mentor', 'employer', 'staff'] },
      { key: 'raisedById', label: 'Person', type: 'select', options: studentOptions(), placeholder: 'Not linked to an account' },
      { key: 'raisedByName', label: 'Name (if not linked above)' },
      { key: 'subject', label: 'Subject' },
      { key: 'description', label: 'What happened', type: 'textarea', rows: 4 },
      { key: 'amount', label: 'Amount in question (₹)', type: 'number' },
      { key: 'severity', label: 'Severity', type: 'select', options: ['low', 'medium', 'high', 'critical'] }
    ], { severity: 'medium' }, { validate: v => !v.subject || !v.description ? 'Subject and description are required.' : null });
    if (!v) return;
    await api('/admin/support/disputes', { method: 'POST', body: v });
    toast('Dispute recorded.', 'success');
    loaders.disputes();
  });

  /* ======================================================================
     STUDENTS
     ====================================================================== */

  let studentsData = [];

  loaders.students = async () => {
    await loadLookups();
    fillSelect('#studentCourseFilter', cache().courses, { placeholder: 'All courses' });
    fillSelect('#studentBatchFilter', cache().batches, { placeholder: 'All batches' });
    studentsData = await api('/admin/students');
    cache().students = studentsData;
    renderStudents();
  };

  function renderStudents() {
    const q = ($('#studentSearch').value || '').toLowerCase();
    const cId = $('#studentCourseFilter').value;
    const bId = $('#studentBatchFilter').value;
    const st = $('#studentStatusFilter').value;

    const rows = studentsData
      .filter(s => !q || `${s.name} ${s.email}`.toLowerCase().includes(q))
      .filter(s => !cId || (s.courseIds || []).includes(cId))
      .filter(s => !bId || s.batchId === bId)
      .filter(s => !st || s.status === st);

    tbody('#studentsTable').innerHTML = rows.length ? rows.map(s => {
      const att = s.attendancePercent;
      const attCls = att === null ? '' : att < 75 ? 'bad' : 'good';
      return `<tr>
        <td class="strong"><a href="#" data-stu-open="${esc(s.id)}">${esc(s.name)}</a></td>
        <td>${esc(s.email)}</td>
        <td>${esc((s.courseNames || []).join(', ') || '—')}</td>
        <td>${esc(s.batchName || '—')}</td>
        <td>${att === null ? '<span class="muted">—</span>' : `${att}%<div class="bar"><i class="${attCls}" style="width:${att}%"></i></div>`}</td>
        <td class="nowrap">Wk ${s.weekProgress}/${s.totalWeeks}</td>
        <td>${pill(s.placementStatus)}</td>
        <td>${pill(s.status)}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-xs" data-stu-open2="${esc(s.id)}">Profile</button>
          <button class="btn btn-ghost btn-xs" data-stu-edit="${esc(s.id)}">Edit</button>
          <button class="btn btn-danger btn-xs" data-stu-del="${esc(s.id)}">Delete</button>
        </td></tr>`;
    }).join('') : empty(9, 'No students match that filter.');

    bind('#studentsTable', 'data-stu-open', id => openStudentDrawer(id));
    bind('#studentsTable', 'data-stu-open2', id => openStudentDrawer(id));
    bind('#studentsTable', 'data-stu-edit', id => editStudent(studentsData.find(s => s.id === id)));
    bind('#studentsTable', 'data-stu-del', async id => {
      if (!confirmDialog('Delete this student account? If they have paid anything, set their status to "dropped" instead.')) return;
      try {
        await api('/admin/students/' + id, { method: 'DELETE' });
        toast('Student deleted.', 'success'); loaders.students();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
  ['#studentSearch', '#studentCourseFilter', '#studentBatchFilter', '#studentStatusFilter']
    .forEach(s => $(s).addEventListener('input', renderStudents));

  async function editStudent(s) {
    const v = await openModal('Edit Student', [
      { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone' },
      { key: 'courseIds', label: 'Courses', type: 'multiselect', options: courseOptions() },
      { key: 'batchId', label: 'Batch', type: 'select', options: batchOptions(), placeholder: 'Not assigned' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'on_hold', 'dropped', 'completed'] },
      { key: 'placementStatus', label: 'Placement status', type: 'select', options: ['not_ready', 'ready', 'applying', 'interviewing', 'placed'] },
      { key: 'weekProgress', label: 'Week progress', type: 'number' },
      { key: 'xp', label: 'XP', type: 'number' },
      { key: 'password', label: 'New password (blank keeps current)', type: 'password' }
    ], { ...s, phone: (s.personal || {}).phone });
    if (!v) return;
    const body = { ...v, weekProgress: Number(v.weekProgress), xp: Number(v.xp), personal: { phone: v.phone } };
    delete body.phone;
    if (!v.password) delete body.password;
    try {
      await api('/admin/students/' + s.id, { method: 'PUT', body });
      toast('Student updated.', 'success'); loaders.students();
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#addStudentBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('Add Student', [
      { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'courseIds', label: 'Courses', type: 'multiselect', options: courseOptions() },
      { key: 'batchId', label: 'Batch', type: 'select', options: batchOptions(), placeholder: 'Assign later' },
      { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' },
      { key: 'guardianName', label: 'Guardian name' }, { key: 'guardianPhone', label: 'Guardian phone' }
    ], {}, {
      subtitle: 'Enrolling sends a welcome push to the student and alerts the admissions team.',
      validate: v => !v.name || !v.email || !v.password ? 'Name, email and password are required.'
        : v.password.length < 6 ? 'Use at least 6 characters.' : null
    });
    if (!v) return;
    try {
      await api('/admin/students', { method: 'POST', body: {
        name: v.name, email: v.email, password: v.password, courseIds: v.courseIds, batchId: v.batchId || null,
        personal: { phone: v.phone, city: v.city, guardianName: v.guardianName, guardianPhone: v.guardianPhone }
      } });
      toast('Student enrolled — welcome notification sent.', 'success');
      loaders.students(); refreshNotifications(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  /* ------------------------------- Student 360 drawer ------------------- */

  loaders.studentProfile = async id => {
    let p;
    try { p = await api(`/admin/students/${id}/profile`); }
    catch (e) { $('#sdBody').innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; return; }

    $('#sdName').textContent = p.personal.name;
    $('#sdSub').innerHTML = `${esc(p.personal.email)} · ${esc((p.personal.courseNames || []).join(', ') || 'No course')} · ${esc(p.batch ? p.batch.name : 'No batch')}`;

    const per = p.personal.personal || {};
    const fee = p.fees[0];

    const tab = (key, label) => `<div class="tab ${key === 'personal' ? 'active' : ''}" data-tab="${key}">${label}</div>`;
    const panelOf = (key, html) => `<div class="tab-panel ${key === 'personal' ? 'active' : ''}" data-tabpanel="${key}">${html}</div>`;

    const kv = (l, v) => `<div class="kv"><label>${esc(l)}</label><b>${esc(v ?? '—')}</b></div>`;

    const attRows = p.attendance.rows.map(r => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.topic)}</td><td>${pill(r.status)}</td><td class="muted">${esc(r.note || '')}</td></tr>`).join('');

    const html = `
      <div class="tabs">
        ${tab('personal', 'Personal')}${tab('course', 'Course &amp; Batch')}${tab('attendance', 'Attendance')}
        ${tab('fees', 'Fees')}${tab('work', 'Coursework')}${tab('certs', 'Certificates')}
        ${tab('placement', 'Placement')}${tab('docs', 'Documents')}${tab('comm', 'Communication')}
      </div>

      ${panelOf('personal', `<div class="kv-grid">
        ${kv('Full name', p.personal.name)}${kv('Email', p.personal.email)}${kv('Phone', per.phone)}
        ${kv('Date of birth', per.dob)}${kv('Gender', per.gender)}${kv('City', per.city)}
        ${kv('State', per.state)}${kv('Pincode', per.pincode)}${kv('Qualification', per.qualification)}
        ${kv('College', per.college)}${kv('Guardian', per.guardianName)}${kv('Guardian phone', per.guardianPhone)}
        ${kv('Enrolled on', fmtDate(p.personal.enrolledAt))}${kv('Status', titleCase(p.personal.status))}
      </div>
      <div class="field"><label>Address</label><div class="kv"><b>${esc(per.address || '—')}</b></div></div>`)}

      ${panelOf('course', `<div class="kv-grid">
        ${p.courses.map(c => kv(c.name, `${c.durationLabel || ''} · ${money(c.fee)}`)).join('') || '<div class="empty-state">No course assigned.</div>'}
      </div>
      <h4 style="margin:18px 0 10px;font-size:13px;">Batch</h4>
      ${p.batch ? `<div class="kv-grid">
        ${kv('Batch', p.batch.name)}${kv('Course', p.batch.courseName)}${kv('Starts', fmtDate(p.batch.startDate))}
        ${kv('Ends', fmtDate(p.batch.endDate))}${kv('Trainer', p.batch.trainerName)}${kv('Mentors', (p.batch.mentorNames || []).join(', '))}
        ${kv('Timing', p.batch.classTiming)}${kv('Days', (p.batch.days || []).join(', '))}
        ${kv('Mode', titleCase(p.batch.mode))}${kv('Status', titleCase(p.batch.status))}
      </div>` : '<div class="empty-state">Not assigned to a batch.</div>'}
      <h4 style="margin:18px 0 10px;font-size:13px;">Progress</h4>
      <div class="kv-grid">${kv('Week', `${p.personal.weekProgress} / ${p.personal.totalWeeks}`)}${kv('XP', `${p.personal.xp} / ${p.personal.xpTarget}`)}${kv('Streak', p.personal.streakDays + ' days')}</div>`)}

      ${panelOf('attendance', `<div class="stat-grid">
        <div class="stat-card ${p.attendance.percent !== null && p.attendance.percent < 75 ? 'alert' : 'good'}"><b>${p.attendance.percent ?? '—'}%</b><span>Overall</span></div>
        <div class="stat-card"><b>${p.attendance.present}</b><span>Present</span></div>
        <div class="stat-card"><b>${p.attendance.absent}</b><span>Absent</span></div>
        <div class="stat-card"><b>${p.attendance.late}</b><span>Late</span></div>
        <div class="stat-card"><b>${p.attendance.total}</b><span>Sessions</span></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Topic</th><th>Status</th><th>Note</th></tr></thead>
      <tbody>${attRows || empty(4, 'No attendance recorded.')}</tbody></table></div>`)}

      ${panelOf('fees', fee ? `<div class="stat-grid">
        <div class="stat-card"><b>${money(fee.netPayable)}</b><span>Net payable</span></div>
        <div class="stat-card good"><b>${money(fee.amountPaid)}</b><span>Paid</span></div>
        <div class="stat-card ${fee.amountPending ? 'alert' : 'good'}"><b>${money(fee.amountPending)}</b><span>Pending</span></div>
        <div class="stat-card"><b>${money(fee.discount + fee.scholarship)}</b><span>Discount + scholarship</span></div>
      </div>
      <h4 style="margin:16px 0 10px;font-size:13px;">Installments</h4>
      <div class="table-wrap"><table><thead><tr><th>Label</th><th>Amount</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
      ${fee.installments.map(i => `<tr><td>${esc(i.label)}</td><td>${money(i.amount)}</td><td>${esc(fmtDate(i.dueDate))}</td><td>${money(i.paid)}</td><td>${money(i.balance)}</td><td>${pill(i.status)}</td></tr>`).join('') || empty(6, 'No installment plan — full payment expected up front.')}
      </tbody></table></div>
      <h4 style="margin:16px 0 10px;font-size:13px;">Payment history</h4>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>
      ${fee.payments.map(pm => `<tr><td>${esc(fmtDate(pm.paidAt))}</td><td>${money(pm.amount)}</td><td>${esc(titleCase(pm.method))}</td><td class="mono">${esc(pm.reference || '—')}</td></tr>`).join('') || empty(4, 'Nothing paid yet.')}
      </tbody></table></div>` : '<div class="empty-state">No fee profile yet. Create one from Finance → Fees &amp; Payments.</div>')}

      ${panelOf('work', `<h4 style="font-size:13px;margin-bottom:10px;">Assignments</h4>
      <div class="table-wrap"><table><thead><tr><th>Assignment</th><th>Submitted</th><th>Grade</th><th>Feedback</th></tr></thead><tbody>
      ${p.assignments.map(a => `<tr><td>${esc(a.assignmentTitle)}</td><td>${esc(fmtDate(a.submittedAt))}</td><td>${a.grade != null ? esc(a.grade + ' / ' + (a.maxMarks || '—')) : '<span class="pill pending">Ungraded</span>'}</td><td class="muted">${esc(a.feedback || '')}</td></tr>`).join('') || empty(4, 'No submissions.')}
      </tbody></table></div>
      <h4 style="font-size:13px;margin:18px 0 10px;">Projects</h4>
      <div class="table-wrap"><table><thead><tr><th>Project</th><th>Status</th><th>Score</th><th>Repo</th></tr></thead><tbody>
      ${p.projects.map(pr => `<tr><td>${esc(pr.title)}</td><td>${pill(pr.status)}</td><td>${pr.score ?? '—'}</td><td class="mono">${esc(pr.repoUrl || '—')}</td></tr>`).join('') || empty(4, 'No projects.')}
      </tbody></table></div>
      <h4 style="font-size:13px;margin:18px 0 10px;">Assessments</h4>
      <div class="table-wrap"><table><thead><tr><th>Assessment</th><th>Marks</th><th>Result</th><th>Remarks</th></tr></thead><tbody>
      ${p.assessments.map(a => `<tr><td>${esc(a.assessmentTitle)}</td><td>${esc(a.marks + ' / ' + a.maxMarks)}</td><td>${a.passed ? '<span class="pill good">Passed</span>' : '<span class="pill rejected">Failed</span>'}</td><td class="muted">${esc(a.remarks || '')}</td></tr>`).join('') || empty(4, 'No assessment results.')}
      </tbody></table></div>`)}

      ${panelOf('certs', `<div class="table-wrap"><table><thead><tr><th>Serial</th><th>Type</th><th>Grade</th><th>Issued</th><th>Status</th></tr></thead><tbody>
      ${p.certificates.map(c => `<tr><td class="mono">${esc(c.serial)}</td><td>${esc(titleCase(c.type))}</td><td>${esc(c.grade || '—')}</td><td>${esc(fmtDate(c.issuedAt))}</td><td>${c.revoked ? '<span class="pill rejected">Revoked</span>' : '<span class="pill verified">Valid</span>'}</td></tr>`).join('') || empty(5, 'No certificates issued.')}
      </tbody></table></div>`)}

      ${panelOf('placement', `<div class="kv-grid" style="margin-bottom:16px;">
        ${kv('Status', titleCase(p.placement.status))}${kv('Company', p.placement.placedCompany)}${kv('Package', p.placement.placedCtc ? lakh(p.placement.placedCtc) : '—')}
      </div>
      <h4 style="font-size:13px;margin-bottom:10px;">Applications</h4>
      <div class="table-wrap"><table><thead><tr><th>Role</th><th>Company</th><th>Stage</th></tr></thead><tbody>
      ${p.placement.applications.map(a => `<tr><td>${esc(a.jobTitle)}</td><td>${esc(a.companyName)}</td><td>${pill(a.stage)}</td></tr>`).join('') || empty(3, 'No applications.')}
      </tbody></table></div>
      <h4 style="font-size:13px;margin:18px 0 10px;">Interviews</h4>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Round</th><th>Mode</th><th>Status</th><th>Result</th></tr></thead><tbody>
      ${p.placement.interviews.map(i => `<tr><td>${esc(fmtDateTime(i.scheduledAt))}</td><td>${i.round}</td><td>${esc(titleCase(i.mode))}</td><td>${pill(i.status)}</td><td>${esc(i.result || '—')}</td></tr>`).join('') || empty(5, 'No interviews.')}
      </tbody></table></div>
      <h4 style="font-size:13px;margin:18px 0 10px;">Offers</h4>
      <div class="table-wrap"><table><thead><tr><th>Role</th><th>CTC</th><th>Joining</th><th>Status</th></tr></thead><tbody>
      ${p.placement.offers.map(o => `<tr><td>${esc(o.role)}</td><td>${lakh(o.ctc)}</td><td>${esc(fmtDate(o.joiningDate))}</td><td>${pill(o.status)}</td></tr>`).join('') || empty(4, 'No offers.')}
      </tbody></table></div>`)}

      ${panelOf('docs', `<div class="doc-grid">${p.documents.map(docCard).join('') || '<div class="empty-state">No documents on file.</div>'}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:14px;" id="sdUploadDoc">+ Upload a document for ${esc(p.personal.name)}</button>`)}

      ${panelOf('comm', `<button class="btn btn-primary btn-sm" id="sdLogComm" style="margin-bottom:14px;">+ Log a conversation</button>
      <div class="timeline">${p.communication.map(c => `
        <div class="tl-item"><div class="tl-when">${esc(fmtDateTime(c.at))} · ${esc(c.byName)}</div>
        <div class="tl-what"><b>${esc(titleCase(c.channel))} (${esc(c.direction)})</b> ${esc(c.subject || '')}</div>
        <div class="tl-change">${esc(c.summary || '')}${c.outcome ? ' — ' + esc(c.outcome) : ''}</div></div>`).join('') || '<div class="empty-state">Nothing logged yet.</div>'}</div>
      <h4 style="font-size:13px;margin:18px 0 10px;">Their tickets</h4>
      ${p.queries.map(q => `<div class="thread-msg"><div class="who"><b>${esc(q.ticketNo)}</b><span>${esc(titleCase(q.status))}</span></div>${esc(q.subject)}</div>`).join('') || '<div class="empty-state">No queries raised.</div>'}`)}
    `;

    $('#sdBody').innerHTML = html;

    const upBtn = $('#sdUploadDoc');
    if (upBtn) upBtn.addEventListener('click', () => uploadDocument({ ownerType: 'student', ownerId: id, ownerName: p.personal.name }));

    const commBtn = $('#sdLogComm');
    if (commBtn) commBtn.addEventListener('click', async () => {
      const v = await openModal('Log a Conversation', [
        { key: 'channel', label: 'Channel', type: 'select', options: ['call', 'email', 'whatsapp', 'sms', 'meeting', 'note'] },
        { key: 'direction', label: 'Direction', type: 'select', options: ['outbound', 'inbound'] },
        { key: 'subject', label: 'Subject' },
        { key: 'summary', label: 'What was discussed', type: 'textarea' },
        { key: 'outcome', label: 'Outcome' },
        { key: 'followUpAt', label: 'Follow up on', type: 'date' }
      ], {});
      if (!v) return;
      await api(`/admin/students/${id}/communication`, { method: 'POST', body: v });
      toast('Logged.', 'success');
      loaders.studentProfile(id);
    });

    $('#sdBody').querySelectorAll('[data-doc-view]').forEach(el =>
      el.addEventListener('click', () => viewDocument(el.getAttribute('data-doc-view'))));
  };

  /* ======================================================================
     MENTORS
     ====================================================================== */

  loaders.mentors = async () => {
    await loadLookups();
    const mentors = await api('/admin/mentors');
    cache().mentors = mentors;

    tbody('#mentorsTable').innerHTML = mentors.length ? mentors.map(m => `
      <tr>
        <td class="strong">${esc(m.name)}</td><td>${esc(m.email)}</td>
        <td>${(m.courseNames || []).map(n => `<span class="pill info">${esc(n)}</span>`).join(' ') || '<span class="pill rejected">No access</span>'}</td>
        <td>${money(m.ratePerSession)}</td><td>${m.batchCount}</td>
        <td>${m.sessionsCompleted}</td><td>${m.sessionsPaid}</td><td>${m.sessionsPending}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-xs" data-men-edit="${esc(m.id)}">Edit</button>
          <button class="btn btn-ghost btn-xs" data-men-docs="${esc(m.id)}">Docs</button>
          <button class="btn btn-danger btn-xs" data-men-del="${esc(m.id)}">Delete</button>
        </td></tr>`).join('') : empty(9, 'No mentors yet.');

    bind('#mentorsTable', 'data-men-edit', async id => {
      const m = mentors.find(x => x.id === id);
      const v = await openModal('Edit Mentor', [
        { key: 'name', label: 'Name' }, { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone' },
        { key: 'courseIds', label: 'Course access', type: 'multiselect', options: courseOptions(),
          hint: 'This is the access control. A mentor can only be put on batches, classes and students for the courses ticked here.' },
        { key: 'ratePerSession', label: 'Rate per session (₹)', type: 'number' },
        { key: 'sessionsCompleted', label: 'Sessions completed', type: 'number' },
        { key: 'sessionsPaid', label: 'Sessions paid', type: 'number' },
        { key: 'sessionsPending', label: 'Sessions pending', type: 'number' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'] },
        { key: 'password', label: 'New password (blank keeps current)', type: 'password' }
      ], m, { validate: v => !v.courseIds.length ? 'Tick at least one course, or the mentor can access nothing.' : null });
      if (!v) return;
      ['ratePerSession', 'sessionsCompleted', 'sessionsPaid', 'sessionsPending'].forEach(k => v[k] = Number(v[k]));
      if (!v.password) delete v.password;
      try {
        await api('/admin/mentors/' + id, { method: 'PUT', body: v });
        toast('Mentor updated.', 'success'); loaders.mentors();
      } catch (e) { toast(e.message, 'error'); }
    });

    bind('#mentorsTable', 'data-men-docs', id => {
      const m = mentors.find(x => x.id === id);
      showOwnerDocuments('mentor', id, m.name);
    });

    bind('#mentorsTable', 'data-men-del', async id => {
      if (!confirmDialog('Delete this mentor account?')) return;
      await api('/admin/mentors/' + id, { method: 'DELETE' });
      loaders.mentors();
    });

    // Correction requests
    const all = [];
    mentors.forEach(m => (m.correctionRequests || []).forEach(c => all.push({ ...c, mentorName: m.name, mentorId: m.id })));
    tbody('#correctionsTable').innerHTML = all.length ? all.map(c => `
      <tr><td>${esc(c.mentorName)}</td><td>${esc(c.weekOrSession || '—')}</td><td>${esc(c.issue)}</td>
      <td class="muted">${esc(c.details || '—')}</td><td>${pill(c.status)}</td>
      <td>${c.status === 'pending' ? `<button class="btn btn-primary btn-xs" data-fix="${esc(c.mentorId)}|${esc(c.id)}">Resolve</button>` : '—'}</td></tr>`).join('')
      : empty(6, 'No correction requests.');

    bind('#correctionsTable', 'data-fix', async val => {
      const [mentorId, reqId] = val.split('|');
      const v = await openModal('Resolve Correction', [
        { key: 'status', label: 'Outcome', type: 'select', options: ['resolved', 'rejected'] },
        { key: 'adminNote', label: 'Note to the mentor', type: 'textarea' }
      ], { status: 'resolved' });
      if (!v) return;
      await api(`/admin/mentors/${mentorId}/corrections/${reqId}`, { method: 'PUT', body: v });
      toast('Correction updated.', 'success'); loaders.mentors();
    });
  };

  $('#addMentorBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('Add Mentor', [
      { key: 'name', label: 'Name' }, { key: 'email', label: 'Email', type: 'email' },
      { key: 'password', label: 'Password', type: 'password' }, { key: 'phone', label: 'Phone' },
      { key: 'courseIds', label: 'Course access', type: 'multiselect', options: courseOptions(),
        hint: 'The mentor will be locked to these courses — they cannot be assigned to any other course\'s batches or students.' },
      { key: 'ratePerSession', label: 'Rate per session (₹)', type: 'number', placeholder: '2000' }
    ], {}, {
      subtitle: 'A welcome push goes to the mentor, and the academic team is alerted.',
      validate: v => !v.name || !v.email || !v.password ? 'Name, email and password are required.'
        : !v.courseIds.length ? 'Pick at least one course — that is what controls their access.' : null
    });
    if (!v) return;
    v.ratePerSession = Number(v.ratePerSession) || 2000;
    try {
      await api('/admin/mentors', { method: 'POST', body: v });
      toast('Mentor added — welcome notification sent.', 'success');
      loaders.mentors(); refreshNotifications(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  /* ======================================================================
     EMPLOYERS
     ====================================================================== */

  loaders.employers = async () => {
    const employers = await api('/admin/employers');
    tbody('#employersTable').innerHTML = employers.length ? employers.map(e => `
      <tr><td class="strong">${esc(e.company || '—')}</td><td>${esc(e.name)}</td><td>${esc(e.email)}</td>
      <td>${(e.hiringRequests || []).length}</td><td>${pill(e.status || 'active')}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-emp-edit="${esc(e.id)}">Edit</button>
        <button class="btn btn-danger btn-xs" data-emp-del="${esc(e.id)}">Delete</button>
      </td></tr>`).join('') : empty(6, 'No employers yet.');

    bind('#employersTable', 'data-emp-edit', async id => {
      const e = employers.find(x => x.id === id);
      const v = await openModal('Edit Employer', [
        { key: 'name', label: 'Contact name' }, { key: 'company', label: 'Company' },
        { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'] }
      ], e);
      if (!v) return;
      await api('/admin/employers/' + id, { method: 'PUT', body: v });
      toast('Employer updated.', 'success'); loaders.employers();
    });
    bind('#employersTable', 'data-emp-del', async id => {
      if (!confirmDialog('Delete this employer account?')) return;
      await api('/admin/employers/' + id, { method: 'DELETE' });
      loaders.employers();
    });

    const reqs = [];
    employers.forEach(e => (e.hiringRequests || []).forEach(r => reqs.push({ ...r, company: e.company || e.name })));
    tbody('#hiringTable').innerHTML = reqs.length ? reqs.slice().reverse().map(r => `
      <tr><td>${esc(r.company)}</td><td>${esc(r.department)}</td><td>${esc(r.roleTitle || '—')}</td>
      <td>${esc(r.openings)}</td><td>${(r.matches || []).length} matched</td><td>${esc(fmtDate(r.createdAt))}</td></tr>`).join('')
      : empty(6, 'No hiring requests yet.');
  };

  $('#addEmployerBtn').addEventListener('click', async () => {
    const v = await openModal('Add Employer', [
      { key: 'name', label: 'Contact name' }, { key: 'company', label: 'Company' },
      { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone' },
      { key: 'password', label: 'Password', type: 'password' }
    ], {}, { subtitle: 'The employer gets a welcome push; the placement team is alerted.' });
    if (!v) return;
    try {
      await api('/admin/employers', { method: 'POST', body: v });
      toast('Employer added — welcome notification sent.', 'success');
      loaders.employers(); refreshNotifications(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  /* ======================================================================
     DOCUMENT REPOSITORY
     ====================================================================== */

  let DOC_TYPES = [];

  function docCard(d) {
    return `<div class="doc-card">
      ${d.sensitive ? '<span class="sensitive-tag">SENSITIVE</span>' : ''}
      <div class="doc-type">📄 ${esc(d.docLabel)}</div>
      <div class="doc-owner">${esc(d.ownerName)} · ${esc(titleCase(d.ownerType))}</div>
      ${d.numberMasked ? `<div class="doc-num">${esc(d.numberMasked)}</div>` : ''}
      <div style="margin-top:9px;">${pill(d.status)}
        ${d.expiresOn ? `<span class="pill">Expires ${esc(fmtDate(d.expiresOn))}</span>` : ''}</div>
      <div class="muted" style="font-size:11.5px;margin-top:7px;">Uploaded ${esc(timeAgo(d.uploadedAt))} by ${esc(d.uploadedByName || '—')}${d.downloadCount ? ` · viewed ${d.downloadCount}×` : ''}</div>
      ${d.rejectionReason ? `<div class="muted" style="font-size:11.5px;margin-top:5px;color:var(--red);">${esc(d.rejectionReason)}</div>` : ''}
      <div class="doc-actions">
        <button class="btn btn-ghost btn-xs" data-doc-view="${esc(d.id)}">View</button>
        ${can('repository.verify') ? `<button class="btn btn-ghost btn-xs" data-doc-verify="${esc(d.id)}">Verify</button>` : ''}
        ${can('repository.write') ? `<button class="btn btn-danger btn-xs" data-doc-del="${esc(d.id)}">Delete</button>` : ''}
      </div></div>`;
  }

  loaders.repository = async () => {
    $('#repoPrivacyNotice').innerHTML =
      '<b>How ID numbers are stored:</b> the scan itself is kept, but the number is saved only as its last four digits ' +
      'plus a one-way hash used to spot duplicates. Full Aadhaar numbers are deliberately never written to the database — ' +
      'holding them creates avoidable exposure under the Aadhaar Act and DPDP Act. Every view of a document is logged ' +
      'against the staff member who opened it.';

    if (!DOC_TYPES.length) DOC_TYPES = await api('/admin/repository/types');
    fillSelect('#docTypeFilter', DOC_TYPES.map(t => ({ id: t.key, name: t.label })), { placeholder: 'All document types' });

    const stats = await api('/admin/repository/stats/summary');
    $('#repoStats').innerHTML = `
      <div class="stat-card"><b>${stats.total}</b><span>Documents on file</span></div>
      <div class="stat-card ${stats.pending ? 'alert' : 'good'}"><b>${stats.pending}</b><span>Awaiting verification</span></div>
      <div class="stat-card good"><b>${stats.verified}</b><span>Verified</span></div>
      <div class="stat-card ${stats.rejected ? 'alert' : ''}"><b>${stats.rejected}</b><span>Rejected</span></div>
      <div class="stat-card info"><b>${stats.sensitive}</b><span>Sensitive IDs</span></div>
      <div class="stat-card ${stats.expiringSoon.length ? 'alert' : ''}"><b>${stats.expiringSoon.length}</b><span>Expiring in 60 days</span></div>`;

    const missing = [
      ...stats.studentsWithoutId.map(s => ({ ...s, type: 'student' })),
      ...stats.mentorsWithoutId.map(m => ({ ...m, type: 'mentor' }))
    ];
    $('#docMissing').innerHTML = missing.length ? missing.map(p => `
      <div class="register-row"><span class="name">${esc(p.name)} <span class="muted">· ${esc(titleCase(p.type))} · ${esc(p.email)}</span></span>
      <button class="btn btn-ghost btn-xs" data-miss="${esc(p.type)}|${esc(p.id)}|${esc(p.name)}">Upload ID</button></div>`).join('')
      : '<div class="empty-state">Everyone has at least one government ID on file.</div>';
    bind('#docMissing', 'data-miss', val => {
      const [ownerType, ownerId, ownerName] = val.split('|');
      uploadDocument({ ownerType, ownerId, ownerName });
    });

    await renderDocs();
  };

  async function renderDocs() {
    const params = new URLSearchParams();
    if ($('#docSearch').value) params.set('q', $('#docSearch').value);
    if ($('#docOwnerFilter').value) params.set('ownerType', $('#docOwnerFilter').value);
    if ($('#docTypeFilter').value) params.set('docType', $('#docTypeFilter').value);
    if ($('#docStatusFilter').value) params.set('status', $('#docStatusFilter').value);

    const docs = await api('/admin/repository?' + params);
    $('#docGrid').innerHTML = docs.length ? docs.map(docCard).join('')
      : '<div class="empty-state">No documents match that filter.</div>';

    bind('#docGrid', 'data-doc-view', id => viewDocument(id));
    bind('#docGrid', 'data-doc-verify', async id => {
      const v = await openModal('Verify Document', [
        { key: 'status', label: 'Decision', type: 'select', options: [
          { value: 'verified', label: 'Verified — matches the person' },
          { value: 'rejected', label: 'Rejected — unreadable or wrong' },
          { value: 'pending', label: 'Send back to pending' }] },
        { key: 'reason', label: 'Reason (shown to them if rejected)', type: 'textarea' }
      ], { status: 'verified' });
      if (!v) return;
      await api(`/admin/repository/${id}/verify`, { method: 'PUT', body: v });
      toast('Document ' + v.status + '.', 'success');
      loaders.repository();
    });
    bind('#docGrid', 'data-doc-del', async id => {
      if (!confirmDialog('Delete this document? The file is removed permanently — the deletion is recorded in the audit log.')) return;
      await api('/admin/repository/' + id, { method: 'DELETE' });
      toast('Document deleted.', 'success');
      loaders.repository();
    });
  }
  ['#docSearch', '#docOwnerFilter', '#docTypeFilter', '#docStatusFilter']
    .forEach(s => $(s).addEventListener('input', renderDocs));

  /**
   * Documents are behind an auth header, so they can't just be dropped into
   * an <img src>. Fetch as a blob and hand the browser an object URL.
   */
  async function viewDocument(id) {
    try {
      const res = await window.BM.authFetch(`/admin/repository/${id}/file`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open the file.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const isPdf = blob.type === 'application/pdf';
      openSheet('Document', isPdf
        ? `<iframe src="${url}" style="width:100%;height:64vh;border:1px solid var(--navy-line);border-radius:10px;"></iframe>`
        : `<img src="${url}" style="max-width:100%;border-radius:10px;border:1px solid var(--navy-line);">`,
        [{ label: 'Open in new tab', onClick: () => { window.open(url, '_blank'); return true; } }]);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function uploadDocument(prefill) {
    if (!DOC_TYPES.length) DOC_TYPES = await api('/admin/repository/types');
    await loadLookups();

    const people = prefill && prefill.ownerId ? null : [
      ...(cache().students || []).map(s => ({ value: 'student:' + s.id, label: `${s.name} (Student)` })),
      ...(cache().mentors || []).map(m => ({ value: 'mentor:' + m.id, label: `${m.name} (Mentor)` })),
      ...(cache().staff || []).map(s => ({ value: 'staff:' + s.id, label: `${s.name} (Staff)` }))
    ];

    const fields = [];
    if (people) fields.push({ key: 'owner', label: 'Person', type: 'select', options: people, placeholder: 'Choose a person' });
    fields.push(
      { key: 'docType', label: 'Document type', type: 'select', options: DOC_TYPES.map(t => ({ value: t.key, label: t.label })) },
      { key: 'number', label: 'ID number', hint: 'Only the last 4 digits are stored, plus a hash to detect duplicates.' },
      { key: 'issuedOn', label: 'Issued on', type: 'date' },
      { key: 'expiresOn', label: 'Expires on', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
      { key: 'file', label: 'Scan or photo', type: 'file', accept: 'image/*,application/pdf', hint: 'JPG, PNG, WEBP, HEIC or PDF. Max 8 MB.' }
    );

    const v = await openModal(
      prefill && prefill.ownerName ? `Upload for ${prefill.ownerName}` : 'Upload Document',
      fields, {}, {
        saveLabel: 'Upload',
        validate: v => !v.file ? 'Choose a file to upload.' : (people && !v.owner) ? 'Choose a person.' : null
      });
    if (!v) return;

    const fd = new FormData();
    if (people) {
      const [ownerType, ownerId] = v.owner.split(':');
      fd.append('ownerType', ownerType); fd.append('ownerId', ownerId);
    } else {
      fd.append('ownerType', prefill.ownerType); fd.append('ownerId', prefill.ownerId);
    }
    ['docType', 'number', 'issuedOn', 'expiresOn', 'notes'].forEach(k => { if (v[k]) fd.append(k, v[k]); });
    fd.append('file', v.file);

    try {
      await api('/admin/repository', { method: 'POST', body: fd });
      toast('Document uploaded — it is now awaiting verification.', 'success');
      if ($('#panel-repository').classList.contains('active')) loaders.repository();
      if (prefill && prefill.ownerType === 'student') loaders.studentProfile(prefill.ownerId);
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#uploadDocBtn').addEventListener('click', () => uploadDocument());

  async function showOwnerDocuments(ownerType, ownerId, name) {
    const data = await api(`/admin/repository/owner/${ownerType}/${ownerId}`);
    const missing = data.completeness.missing;
    openSheet(`${name} — Documents`, `
      ${missing.length ? `<div class="notice warn">Missing: ${esc(missing.map(titleCase).join(', '))}</div>` : '<div class="notice info">All required documents are on file.</div>'}
      <div class="doc-grid">${data.documents.map(docCard).join('') || '<div class="empty-state">Nothing uploaded yet.</div>'}</div>`,
      [{ label: 'Upload a document', cls: 'btn-primary', onClick: () => { uploadDocument({ ownerType, ownerId, ownerName: name }); } }]);
    document.querySelectorAll('[data-doc-view]').forEach(el =>
      el.addEventListener('click', () => viewDocument(el.getAttribute('data-doc-view'))));
  }

  /* ======================================================================
     COURSES
     ====================================================================== */

  loaders.courses = async () => {
    const courses = await api('/admin/academics/courses');
    cache().courses = courses;
    const batches = cache().batches || [];
    const students = cache().students || [];

    tbody('#coursesTable').innerHTML = courses.length ? courses.map(c => `
      <tr><td class="mono">${esc(c.code)}</td><td class="strong">${esc(c.name)}</td>
      <td>${money(c.fee)}</td><td>${esc(c.durationLabel || '—')}</td>
      <td>${batches.filter(b => b.courseId === c.id).length}</td>
      <td>${students.filter(s => (s.courseIds || []).includes(c.id)).length}</td>
      <td>${(c.curriculum || []).length}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-crs-edit="${esc(c.id)}">Edit</button>
        <button class="btn btn-ghost btn-xs" data-crs-curr="${esc(c.id)}">Curriculum</button>
        <button class="btn btn-danger btn-xs" data-crs-del="${esc(c.id)}">Delete</button>
      </td></tr>`).join('') : empty(8, 'No courses in the catalogue yet.');

    bind('#coursesTable', 'data-crs-edit', async id => {
      const c = courses.find(x => x.id === id);
      const v = await openModal('Edit Course', [
        { key: 'name', label: 'Name' }, { key: 'code', label: 'Short code' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'fee', label: 'Fee (₹)', type: 'number' },
        { key: 'durationLabel', label: 'Duration label' },
        { key: 'totalWeeks', label: 'Total weeks', type: 'number' },
        { key: 'active', label: 'Active', type: 'checkbox' }
      ], c);
      if (!v) return;
      v.fee = Number(v.fee); v.totalWeeks = Number(v.totalWeeks);
      await api('/admin/academics/courses/' + id, { method: 'PUT', body: v });
      toast('Course updated.', 'success'); await loadLookups(true); loaders.courses();
    });

    bind('#coursesTable', 'data-crs-curr', async id => {
      const c = courses.find(x => x.id === id);
      const v = await openModal(`${c.name} — Curriculum`, [
        { key: 'curriculum', label: 'One module per line (Week | Title | Topics)', type: 'textarea', rows: 12,
          hint: 'Example:  1 | Foundations | SEO basics, keyword research' }
      ], { curriculum: (c.curriculum || []).map(m => `${m.week} | ${m.title} | ${(m.topics || []).join(', ')}`).join('\n') }, { wide: true });
      if (!v) return;
      const curriculum = v.curriculum.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [week, title, topics] = line.split('|').map(s => (s || '').trim());
        return { week: Number(week) || null, title: title || line, topics: topics ? topics.split(',').map(t => t.trim()) : [] };
      });
      await api(`/admin/academics/courses/${id}/curriculum`, { method: 'PUT', body: { curriculum } });
      toast('Curriculum saved.', 'success'); loaders.courses();
    });

    bind('#coursesTable', 'data-crs-del', async id => {
      if (!confirmDialog('Delete this course?')) return;
      try {
        await api('/admin/academics/courses/' + id, { method: 'DELETE' });
        toast('Course deleted.', 'success'); await loadLookups(true); loaders.courses();
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  $('#addCourseCatBtn').addEventListener('click', async () => {
    const v = await openModal('Add Course', [
      { key: 'name', label: 'Name' }, { key: 'code', label: 'Short code' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'fee', label: 'Fee (₹)', type: 'number' },
      { key: 'durationLabel', label: 'Duration label', placeholder: '20 Weeks' },
      { key: 'totalWeeks', label: 'Total weeks', type: 'number', placeholder: '20' }
    ], {}, { validate: v => !v.name ? 'A course name is required.' : null });
    if (!v) return;
    await api('/admin/academics/courses', { method: 'POST', body: v });
    toast('Course added.', 'success'); await loadLookups(true); loaders.courses();
  });

  /* ======================================================================
     BATCHES
     ====================================================================== */

  loaders.batches = async () => {
    await loadLookups(true);
    const batches = cache().batches;

    tbody('#batchesTable').innerHTML = batches.length ? batches.map(b => `
      <tr><td class="strong">${esc(b.name)}</td><td>${esc(b.courseName)}</td>
      <td class="nowrap">${esc(fmtDate(b.startDate))} → ${esc(fmtDate(b.endDate))}</td>
      <td>${esc(b.trainerName || '—')}</td>
      <td>${(b.mentorNames || []).join(', ') || '<span class="muted">—</span>'}</td>
      <td>${esc(b.classTiming || '—')}</td><td>${esc((b.days || []).join(', ') || '—')}</td>
      <td>${pill(b.mode)}</td><td>${b.studentCount}/${b.capacity}</td><td>${pill(b.status)}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-bat-edit="${esc(b.id)}">Edit</button>
        <button class="btn btn-ghost btn-xs" data-bat-roster="${esc(b.id)}">Roster</button>
        <button class="btn btn-danger btn-xs" data-bat-del="${esc(b.id)}">Delete</button>
      </td></tr>`).join('') : empty(11, 'No batches yet.');

    bind('#batchesTable', 'data-bat-edit', id => batchForm(batches.find(b => b.id === id)));
    bind('#batchesTable', 'data-bat-del', async id => {
      if (!confirmDialog('Delete this batch? Students on it will be unassigned.')) return;
      await api('/admin/academics/batches/' + id, { method: 'DELETE' });
      toast('Batch deleted.', 'success'); loaders.batches();
    });

    bind('#batchesTable', 'data-bat-roster', async id => {
      const b = batches.find(x => x.id === id);
      const detail = await api('/admin/academics/batches/' + id);
      const eligible = (cache().students || []).filter(s => (s.courseIds || []).includes(b.courseId));
      const v = await openModal(`${b.name} — Roster`, [
        { key: 'studentIds', label: `Students on this batch (capacity ${b.capacity})`, type: 'multiselect',
          options: eligible.map(s => ({ value: s.id, label: `${s.name} — ${s.email}` })),
          hint: 'Only students enrolled on ' + b.courseName + ' are listed.' }
      ], { studentIds: detail.students.map(s => s.id) }, { wide: true });
      if (!v) return;
      try {
        await api(`/admin/academics/batches/${id}/students`, { method: 'PUT', body: v });
        toast('Roster updated.', 'success'); loaders.batches();
      } catch (e) { toast(e.message, 'error'); }
    });
  };

  async function batchForm(existing) {
    await loadLookups();
    const trainers = (cache().staff || []).filter(s => ['trainer', 'academic_manager', 'super_admin'].includes(s.role));
    const mentors = cache().mentors || [];

    const v = await openModal(existing ? 'Edit Batch' : 'Create Batch', [
      { key: 'name', label: 'Batch name', placeholder: 'DM-Sep-2026-Evening' },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End date', type: 'date' },
      { key: 'trainerId', label: 'Trainer', type: 'select', options: trainers.map(t => ({ value: t.id, label: t.name })), placeholder: 'Assign later' },
      { key: 'mentorIds', label: 'Mentors', type: 'multiselect',
        options: mentors.map(m => ({ value: m.id, label: `${m.name} — ${(m.courseNames || []).join(', ') || 'no course'}` })),
        hint: 'A mentor can only be added if the batch course is one they are approved for. Change their approval on the Mentors page.' },
      { key: 'classTiming', label: 'Class timing', placeholder: '7:00 PM – 9:00 PM' },
      { key: 'days', label: 'Days', placeholder: 'Mon, Wed, Fri' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['online', 'classroom', 'hybrid'] },
      { key: 'classroom', label: 'Classroom / room' },
      { key: 'capacity', label: 'Capacity', type: 'number', placeholder: '30' },
      { key: 'status', label: 'Status', type: 'select', options: ['upcoming', 'ongoing', 'completed', 'cancelled'] }
    ], existing ? { ...existing, days: (existing.days || []).join(', ') } : { mode: 'online', status: 'upcoming' }, {
      validate: v => !v.name ? 'A batch name is required.' : !v.courseId ? 'Pick a course.' : null
    });
    if (!v) return;

    const body = { ...v, days: v.days ? v.days.split(',').map(d => d.trim()).filter(Boolean) : [], capacity: Number(v.capacity) || 30 };
    try {
      if (existing) await api('/admin/academics/batches/' + existing.id, { method: 'PUT', body });
      else await api('/admin/academics/batches', { method: 'POST', body });
      toast('Batch saved.', 'success');
      await loadLookups(true); loaders.batches();
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#addBatchBtn').addEventListener('click', () => batchForm(null));

  /* ======================================================================
     CLASSES
     ====================================================================== */

  loaders.classes = async () => {
    await loadLookups();
    fillSelect('#classBatchFilter', cache().batches, { placeholder: 'All batches' });
    await renderClasses();
  };

  async function renderClasses() {
    const params = new URLSearchParams();
    if ($('#classBatchFilter').value) params.set('batchId', $('#classBatchFilter').value);
    if ($('#classStatusFilter').value) params.set('status', $('#classStatusFilter').value);
    const list = await api('/admin/academics/classes?' + params);

    tbody('#classesTable').innerHTML = list.length ? list.map(c => `
      <tr><td class="nowrap">${esc(fmtDateTime(c.startsAt))}</td>
      <td class="strong">${esc(c.topic)}</td><td>${esc(c.batchName)}</td>
      <td>${esc(c.trainerName || '—')}</td><td>${pill(c.mode)}</td>
      <td>${c.meetingLink ? `<a href="${esc(c.meetingLink)}" target="_blank" rel="noopener">Join ↗</a>` : '<span class="muted">—</span>'}
        ${c.recordingUrl ? ` · <a href="${esc(c.recordingUrl)}" target="_blank" rel="noopener">Recording ↗</a>` : ''}</td>
      <td>${c.attendanceMarked ? '<span class="pill verified">Marked</span>' : '<span class="pill pending">Not marked</span>'}</td>
      <td>${pill(c.status)}</td>
      <td class="row-actions">
        <button class="btn btn-primary btn-xs" data-cls-att="${esc(c.id)}">Attendance</button>
        <button class="btn btn-ghost btn-xs" data-cls-edit="${esc(c.id)}">Edit</button>
        <button class="btn btn-ghost btn-xs" data-cls-remind="${esc(c.id)}">Remind</button>
        <button class="btn btn-ghost btn-xs" data-cls-move="${esc(c.id)}">Reschedule</button>
        <button class="btn btn-danger btn-xs" data-cls-cancel="${esc(c.id)}">Cancel</button>
      </td></tr>`).join('') : empty(9, 'No classes scheduled.');

    bind('#classesTable', 'data-cls-att', id => markAttendance(list.find(c => c.id === id)));
    bind('#classesTable', 'data-cls-edit', id => classForm(list.find(c => c.id === id)));

    bind('#classesTable', 'data-cls-remind', async id => {
      const r = await api(`/admin/academics/classes/${id}/reminders`, { method: 'POST' });
      toast(`Reminder sent to ${r.sent} student(s).`, 'success');
    });

    bind('#classesTable', 'data-cls-move', async id => {
      const v = await openModal('Reschedule Class', [
        { key: 'startsAt', label: 'New start', type: 'datetime-local' },
        { key: 'endsAt', label: 'New end', type: 'datetime-local' },
        { key: 'reason', label: 'Reason (sent to students)', type: 'textarea', rows: 2 }
      ], {}, { validate: v => !v.startsAt ? 'Pick a new start time.' : null });
      if (!v) return;
      await api(`/admin/academics/classes/${id}/reschedule`, { method: 'POST', body: v });
      toast('Class rescheduled and students notified.', 'success'); renderClasses();
    });

    bind('#classesTable', 'data-cls-cancel', async id => {
      const v = await openModal('Cancel Class', [{ key: 'reason', label: 'Reason (sent to students)', type: 'textarea' }], {});
      if (!v) return;
      await api(`/admin/academics/classes/${id}/cancel`, { method: 'POST', body: v });
      toast('Class cancelled and students notified.', 'success'); renderClasses();
    });
  }
  ['#classBatchFilter', '#classStatusFilter'].forEach(s => $(s).addEventListener('change', renderClasses));

  async function classForm(existing) {
    await loadLookups();
    const trainers = (cache().staff || []).filter(s => ['trainer', 'academic_manager', 'super_admin'].includes(s.role));
    const v = await openModal(existing ? 'Edit Class' : 'Schedule Class', [
      { key: 'batchId', label: 'Batch', type: 'select', options: batchOptions() },
      { key: 'topic', label: 'Topic' },
      { key: 'startsAt', label: 'Starts', type: 'datetime-local' },
      { key: 'endsAt', label: 'Ends', type: 'datetime-local' },
      { key: 'trainerId', label: 'Trainer', type: 'select', options: trainers.map(t => ({ value: t.id, label: t.name })), placeholder: 'Batch default' },
      { key: 'meetingLink', label: 'Meeting link', placeholder: 'https://meet.google.com/…' },
      { key: 'recordingUrl', label: 'Recording URL (after the class)' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['online', 'classroom', 'hybrid'] },
      { key: 'room', label: 'Room' },
      { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'rescheduled', 'cancelled'] }
    ], existing ? {
      ...existing,
      startsAt: existing.startsAt ? existing.startsAt.slice(0, 16) : '',
      endsAt: existing.endsAt ? existing.endsAt.slice(0, 16) : ''
    } : { mode: 'online' }, {
      subtitle: existing ? '' : 'Scheduling notifies every student on the batch.',
      validate: v => !v.batchId ? 'Pick a batch.' : !v.startsAt ? 'Pick a start time.' : null
    });
    if (!v) return;
    try {
      if (existing) await api('/admin/academics/classes/' + existing.id, { method: 'PUT', body: v });
      else await api('/admin/academics/classes', { method: 'POST', body: v });
      toast('Class saved.', 'success'); renderClasses();
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#addClassBtn').addEventListener('click', () => classForm(null));

  async function markAttendance(session) {
    const detail = await api('/admin/academics/batches/' + session.batchId);
    const existing = await api('/admin/academics/attendance?sessionId=' + session.id);
    const byStudent = {};
    existing.forEach(a => byStudent[a.studentId] = a.status);

    if (!detail.students.length) return toast('No students on this batch yet.', 'error');

    const rows = detail.students.map(s => `
      <div class="register-row" data-student="${esc(s.id)}">
        <span class="name">${esc(s.name)}</span>
        <div class="att-opts">
          ${['present', 'absent', 'late', 'excused'].map(v =>
            `<button class="att-opt ${(byStudent[s.id] || 'present') === v ? 'sel' : ''}" data-v="${v}">${titleCase(v)}</button>`).join('')}
        </div>
      </div>`).join('');

    const sheet = openSheet(`Attendance — ${session.topic}`, `
      <div class="muted" style="margin-bottom:12px;">${esc(fmtDateTime(session.startsAt))} · ${esc(session.batchName)}</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-ghost btn-sm" data-all="present">Mark all present</button>
        <button class="btn btn-ghost btn-sm" data-all="absent">Mark all absent</button>
      </div>
      ${rows}
      <div class="notice info" style="margin-top:14px;">Anyone whose attendance drops below the threshold in Settings gets a Low Attendance alert automatically.</div>`,
      [{ label: 'Save register', cls: 'btn-primary', onClick: async overlay => {
        const records = Array.from(overlay.querySelectorAll('[data-student]')).map(row => ({
          studentId: row.dataset.student,
          status: (row.querySelector('.att-opt.sel') || {}).dataset?.v || 'present'
        }));
        await api('/admin/academics/attendance', { method: 'POST', body: { sessionId: session.id, records } });
        toast('Attendance saved.', 'success'); renderClasses();
      } }]);

    sheet.overlay.querySelectorAll('.att-opt').forEach(btn => btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('.att-opt').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    }));
    sheet.overlay.querySelectorAll('[data-all]').forEach(btn => btn.addEventListener('click', () => {
      const v = btn.dataset.all;
      sheet.overlay.querySelectorAll('[data-student]').forEach(row => {
        row.querySelectorAll('.att-opt').forEach(b => b.classList.toggle('sel', b.dataset.v === v));
      });
    }));
  }

  /* ======================================================================
     COURSEWORK
     ====================================================================== */

  loaders.coursework = async () => { await loadAssignments(); };
  loaders['tab:cw'] = async which => {
    if (which === 'assignments') loadAssignments();
    if (which === 'projects') loadProjects();
    if (which === 'assessments') loadAssessments();
  };

  async function loadAssignments() {
    const list = await api('/admin/academics/assignments');
    tbody('#assignmentsTable').innerHTML = list.length ? list.map(a => `
      <tr><td class="strong">${esc(a.title)}</td><td>${esc(a.courseName)}</td><td>${a.week || '—'}</td>
      <td>${esc(fmtDate(a.dueDate))}</td><td>${a.maxMarks}</td><td>${a.submissionCount}</td><td>${a.gradedCount}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-asg-sub="${esc(a.id)}">Submissions</button>
        <button class="btn btn-danger btn-xs" data-asg-del="${esc(a.id)}">Delete</button>
      </td></tr>`).join('') : empty(8, 'No assignments yet.');

    bind('#assignmentsTable', 'data-asg-del', async id => {
      if (!confirmDialog('Delete this assignment and its submissions?')) return;
      await api('/admin/academics/assignments/' + id, { method: 'DELETE' });
      loadAssignments();
    });

    bind('#assignmentsTable', 'data-asg-sub', async id => {
      const subs = await api('/admin/academics/submissions?assignmentId=' + id);
      const a = list.find(x => x.id === id);
      openSheet(`${a.title} — Submissions`, `<div class="table-wrap"><table>
        <thead><tr><th>Student</th><th>Submitted</th><th>Grade</th><th></th></tr></thead><tbody>
        ${subs.map(s => `<tr><td>${esc(s.studentName)}</td><td>${esc(fmtDateTime(s.submittedAt))}</td>
          <td>${s.grade != null ? esc(s.grade + ' / ' + a.maxMarks) : '<span class="pill pending">Ungraded</span>'}</td>
          <td><button class="btn btn-ghost btn-xs" data-grade="${esc(s.id)}">Grade</button></td></tr>`).join('')
          || empty(4, 'Nothing submitted yet.')}
        </tbody></table></div>`);
      document.querySelectorAll('[data-grade]').forEach(btn => btn.addEventListener('click', async () => {
        const v = await openModal('Grade Submission', [
          { key: 'grade', label: `Marks (out of ${a.maxMarks})`, type: 'number' },
          { key: 'feedback', label: 'Feedback', type: 'textarea' }
        ], {});
        if (!v) return;
        await api(`/admin/academics/submissions/${btn.dataset.grade}/grade`, { method: 'PUT', body: v });
        toast('Graded — the student has been notified.', 'success');
      }));
    });
  }

  $('#addAssignmentBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('New Assignment', [
      { key: 'title', label: 'Title' },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'batchId', label: 'Batch (optional)', type: 'select', options: batchOptions(), placeholder: 'All batches on the course' },
      { key: 'description', label: 'Brief', type: 'textarea' },
      { key: 'week', label: 'Week number', type: 'number' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'maxMarks', label: 'Max marks', type: 'number', placeholder: '100' }
    ], {}, { validate: v => !v.title || !v.courseId ? 'Title and course are required.' : null });
    if (!v) return;
    await api('/admin/academics/assignments', { method: 'POST', body: v });
    toast('Assignment created — students notified.', 'success');
    loadAssignments();
  });

  async function loadProjects() {
    const list = await api('/admin/academics/projects');
    tbody('#projectsTable').innerHTML = list.length ? list.map(p => `
      <tr><td class="strong">${esc(p.title)}</td><td>${esc(p.studentName)}</td><td>${esc(fmtDate(p.dueDate))}</td>
      <td class="mono">${esc((p.repoUrl || '—').slice(0, 34))}</td><td>${pill(p.status)}</td><td>${p.score ?? '—'}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-prj-edit="${esc(p.id)}">Review</button>
        <button class="btn btn-danger btn-xs" data-prj-del="${esc(p.id)}">Delete</button>
      </td></tr>`).join('') : empty(7, 'No projects yet.');

    bind('#projectsTable', 'data-prj-edit', async id => {
      const p = list.find(x => x.id === id);
      const v = await openModal('Review Project', [
        { key: 'status', label: 'Status', type: 'select', options: ['in_progress', 'submitted', 'reviewed', 'approved'] },
        { key: 'score', label: 'Score', type: 'number' },
        { key: 'feedback', label: 'Feedback', type: 'textarea' },
        { key: 'repoUrl', label: 'Repository URL' }, { key: 'liveUrl', label: 'Live URL' }
      ], p);
      if (!v) return;
      await api('/admin/academics/projects/' + id, { method: 'PUT', body: { ...v, score: v.score ? Number(v.score) : null } });
      toast('Project updated.', 'success'); loadProjects();
    });
    bind('#projectsTable', 'data-prj-del', async id => {
      if (!confirmDialog('Delete this project?')) return;
      await api('/admin/academics/projects/' + id, { method: 'DELETE' });
      loadProjects();
    });
  }

  $('#addProjectBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('New Project', [
      { key: 'title', label: 'Title' },
      { key: 'studentId', label: 'Student', type: 'select', options: studentOptions() },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions(), placeholder: 'Not course-specific' },
      { key: 'description', label: 'Brief', type: 'textarea' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'repoUrl', label: 'Repository URL' }
    ], {}, { validate: v => !v.title || !v.studentId ? 'Title and student are required.' : null });
    if (!v) return;
    await api('/admin/academics/projects', { method: 'POST', body: v });
    toast('Project created.', 'success'); loadProjects();
  });

  async function loadAssessments() {
    const list = await api('/admin/academics/assessments');
    tbody('#assessmentsTable').innerHTML = list.length ? list.map(a => `
      <tr><td class="strong">${esc(a.title)}</td><td>${esc(a.courseName)}</td><td>${esc(titleCase(a.type))}</td>
      <td>${esc(fmtDateTime(a.scheduledAt))}</td><td>${a.maxMarks}</td><td>${a.passMarks}</td><td>${a.attempts}</td>
      <td><button class="btn btn-ghost btn-xs" data-ass-res="${esc(a.id)}">Record results</button></td></tr>`).join('')
      : empty(8, 'No assessments yet.');

    bind('#assessmentsTable', 'data-ass-res', async id => {
      const a = list.find(x => x.id === id);
      const students = (cache().students || []).filter(s => (s.courseIds || []).includes(a.courseId));
      if (!students.length) return toast('No students on that course yet.', 'error');
      const existing = await api('/admin/academics/assessment-results?assessmentId=' + id);
      const by = {}; existing.forEach(r => by[r.studentId] = r.marks);

      const sheet = openSheet(`${a.title} — Results`, `
        <div class="muted" style="margin-bottom:12px;">Out of ${a.maxMarks}, pass mark ${a.passMarks}</div>
        ${students.map(s => `<div class="register-row" data-rs="${esc(s.id)}">
          <span class="name">${esc(s.name)}</span>
          <input type="number" style="width:110px;" value="${by[s.id] ?? ''}" placeholder="Marks">
        </div>`).join('')}`,
        [{ label: 'Save results', cls: 'btn-primary', onClick: async overlay => {
          const results = Array.from(overlay.querySelectorAll('[data-rs]'))
            .map(r => ({ studentId: r.dataset.rs, marks: Number(r.querySelector('input').value) || 0 }));
          await api('/admin/academics/assessment-results', { method: 'POST', body: { assessmentId: id, results } });
          toast('Results recorded.', 'success'); loadAssessments();
        } }]);
      return sheet;
    });
  }

  $('#addAssessmentBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('New Assessment', [
      { key: 'title', label: 'Title' },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'batchId', label: 'Batch', type: 'select', options: batchOptions(), placeholder: 'All batches' },
      { key: 'type', label: 'Type', type: 'select', options: ['quiz', 'midterm', 'final', 'mock_interview', 'practical'] },
      { key: 'scheduledAt', label: 'Scheduled for', type: 'datetime-local' },
      { key: 'maxMarks', label: 'Max marks', type: 'number', placeholder: '100' },
      { key: 'passMarks', label: 'Pass marks', type: 'number', placeholder: '40' },
      { key: 'durationMinutes', label: 'Duration (minutes)', type: 'number', placeholder: '60' }
    ], {}, { validate: v => !v.title || !v.courseId ? 'Title and course are required.' : null });
    if (!v) return;
    await api('/admin/academics/assessments', { method: 'POST', body: v });
    toast('Assessment created.', 'success'); loadAssessments();
  });

  /* ======================================================================
     CERTIFICATES
     ====================================================================== */

  loaders.certificates = async () => {
    const list = await api('/admin/academics/certificates');
    tbody('#certsTable').innerHTML = list.length ? list.map(c => `
      <tr><td class="mono">${esc(c.serial)}</td><td class="strong">${esc(c.studentName)}</td><td>${esc(c.courseName)}</td>
      <td>${esc(titleCase(c.type))}</td><td>${esc(c.grade || '—')}</td><td>${esc(fmtDate(c.issuedAt))}</td>
      <td>${c.revoked ? '<span class="pill rejected">Revoked</span>' : '<span class="pill verified">Valid</span>'}</td>
      <td>${c.revoked ? '' : `<button class="btn btn-danger btn-xs" data-cert-rev="${esc(c.id)}">Revoke</button>`}</td></tr>`).join('')
      : empty(8, 'No certificates issued yet.');

    bind('#certsTable', 'data-cert-rev', async id => {
      const v = await openModal('Revoke Certificate', [{ key: 'reason', label: 'Reason', type: 'textarea' }], {});
      if (!v) return;
      await api(`/admin/academics/certificates/${id}/revoke`, { method: 'POST', body: v });
      toast('Certificate revoked.', 'success'); loaders.certificates();
    });
  };

  $('#issueCertBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('Issue Certificate', [
      { key: 'studentId', label: 'Student', type: 'select', options: studentOptions() },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'type', label: 'Type', type: 'select', options: ['completion', 'excellence', 'participation', 'internship'] },
      { key: 'grade', label: 'Grade' },
      { key: 'fileUrl', label: 'PDF URL (optional)' }
    ], {}, { validate: v => !v.studentId ? 'Pick a student.' : null });
    if (!v) return;
    await api('/admin/academics/certificates', { method: 'POST', body: v });
    toast('Certificate issued.', 'success'); loaders.certificates();
  });

  /* ======================================================================
     FINANCE
     ====================================================================== */

  let feeData = [];

  loaders.finance = async () => {
    await loadLookups();
    const d = await api('/admin/finance/dashboard');
    $('#financeStats').innerHTML = `
      <div class="stat-card"><b>${money(d.totalBilled)}</b><span>Total billed</span></div>
      <div class="stat-card good"><b>${money(d.collected)}</b><span>Collected</span></div>
      <div class="stat-card ${d.outstanding ? 'alert' : 'good'}"><b>${money(d.outstanding)}</b><span>Outstanding</span></div>
      <div class="stat-card info"><b>${money(d.collectedThisMonth)}</b><span>This month</span></div>
      <div class="stat-card"><b>${money(d.discounted)}</b><span>Discounts given</span></div>
      <div class="stat-card ${d.overdueStudents ? 'alert' : 'good'}"><b>${d.overdueStudents}</b><span>Students overdue</span></div>
      <div class="stat-card good"><b>${d.clearedStudents}</b><span>Fully paid</span></div>`;

    feeData = await api('/admin/finance/fee-profiles');
    renderFees();

    const payments = await api('/admin/finance/payments');
    tbody('#paymentsTable').innerHTML = payments.length ? payments.slice(0, 40).map(p => `
      <tr><td class="nowrap">${esc(fmtDate(p.paidAt))}</td><td>${esc(p.studentName)}</td>
      <td class="strong">${money(p.amount)}</td><td>${esc(titleCase(p.method))}</td>
      <td class="mono">${esc(p.reference || '—')}</td><td>${pill(p.status)}</td>
      <td>${p.status === 'success' ? `<button class="btn btn-danger btn-xs" data-pay-rev="${esc(p.id)}">Reverse</button>` : ''}</td></tr>`).join('')
      : empty(7, 'No payments recorded.');

    bind('#paymentsTable', 'data-pay-rev', async id => {
      const v = await openModal('Reverse Payment', [{ key: 'reason', label: 'Reason', type: 'textarea' }], {}, {
        notice: 'The payment is marked reversed, not deleted — the original entry stays in the audit trail.',
        noticeType: 'warn'
      });
      if (!v) return;
      await api(`/admin/finance/payments/${id}/reverse`, { method: 'POST', body: v });
      toast('Payment reversed.', 'success'); loaders.finance();
    });
  };

  function renderFees() {
    const q = ($('#feeSearch').value || '').toLowerCase();
    const st = $('#feeStatusFilter').value;
    const rows = feeData.filter(f => !q || f.studentName.toLowerCase().includes(q)).filter(f => !st || f.status === st);

    tbody('#feeTable').innerHTML = rows.length ? rows.map(f => `
      <tr><td class="strong">${esc(f.studentName)}</td><td>${esc(f.courseName)}</td>
      <td>${money(f.courseFee)}</td><td>${money(f.discount + f.scholarship)}</td><td>${money(f.netPayable)}</td>
      <td class="good">${money(f.amountPaid)}</td><td class="${f.amountPending ? 'strong' : ''}">${money(f.amountPending)}</td>
      <td>${f.installments.length ? `${f.installments.filter(i => i.status === 'paid').length}/${f.installments.length}${f.overdueCount ? ` <span class="pill overdue">${f.overdueCount} overdue</span>` : ''}` : '<span class="muted">Lump sum</span>'}</td>
      <td>${pill(f.status)}</td>
      <td class="row-actions">
        <button class="btn btn-primary btn-xs" data-fee-pay="${esc(f.id)}">Record payment</button>
        <button class="btn btn-ghost btn-xs" data-fee-edit="${esc(f.id)}">Edit plan</button>
      </td></tr>`).join('') : empty(10, 'No fee profiles yet.');

    bind('#feeTable', 'data-fee-pay', async id => {
      const f = feeData.find(x => x.id === id);
      if (f.amountPending <= 0) return toast('This student has already paid in full.', 'error');
      const v = await openModal(`Record Payment — ${f.studentName}`, [
        { key: 'amount', label: `Amount (pending ${money(f.amountPending)})`, type: 'number' },
        { key: 'installmentId', label: 'Against installment', type: 'select',
          options: f.installments.filter(i => i.status !== 'paid').map(i => ({ value: i.id, label: `${i.label} — ${money(i.balance)} due ${fmtDate(i.dueDate)}` })),
          placeholder: 'Apply to the oldest unpaid installment' },
        { key: 'method', label: 'Method', type: 'select', options: ['upi', 'card', 'netbanking', 'neft', 'cash', 'cheque', 'gateway'] },
        { key: 'reference', label: 'Transaction reference' },
        { key: 'paidAt', label: 'Paid on', type: 'date' },
        { key: 'note', label: 'Note' }
      ], {}, { subtitle: 'An invoice is generated automatically and the student is notified.',
        validate: v => !v.amount || Number(v.amount) <= 0 ? 'Enter an amount.' : null });
      if (!v) return;
      try {
        const r = await api('/admin/finance/payments', { method: 'POST', body: { ...v, feeProfileId: id, amount: Number(v.amount) } });
        toast(`Payment recorded. Invoice ${r.invoice.number} generated.`, 'success');
        loaders.finance();
      } catch (e) { toast(e.message, 'error'); }
    });

    bind('#feeTable', 'data-fee-edit', async id => {
      const f = feeData.find(x => x.id === id);
      const v = await openModal(`Fee Plan — ${f.studentName}`, [
        { key: 'courseFee', label: 'Course fee (₹)', type: 'number' },
        { key: 'discount', label: 'Discount (₹)', type: 'number' },
        { key: 'scholarship', label: 'Scholarship (₹)', type: 'number' },
        { key: 'discountReason', label: 'Reason for discount' },
        { key: 'installments', label: 'Installments — one per line: Label | Amount | YYYY-MM-DD', type: 'textarea', rows: 6,
          hint: 'Leave blank for a single lump-sum payment.' }
      ], {
        ...f,
        installments: f.installments.map(i => `${i.label} | ${i.amount} | ${i.dueDate || ''}`).join('\n')
      }, { notice: 'Changing a fee is written to the audit log with the old and new values.', noticeType: 'warn' });
      if (!v) return;
      const installments = v.installments.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [label, amount, dueDate] = line.split('|').map(s => (s || '').trim());
        return { label: label || 'Installment', amount: Number(amount) || 0, dueDate: dueDate || null };
      });
      await api('/admin/finance/fee-profiles/' + id, { method: 'PUT', body: {
        courseFee: Number(v.courseFee), discount: Number(v.discount), scholarship: Number(v.scholarship),
        discountReason: v.discountReason, installments
      } });
      toast('Fee plan updated.', 'success'); loaders.finance();
    });
  }
  ['#feeSearch', '#feeStatusFilter'].forEach(s => $(s).addEventListener('input', renderFees));

  $('#addFeeProfileBtn').addEventListener('click', async () => {
    await loadLookups();
    const v = await openModal('Create Fee Profile', [
      { key: 'studentId', label: 'Student', type: 'select', options: studentOptions() },
      { key: 'courseId', label: 'Course', type: 'select', options: courseOptions() },
      { key: 'courseFee', label: 'Course fee (₹)', type: 'number' },
      { key: 'discount', label: 'Discount (₹)', type: 'number' },
      { key: 'scholarship', label: 'Scholarship (₹)', type: 'number' },
      { key: 'discountReason', label: 'Reason for discount' },
      { key: 'installments', label: 'Installments — Label | Amount | YYYY-MM-DD', type: 'textarea', rows: 5 }
    ], {}, { validate: v => !v.studentId ? 'Pick a student.' : null });
    if (!v) return;
    const installments = (v.installments || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [label, amount, dueDate] = line.split('|').map(s => (s || '').trim());
      return { label: label || 'Installment', amount: Number(amount) || 0, dueDate: dueDate || null };
    });
    try {
      await api('/admin/finance/fee-profiles', { method: 'POST', body: { ...v, courseFee: Number(v.courseFee) || 0, discount: Number(v.discount) || 0, scholarship: Number(v.scholarship) || 0, installments } });
      toast('Fee profile created.', 'success'); loaders.finance();
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#sweepOverdueBtn').addEventListener('click', async () => {
    const r = await api('/admin/finance/sweep-overdue', { method: 'POST' });
    toast(r.alertsRaised ? `${r.alertsRaised} overdue alert(s) raised.` : 'Nothing newly overdue.', 'success');
    refreshNotifications(true); loaders.finance();
  });

  /* ======================================================================
     INVOICES
     ====================================================================== */

  loaders.invoices = async () => {
    const list = await api('/admin/finance/invoices');
    tbody('#invoicesTable').innerHTML = list.length ? list.map(i => `
      <tr><td class="mono strong">${esc(i.number)}</td><td>${esc(i.studentName)}</td><td>${esc(i.courseName)}</td>
      <td>${money(i.taxableValue)}</td><td>${money(i.gstAmount)} <span class="muted">(${i.gstPercent}%)</span></td>
      <td class="strong">${money(i.total)}</td><td>${esc(fmtDate(i.issuedAt))}</td>
      <td><button class="btn btn-ghost btn-xs" data-inv="${esc(i.id)}">View</button></td></tr>`).join('')
      : empty(8, 'No invoices yet — they are created automatically when you record a payment.');

    bind('#invoicesTable', 'data-inv', async id => {
      const { invoice, company } = await api('/admin/finance/invoices/' + id);
      openSheet('Invoice ' + invoice.number, `
        <div class="kv-grid">
          <div class="kv"><label>From</label><b>${esc(company.companyName)}<br>${esc(company.address || '')}</b></div>
          <div class="kv"><label>Billed to</label><b>${esc(invoice.studentName)}<br>${esc(invoice.studentEmail)}</b></div>
          <div class="kv"><label>Issued</label><b>${esc(fmtDate(invoice.issuedAt))}</b></div>
          <div class="kv"><label>GSTIN</label><b>${esc(invoice.gstin || '—')}</b></div>
        </div>
        <div class="table-wrap" style="margin-top:16px;"><table>
          <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody>
          ${invoice.lineItems.map(l => `<tr><td>${esc(l.description)}</td><td class="right">${money(l.amount)}</td></tr>`).join('')}
          <tr><td class="right muted">Taxable value</td><td class="right">${money(invoice.taxableValue)}</td></tr>
          <tr><td class="right muted">GST @ ${invoice.gstPercent}%</td><td class="right">${money(invoice.gstAmount)}</td></tr>
          <tr><td class="right strong">Total</td><td class="right strong">${money(invoice.total)}</td></tr>
        </tbody></table></div>`,
        [{ label: 'Print', onClick: () => { window.print(); return true; } }]);
    });
  };

  /* ======================================================================
     PLACEMENT
     ====================================================================== */

  loaders.placement = async () => {
    const d = await api('/admin/placement/dashboard');
    $('#placementStats').innerHTML = `
      <div class="stat-card"><b>${d.placementReady}</b><span>Placement ready</span></div>
      <div class="stat-card info"><b>${d.applying}</b><span>Applying</span></div>
      <div class="stat-card info"><b>${d.interviewing}</b><span>Interviewing</span></div>
      <div class="stat-card good"><b>${d.placed}</b><span>Placed</span></div>
      <div class="stat-card"><b>${d.placementRate}%</b><span>Placement rate</span></div>
      <div class="stat-card"><b>${lakh(d.averageSalary)}</b><span>Average package</span></div>
      <div class="stat-card good"><b>${lakh(d.highestSalary)}</b><span>Highest package</span></div>
      <div class="stat-card"><b>${d.offersOut}</b><span>Offers pending</span></div>`;

    const apps = await api('/admin/placement/applications');
    const stages = ['applied', 'shortlisted', 'interviewing', 'offered', 'placed', 'rejected'];
    $('#placementKanban').innerHTML = stages.map(st => {
      const inStage = apps.filter(a => a.stage === st);
      return `<div class="kan-col"><h4>${titleCase(st)}<span>${inStage.length}</span></h4>
        ${inStage.map(a => `<div class="kan-card" data-app="${esc(a.id)}">
          <b>${esc(a.studentName)}</b><small>${esc(a.jobTitle)} · ${esc(a.companyName)}</small></div>`).join('')
          || '<div class="muted" style="font-size:12px;">—</div>'}</div>`;
    }).join('');

    bind('#placementKanban', 'data-app', async id => {
      const a = apps.find(x => x.id === id);
      const v = await openModal(`${a.studentName} → ${a.jobTitle}`, [
        { key: 'stage', label: 'Move to stage', type: 'select', options: stages.concat(['withdrawn']) },
        { key: 'note', label: 'Note' }
      ], a);
      if (!v) return;
      await api(`/admin/placement/applications/${id}/stage`, { method: 'PUT', body: v });
      toast('Application moved.', 'success'); loaders.placement();
    });

    $('#companiesHiring').innerHTML = d.companiesHiring.length
      ? d.companiesHiring.map(c => `<div class="register-row"><span class="name">${esc(c.name)}</span><span class="pill info">${c.openings} opening(s)</span></div>`).join('')
      : '<div class="empty-state">No open positions right now.</div>';
  };

  loaders['tab:pl'] = which => {
    if (which === 'companies') loadCompanies();
    if (which === 'jobs') loadJobs();
    if (which === 'interviews') loadInterviews();
    if (which === 'offers') loadOffers();
  };

  async function loadCompanies() {
    const list = await api('/admin/placement/companies');
    tbody('#companiesTable').innerHTML = list.length ? list.map(c => `
      <tr><td class="strong">${esc(c.name)}</td><td>${esc(c.industry || '—')}</td>
      <td>${esc(c.hrName || '—')}<br><span class="muted">${esc(c.hrEmail || '')}</span></td>
      <td>${esc(c.city || '—')}</td><td>${pill(c.tier)}</td><td>${c.openJobs}</td><td>${c.hires}</td>
      <td class="row-actions"><button class="btn btn-ghost btn-xs" data-cmp-edit="${esc(c.id)}">Edit</button>
      <button class="btn btn-danger btn-xs" data-cmp-del="${esc(c.id)}">Delete</button></td></tr>`).join('')
      : empty(8, 'No companies added yet.');

    bind('#companiesTable', 'data-cmp-edit', async id => {
      const c = list.find(x => x.id === id);
      const v = await openModal('Edit Company', companyFields(), c);
      if (!v) return;
      await api('/admin/placement/companies/' + id, { method: 'PUT', body: v });
      toast('Company updated.', 'success'); loadCompanies();
    });
    bind('#companiesTable', 'data-cmp-del', async id => {
      if (!confirmDialog('Delete this company?')) return;
      try { await api('/admin/placement/companies/' + id, { method: 'DELETE' }); loadCompanies(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  const companyFields = () => [
    { key: 'name', label: 'Company name' }, { key: 'industry', label: 'Industry' },
    { key: 'website', label: 'Website' }, { key: 'hrName', label: 'HR contact name' },
    { key: 'hrEmail', label: 'HR email', type: 'email' }, { key: 'hrPhone', label: 'HR phone' },
    { key: 'city', label: 'City' },
    { key: 'tier', label: 'Tier', type: 'select', options: ['standard', 'preferred', 'strategic'] },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  $('#addCompanyBtn').addEventListener('click', async () => {
    const v = await openModal('Add Company', companyFields(), {}, { validate: v => !v.name ? 'A company name is required.' : null });
    if (!v) return;
    await api('/admin/placement/companies', { method: 'POST', body: v });
    toast('Company added.', 'success'); loadCompanies();
  });

  async function loadJobs() {
    const list = await api('/admin/placement/jobs');
    tbody('#jobsTable').innerHTML = list.length ? list.map(j => `
      <tr><td class="strong">${esc(j.title)}</td><td>${esc(j.companyName)}</td><td>${j.openings}</td>
      <td>${j.ctcMin ? `${lakh(j.ctcMin)} – ${lakh(j.ctcMax)}` : '—'}</td><td>${esc(j.location || '—')}</td>
      <td>${j.applicationCount}</td><td>${pill(j.status)}</td>
      <td class="row-actions"><button class="btn btn-primary btn-xs" data-job-apply="${esc(j.id)}">Add applicant</button>
      <button class="btn btn-danger btn-xs" data-job-del="${esc(j.id)}">Delete</button></td></tr>`).join('')
      : empty(8, 'No jobs posted yet.');

    bind('#jobsTable', 'data-job-apply', async id => {
      const ready = (cache().students || []).filter(s => s.placementStatus !== 'placed');
      const v = await openModal('Add an Applicant', [
        { key: 'studentId', label: 'Student', type: 'select', options: ready.map(s => ({ value: s.id, label: s.name })) },
        { key: 'note', label: 'Note' }
      ], {}, { validate: v => !v.studentId ? 'Pick a student.' : null });
      if (!v) return;
      try {
        await api('/admin/placement/applications', { method: 'POST', body: { ...v, jobId: id } });
        toast('Application created.', 'success'); loadJobs();
      } catch (e) { toast(e.message, 'error'); }
    });
    bind('#jobsTable', 'data-job-del', async id => {
      if (!confirmDialog('Delete this job and its applications?')) return;
      await api('/admin/placement/jobs/' + id, { method: 'DELETE' }); loadJobs();
    });
  }

  $('#addJobBtn').addEventListener('click', async () => {
    const companies = await api('/admin/placement/companies');
    await loadLookups();
    const v = await openModal('Post a Job', [
      { key: 'companyId', label: 'Company', type: 'select', options: companies.map(c => ({ value: c.id, label: c.name })) },
      { key: 'title', label: 'Role title' },
      { key: 'courseIds', label: 'Eligible courses', type: 'multiselect', options: courseOptions() },
      { key: 'openings', label: 'Openings', type: 'number', placeholder: '1' },
      { key: 'ctcMin', label: 'CTC min (₹ per year)', type: 'number' },
      { key: 'ctcMax', label: 'CTC max (₹ per year)', type: 'number' },
      { key: 'location', label: 'Location' },
      { key: 'workMode', label: 'Work mode', type: 'select', options: ['onsite', 'hybrid', 'remote'] },
      { key: 'experience', label: 'Experience', type: 'select', options: ['fresher', '0-1 years', '1-3 years', '3+ years'] },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'lastDate', label: 'Apply by', type: 'date' }
    ], {}, { subtitle: 'Placement-ready students on the eligible courses are notified.',
      validate: v => !v.companyId || !v.title ? 'Company and role title are required.' : null });
    if (!v) return;
    await api('/admin/placement/jobs', { method: 'POST', body: v });
    toast('Job posted — eligible students notified.', 'success'); loadJobs();
  });

  async function loadInterviews() {
    const list = await api('/admin/placement/interviews');
    tbody('#interviewsTable').innerHTML = list.length ? list.map(i => `
      <tr><td class="nowrap">${esc(fmtDateTime(i.scheduledAt))}</td><td class="strong">${esc(i.studentName)}</td>
      <td>${esc(i.companyName)}</td><td>Round ${i.round}</td><td>${pill(i.mode)}</td>
      <td>${pill(i.status)}</td><td>${esc(i.result || '—')}</td>
      <td><button class="btn btn-ghost btn-xs" data-int-edit="${esc(i.id)}">Update</button></td></tr>`).join('')
      : empty(8, 'No interviews scheduled.');

    bind('#interviewsTable', 'data-int-edit', async id => {
      const i = list.find(x => x.id === id);
      const v = await openModal('Update Interview', [
        { key: 'status', label: 'Status', type: 'select', options: ['scheduled', 'completed', 'no_show', 'cancelled'] },
        { key: 'result', label: 'Result', type: 'select', options: ['passed', 'failed', 'on_hold'], placeholder: 'Not decided' },
        { key: 'feedback', label: 'Feedback', type: 'textarea' }
      ], i);
      if (!v) return;
      await api('/admin/placement/interviews/' + id, { method: 'PUT', body: v });
      toast('Interview updated.', 'success'); loadInterviews();
    });
  }

  $('#addInterviewBtn').addEventListener('click', async () => {
    const apps = await api('/admin/placement/applications');
    const open = apps.filter(a => !['rejected', 'withdrawn', 'placed'].includes(a.stage));
    if (!open.length) return toast('No open applications to schedule against.', 'error');
    const v = await openModal('Schedule Interview', [
      { key: 'applicationId', label: 'Application', type: 'select',
        options: open.map(a => ({ value: a.id, label: `${a.studentName} → ${a.jobTitle} (${a.companyName})` })) },
      { key: 'scheduledAt', label: 'When', type: 'datetime-local' },
      { key: 'round', label: 'Round', type: 'number', placeholder: '1' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['online', 'onsite', 'telephonic'] },
      { key: 'link', label: 'Meeting link' }, { key: 'panel', label: 'Panel / interviewer' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ], {}, { validate: v => !v.applicationId ? 'Pick an application.' : null });
    if (!v) return;
    await api('/admin/placement/interviews', { method: 'POST', body: { ...v, round: Number(v.round) || 1 } });
    toast('Interview scheduled — the student has been notified.', 'success'); loadInterviews();
  });

  async function loadOffers() {
    const list = await api('/admin/placement/offers');
    tbody('#offersTable').innerHTML = list.length ? list.map(o => `
      <tr><td class="strong">${esc(o.studentName)}</td><td>${esc(o.companyName)}</td><td>${esc(o.role || '—')}</td>
      <td>${lakh(o.ctc)}</td><td>${esc(fmtDate(o.joiningDate))}</td><td>${pill(o.status)}</td>
      <td class="row-actions">
        ${o.status === 'offered' ? `<button class="btn btn-primary btn-xs" data-off="${esc(o.id)}|accepted">Accepted</button>
        <button class="btn btn-ghost btn-xs" data-off="${esc(o.id)}|declined">Declined</button>` : '—'}
      </td></tr>`).join('') : empty(7, 'No offers yet.');

    bind('#offersTable', 'data-off', async val => {
      const [id, status] = val.split('|');
      await api(`/admin/placement/offers/${id}/status`, { method: 'PUT', body: { status } });
      toast(status === 'accepted' ? 'Marked placed — everyone notified.' : 'Offer marked declined.', 'success');
      loadOffers(); refreshNotifications(true);
    });
  }

  /* ======================================================================
     SITE CONTENT
     ====================================================================== */

  let contentCache = null;

  loaders.content = async () => {
    contentCache = await api('/admin/content');
    $('#c-hero-eyebrow').value = contentCache.hero.eyebrow || '';
    $('#c-hero-cyclewords').value = (contentCache.hero.cycleWords || []).join(', ');
    $('#c-hero-suffix').value = contentCache.hero.headlineSuffix || '';
    $('#c-hero-sub').value = contentCache.hero.sub || '';
    $('#c-usp-headline').value = contentCache.usp.headline || '';
    $('#c-usp-body').value = contentCache.usp.body || '';
    $('#c-usp-disclaimer').value = contentCache.usp.disclaimer || '';
    renderCourseEditor(); renderTestimonialEditor();
  };

  function renderCourseEditor() {
    $('#coursesEditor').innerHTML = contentCache.courses.map((c, i) => `
      <div class="editor-item">
        <button class="remove-item" data-rm-course="${i}">✕</button>
        <div class="grid-2">
          <div class="field"><label>ID</label><input data-course-field="id" value="${esc(c.id)}"></div>
          <div class="field"><label>Tag / Title</label><input data-course-field="tag" value="${esc(c.tag)}"></div>
        </div>
        <div class="field"><label>Description</label><textarea rows="2" data-course-field="blurb">${esc(c.blurb)}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Fee (₹)</label><input type="number" data-course-field="fee" value="${esc(c.fee)}"></div>
          <div class="field"><label>Duration</label><input data-course-field="duration" value="${esc(c.duration)}"></div>
        </div>
      </div>`).join('');
    bind('#coursesEditor', 'data-rm-course', i => {
      contentCache.courses.splice(Number(i), 1); renderCourseEditor();
    });
  }

  function renderTestimonialEditor() {
    $('#testimonialsEditor').innerHTML = contentCache.testimonials.map((t, i) => `
      <div class="editor-item">
        <button class="remove-item" data-rm-testi="${i}">✕</button>
        <div class="field"><label>Quote</label><textarea rows="2" data-testi-field="quote">${esc(t.quote)}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Name</label><input data-testi-field="name" value="${esc(t.name)}"></div>
          <div class="field"><label>Track</label><input data-testi-field="track" value="${esc(t.track)}"></div>
        </div>
      </div>`).join('');
    bind('#testimonialsEditor', 'data-rm-testi', i => {
      contentCache.testimonials.splice(Number(i), 1); renderTestimonialEditor();
    });
  }

  function collectList(sel, attr) {
    return $$(sel + ' .editor-item').map(item => {
      const obj = {};
      item.querySelectorAll(`[${attr}]`).forEach(el => {
        obj[el.getAttribute(attr)] = el.type === 'number' ? Number(el.value) : el.value;
      });
      return obj;
    });
  }

  $('#addCourseBtn').addEventListener('click', () => {
    contentCache.courses.push({ id: '', tag: 'New Course', blurb: '', fee: 20000, duration: '20 Weeks' });
    renderCourseEditor();
  });
  $('#addTestimonialBtn').addEventListener('click', () => {
    contentCache.testimonials.push({ quote: '', name: '', track: '' });
    renderTestimonialEditor();
  });

  $('#saveContentBtn').addEventListener('click', async () => {
    const payload = {
      hero: {
        eyebrow: $('#c-hero-eyebrow').value,
        cycleWords: $('#c-hero-cyclewords').value.split(',').map(s => s.trim()).filter(Boolean),
        headlineSuffix: $('#c-hero-suffix').value,
        sub: $('#c-hero-sub').value,
        stats: contentCache.hero.stats
      },
      usp: { headline: $('#c-usp-headline').value, body: $('#c-usp-body').value, disclaimer: $('#c-usp-disclaimer').value },
      courses: collectList('#coursesEditor', 'data-course-field'),
      testimonials: collectList('#testimonialsEditor', 'data-testi-field'),
      webinar: contentCache.webinar
    };
    await api('/admin/content', { method: 'PUT', body: payload });
    toast('Site content saved.', 'success'); loaders.content();
  });

  /* ======================================================================
     WEBINAR
     ====================================================================== */

  loaders.webinar = async () => {
    const content = await api('/admin/content');
    const w = content.webinar || {};
    $('#w-title').value = w.title || ''; $('#w-venue').value = w.venue || '';
    $('#w-address').value = w.address || ''; $('#w-date').value = w.dateISO || '';
    $('#w-endtime').value = w.endTime || '';

    const regs = await api('/admin/webinar-registrations');
    $('#regCount').textContent = regs.length;
    tbody('#regTable').innerHTML = regs.length ? regs.slice().reverse().map(r => `
      <tr><td class="strong">${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td>
      <td>${esc(r.track || '—')}</td><td>${r.guests || 0}</td><td>${esc(fmtDate(r.registeredAt))}</td>
      <td><button class="btn btn-danger btn-xs" data-reg-del="${esc(r.id)}">Remove</button></td></tr>`).join('')
      : empty(7, 'No registrations yet.');

    bind('#regTable', 'data-reg-del', async id => {
      if (!confirmDialog('Remove this registration?')) return;
      await api('/admin/webinar-registrations/' + id, { method: 'DELETE' });
      loaders.webinar();
    });
  };

  $('#saveWebinarBtn').addEventListener('click', async () => {
    await api('/admin/webinar-config', { method: 'PUT', body: {
      title: $('#w-title').value, venue: $('#w-venue').value, address: $('#w-address').value,
      dateISO: $('#w-date').value, endTime: $('#w-endtime').value
    } });
    toast('Webinar details updated.', 'success');
  });

  /* ======================================================================
     CODE EDITOR
     ====================================================================== */

  let currentFile = null, originalContent = '';

  loaders.code = async () => {
    const files = await api('/admin/files');
    $('#fileList').innerHTML = files.map(f => `
      <div class="file-item" data-file="${esc(f.name)}"><span class="fname">${esc(f.name)}</span>
      <span style="font-size:11px;color:var(--ink-faint);">${(f.size / 1024).toFixed(1)}kb</span></div>`).join('');
    bind('#fileList', 'data-file', name => openFile(name));
  };

  async function openFile(name) {
    const data = await api('/admin/files/' + encodeURIComponent(name));
    currentFile = name; originalContent = data.content;
    $('#editorFileName').textContent = name;
    $('#codeTextarea').value = data.content;
    $('#codeTextarea').disabled = false;
    $('#saveFileBtn').disabled = false; $('#deleteFileBtn').disabled = false;
    $('#editorStatus').textContent = 'Saved';
    $('#editorStatus').className = 'editor-status saved';
    $$('.file-item').forEach(i => i.classList.toggle('active', i.dataset.file === name));
  }

  $('#codeTextarea').addEventListener('input', () => {
    if (!currentFile) return;
    const dirty = $('#codeTextarea').value !== originalContent;
    $('#editorStatus').textContent = dirty ? 'Unsaved changes' : 'Saved';
    $('#editorStatus').className = 'editor-status ' + (dirty ? 'dirty' : 'saved');
  });

  $('#saveFileBtn').addEventListener('click', async () => {
    if (!currentFile) return;
    await api('/admin/files/' + encodeURIComponent(currentFile), { method: 'PUT', body: { content: $('#codeTextarea').value } });
    originalContent = $('#codeTextarea').value;
    $('#editorStatus').textContent = 'Saved';
    $('#editorStatus').className = 'editor-status saved';
    toast(`${currentFile} saved. A backup of the previous version was kept.`, 'success');
    loaders.code();
  });

  $('#deleteFileBtn').addEventListener('click', async () => {
    if (!currentFile || !confirmDialog(`Delete ${currentFile}? A backup is kept.`)) return;
    await api('/admin/files/' + encodeURIComponent(currentFile), { method: 'DELETE' });
    toast(`${currentFile} deleted.`, 'success');
    currentFile = null;
    $('#editorFileName').textContent = 'Select a file';
    $('#codeTextarea').value = ''; $('#codeTextarea').disabled = true;
    $('#saveFileBtn').disabled = true; $('#deleteFileBtn').disabled = true;
    loaders.code();
  });

  $('#newFileBtn').addEventListener('click', async () => {
    const name = $('#newFileName').value.trim();
    if (!name) return;
    await api('/admin/files', { method: 'POST', body: { name, content: '' } });
    $('#newFileName').value = '';
    toast(`${name} created.`, 'success');
    await loaders.code(); openFile(name);
  });

  /* ======================================================================
     STAFF & ROLES
     ====================================================================== */

  loaders.staff = async () => {
    await loadLookups(true);
    const roles = await api('/admin/staff/roles');
    const staff = await api('/admin/staff');
    cache().staff = staff;

    tbody('#staffTable').innerHTML = staff.map(u => `
      <tr><td class="strong">${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td>${pill(u.role, 'info')} ${esc(u.roleLabel)}</td>
      <td>${(u.courseNames || []).length ? (u.courseNames).map(n => `<span class="pill">${esc(n)}</span>`).join(' ') : '<span class="muted">All courses</span>'}</td>
      <td>${esc(u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never')}</td>
      <td>${u.active === false ? '<span class="pill rejected">Disabled</span>' : '<span class="pill active">Active</span>'}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-xs" data-staff-edit="${esc(u.id)}">Edit</button>
        <button class="btn btn-danger btn-xs" data-staff-del="${esc(u.id)}">Delete</button>
      </td></tr>`).join('');

    bind('#staffTable', 'data-staff-edit', async id => {
      const u = staff.find(x => x.id === id);
      const v = await openModal('Edit Staff', staffFields(roles), u, {
        subtitle: 'Leaving the course restriction empty gives access to every course.'
      });
      if (!v) return;
      if (!v.password) delete v.password;
      try {
        await api('/admin/staff/' + id, { method: 'PUT', body: v });
        toast('Staff updated.', 'success'); loaders.staff();
      } catch (e) { toast(e.message, 'error'); }
    });
    bind('#staffTable', 'data-staff-del', async id => {
      if (!confirmDialog('Delete this staff account?')) return;
      try { await api('/admin/staff/' + id, { method: 'DELETE' }); loaders.staff(); }
      catch (e) { toast(e.message, 'error'); }
    });

    $('#rolesMatrix').innerHTML = roles.map(r => `
      <div class="editor-item">
        <b style="font-size:14px;">${esc(r.label)}</b>
        <p style="font-size:12.5px;margin-top:4px;">${esc(r.description)}</p>
        <div style="margin-top:9px;display:flex;flex-wrap:wrap;gap:5px;">
          ${r.permissions.length > 30 ? '<span class="pill active">Everything</span>'
            : r.permissions.map(p => `<span class="pill">${esc(p)}</span>`).join('')}
        </div>
      </div>`).join('');
  };

  const staffFields = roles => [
    { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role', type: 'select', options: roles.map(r => ({ value: r.key, label: r.label })) },
    { key: 'courseIds', label: 'Restrict to courses', type: 'multiselect', options: courseOptions(),
      hint: 'Leave all unticked for full access. Tick courses to lock a trainer or manager to just those.' },
    { key: 'active', label: 'Account active', type: 'checkbox' },
    { key: 'password', label: 'Password (min 8 characters)', type: 'password' }
  ];

  $('#addStaffBtn').addEventListener('click', async () => {
    await loadLookups();
    const roles = await api('/admin/staff/roles');
    const v = await openModal('Add Staff', staffFields(roles), { active: true }, {
      validate: v => !v.name || !v.email || !v.role ? 'Name, email and role are required.'
        : !v.password || v.password.length < 8 ? 'Set a password of at least 8 characters.' : null
    });
    if (!v) return;
    try {
      await api('/admin/staff', { method: 'POST', body: v });
      toast('Staff account created.', 'success'); loaders.staff();
    } catch (e) { toast(e.message, 'error'); }
  });

  /* ======================================================================
     AUDIT
     ====================================================================== */

  loaders.audit = async () => {
    const facets = await api('/admin/audit/facets');
    fillSelect('#auditEntity', facets.entities.map(e => ({ id: e, name: titleCase(e) })), { placeholder: 'All record types' });
    fillSelect('#auditAction', facets.actions.map(a => ({ id: a, name: titleCase(a) })), { placeholder: 'All actions' });
    fillSelect('#auditActor', facets.actors, { placeholder: 'All people' });
    await renderAudit();
  };

  loaders['tab:au'] = which => {
    if (which === 'all') renderAudit();
    if (which === 'sensitive') renderSensitive();
    if (which === 'logins') renderLogins();
  };

  async function renderAudit() {
    const params = new URLSearchParams({ limit: '200' });
    ['auditSearch:q', 'auditEntity:entity', 'auditAction:action', 'auditActor:actorId'].forEach(pair => {
      const [id, key] = pair.split(':');
      if ($('#' + id).value) params.set(key, $('#' + id).value);
    });
    const data = await api('/admin/audit?' + params);

    $('#auditTimeline').innerHTML = data.items.length ? data.items.map(l => `
      <div class="tl-item">
        <div class="tl-when">${esc(fmtDateTime(l.at))} · ${esc(l.ip || 'no ip')}</div>
        <div class="tl-what"><b>${esc(l.actorName)}</b> <span class="muted">(${esc(titleCase(l.actorRole))})</span>
          ${esc(titleCase(l.action))} — ${esc(titleCase(l.entity))} ${l.label ? `<b>${esc(l.label)}</b>` : ''}</div>
        ${(l.changes || []).length ? `<div class="tl-change">${l.changes.slice(0, 6).map(c =>
          `${esc(c.field)}: <span class="from">${esc(c.from ?? '—')}</span> → <span class="to">${esc(c.to ?? '—')}</span>`).join('<br>')}</div>` : ''}
      </div>`).join('') : '<div class="empty-state">No matching activity.</div>';
  }
  ['#auditSearch', '#auditEntity', '#auditAction', '#auditActor']
    .forEach(s => $(s).addEventListener('input', renderAudit));

  async function renderSensitive() {
    const d = await api('/admin/audit/sensitive');
    const section = (title, items, note) => `
      <div class="card"><h3>${esc(title)}</h3>
      ${note ? `<p class="card-sub">${esc(note)}</p>` : ''}
      ${items.length ? `<div class="timeline">${items.map(l => `
        <div class="tl-item"><div class="tl-when">${esc(fmtDateTime(l.at))}</div>
        <div class="tl-what"><b>${esc(l.actorName)}</b> ${esc(titleCase(l.action))} ${esc(l.entity)} ${esc(l.label || '')}</div>
        ${(l.changes || []).length ? `<div class="tl-change">${l.changes.slice(0, 4).map(c =>
          `${esc(c.field)}: <span class="from">${esc(c.from ?? '—')}</span> → <span class="to">${esc(c.to ?? '—')}</span>`).join('<br>')}</div>` : ''}
        </div>`).join('')}</div>` : '<div class="empty-state">Nothing recorded.</div>'}</div>`;

    $('#auditSensitive').innerHTML =
      section('Deleted records', d.deletions) +
      section('Payment and fee modifications', d.paymentChanges) +
      section('Student status changes', d.statusChanges) +
      section('Permission and role changes', d.permissionChanges) +
      section('Identity document access', d.documentAccess, 'Every time a staff member opens someone\'s ID scan, it is recorded here.');
  }

  async function renderLogins() {
    const params = new URLSearchParams();
    if ($('#failedOnly').checked) params.set('failedOnly', 'true');
    const d = await api('/admin/audit/login-history?' + params);
    tbody('#loginTable').innerHTML = d.items.length ? d.items.map(l => `
      <tr><td class="nowrap">${esc(fmtDateTime(l.at))}</td><td>${esc(l.email)}</td>
      <td>${esc(titleCase(l.role || '—'))}</td>
      <td>${l.success ? '<span class="pill verified">Success</span>' : `<span class="pill rejected">Failed</span> <span class="muted">${esc(l.reason)}</span>`}</td>
      <td class="mono">${esc(l.ip || '—')}</td><td class="muted">${esc((l.userAgent || '').slice(0, 40))}</td></tr>`).join('')
      : empty(6, 'No login records.');
  }
  $('#failedOnly').addEventListener('change', renderLogins);

  /* ======================================================================
     SETTINGS
     ====================================================================== */

  let settingsCache = null;

  loaders.settings = async () => {
    const d = await api('/admin/settings');
    settingsCache = d.settings;
    renderGeneral(); renderPayments(); renderIntegrations(); renderNotificationSettings(d.webPushAvailable);
  };
  loaders['tab:st'] = () => { /* all four render on load */ };

  const inputRow = (key, label, value, type = 'text') =>
    `<div class="field"><label>${esc(label)}</label><input data-set="${esc(key)}" type="${type}" value="${esc(value ?? '')}"></div>`;

  function saveSection(section, root) {
    const body = {};
    $$(root + ' [data-set]').forEach(el => {
      const path = el.dataset.set.split('.');
      let node = body;
      path.slice(0, -1).forEach(p => { node[p] = node[p] || {}; node = node[p]; });
      node[path[path.length - 1]] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
    });
    return api('/admin/settings/' + section, { method: 'PUT', body });
  }

  function renderGeneral() {
    const g = settingsCache.general;
    $('#setGeneral').innerHTML = `<div class="card"><h3>Company details</h3>
      <div class="grid-2">
        ${inputRow('companyName', 'Company name', g.companyName)}
        ${inputRow('legalName', 'Registered legal name', g.legalName)}
        ${inputRow('supportEmail', 'Support email', g.supportEmail, 'email')}
        ${inputRow('supportPhone', 'Support phone', g.supportPhone)}
        ${inputRow('website', 'Website', g.website)}
        ${inputRow('logoUrl', 'Logo URL', g.logoUrl)}
        ${inputRow('timezone', 'Timezone', g.timezone)}
        ${inputRow('currency', 'Currency', g.currency)}
      </div>
      <div class="field"><label>Address</label><textarea data-set="address" rows="2">${esc(g.address || '')}</textarea></div>
      <button class="btn btn-primary" style="margin-top:16px;" id="saveGeneral">Save General Settings</button></div>`;
    $('#saveGeneral').addEventListener('click', async () => {
      await saveSection('general', '#setGeneral'); toast('General settings saved.', 'success');
    });
  }

  function renderPayments() {
    const p = settingsCache.payments;
    $('#setPayments').innerHTML = `
      <div class="card"><h3>Payment gateway</h3>
        <div class="grid-2">
          <div class="field"><label>Gateway</label><select data-set="gateway">
            ${['razorpay', 'payu', 'cashfree', 'stripe', 'instamojo', 'none'].map(o =>
              `<option value="${o}" ${p.gateway === o ? 'selected' : ''}>${titleCase(o)}</option>`).join('')}
          </select></div>
          ${inputRow('keyId', 'Key ID', p.keyId)}
        </div>
        <div class="field"><label>Key secret ${p.keySecretSet ? '<span class="pill verified">Stored</span>' : ''}</label>
          <input data-set="keySecret" type="password" placeholder="${p.keySecretSet ? 'Leave blank to keep the stored secret' : 'Enter the secret'}">
          <div class="hint">Secrets are never sent back to the browser. Leaving this blank keeps what is already stored.</div></div>
      </div>
      <div class="card"><h3>Bank &amp; invoicing</h3>
        <div class="grid-2">
          ${inputRow('bankName', 'Bank name', p.bankName)}
          ${inputRow('accountName', 'Account name', p.accountName)}
          ${inputRow('accountNumberLast4', 'Account number (last 4)', p.accountNumberLast4)}
          ${inputRow('ifsc', 'IFSC', p.ifsc)}
          ${inputRow('upiId', 'UPI ID', p.upiId)}
          ${inputRow('gstin', 'GSTIN', p.gstin)}
          ${inputRow('gstPercent', 'GST %', p.gstPercent, 'number')}
          ${inputRow('invoicePrefix', 'Invoice prefix', p.invoicePrefix)}
          ${inputRow('nextInvoiceNumber', 'Next invoice number', p.nextInvoiceNumber, 'number')}
        </div>
        <div class="field"><label>Invoice terms</label><textarea data-set="invoiceTerms" rows="2">${esc(p.invoiceTerms || '')}</textarea></div>
        <button class="btn btn-primary" style="margin-top:16px;" id="savePayments">Save Payment Settings</button>
      </div>`;
    $('#savePayments').addEventListener('click', async () => {
      await saveSection('payments', '#setPayments'); toast('Payment settings saved.', 'success'); loaders.settings();
    });
  }

  function renderIntegrations() {
    const i = settingsCache.integrations;
    const block = (key, title, fields, secretKey, secretSet) => `
      <div class="card"><h3>${esc(title)}
        <label class="checkbox-row" style="margin:0;"><input type="checkbox" data-set="${key}.enabled" ${i[key].enabled ? 'checked' : ''}> Enabled</label>
      </h3>
      <div class="grid-2">${fields.map(([f, label, type]) => inputRow(`${key}.${f}`, label, i[key][f], type || 'text')).join('')}</div>
      ${secretKey ? `<div class="field"><label>${esc(secretKey.label)} ${secretSet ? '<span class="pill verified">Stored</span>' : ''}</label>
        <input data-set="${key}.${secretKey.field}" type="password" placeholder="${secretSet ? 'Leave blank to keep' : ''}"></div>` : ''}
      ${i[key].lastTestedAt ? `<div class="hint">Last checked ${esc(timeAgo(i[key].lastTestedAt))}</div>` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-top:12px;" data-test="${key}">Check configuration</button></div>`;

    $('#setIntegrations').innerHTML = `
      <div class="notice info">Credentials are stored here and the panel records which integrations are configured.
      Actually sending through Meta, Google, WhatsApp or your SMS provider needs their SDK wired into <span class="mono">lib/</span> —
      each requires its own app review and callback URL, which can't be faked from this screen.</div>
      ${block('metaLeadAds', 'Meta Lead Ads', [['pageId', 'Page ID'], ['formIds', 'Form IDs (comma separated)'], ['verifyToken', 'Webhook verify token']], { label: 'App secret', field: 'appSecret' }, i.metaLeadAds.appSecretSet)}
      ${block('googleAds', 'Google Ads', [['customerId', 'Customer ID'], ['conversionLabel', 'Conversion label']])}
      ${block('googleAnalytics', 'Google Analytics', [['measurementId', 'Measurement ID (G-…)']])}
      ${block('whatsapp', 'WhatsApp', [['provider', 'Provider'], ['phoneNumberId', 'Phone number ID']], { label: 'Access token', field: 'token' }, i.whatsapp.tokenSet)}
      ${block('email', 'Email (SMTP)', [['host', 'SMTP host'], ['port', 'Port', 'number'], ['user', 'Username'], ['fromName', 'From name'], ['fromEmail', 'From email', 'email']], { label: 'SMTP password', field: 'password' }, i.email.passwordSet)}
      ${block('meeting', 'Zoom / Google Meet', [['provider', 'Provider'], ['accountEmail', 'Account email', 'email']], { label: 'OAuth token', field: 'token' }, i.meeting.tokenSet)}
      ${block('sms', 'SMS', [['provider', 'Provider'], ['senderId', 'Sender ID']], { label: 'API key', field: 'apiKey' }, i.sms.apiKeySet)}
      ${block('crm', 'CRM', [['provider', 'Provider']], { label: 'API key', field: 'apiKey' }, i.crm.apiKeySet)}
      <button class="btn btn-primary" id="saveIntegrations">Save All Integrations</button>`;

    $('#saveIntegrations').addEventListener('click', async () => {
      await saveSection('integrations', '#setIntegrations');
      toast('Integrations saved.', 'success'); loaders.settings();
    });
    bind('#setIntegrations', 'data-test', async key => {
      try {
        const r = await api(`/admin/settings/integrations/${key}/test`, { method: 'POST' });
        toast(r.message, 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function renderNotificationSettings(pushAvailable) {
    const n = settingsCache.notifications;
    const roleList = ['super_admin', 'admissions_manager', 'counsellor', 'academic_manager', 'trainer', 'placement_manager', 'finance', 'content_manager'];

    $('#setNotifications').innerHTML = `
      <div class="card"><h3>Delivery channels</h3>
        <label class="checkbox-row"><input type="checkbox" data-set="webPushEnabled" ${n.webPushEnabled ? 'checked' : ''}> Browser push notifications ${pushAvailable ? '' : '<span class="pill rejected">web-push not installed</span>'}</label>
        <label class="checkbox-row"><input type="checkbox" data-set="emailEnabled" ${n.emailEnabled ? 'checked' : ''}> Email</label>
        <label class="checkbox-row"><input type="checkbox" data-set="whatsappEnabled" ${n.whatsappEnabled ? 'checked' : ''}> WhatsApp</label>
        <label class="checkbox-row"><input type="checkbox" data-set="smsEnabled" ${n.smsEnabled ? 'checked' : ''}> SMS</label>
        <div class="grid-2" style="margin-top:14px;">
          ${inputRow('lowAttendanceThreshold', 'Low attendance alert below (%)', n.lowAttendanceThreshold, 'number')}
          ${inputRow('overdueGraceDays', 'Overdue grace period (days)', n.overdueGraceDays, 'number')}
        </div>
      </div>
      <div class="card"><h3>Which alerts go to which roles</h3>
        <p class="card-sub">Untick an event to switch it off entirely. Everyone directly involved (the student who paid, the mentor who enrolled) is always notified regardless.</p>
        ${Object.entries(n.events).map(([key, cfg]) => `
          <div class="editor-item">
            <label class="checkbox-row" style="margin:0 0 8px;"><input type="checkbox" data-set="events.${key}.enabled" ${cfg.enabled ? 'checked' : ''}> <b>${esc(titleCase(key))}</b></label>
            <div class="checkbox-grid">
              ${roleList.map(r => `<label class="checkbox-row"><input type="checkbox" data-role-event="${key}" value="${r}" ${cfg.roles.includes(r) ? 'checked' : ''}> ${esc(titleCase(r))}</label>`).join('')}
            </div>
          </div>`).join('')}
        <button class="btn btn-primary" style="margin-top:14px;" id="saveNotifs">Save Notification Settings</button>
      </div>`;

    $('#saveNotifs').addEventListener('click', async () => {
      const body = {};
      $$('#setNotifications [data-set]').forEach(el => {
        const path = el.dataset.set.split('.');
        let node = body;
        path.slice(0, -1).forEach(p => { node[p] = node[p] || {}; node = node[p]; });
        node[path[path.length - 1]] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
      });
      body.events = body.events || {};
      $$('#setNotifications [data-role-event]').forEach(el => {
        const k = el.dataset.roleEvent;
        body.events[k] = body.events[k] || {};
        body.events[k].roles = body.events[k].roles || [];
        if (el.checked) body.events[k].roles.push(el.value);
      });
      await api('/admin/settings/notifications', { method: 'PUT', body });
      toast('Notification settings saved.', 'success'); loaders.settings();
    });
  }

  /* ======================================================================
     ACCOUNT
     ====================================================================== */

  loaders.account = () => window.BM.renderPushStatus();

  $('#changePassBtn').addEventListener('click', async () => {
    const msg = $('#settingsMsg');
    try {
      await api('/admin/change-password', { method: 'PUT', body: {
        currentPassword: $('#s-current-pass').value, newPassword: $('#s-new-pass').value
      } });
      msg.style.color = 'var(--green)';
      msg.textContent = 'Password updated.';
      msg.classList.add('show');
      $('#s-current-pass').value = ''; $('#s-new-pass').value = '';
    } catch (e) {
      msg.style.color = 'var(--red)';
      msg.textContent = e.message;
      msg.classList.add('show');
    }
  });

})();
