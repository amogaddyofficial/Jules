const { Client, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
require('dotenv').config();

// ========== CONFIGURAZIONE EXPRESS ==========
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

// ========== CONFIGURAZIONE BOT ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DATABASE_PATH = path.join(__dirname, 'database.json');
let botStartTime = Date.now();
let totalCommands = 0;
let totalErrors = 0;

// ========== SISTEMA DI LOG ==========
const logs = [];
const MAX_LOGS = 500;

function addLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type, // 'info', 'error', 'success', 'warning'
    message
  };

  logs.push(logEntry);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  const prefix = {
    'info': '📝',
    'error': '❌',
    'success': '✓',
    'warning': '⚠️'
  }[type] || '•';

  console.log(`[${timestamp}] ${prefix} ${message}`);
}

// ========== COSTANTI E CONFIGURAZIONI ==========
const SLASH_COMMANDS = [
  {
    name: 'partnership',
    description: 'Pubblica una partnership (solo Partner Manager)',
    options: [
      {
        name: 'utente',
        description: 'L\'utente con cui è stata fatta la partnership',
        type: 6, // USER type
        required: true
      }
    ]
  },
  {
    name: 'count',
    description: 'Vedi il conteggio delle partnership di un utente',
    options: [
      {
        name: 'utente',
        description: 'Utente di cui controllare il conteggio (default: tu stesso)',
        type: 6,
        required: false
      }
    ]
  },
  {
    name: 'addpartnership',
    description: 'Aggiungi partnership manualmente (Owner e Partner Manager)',
    options: [
      {
        name: 'utente',
        description: 'Utente a cui aggiungere partnership',
        type: 6,
        required: true
      },
      {
        name: 'quantita',
        description: 'Numero di partnership da aggiungere',
        type: 4,
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'removepartnership',
    description: 'Rimuovi partnership manualmente (Owner e Partner Manager)',
    options: [
      {
        name: 'utente',
        description: 'Utente a cui rimuovere partnership',
        type: 6,
        required: true
      },
      {
        name: 'quantita',
        description: 'Numero di partnership da rimuovere',
        type: 4,
        required: true,
        min_value: 1
      }
    ]
  }
];

// ========== UTILITY FUNCTIONS ==========

/**
 * Carica il database dal file JSON
 */
function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_PATH)) {
      return JSON.parse(fs.readFileSync(DATABASE_PATH, 'utf8'));
    }
  } catch (error) {
    addLog(`Errore nel caricamento del database: ${error.message}`, 'error');
    totalErrors++;
  }
  return {
    config: {
      partnershipChannelId: null,
      partnerManagerRoleId: null,
      ownerRoleId: null
    },
    partnerships: {},
    lastUpdate: new Date().toISOString()
  };
}

/**
 * Salva il database nel file JSON (locale solamente)
 */
function saveDatabase(data) {
  try {
    data.lastUpdate = new Date().toISOString();
    fs.writeFileSync(DATABASE_PATH, JSON.stringify(data, null, 2));
    addLog('Database salvato', 'success');
  } catch (error) {
    addLog(`Errore nel salvataggio del database: ${error.message}`, 'error');
    totalErrors++;
  }
}

/**
 * Rimuove i tag di massa (@everyone, @here) dal testo
 */
function sanitizePartnershipMessage(text) {
  return text
    .replace(/@everyone/g, '@ᴇᴠᴇʀʏᴏɴᴇ')
    .replace(/@here/g, '@ʜᴇʀᴇ')
    .replace(/@[aA]ll/g, '@ᴀʟʟ');
}

/**
 * Verifica se l'utente ha il ruolo necessario
 */
function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  return member.roles.cache.has(roleId);
}

/**
 * Calcola l'uptime del bot in formato leggibile
 */
