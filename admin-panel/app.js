/* =========================================================================
   Byte Morphix Admin — core
   Auth, navigation, permission gating, notifications, and the shared helpers
   that modules.js builds the rest of the panels on top of.
   ========================================================================= */
(function () {
  'use strict';

  let TOKEN = null;          // in memory only — a refresh means a fresh login
  let ME = null;             // { id, name, email, role, permissions, courseIds }
  const CACHE = {};          // courses / batches / staff, fetched once per session

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ------------------------------------------------------------- utilities */

  function toast(msg, type) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 4200);
  }

  // Everything user-supplied goes through this before it reaches innerHTML.
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = v => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const money = n => '₹' + (Number(n) || 0).toLocaleString('en-IN');
  const lakh = n => n ? '₹' + (Number(n) / 100000).toFixed(1) + ' LPA' : '—';

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return fmtDate(iso);
  }

  const titleCase = s => String(s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  /* ------------------------------------------------------------ API client */

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    if (TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;

    const res = await fetch('/api' + path, opts);
    if (res.status === 401) {
      toast('Session expired — please log in again.', 'error');
      logout();
      throw new Error('Unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const can = perm => !!(ME && (ME.permissions.includes('*') || ME.permissions.includes(perm)));

  /**
   * Raw fetch with the auth header attached, for responses that aren't JSON
   * — document scans, PDFs. The token never leaves this closure.
   */
  async function authFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {});
    return fetch('/api' + path, opts);
  }

  /* --------------------------------------------------------------- modals */

  /**
   * Generic form modal. Field types: text, number, email, password, date,
   * datetime-local, textarea, select, multiselect, checkbox.
   * Returns the collected values, or null if cancelled.
   */
  function openModal(title, fields, initial, opts) {
    opts = opts || {};
    initial = initial || {};

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';

      const fieldHtml = fields.map(f => {
        const v = initial[f.key];
        if (f.type === 'select') {
          const options = (f.options || []).map(o => {
            const val = typeof o === 'object' ? o.value : o;
            const lbl = typeof o === 'object' ? o.label : o;
            return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lbl)}</option>`;
          }).join('');
          return `<div class="field"><label>${esc(f.label)}</label>
            <select data-key="${esc(f.key)}">${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${options}</select>
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
        }
        if (f.type === 'multiselect') {
          const sel = Array.isArray(v) ? v.map(String) : [];
          const boxes = (f.options || []).map(o => {
            const val = typeof o === 'object' ? o.value : o;
            const lbl = typeof o === 'object' ? o.label : o;
            return `<label class="checkbox-row"><input type="checkbox" data-multi="${esc(f.key)}" value="${esc(val)}" ${sel.includes(String(val)) ? 'checked' : ''}> ${esc(lbl)}</label>`;
          }).join('');
          return `<div class="field"><label>${esc(f.label)}</label>
            <div class="checkbox-grid">${boxes || '<span class="muted">Nothing to choose from yet.</span>'}</div>
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
        }
        if (f.type === 'checkbox') {
          return `<label class="checkbox-row"><input type="checkbox" data-key="${esc(f.key)}" data-bool="1" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label>${esc(f.label)}</label>
            <textarea data-key="${esc(f.key)}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v || '')}</textarea>
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
        }
        if (f.type === 'file') {
          return `<div class="field"><label>${esc(f.label)}</label>
            <input type="file" data-key="${esc(f.key)}" data-file="1" accept="${esc(f.accept || '')}">
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
        }
        return `<div class="field"><label>${esc(f.label)}</label>
          <input data-key="${esc(f.key)}" type="${f.type || 'text'}" value="${esc(v != null ? v : '')}" placeholder="${esc(f.placeholder || '')}">
          ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
      }).join('');

      overlay.innerHTML = `
        <div class="modal-box ${opts.wide ? 'wide' : ''}">
          <h3>${esc(title)}</h3>
          ${opts.subtitle ? `<div class="modal-sub">${esc(opts.subtitle)}</div>` : ''}
          ${opts.notice ? `<div class="notice ${esc(opts.noticeType || 'info')}">${opts.notice}</div>` : ''}
          ${fieldHtml}
          <div class="error-text" data-modal-error></div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-cancel>Cancel</button>
            <button class="btn btn-primary" data-save>${esc(opts.saveLabel || 'Save')}</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      const firstInput = overlay.querySelector('input,select,textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 40);

      const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);

      overlay.querySelector('[data-cancel]').onclick = () => close(null);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

      overlay.querySelector('[data-save]').onclick = () => {
        const values = {};
        overlay.querySelectorAll('[data-key]').forEach(el => {
          if (el.dataset.file) { values[el.dataset.key] = el.files[0] || null; return; }
          if (el.dataset.bool) { values[el.dataset.key] = el.checked; return; }
          values[el.dataset.key] = el.value;
        });
        overlay.querySelectorAll('[data-multi]').forEach(el => {
          const k = el.dataset.multi;
          values[k] = values[k] || [];
          if (el.checked) values[k].push(el.value);
        });

        if (opts.validate) {
          const err = opts.validate(values);
          if (err) {
            const box = overlay.querySelector('[data-modal-error]');
            box.textContent = err;
            box.classList.add('show');
            return;
          }
        }
        close(values);
      };
    });
  }

  /** Full-width HTML modal for read-heavy views (threads, invoices, rosters). */
  function openSheet(title, html, actions) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal-box wide">
        <h3>${esc(title)}</h3>
        <div data-sheet-body>${html}</div>
        <div class="modal-actions">
          ${(actions || []).map((a, i) => `<button class="btn ${esc(a.cls || 'btn-ghost')}" data-act="${i}">${esc(a.label)}</button>`).join('')}
          <button class="btn btn-ghost" data-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-close]').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    (actions || []).forEach((a, i) => {
      overlay.querySelector(`[data-act="${i}"]`).onclick = async () => {
        const keep = await a.onClick(overlay);
        if (!keep) close();
      };
    });
    return { overlay, close, body: overlay.querySelector('[data-sheet-body]') };
  }

  const confirmDialog = msg => window.confirm(msg);

  function empty(cols, msg) {
    return `<tr><td colspan="${cols}" class="empty-state">${esc(msg)}</td></tr>`;
  }

  /* ---------------------------------------------------------------- LOGIN */

  async function doLogin() {
    const email = $('#admin-email').value.trim();
    const password = $('#admin-pass').value;
    const errEl = $('#loginError');
    errEl.classList.remove('show');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      if (!data.permissions || !data.permissions.length) {
        throw new Error('This login is a portal account, not an admin account. Use your staff credentials here.');
      }

      TOKEN = data.token;
      ME = { id: data.id, name: data.name, email, role: data.role, roleLabel: data.roleLabel, permissions: data.permissions, courseIds: data.courseIds || [] };

      $('#loginScreen').style.display = 'none';
      $('#appShell').classList.add('show');
      $('#admin-pass').value = '';

      applyPermissions();
      await bootstrap();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  }

  $('#loginBtn').addEventListener('click', doLogin);
  ['#admin-email', '#admin-pass'].forEach(sel =>
    $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));

  function logout() {
    TOKEN = null; ME = null;
    stopPolling();
    $('#appShell').classList.remove('show');
    $('#loginScreen').style.display = 'flex';
  }
  $('#logoutBtn').addEventListener('click', logout);

  /* --------------------------------------------------- permission gating */

  /**
   * Hides nav items the role can't use. The server enforces the same rules,
   * so this is about not showing people doors they can't open — not security.
   */
  function applyPermissions() {
    $('#whoName').textContent = ME.name;
    $('#whoEmail').textContent = ME.email;
    $('#whoRole').textContent = ME.roleLabel || titleCase(ME.role);

    $$('.nav-item').forEach(item => {
      const perm = item.dataset.perm;
      item.classList.toggle('locked', !!(perm && !can(perm)));
    });

    // Hide a group heading when every item under it is hidden.
    $$('.nav-group').forEach(group => {
      let n = group.nextElementSibling, visible = false;
      while (n && n.classList.contains('nav-item')) {
        if (!n.classList.contains('locked')) visible = true;
        n = n.nextElementSibling;
      }
      group.style.display = visible ? '' : 'none';
    });

    const first = $$('.nav-item:not(.locked)')[0];
    if (first) selectPanel(first.dataset.panel);
  }

  function renderScopeNote() {
    const el = $('#whoScope');
    if (!ME.courseIds || !ME.courseIds.length) { el.innerHTML = ''; return; }
    const names = ME.courseIds.map(id => (CACHE.courses || []).find(c => c.id === id))
      .filter(Boolean).map(c => c.name);
    el.innerHTML = names.length
      ? `<span class="pill info" title="You only see records on these courses">🔒 ${esc(names.join(', '))}</span>`
      : '';
  }

  /* ---------------------------------------------------------- NAVIGATION */

  const loaders = {};   // modules.js registers panel loaders here

  function selectPanel(name) {
    const item = $(`.nav-item[data-panel="${name}"]`);
    if (!item || item.classList.contains('locked')) return;
    $$('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    $$('.panel').forEach(p => p.classList.remove('active'));
    const panel = $('#panel-' + name);
    if (panel) panel.classList.add('active');
    $('#sidebar').classList.remove('open');
    window.scrollTo(0, 0);
    if (loaders[name]) {
      Promise.resolve(loaders[name]()).catch(e => toast(e.message, 'error'));
    }
  }

  $$('.nav-item').forEach(item =>
    item.addEventListener('click', () => selectPanel(item.dataset.panel)));
  $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  // Generic tab strips (used by Coursework, Placement, Audit, Settings).
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const strip = tab.parentElement;
    strip.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const scope = strip.parentElement;
    scope.querySelectorAll(':scope > .tab-panel').forEach(p =>
      p.classList.toggle('active', p.dataset.tabpanel === tab.dataset.tab));
    if (strip.dataset.tabs && loaders['tab:' + strip.dataset.tabs]) {
      loaders['tab:' + strip.dataset.tabs](tab.dataset.tab);
    }
  });

  /* ------------------------------------------------------ shared lookups */

  async function loadLookups(force) {
    if (CACHE.loaded && !force) return CACHE;
    CACHE.courses = can('courses.read') ? await api('/admin/academics/courses').catch(() => []) : [];
    CACHE.batches = can('batches.read') ? await api('/admin/academics/batches').catch(() => []) : [];
    CACHE.staff = can('staff.read') ? await api('/admin/staff').catch(() => []) : [];
    CACHE.students = can('students.read') ? await api('/admin/students').catch(() => []) : [];
    CACHE.mentors = can('mentors.read') ? await api('/admin/mentors').catch(() => []) : [];
    CACHE.loaded = true;
    renderScopeNote();
    return CACHE;
  }

  function fillSelect(sel, items, { value = 'id', label = 'name', placeholder } = {}) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    const current = el.value;
    el.innerHTML = (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '')
      + items.map(i => `<option value="${esc(i[value])}">${esc(i[label])}</option>`).join('');
    if (current) el.value = current;
  }

  /* --------------------------------------------------- NOTIFICATIONS */

  let pollTimer = null;
  let lastSeenIds = new Set();

  async function refreshNotifications(silent) {
    if (!TOKEN) return;
    try {
      const data = await api('/notifications?limit=60');
      const count = data.unread;
      [['#bellCount', count], ['#bellCountMobile', count]].forEach(([sel, n]) => {
        const el = $(sel);
        if (!el) return;
        el.textContent = n > 99 ? '99+' : n;
        el.classList.toggle('show', n > 0);
      });

      $('#notifList').innerHTML = data.items.length ? data.items.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notif="${esc(n.id)}" ${n.link ? `data-link="${esc(n.link)}"` : ''}>
          <span class="ico">${esc(n.icon)}</span>
          <div style="flex:1;">
            <b>${esc(n.title)}</b>
            <small>${esc(n.body)}</small>
            <div class="when">${esc(timeAgo(n.createdAt))}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">Nothing yet.</div>';

      // Only foreground-toast things that arrived while the page was open,
      // otherwise every reload would replay the whole backlog.
      if (!silent) {
        data.items.filter(n => !n.read && !lastSeenIds.has(n.id)).slice(0, 3).forEach(n => {
          toast(`${n.icon} ${n.title} — ${n.body}`.slice(0, 150));
        });
      }
      lastSeenIds = new Set(data.items.map(n => n.id));

      updateBadges();
    } catch (e) { /* a failed poll shouldn't interrupt anything */ }
  }

  async function updateBadges() {
    if (!can('queries.read') && !can('disputes.read') && !can('forms.read')) return;
    try {
      const s = await api('/admin/support/summary');
      const set = (sel, n) => {
        const el = $(sel);
        if (!el) return;
        el.textContent = n;
        el.style.display = n > 0 ? '' : 'none';
      };
      set('#badgeQueries', s.queriesOpen);
      set('#badgeDisputes', s.disputesOpen);
      set('#badgeForms', s.formsNew);
    } catch (e) { /* non-critical */ }
  }

  function startPolling() {
    stopPolling();
    refreshNotifications(true);
    pollTimer = setInterval(refreshNotifications, 25000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  const drawer = $('#notifDrawer');
  const openDrawer = () => { drawer.classList.add('open'); refreshNotifications(true); };
  $('#bell').addEventListener('click', openDrawer);
  const bellM = $('#bellMobile');
  if (bellM) bellM.addEventListener('click', openDrawer);
  $('#closeNotif').addEventListener('click', () => drawer.classList.remove('open'));

  $('#notifList').addEventListener('click', async e => {
    const item = e.target.closest('[data-notif]');
    if (!item) return;
    await api('/notifications/read', { method: 'POST', body: { ids: [item.dataset.notif] } });
    item.classList.remove('unread');
    refreshNotifications(true);
    const link = item.dataset.link;
    if (link && link.startsWith('#')) {
      const panel = link.slice(1).split('/')[0];
      const map = { finance: 'finance', students: 'students', mentors: 'mentors', employers: 'employers',
        leads: 'leads', forms: 'forms', queries: 'queries', disputes: 'disputes', repository: 'repository',
        placement: 'placement', classes: 'classes', webinar: 'webinar' };
      if (map[panel]) { drawer.classList.remove('open'); selectPanel(map[panel]); }
    }
  });

  $('#markAllRead').addEventListener('click', async () => {
    await api('/notifications/read', { method: 'POST', body: {} });
    refreshNotifications(true);
  });

  $('#broadcastBtn').addEventListener('click', async () => {
    if (!can('notifications.broadcast')) return toast('Your role cannot send broadcasts.', 'error');
    const roles = [
      { value: 'student', label: 'All students' }, { value: 'mentor', label: 'All mentors' },
      { value: 'employer', label: 'All employers' }, { value: 'super_admin', label: 'Super Admins' },
      { value: 'admissions_manager', label: 'Admissions Managers' }, { value: 'counsellor', label: 'Counsellors' },
      { value: 'academic_manager', label: 'Academic Managers' }, { value: 'trainer', label: 'Trainers' },
      { value: 'placement_manager', label: 'Placement Managers' }, { value: 'finance', label: 'Finance' },
      { value: 'content_manager', label: 'Content Managers' }
    ];
    const v = await openModal('Send a Broadcast', [
      { key: 'title', label: 'Title' },
      { key: 'body', label: 'Message', type: 'textarea' },
      { key: 'everyone', label: 'Send to absolutely everyone', type: 'checkbox' },
      { key: 'roles', label: 'Or pick specific groups', type: 'multiselect', options: roles }
    ], {}, {
      subtitle: 'Goes to the in-app bell and, for anyone who allowed it, as a push notification.',
      saveLabel: 'Send',
      validate: val => !val.title || !val.body ? 'A title and a message are both required.' : null
    });
    if (!v) return;
    try {
      await api('/notifications/broadcast', { method: 'POST', body: v });
      toast('Broadcast sent.', 'success');
      refreshNotifications(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  /* ---------------------------------------------------------- WEB PUSH */

  const b64ToUint8 = base64 => {
    const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  };

  async function pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { supported: false, reason: 'This browser does not support push notifications.' };
    }
    const info = await api('/notifications/vapid-key').catch(() => ({ available: false }));
    if (!info.available) return { supported: false, reason: info.reason || 'Push is switched off in Settings → Notifications.' };
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return { supported: true, permission: Notification.permission, subscribed: !!sub, publicKey: info.publicKey };
  }

  async function enablePush() {
    try {
      const state = await pushState();
      if (!state.supported) return toast(state.reason, 'error');

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return toast('Notifications were blocked. Allow them in your browser settings to receive alerts.', 'error');

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToUint8(state.publicKey)
        });
      }
      await api('/notifications/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      toast('Push notifications are on for this device.', 'success');
      $('#enablePushBtn').style.display = 'none';
      renderPushStatus();
    } catch (e) {
      toast('Could not enable push: ' + e.message, 'error');
    }
  }

  async function renderPushStatus() {
    const el = $('#pushStatusText');
    if (!el) return;
    const state = await pushState();
    if (!state.supported) { el.textContent = state.reason; return; }
    el.textContent = state.subscribed
      ? 'This device is subscribed. You will get alerts even when the tab is closed.'
      : `Not subscribed on this device (browser permission: ${state.permission}).`;
  }

  $('#enablePushBtn').addEventListener('click', enablePush);
  $('#pushEnableBtn').addEventListener('click', enablePush);
  $('#pushTestBtn').addEventListener('click', async () => {
    try {
      const r = await api('/notifications/test', { method: 'POST' });
      toast(r.subscribedDevices ? `Test sent to ${r.subscribedDevices} device(s).` : 'Sent to your bell — no push devices subscribed yet.', 'success');
      refreshNotifications(true);
    } catch (e) { toast(e.message, 'error'); }
  });

  async function offerPush() {
    const state = await pushState();
    if (state.supported && !state.subscribed && state.permission !== 'denied') {
      $('#enablePushBtn').style.display = '';
    }
  }

  /* ------------------------------------------------------- STUDENT DRAWER */

  const sd = $('#studentDrawer');
  $('#closeStudentDrawer').addEventListener('click', () => sd.classList.remove('open'));

  function openStudentDrawer(id) {
    sd.classList.add('open');
    $('#sdBody').innerHTML = '<div class="loading"><span class="spinner"></span> Loading the full record…</div>';
    if (loaders.studentProfile) loaders.studentProfile(id);
  }

  /* ------------------------------------------------------------ bootstrap */

  async function bootstrap() {
    await loadLookups(true);
    startPolling();
    offerPush();
    renderPushStatus();
    const active = $('.nav-item.active');
    if (active && loaders[active.dataset.panel]) {
      Promise.resolve(loaders[active.dataset.panel]()).catch(e => toast(e.message, 'error'));
    }
  }

  /* ------------------------------------------------ exported to modules.js */

  window.BM = {
    api, authFetch, toast, esc, fmtDate, fmtDateTime, money, lakh, timeAgo, titleCase,
    openModal, openSheet, confirmDialog, empty, fillSelect,
    can, loadLookups, selectPanel, openStudentDrawer,
    refreshNotifications, renderPushStatus,
    loaders,
    get me() { return ME; },
    get cache() { return CACHE; },
    $, $$
  };
})();
