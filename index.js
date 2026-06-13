require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} = require("discord.js");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

const DATA_FILE = path.join(__dirname, "partnership_counts.json");

const chartCanvas = new ChartJSNodeCanvas({ width: 800, height: 400, backgroundColour: "#2b2d31" });

function loadCounts() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, history: {}, globalHistory: [] };
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!data.history) data.history = {};
    if (!data.globalHistory) data.globalHistory = [];
    return data;
  } catch {
    return { users: {}, history: {}, globalHistory: [] };
  }
}

function saveCounts(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const staffRoleId = process.env.STAFF_ROLE_ID;
  if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;

  const partnerManagerRoleId = process.env.PARTNER_MANAGER_ROLE_ID;
  if (partnerManagerRoleId && member.roles.cache.has(partnerManagerRoleId)) return true;

  return false;
}

async function getDisplayName(guild, userId) {
  try {
    const member = await guild.members.fetch(userId);
    return member.displayName;
  } catch {
    try {
      const user = await guild.client.users.fetch(userId);
      return user.username;
    } catch {
      return `Utente sconosciuto (${userId})`;
    }
  }
}

function recordHistory(data, userId, total) {
  const now = Date.now();
  if (!data.history[userId]) data.history[userId] = [];
  data.history[userId].push({ t: now, v: total });

  const globalTotal = Object.values(data.users || {}).reduce((sum, v) => sum + v, 0);
  data.globalHistory.push({ t: now, v: globalTotal });
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

async function buildTimelineChart(series, label) {
  const points = series.length > 0 ? series : [{ t: Date.now(), v: 0 }];
  return chartCanvas.renderToBuffer({
    type: "line",
    data: {
      labels: points.map(p => formatDate(p.t)),
      datasets: [
        {
          label,
          data: points.map(p => p.v),
          borderColor: "#5865F2",
          backgroundColor: "rgba(88, 101, 242, 0.2)",
          fill: true,
          tension: 0.2,
          stepped: true
        }
      ]
    },
    options: {
      plugins: {
        legend: { labels: { color: "#ffffff" } },
        title: { display: true, text: label, color: "#ffffff" }
      },
      scales: {
        x: { ticks: { color: "#ffffff" }, grid: { color: "#444444" } },
        y: { ticks: { color: "#ffffff" }, grid: { color: "#444444" }, beginAtZero: true }
      }
    }
  });
}

async function buildLeaderboardEmbed(guild, data) {
  const sorted = Object.entries(data.users || {})
    .filter(([, count]) => count !== 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  let description;
  if (sorted.length === 0) {
    description = "Nessuna partnership registrata per ora.";
  } else {
    const lines = await Promise.all(
      sorted.map(async ([userId, count], index) => {
        const name = await getDisplayName(guild, userId);
        return `**${index + 1}.** ${name} — **${count}** partnership`;
      })
    );
    description = lines.join("\n");
  }

  return new EmbedBuilder()
    .setTitle("🤝 Classifica Partnership")
    .setDescription(description)
    .setColor("#5865F2")
    .setTimestamp();
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("partnership-add")
      .setDescription("Aggiunge partnership a un utente")
      .addUserOption(option =>
        option.setName("utente").setDescription("Utente a cui aggiungere partnership").setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("quantita").setDescription("Quantità da aggiungere (default 1)").setRequired(false).setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("descrizione").setDescription("Messaggio/descrizione della partnership").setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("partnership-remove")
      .setDescription("Rimuove partnership a un utente")
      .addUserOption(option =>
        option.setName("utente").setDescription("Utente a cui rimuovere partnership").setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("quantita").setDescription("Quantità da rimuovere (default 1)").setRequired(false).setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("descrizione").setDescription("Messaggio/descrizione della partnership").setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("partnership-classifica")
      .setDescription("Mostra la classifica delle partnership"),

    new SlashCommandBuilder()
      .setName("partnership-conta")
      .setDescription("Mostra il numero di partnership di un utente")
      .addUserOption(option =>
        option.setName("utente").setDescription("Utente da controllare (default: te stesso)").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("partnership-grafico")
      .setDescription("Mostra il grafico della timeline delle partnership")
      .addUserOption(option =>
        option.setName("utente").setDescription("Utente da controllare (default: totale generale)").setRequired(false)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Comandi slash caricati!");
  } catch (error) {
    console.error("❌ Errore registrazione comandi:", error);
  }
}

client.once("clientReady", async () => {
  console.log(`✅ ${client.user.tag} è online! (bot testing - partnership)`);
  await registerSlashCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const noPing = { allowedMentions: { parse: [] } };

  try {
    if (interaction.commandName === "partnership-add" || interaction.commandName === "partnership-remove") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Non hai i permessi per usare questo comando.",
          flags: 64,
          ...noPing
        });
      }

      const target = interaction.options.getUser("utente");
      const amount = interaction.options.getInteger("quantita") ?? 1;
      const message = interaction.options.getString("descrizione");
      const isAdd = interaction.commandName === "partnership-add";

      const data = loadCounts();
      const current = data.users[target.id] || 0;
      const updated = isAdd ? current + amount : Math.max(0, current - amount);
      data.users[target.id] = updated;
      recordHistory(data, target.id, updated);
      saveCounts(data);

      const totalGlobal = Object.values(data.users || {}).reduce((sum, v) => sum + v, 0);

      const embed = new EmbedBuilder()
        .setTitle(isAdd ? "➕ Partnership aggiunte" : "➖ Partnership rimosse")
        .addFields(
          { name: "Utente", value: `<@${target.id}>`, inline: true },
          { name: "Partnership utente", value: `${updated}`, inline: true },
          { name: "Totale server", value: `${totalGlobal}`, inline: true },
          { name: "Gestito da", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Data e ora", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setColor(isAdd ? "#00ff99" : "#ff3333");

      return interaction.reply({
        content: message || undefined,
        embeds: [embed],
        ...noPing
      });
    }

    if (interaction.commandName === "partnership-classifica") {
      const data = loadCounts();
      const embed = await buildLeaderboardEmbed(interaction.guild, data);
      return interaction.reply({ embeds: [embed], ...noPing });
    }

    if (interaction.commandName === "partnership-conta") {
      const target = interaction.options.getUser("utente") || interaction.user;
      const data = loadCounts();
      const count = data.users[target.id] || 0;

      return interaction.reply({
        content: `📊 **${target.username}** ha **${count}** partnership.`,
        flags: 64,
        ...noPing
      });
    }
    if (interaction.commandName === "partnership-grafico") {
      const target = interaction.options.getUser("utente");
      const data = loadCounts();

      let series, label;
      if (target) {
        series = data.history[target.id] || [];
        label = `Partnership di ${target.username}`;
      } else {
        series = data.globalHistory || [];
        label = "Totale partnership del server";
      }

      const buffer = await buildTimelineChart(series, label);
      const attachment = new AttachmentBuilder(buffer, { name: "timeline.png" });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📈 Timeline Partnership")
            .setImage("attachment://timeline.png")
            .setColor("#5865F2")
        ],
        files: [attachment],
        ...noPing
      });
    }
  } catch (error) {
    console.error("Errore nel comando:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Si è verificato un errore.", flags: 64, ...noPing }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(process.env.TOKEN);