function getUptimeFormatted() {
  const uptime = Date.now() - botStartTime;
  const seconds = Math.floor((uptime / 1000) % 60);
  const minutes = Math.floor((uptime / (1000 * 60)) % 60);
  const hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Ottieni statistiche del bot
 */
function getStats() {
  const db = loadDatabase();
  const partnershipsCount = Object.keys(db.partnerships).length;
  const totalPartnerships = Object.values(db.partnerships).reduce((sum, p) => sum + p.count, 0);

  return {
    botStatus: client.isReady() ? 'Online ✓' : 'Offline ✗',
    uptime: getUptimeFormatted(),
    totalCommands: totalCommands,
    totalErrors: totalErrors,
    guilds: client.guilds.cache.size,
    users: client.users.cache.size,
    partnersCount: partnershipsCount,
    totalPartnerships: totalPartnerships,
    lastUpdate: db.lastUpdate,
    configStatus: db.config.partnershipChannelId ? 'Configurato ✓' : 'Non configurato ✗',
    memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    nodeVersion: process.version
  };
}

// ========== EXPRESS ROUTES ==========

app.set('view engine', 'ejs');
app.use(express.static('public'));

/**
 * Pagina di statistiche e configurazione del bot
 */
app.get('/', (req, res) => {
  const stats = getStats();
  const db = loadDatabase();
  res.render('index', { stats, logs, config: db.config });
});

/**
 * Salva la configurazione dal web
 */
app.post('/config', (req, res) => {
  const { partnershipChannelId, partnerManagerRoleId, ownerRoleId } = req.body;

  const db = loadDatabase();
  db.config.partnershipChannelId = partnershipChannelId || db.config.partnershipChannelId;
  db.config.partnerManagerRoleId = partnerManagerRoleId || db.config.partnerManagerRoleId;
  db.config.ownerRoleId = ownerRoleId || db.config.ownerRoleId;

  saveDatabase(db);
  addLog('Configurazione aggiornata via Dashboard Web', 'success');

  res.redirect('/?success=true');
});

/**
 * API Logs in JSON
 */
app.get('/api/logs', (req, res) => {
  res.json({
    logs: logs,
    totalLogs: logs.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * Ping per cron job (keep-alive)
 */
app.get('/ping', (req, res) => {
  const stats = getStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...stats
  });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  const isHealthy = client.isReady();
  res.status(isHealthy ? 200 : 503).json({
    healthy: isHealthy,
    timestamp: new Date().toISOString()
  });
});

// ========== BOT EVENT LISTENERS ==========

client.on('ready', () => {
  addLog(`Bot loggato come ${client.user.tag}`, 'success');
  botStartTime = Date.now();
  client.user.setActivity('/setup per configurare il bot', { type: 'WATCHING' });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!sync') {
    if (!message.member.permissions.has('Administrator')) {
      addLog(`${message.author.username} ha tentato !Sync senza permessi`, 'warning');
      return message.reply('❌ Solo gli Amministratori possono eseguire questo comando.');
    }

    try {
      addLog(`Richiesta sincronizzazione comandi da ${message.author.username}`, 'info');

      // Sincronizzazione globale
      await client.application.commands.set(SLASH_COMMANDS);
      addLog('Slash commands sincronizzati globalmente via !Sync', 'success');

      // Sincronizzazione in ogni server (per effetto immediato)
      const guilds = client.guilds.cache;
      addLog(`Sincronizzazione istantanea in ${guilds.size} server...`, 'info');

      for (const [guildId, guild] of guilds) {
        try {
          await guild.commands.set(SLASH_COMMANDS);
          addLog(`Comandi sincronizzati istantaneamente nel server: ${guild.name} (${guildId})`, 'success');
        } catch (guildError) {
          addLog(`Impossibile sincronizzare nel server ${guild.name}: ${guildError.message}`, 'warning');
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Sincronizzazione Completata')
        .setDescription(`I comandi slash sono stati registrati globalmente e in **${guilds.size}** server individuali per un effetto immediato.`)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      addLog(`Errore durante !Sync: ${error.message}`, 'error');
      totalErrors++;
      return message.reply(`❌ Errore durante la sincronizzazione: ${error.message}`);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // ========== SLASH COMMANDS ==========
    if (interaction.isCommand()) {
      totalCommands++;
      const db = loadDatabase();
      const { commandName } = interaction;

      addLog(`Comando eseguito: /${commandName} da ${interaction.user.username}`, 'info');

      // ========== /partnership ==========
      if (commandName === 'partnership') {
        if (!db.config.partnershipChannelId) {
          addLog('Tentativo /partnership senza configurazione', 'warning');
          return interaction.reply({
            content: '❌ Il bot non è stato configurato. Configuralo dalla Dashboard Web.',
            ephemeral: true
          });
        }

        if (!hasRole(interaction.member, db.config.partnerManagerRoleId)) {
          addLog(`${interaction.user.username} ha tentato /partnership senza ruolo`, 'warning');
          return interaction.reply({
            content: '❌ Non hai il ruolo di Partner Manager per usare questo comando.',
            ephemeral: true
          });
        }

        const targetUser = interaction.options.getUser('utente');
        const modal = new ModalBuilder()
          .setCustomId(`partnership_modal_${targetUser.id}`)
          .setTitle('Nuova Partnership');

        const textInput = new TextInputBuilder()
          .setCustomId('partnership_text')
          .setLabel('Testo della Partnership')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(2000);

        const actionRow = new ActionRowBuilder().addComponents(textInput);
        modal.addComponents(actionRow);

        return interaction.showModal(modal);
      }

      // ========== /count ==========
      if (commandName === 'count') {
        const user = interaction.options.getUser('utente') || interaction.user;
        const userId = user.id;
        const count = db.partnerships[userId]?.count || 0;

        addLog(`Conteggio partnership richiesto per ${user.username}: ${count}`, 'info');

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('📊 Conteggio Partnership')
          .setDescription(`**${user.username}** ha registrato **${count}** partnership`)
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      // ========== /addpartnership ==========
      if (commandName === 'addpartnership') {
        const isOwner = hasRole(interaction.member, db.config.ownerRoleId);
        const isPartnerManager = hasRole(interaction.member, db.config.partnerManagerRoleId);

        if (!isOwner && !isPartnerManager) {
          addLog(`${interaction.user.username} ha tentato /addpartnership senza permessi`, 'warning');
          return interaction.reply({
            content: '❌ Solo Owner e Partner Manager possono usare questo comando.',
            ephemeral: true
          });
        }

        const user = interaction.options.getUser('utente');
        const amount = interaction.options.getInteger('quantita');
        const userId = user.id;

        if (!db.partnerships[userId]) {
          db.partnerships[userId] = { count: 0, username: user.username };
        }

        db.partnerships[userId].count += amount;
        saveDatabase(db);
        addLog(`Partnership aggiunte a ${user.username}: +${amount}`, 'success');

        const embed = new EmbedBuilder()
          .setColor(0x00AA00)
          .setTitle('✓ Partnership Aggiunte')
          .setDescription(`Aggiunte **${amount}** partnership a ${user.username}\nTotale: **${db.partnerships[userId].count}**`)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      // ========== /removepartnership ==========
      if (commandName === 'removepartnership') {
        const isOwner = hasRole(interaction.member, db.config.ownerRoleId);
        const isPartnerManager = hasRole(interaction.member, db.config.partnerManagerRoleId);

        if (!isOwner && !isPartnerManager) {
          addLog(`${interaction.user.username} ha tentato /removepartnership senza permessi`, 'warning');
          return interaction.reply({
            content: '❌ Solo Owner e Partner Manager possono usare questo comando.',
            ephemeral: true
          });
        }

        const user = interaction.options.getUser('utente');
        const amount = interaction.options.getInteger('quantita');
        const userId = user.id;

        if (!db.partnerships[userId]) {
          return interaction.reply({
            content: `❌ ${user.username} non ha alcuna partnership registrata.`,
            ephemeral: true
          });
        }

        const newCount = Math.max(0, db.partnerships[userId].count - amount);
        db.partnerships[userId].count = newCount;
        saveDatabase(db);
        addLog(`Partnership rimosse da ${user.username}: -${amount}`, 'success');

        const embed = new EmbedBuilder()
          .setColor(0xAA0000)
          .setTitle('✓ Partnership Rimosse')
          .setDescription(`Rimosse **${amount}** partnership da ${user.username}\nTotale: **${newCount}**`)
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: false });
      }
    }

    // ========== MODAL SUBMISSION ==========
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('partnership_modal_')) {
        const targetUserId = interaction.customId.replace('partnership_modal_', '');
        const db = loadDatabase();
        const partnershipText = interaction.fields.getTextInputValue('partnership_text');
        const sanitizedText = sanitizePartnershipMessage(partnershipText);
        const managerId = interaction.user.id;

        const channel = interaction.guild.channels.cache.get(db.config.partnershipChannelId);
        if (!channel) {
          addLog('Canale partnership non trovato', 'error');
          return interaction.reply({
            content: '❌ Canale partnership non trovato. Contatta un amministratore.',
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0xFF6B00)
          .setTitle('🤝 Partnership Registrata')
          .addFields(
            { name: 'Manager', value: `<@${managerId}>`, inline: true },
            { name: 'Partner', value: `<@${targetUserId}>`, inline: true }
          )
          .setFooter({ text: `Eseguito da ${interaction.user.username}` })
          .setTimestamp();

        await channel.send({
          content: sanitizedText,
          embeds: [embed]
        });

        if (!db.partnerships[managerId]) {
          db.partnerships[managerId] = { count: 0, username: interaction.user.username };
        }
        db.partnerships[managerId].count += 1;

        saveDatabase(db);
        addLog(`Partnership pubblicata da ${interaction.user.username}`, 'success');

        return interaction.reply({
          content: `✓ Partnership pubblicata! Totale: **${db.partnerships[managerId].count}**`,
          ephemeral: true
        });
      }
    }
  } catch (error) {
    addLog(`Errore nell'elaborazione dell'interazione: ${error.message}`, 'error');
    totalErrors++;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ Errore nell\'elaborazione della richiesta.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Errore nell\'elaborazione della richiesta.', ephemeral: true });
    }
  }
});

// ========== REGISTRAZIONE SLASH COMMANDS ==========
client.on('ready', async () => {
  try {
    // Registrazione globale
    await client.application.commands.set(SLASH_COMMANDS);
    addLog('Slash commands registrati globalmente all\'avvio', 'success');

    // Sincronizzazione in ogni server all'avvio per effetto immediato
    const guilds = client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      try {
        await guild.commands.set(SLASH_COMMANDS);
      } catch (err) {
        addLog(`Errore sync iniziale server ${guild.name}: ${err.message}`, 'warning');
      }
    }
  } catch (error) {
    addLog(`Errore nella registrazione comandi all'avvio: ${error.message}`, 'error');
    totalErrors++;
  }
});

// ========== SERVER STARTUP ==========
const server = app.listen(PORT, () => {
  addLog(`Server web avviato su porta ${PORT}`, 'success');
  addLog(`📊 Dashboard: http://localhost:${PORT}`, 'info');
  addLog(`📋 Logs API: http://localhost:${PORT}/api/logs`, 'info');
});

// ========== BOT LOGIN ==========
client.login(process.env.DISCORD_TOKEN).catch(error => {
  addLog(`Errore nel login del bot: ${error.message}`, 'error');
  totalErrors++;
});

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGTERM', () => {
  addLog('SIGTERM ricevuto, chiusura in corso...', 'warning');
  server.close(() => {
    addLog('Server chiuso', 'info');
    client.destroy();
    process.exit(0);
  });
});
