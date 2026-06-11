// server.js
// Backend Node.js che legge un file di log (tail -F) e invia righe di log + aggregati "top consumers" via WebSocket
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

// Semplice funzione di parsing: adattala al formato dei tuoi log
function parseLogLine(line) {
  // Esempio di riga: "[service=svcA] cpu=12.3 mem=45.0 message=..."
  // Per il bot Discord, si assume che il logger includa 'service=Bot' o 'user=' o 'shard=' ecc.
  const svc = (line.match(/service=([^\s,\]]+)/) || [null, 'discord-bot'])[1];
  const cpu = parseFloat((line.match(/cpu=([0-9.]+)/) || [null, '0'])[1]) || 0;
  const mem = parseFloat((line.match(/mem=([0-9.]+)/) || [null, '0'])[1]) || 0;
  return { service: svc || 'discord-bot', cpu, mem, raw: line };
}

let aggregates = {}; // aggregates[service] = { cpu: sum, mem: sum, count }

function addToAggregates(parsed) {
  const s = parsed.service || 'discord-bot';
  if (!aggregates[s]) aggregates[s] = { cpu: 0, mem: 0, count: 0 };
  aggregates[s].cpu += parsed.cpu;
  aggregates[s].mem += parsed.mem;
  aggregates[s].count += 1;
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

// Avvia tail sul file di log (Linux). Se non vuoi usare tail, integra la tua fonte di log qui.
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

// Endpoint statico per servire frontend dalla cartella 'public'
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  socket.on('command', (cmd) => {
    if (typeof cmd !== 'string') return;
    if (cmd.trim() === 'top') {
      socket.emit('top', computeTop());
    }
    // qui puoi aggiungere altri comandi remoti
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
