// server.js
// Backend Node.js che legge un file di log (tail -F) o riceve metriche via POST e invia righe di log + aggregati "top consumers" via WebSocket
// Dipendenze: express, socket.io

const express = require('express');
const http = require('http');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

// Configurazione
const LOG_PATH = process.env.LOG_PATH || '/var/log/myapp.log'; // cambia se necessario
const TOP_INTERVAL_MS = parseInt(process.env.TOP_INTERVAL_MS || '2000', 10);
const TOP_N = parseInt(process.env.TOP_N || '10', 10);
const HISTORY_MAX_POINTS = parseInt(process.env.HISTORY_MAX_POINTS || '360', 10); // punti per grafici in memoria

// middleware
app.use(express.json());
app.use(express.static('public'));

// Semplice funzione di parsing: adattala al formato dei tuoi log
function parseLogLine(line) {
  // Esempio di riga: "[service=svcA] cpu=12.3 mem=45.0 message=..."
  const svc = (line.match(/service=([^\s,\]]+)/) || [null, 'discord-bot'])[1];
  const cpu = parseFloat((line.match(/cpu=([0-9.]+)/) || [null, '0'])[1]) || 0;
  const mem = parseFloat((line.match(/mem=([0-9.]+)/) || [null, '0'])[1]) || 0;
  return { service: svc || 'discord-bot', cpu, mem, raw: line, ts: Date.now() };
}

let aggregates = {}; // aggregates[service] = { cpu: sum, mem: sum, count }
let history = {}; // history[service] = [{ ts, cpu, mem }, ...]

function addToAggregates(parsed) {
  const s = parsed.service || 'discord-bot';
  if (!aggregates[s]) aggregates[s] = { cpu: 0, mem: 0, count: 0 };
  aggregates[s].cpu += parsed.cpu;
  aggregates[s].mem += parsed.mem;
  aggregates[s].count += 1;

  if (!history[s]) history[s] = [];
  history[s].push({ ts: parsed.ts || Date.now(), cpu: parsed.cpu, mem: parsed.mem });
  // keep history bounded
  if (history[s].length > HISTORY_MAX_POINTS) history[s].shift();
}

function computeTop(n = TOP_N) {
  const arr = Object.entries(aggregates).map(([service, v]) => ({
    service,
    cpu_total: v.cpu,
    mem_total: v.mem,
    count: v.count,
    cpu_avg: v.count ? v.cpu / v.count : 0,
    mem_avg: v.count ? v.mem / v.count : 0,
  }));
  arr.sort((a, b) => b.cpu_total - a.cpu_total);
  return arr.slice(0, n);
}

// Endpoint per ricevere metriche push dal bot (consigliato su Render)
app.post('/ingest-metric', (req, res) => {
  const token = req.headers['x-dashboard-token'] || req.query.token;
  if (process.env.DASHBOARD_TOKEN && token !== process.env.DASHBOARD_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const payload = req.body || {};
  const service = payload.service || 'discord-bot';
  const cpu = Number(payload.cpu || 0);
  const mem = Number(payload.mem || 0);
  const ts = payload.ts || Date.now();
  const parsed = { service, cpu, mem, raw: JSON.stringify(payload), ts };
  addToAggregates(parsed);
  // emetto metric e anche la riga raw per il terminale
  io.emit('metric', { service, cpu, mem, ts });
  io.emit('log_line', parsed.raw);
  return res.status(204).end();
});

// Endpoint per ottenere storici in memoria (solo dal momento in cui il server è stato avviato)
app.get('/history', (req, res) => {
  const service = req.query.service || 'discord-bot';
  res.json({ service, data: history[service] || [] });
});

// tail -F per seguire file di log (solo se disponibile)
let tail;
try {
  tail = spawn('tail', ['-F', LOG_PATH]);
} catch (e) {
  console.error('Errore avviando tail:', e);
}

if (tail) {
  tail.stdout.setEncoding('utf8');
  tail.stdout.on('data', (chunk) => {
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    lines.forEach((line) => {
      const parsed = parseLogLine(line);
      addToAggregates(parsed);
      io.emit('log_line', parsed.raw);
    });
  });

  tail.on('error', (err) => console.error('tail error', err));
  tail.on('exit', (code) => console.warn('tail exited', code));
} else {
  console.warn('tail non disponibile: assicurati che il sistema abbia il comando tail o usa un altro meccanismo per leggere i log.');
}

// protezione socket (se DASHBOARD_TOKEN impostato)
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (process.env.DASHBOARD_TOKEN && token !== process.env.DASHBOARD_TOKEN) return next(new Error('unauthorized'));
    return next();
  } catch (e) { return next(); }
});

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  // invio lo storico del servizio discord-bot al client appena connesso
  const defaultService = 'discord-bot';
  socket.emit('history', { service: defaultService, data: history[defaultService] || [] });

  socket.on('command', (cmd) => {
    if (typeof cmd !== 'string') return;
    if (cmd.trim() === 'top') {
      socket.emit('top', computeTop());
    }
  });

  const interval = setInterval(() => {
    socket.emit('top', computeTop());
  }, TOP_INTERVAL_MS);

  socket.on('disconnect', () => {
    clearInterval(interval);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server in ascolto su http://localhost:${PORT}`));
