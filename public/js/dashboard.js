// public/js/dashboard.js
// Client-side per la dashboard: xterm.js + socket.io-client + Chart.js
// Miglioramenti: prende token da query string o prompt, mostra errori di connessione nel terminale,
// supporta comando client-side "test" per inviare una metrica di prova via /ingest-metric.

(function () {
  // leggi token da querystring o chiedi con prompt (utile per testing rapido)
  function getToken() {
    const qs = new URLSearchParams(window.location.search);
    const t = qs.get('token');
    if (t) return t;
    // non chiedere prompt in ambienti senza prompt (opzionale)
    try {
      const p = prompt('Inserisci DASHBOARD_TOKEN (lascia vuoto per test senza token):');
      return p || '';
    } catch (e) {
      return '';
    }
  }

  const token = getToken();
  const socket = io({ auth: { token } });

  const term = new window.Terminal({ cols: 120, rows: 30, cursorBlink: true });
  term.open(document.getElementById('terminal'));
  term.writeln('Connesso alla dashboard dei log. Digita "top" e premi Enter per vedere i maggiori consumatori.');
  term.writeln('Digitare "test" per inviare una metrica di prova dal browser (non invia al bot).');

  // Chart.js setup (crea canvas se non esiste)
  const cpuCtx = createCanvasAndGetCtx('cpuChart', 'CPU %');
  const memCtx = createCanvasAndGetCtx('memChart', 'Memory (MB)');

  const cpuChart = new Chart(cpuCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'CPU %', data: [], borderColor: '#ff6384', fill: false }] },
    options: { animation: false, scales: { x: { type: 'time', time: { unit: 'second' } }, y: { beginAtZero: true } } }
  });

  const memChart = new Chart(memCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Memory MB', data: [], borderColor: '#36a2eb', fill: false }] },
    options: { animation: false, scales: { x: { type: 'time', time: { unit: 'second' } }, y: { beginAtZero: true } } }
  });

  function createCanvasAndGetCtx(id, title) {
    let el = document.getElementById(id);
    if (!el) {
      const parent = document.getElementById('right');
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '8px';
      wrapper.innerHTML = `<div style="font-weight:600;margin-bottom:6px">${title}</div><canvas id="${id}" height="120"></canvas>`;
      parent.prepend(wrapper);
      el = document.getElementById(id);
    }
    return el.getContext('2d');
  }

  // buffer per grafici (in memoria solo durante runtime)
  const service = 'discord-bot';
  const history = []; // {ts, cpu, mem}
  const HISTORY_MAX = Number(window.HISTORY_MAX || 360);

  function pushPoint(pt) {
    history.push(pt);
    if (history.length > HISTORY_MAX) history.shift();
    // aggiorna charts
    cpuChart.data.labels = history.map(p => new Date(p.ts));
    cpuChart.data.datasets[0].data = history.map(p => p.cpu);
    cpuChart.update();
    memChart.data.labels = cpuChart.data.labels;
    memChart.data.datasets[0].data = history.map(p => (p.mem / 1024 / 1024));
    memChart.update();
  }

  let inputBuffer = '';
  term.write('\r\n> ');

  socket.on('connect', () => {
    term.writeln('\r\n[connesso al server]');
  });

  socket.on('connect_error', (err) => {
    try { term.writeln('\r\n[connect_error] ' + (err.message || String(err))); } catch (e) { console.error('term write', e); }
    console.error('socket connect_error', err);
  });

  socket.on('log_line', (line) => {
    try { term.writeln(line); } catch (e) { console.warn('term write err', e); }
  });

  socket.on('history', (payload) => {
    // payload: { service, data: [{ts,cpu,mem}, ...] }
    (payload.data || []).forEach(p => pushPoint(p));
  });

  socket.on('metric', (m) => {
    if ((m.service || service) === service) pushPoint(m);
  });

  socket.on('top', (list) => {
    const tbody = document.querySelector('#tops tbody');
    tbody.innerHTML = '';
    (list || []).forEach(l => {
      const tr = document.createElement('tr');
      const memMB = (Number(l.mem_total || 0) / 1024 / 1024).toFixed(2);
      tr.innerHTML = `<td>${escapeHtml(l.service)}</td><td style="text-align:right">${Number(l.cpu_total||0).toFixed(2)}</td><td style="text-align:right">${memMB}</td><td style="text-align:right">${Number(l.count||0)}</td>`;
      tbody.appendChild(tr);
    });
  });

  term.onKey(({ key, domEvent }) => {
    const ev = domEvent;
    if (ev.key === 'Enter') {
      term.writeln('');
      const cmd = inputBuffer.trim();
      if (cmd) handleCommand(cmd);
      inputBuffer = '';
      term.write('\r\n> ');
    } else if (ev.key === 'Backspace') {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        term.write('\b \b');
      }
    } else {
      inputBuffer += key;
      term.write(key);
    }
  });

  function handleCommand(cmd) {
    if (cmd === 'test') {
      // invia una metrica di prova dal browser stesso
      const payload = { service, cpu: Math.random() * 50, mem: Math.floor(Math.random() * 100000000), ts: Date.now() };
      fetch('/ingest-metric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
        body: JSON.stringify(payload)
      }).then(r => {
        if (r.status === 204) term.writeln('[test] metrica inviata con successo');
        else term.writeln('[test] errore invio metrica: ' + r.status);
      }).catch(err => {
        term.writeln('[test] fetch error: ' + (err.message || err));
      });
      return;
    }
    // altrimenti invia al server come comando normale (es. top)
    socket.emit('command', cmd);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();
