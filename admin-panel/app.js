(function(){
  let TOKEN = null; // kept in memory only — refresh requires re-login, on purpose.

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // ---------- toast ----------
  function toast(msg, type){
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    setTimeout(()=> el.classList.remove('show'), 3200);
  }

  // ---------- authenticated fetch ----------
  async function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers || {});
    if(TOKEN) opts.headers['Authorization'] = 'Bearer ' + TOKEN;
    if(opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, opts);
    if(res.status === 401){
      toast('Session expired — please log in again.', 'error');
      logout();
      throw new Error('Unauthorized');
    }
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ---------- generic modal ----------
  function openModal(title, fields, initial){
    return new Promise((resolve)=>{
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML = `
        <div class="modal-box">
          <h3>${title}</h3>
          ${fields.map(f => `
            <div class="field">
              <label>${f.label}</label>
              ${f.type === 'select'
                ? `<select data-key="${f.key}">${f.options.map(o=>`<option value="${o}" ${initial && initial[f.key]===o ? 'selected':''}>${o}</option>`).join('')}</select>`
                : `<input data-key="${f.key}" type="${f.type||'text'}" value="${initial && initial[f.key]!=null ? String(initial[f.key]).replace(/"/g,'&quot;') : ''}" placeholder="${f.placeholder||''}">`
              }
            </div>`).join('')}
          <div class="modal-actions">
            <button class="btn btn-ghost" id="modalCancel">Cancel</button>
            <button class="btn btn-primary" id="modalSave">Save</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#modalCancel').onclick = ()=>{ overlay.remove(); resolve(null); };
      overlay.querySelector('#modalSave').onclick = ()=>{
        const values = {};
        overlay.querySelectorAll('[data-key]').forEach(el=> values[el.dataset.key] = el.value);
        overlay.remove();
        resolve(values);
      };
    });
  }

  function confirmDialog(msg){
    return window.confirm(msg);
  }

  // ======================================================
  // LOGIN
  // ======================================================
  $('#loginBtn').addEventListener('click', async ()=>{
    const email = $('#admin-email').value.trim();
    const password = $('#admin-pass').value;
    const errEl = $('#loginError');
    errEl.classList.remove('show');
    try{
      const res = await fetch('/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({role:'admin', email, password})
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || 'Login failed');
      TOKEN = data.token;
      $('#loginScreen').style.display = 'none';
      $('#appShell').classList.add('show');
      loadOverview();
    } catch(err){
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  });

  function logout(){
    TOKEN = null;
    $('#appShell').classList.remove('show');
    $('#loginScreen').style.display = 'flex';
    $('#admin-pass').value = '';
  }
  $('#logoutBtn').addEventListener('click', logout);

  // ======================================================
  // NAVIGATION
  // ======================================================
  const loaders = {
    overview: loadOverview, content: loadContent, code: loadCode, leads: loadLeads,
    webinar: loadWebinar, students: loadStudents, mentors: loadMentors,
    employers: loadEmployers, settings: ()=>{}
  };
  $$('.nav-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      $$('.nav-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      $$('.panel').forEach(p=>p.classList.remove('active'));
      $('#panel-' + item.dataset.panel).classList.add('active');
      $('#sidebar').classList.remove('open');
      const load = loaders[item.dataset.panel];
      if(load) load();
    });
  });
  $('#menuToggle').addEventListener('click', ()=> $('#sidebar').classList.toggle('open'));

  // ======================================================
  // OVERVIEW
  // ======================================================
  async function loadOverview(){
    try{
      const d = await api('/admin/overview');
      $('#overviewStats').innerHTML = `
        <div class="stat-card"><b>${d.leads}</b><span>Total leads</span></div>
        <div class="stat-card"><b>${d.webinarRegistrations}</b><span>Webinar registrations</span></div>
        <div class="stat-card"><b>${d.students}</b><span>Students</span></div>
        <div class="stat-card"><b>${d.mentors}</b><span>Mentors</span></div>
        <div class="stat-card"><b>${d.employers}</b><span>Employers</span></div>
        <div class="stat-card"><b>${d.pendingCorrections}</b><span>Pending corrections</span></div>
        <div class="stat-card"><b>${d.totalHiringRequests}</b><span>Hiring requests</span></div>
      `;
    } catch(e){ toast(e.message, 'error'); }
  }

  // ======================================================
  // SITE CONTENT
  // ======================================================
  let contentCache = null;

  function renderCourseEditor(courses){
    $('#coursesEditor').innerHTML = courses.map((c, i) => `
      <div class="editor-item" data-index="${i}">
        <button class="remove-item" data-remove-course="${i}">✕</button>
        <div class="grid-2">
          <div class="field"><label>ID (short code)</label><input data-course-field="id" value="${c.id}"></div>
          <div class="field"><label>Tag / Title</label><input data-course-field="tag" value="${c.tag}"></div>
        </div>
        <div class="field"><label>Description</label><textarea rows="2" data-course-field="blurb">${c.blurb}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Fee (₹)</label><input type="number" data-course-field="fee" value="${c.fee}"></div>
          <div class="field"><label>Duration</label><input data-course-field="duration" value="${c.duration}"></div>
        </div>
      </div>
    `).join('');
    $$('[data-remove-course]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        contentCache.courses.splice(Number(btn.dataset.removeCourse), 1);
        renderCourseEditor(contentCache.courses);
      });
    });
  }

  function renderTestimonialEditor(list){
    $('#testimonialsEditor').innerHTML = list.map((t, i) => `
      <div class="editor-item" data-index="${i}">
        <button class="remove-item" data-remove-testi="${i}">✕</button>
        <div class="field"><label>Quote</label><textarea rows="2" data-testi-field="quote">${t.quote}</textarea></div>
        <div class="grid-2">
          <div class="field"><label>Name</label><input data-testi-field="name" value="${t.name}"></div>
          <div class="field"><label>Track label</label><input data-testi-field="track" value="${t.track}"></div>
        </div>
      </div>
    `).join('');
    $$('[data-remove-testi]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        contentCache.testimonials.splice(Number(btn.dataset.removeTesti), 1);
        renderTestimonialEditor(contentCache.testimonials);
      });
    });
  }

  function collectListEditor(containerSel, itemFieldAttr){
    return $$(containerSel + ' .editor-item').map(item=>{
      const obj = {};
      item.querySelectorAll(`[${itemFieldAttr}]`).forEach(el=>{
        const key = el.getAttribute(itemFieldAttr);
        obj[key] = el.type === 'number' ? Number(el.value) : el.value;
      });
      return obj;
    });
  }

  async function loadContent(){
    try{
      contentCache = await api('/admin/content');
      $('#c-hero-eyebrow').value = contentCache.hero.eyebrow || '';
      $('#c-hero-cyclewords').value = (contentCache.hero.cycleWords || []).join(', ');
      $('#c-hero-suffix').value = contentCache.hero.headlineSuffix || '';
      $('#c-hero-sub').value = contentCache.hero.sub || '';
      $('#c-usp-headline').value = contentCache.usp.headline || '';
      $('#c-usp-body').value = contentCache.usp.body || '';
      $('#c-usp-disclaimer').value = contentCache.usp.disclaimer || '';
      renderCourseEditor(contentCache.courses);
      renderTestimonialEditor(contentCache.testimonials);
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#addCourseBtn').addEventListener('click', ()=>{
    contentCache.courses.push({id:'', tag:'New Course', blurb:'', fee:20000, duration:'20 Weeks'});
    renderCourseEditor(contentCache.courses);
  });
  $('#addTestimonialBtn').addEventListener('click', ()=>{
    contentCache.testimonials.push({quote:'', name:'', track:''});
    renderTestimonialEditor(contentCache.testimonials);
  });

  $('#saveContentBtn').addEventListener('click', async ()=>{
    const payload = {
      hero: {
        eyebrow: $('#c-hero-eyebrow').value,
        cycleWords: $('#c-hero-cyclewords').value.split(',').map(s=>s.trim()).filter(Boolean),
        headlineSuffix: $('#c-hero-suffix').value,
        sub: $('#c-hero-sub').value,
        stats: contentCache.hero.stats
      },
      usp: {
        headline: $('#c-usp-headline').value,
        body: $('#c-usp-body').value,
        disclaimer: $('#c-usp-disclaimer').value
      },
      courses: collectListEditor('#coursesEditor', 'data-course-field'),
      testimonials: collectListEditor('#testimonialsEditor', 'data-testi-field'),
      webinar: contentCache.webinar
    };
    try{
      await api('/admin/content', {method:'PUT', body: payload});
      toast('Site content saved — the live site will reflect this immediately.', 'success');
      loadContent();
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // CODE EDITOR
  // ======================================================
  let currentFile = null;
  let originalContent = '';

  async function loadCode(){
    try{
      const files = await api('/admin/files');
      $('#fileList').innerHTML = files.map(f => `
        <div class="file-item" data-file="${f.name}"><span class="fname">${f.name}</span><span style="font-size:11px; color:var(--ink-faint);">${(f.size/1024).toFixed(1)}kb</span></div>
      `).join('');
      $$('.file-item').forEach(item=>{
        item.addEventListener('click', ()=> openFile(item.dataset.file));
      });
    } catch(e){ toast(e.message, 'error'); }
  }

  async function openFile(name){
    try{
      const data = await api('/admin/files/' + encodeURIComponent(name));
      currentFile = name;
      originalContent = data.content;
      $('#editorFileName').textContent = name;
      $('#codeTextarea').value = data.content;
      $('#codeTextarea').disabled = false;
      $('#saveFileBtn').disabled = false;
      $('#deleteFileBtn').disabled = false;
      $('#editorStatus').textContent = 'Saved';
      $('#editorStatus').className = 'editor-status saved';
      $$('.file-item').forEach(i=> i.classList.toggle('active', i.dataset.file === name));
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#codeTextarea').addEventListener('input', ()=>{
    if(!currentFile) return;
    const dirty = $('#codeTextarea').value !== originalContent;
    $('#editorStatus').textContent = dirty ? 'Unsaved changes' : 'Saved';
    $('#editorStatus').className = 'editor-status ' + (dirty ? 'dirty' : 'saved');
  });

  $('#saveFileBtn').addEventListener('click', async ()=>{
    if(!currentFile) return;
    try{
      await api('/admin/files/' + encodeURIComponent(currentFile), {method:'PUT', body:{content: $('#codeTextarea').value}});
      originalContent = $('#codeTextarea').value;
      $('#editorStatus').textContent = 'Saved';
      $('#editorStatus').className = 'editor-status saved';
      toast(`${currentFile} saved. A backup of the previous version was kept.`, 'success');
      loadCode();
    } catch(e){ toast(e.message, 'error'); }
  });

  $('#deleteFileBtn').addEventListener('click', async ()=>{
    if(!currentFile) return;
    if(!confirmDialog(`Delete ${currentFile}? A backup will be kept, but this removes it from the live site.`)) return;
    try{
      await api('/admin/files/' + encodeURIComponent(currentFile), {method:'DELETE'});
      toast(`${currentFile} deleted.`, 'success');
      currentFile = null;
      $('#editorFileName').textContent = 'Select a file';
      $('#codeTextarea').value = '';
      $('#codeTextarea').disabled = true;
      $('#saveFileBtn').disabled = true;
      $('#deleteFileBtn').disabled = true;
      loadCode();
    } catch(e){ toast(e.message, 'error'); }
  });

  $('#newFileBtn').addEventListener('click', async ()=>{
    const name = $('#newFileName').value.trim();
    if(!name) return;
    try{
      await api('/admin/files', {method:'POST', body:{name, content:''}});
      $('#newFileName').value = '';
      toast(`${name} created.`, 'success');
      loadCode();
      openFile(name);
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // LEADS
  // ======================================================
  async function loadLeads(){
    try{
      const leads = await api('/admin/leads');
      const tbody = $('#leadsTable tbody');
      if(!leads.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No leads yet.</td></tr>`; return; }
      tbody.innerHTML = leads.slice().reverse().map(l => `
        <tr>
          <td>${l.name}</td><td>${l.email}</td><td>${l.phone}</td><td>${l.track}</td>
          <td><span class="pill ${l.status}">${l.status}</span></td>
          <td>${new Date(l.createdAt).toLocaleString()}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-mark-contacted="${l.id}">Mark Contacted</button>
            <button class="btn btn-danger btn-sm" data-delete-lead="${l.id}">Delete</button>
          </td>
        </tr>`).join('');
      $$('[data-mark-contacted]').forEach(btn=> btn.addEventListener('click', async ()=>{
        await api('/admin/leads/' + btn.dataset.markContacted, {method:'PUT', body:{status:'contacted'}});
        loadLeads();
      }));
      $$('[data-delete-lead]').forEach(btn=> btn.addEventListener('click', async ()=>{
        if(!confirmDialog('Delete this lead?')) return;
        await api('/admin/leads/' + btn.dataset.deleteLead, {method:'DELETE'});
        loadLeads();
      }));
    } catch(e){ toast(e.message, 'error'); }
  }

  // ======================================================
  // WEBINAR
  // ======================================================
  async function loadWebinar(){
    try{
      const content = await api('/admin/content');
      const w = content.webinar;
      $('#w-title').value = w.title || '';
      $('#w-venue').value = w.venue || '';
      $('#w-address').value = w.address || '';
      $('#w-date').value = w.dateISO || '';
      $('#w-endtime').value = w.endTime || '';

      const regs = await api('/admin/webinar-registrations');
      $('#regCount').textContent = regs.length;
      const tbody = $('#regTable tbody');
      if(!regs.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No registrations yet.</td></tr>`; return; }
      tbody.innerHTML = regs.slice().reverse().map(r => `
        <tr>
          <td>${r.name}</td><td>${r.email}</td><td>${r.phone}</td><td>${r.track}</td><td>${r.guests}</td>
          <td>${new Date(r.registeredAt).toLocaleString()}</td>
          <td><button class="btn btn-danger btn-sm" data-delete-reg="${r.id}">Remove</button></td>
        </tr>`).join('');
      $$('[data-delete-reg]').forEach(btn=> btn.addEventListener('click', async ()=>{
        if(!confirmDialog('Remove this registration?')) return;
        await api('/admin/webinar-registrations/' + btn.dataset.deleteReg, {method:'DELETE'});
        loadWebinar();
      }));
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#saveWebinarBtn').addEventListener('click', async ()=>{
    try{
      await api('/admin/webinar-config', {body:{
        title: $('#w-title').value, venue: $('#w-venue').value, address: $('#w-address').value,
        dateISO: $('#w-date').value, endTime: $('#w-endtime').value
      }, method:'PUT'});
      toast('Webinar details updated.', 'success');
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // STUDENTS
  // ======================================================
  async function loadStudents(){
    try{
      const students = await api('/admin/students');
      const tbody = $('#studentsTable tbody');
      if(!students.length){ tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No students yet.</td></tr>`; return; }
      tbody.innerHTML = students.map(s => `
        <tr>
          <td>${s.name}</td><td>${s.email}</td><td>${s.track}</td>
          <td>Week ${s.weekProgress}/${s.totalWeeks}</td><td>${s.xp}/${s.xpTarget}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-edit-student="${s.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-delete-student="${s.id}">Delete</button>
          </td>
        </tr>`).join('');
      $$('[data-edit-student]').forEach(btn=> btn.addEventListener('click', async ()=>{
        const s = students.find(x=>x.id===btn.dataset.editStudent);
        const values = await openModal('Edit Student', [
          {key:'name', label:'Name'}, {key:'email', label:'Email'},
          {key:'track', label:'Track'}, {key:'weekProgress', label:'Week Progress', type:'number'},
          {key:'xp', label:'XP', type:'number'}, {key:'password', label:'New password (leave blank to keep)'}
        ], s);
        if(!values) return;
        if(!values.password) delete values.password;
        await api('/admin/students/' + s.id, {method:'PUT', body:values});
        toast('Student updated.', 'success');
        loadStudents();
      }));
      $$('[data-delete-student]').forEach(btn=> btn.addEventListener('click', async ()=>{
        if(!confirmDialog('Delete this student account?')) return;
        await api('/admin/students/' + btn.dataset.deleteStudent, {method:'DELETE'});
        loadStudents();
      }));
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#addStudentBtn').addEventListener('click', async ()=>{
    const values = await openModal('Add Student', [
      {key:'name', label:'Name'}, {key:'email', label:'Email'}, {key:'password', label:'Password'},
      {key:'track', label:'Track', type:'select', options:['Digital Marketing','Artificial Intelligence','Data Science','Full Stack Development']}
    ]);
    if(!values) return;
    try{
      await api('/admin/students', {method:'POST', body:values});
      toast('Student added.', 'success');
      loadStudents();
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // MENTORS
  // ======================================================
  async function loadMentors(){
    try{
      const mentors = await api('/admin/mentors');
      const tbody = $('#mentorsTable tbody');
      if(!mentors.length){ tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No mentors yet.</td></tr>`; }
      else {
        tbody.innerHTML = mentors.map(m => `
          <tr>
            <td>${m.name}</td><td>${m.track}</td><td>₹${m.ratePerSession}</td>
            <td>${m.sessionsCompleted}</td><td>${m.sessionsPaid}</td><td>${m.sessionsPending}</td>
            <td class="row-actions">
              <button class="btn btn-ghost btn-sm" data-edit-mentor="${m.id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-delete-mentor="${m.id}">Delete</button>
            </td>
          </tr>`).join('');
      }
      $$('[data-edit-mentor]').forEach(btn=> btn.addEventListener('click', async ()=>{
        const m = mentors.find(x=>x.id===btn.dataset.editMentor);
        const values = await openModal('Edit Mentor', [
          {key:'name', label:'Name'}, {key:'track', label:'Track'},
          {key:'ratePerSession', label:'Rate per session (₹)', type:'number'},
          {key:'sessionsCompleted', label:'Sessions completed', type:'number'},
          {key:'sessionsPaid', label:'Sessions paid', type:'number'},
          {key:'sessionsPending', label:'Sessions pending', type:'number'}
        ], m);
        if(!values) return;
        ['ratePerSession','sessionsCompleted','sessionsPaid','sessionsPending'].forEach(k=> values[k] = Number(values[k]));
        await api('/admin/mentors/' + m.id, {method:'PUT', body:values});
        toast('Mentor updated.', 'success');
        loadMentors();
      }));
      $$('[data-delete-mentor]').forEach(btn=> btn.addEventListener('click', async ()=>{
        if(!confirmDialog('Delete this mentor account?')) return;
        await api('/admin/mentors/' + btn.dataset.deleteMentor, {method:'DELETE'});
        loadMentors();
      }));

      // Corrections
      const allCorrections = [];
      mentors.forEach(m => m.correctionRequests.forEach(c => allCorrections.push({...c, mentorName: m.name, mentorId: m.id})));
      const ctbody = $('#correctionsTable tbody');
      if(!allCorrections.length){ ctbody.innerHTML = `<tr><td colspan="6" class="empty-state">No correction requests.</td></tr>`; return; }
      ctbody.innerHTML = allCorrections.map(c => `
        <tr>
          <td>${c.mentorName}</td><td>${c.weekOrSession || '—'}</td><td>${c.issue}</td><td>${c.details || '—'}</td>
          <td><span class="pill ${c.status}">${c.status}</span></td>
          <td>${c.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-resolve="${c.mentorId}|${c.id}">Mark Resolved</button>` : '—'}</td>
        </tr>`).join('');
      $$('[data-resolve]').forEach(btn=> btn.addEventListener('click', async ()=>{
        const [mentorId, reqId] = btn.dataset.resolve.split('|');
        await api(`/admin/mentors/${mentorId}/corrections/${reqId}`, {method:'PUT', body:{status:'resolved'}});
        toast('Correction marked as resolved.', 'success');
        loadMentors();
      }));
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#addMentorBtn').addEventListener('click', async ()=>{
    const values = await openModal('Add Mentor', [
      {key:'name', label:'Name'}, {key:'email', label:'Email'}, {key:'password', label:'Password'},
      {key:'track', label:'Track', type:'select', options:['Digital Marketing','Artificial Intelligence','Data Science','Full Stack Development']},
      {key:'ratePerSession', label:'Rate per session (₹)', type:'number', placeholder:'2000'}
    ]);
    if(!values) return;
    values.ratePerSession = Number(values.ratePerSession) || 2000;
    try{
      await api('/admin/mentors', {method:'POST', body:values});
      toast('Mentor added.', 'success');
      loadMentors();
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // EMPLOYERS
  // ======================================================
  async function loadEmployers(){
    try{
      const employers = await api('/admin/employers');
      const tbody = $('#employersTable tbody');
      if(!employers.length){ tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No employers yet.</td></tr>`; }
      else {
        tbody.innerHTML = employers.map(e => `
          <tr>
            <td>${e.company || '—'}</td><td>${e.name}</td><td>${e.email}</td><td>${e.hiringRequests.length}</td>
            <td class="row-actions">
              <button class="btn btn-ghost btn-sm" data-edit-employer="${e.id}">Edit</button>
              <button class="btn btn-danger btn-sm" data-delete-employer="${e.id}">Delete</button>
            </td>
          </tr>`).join('');
      }
      $$('[data-edit-employer]').forEach(btn=> btn.addEventListener('click', async ()=>{
        const e = employers.find(x=>x.id===btn.dataset.editEmployer);
        const values = await openModal('Edit Employer', [
          {key:'name', label:'Contact name'}, {key:'company', label:'Company'}, {key:'email', label:'Email'}
        ], e);
        if(!values) return;
        await api('/admin/employers/' + e.id, {method:'PUT', body:values});
        toast('Employer updated.', 'success');
        loadEmployers();
      }));
      $$('[data-delete-employer]').forEach(btn=> btn.addEventListener('click', async ()=>{
        if(!confirmDialog('Delete this employer account?')) return;
        await api('/admin/employers/' + btn.dataset.deleteEmployer, {method:'DELETE'});
        loadEmployers();
      }));

      const allRequests = [];
      employers.forEach(e => e.hiringRequests.forEach(r => allRequests.push({...r, company: e.company || e.name})));
      const htbody = $('#hiringTable tbody');
      if(!allRequests.length){ htbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hiring requests yet.</td></tr>`; return; }
      htbody.innerHTML = allRequests.slice().reverse().map(r => `
        <tr>
          <td>${r.company}</td><td>${r.department}</td><td>${r.roleTitle || '—'}</td>
          <td>${r.openings}</td><td>${r.matches.length} matched</td><td>${new Date(r.createdAt).toLocaleDateString()}</td>
        </tr>`).join('');
    } catch(e){ toast(e.message, 'error'); }
  }

  $('#addEmployerBtn').addEventListener('click', async ()=>{
    const values = await openModal('Add Employer', [
      {key:'name', label:'Contact name'}, {key:'company', label:'Company'},
      {key:'email', label:'Email'}, {key:'password', label:'Password'}
    ]);
    if(!values) return;
    try{
      await api('/admin/employers', {method:'POST', body:values});
      toast('Employer added.', 'success');
      loadEmployers();
    } catch(e){ toast(e.message, 'error'); }
  });

  // ======================================================
  // SETTINGS
  // ======================================================
  $('#changePassBtn').addEventListener('click', async ()=>{
    const currentPassword = $('#s-current-pass').value;
    const newPassword = $('#s-new-pass').value;
    const msg = $('#settingsMsg');
    try{
      await api('/admin/change-password', {method:'PUT', body:{currentPassword, newPassword}});
      msg.style.color = 'var(--green)';
      msg.textContent = 'Password updated.';
      msg.classList.add('show');
      $('#s-current-pass').value = ''; $('#s-new-pass').value = '';
    } catch(e){
      msg.style.color = 'var(--red)';
      msg.textContent = e.message;
      msg.classList.add('show');
    }
  });

})();
