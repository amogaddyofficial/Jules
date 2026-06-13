# Bot "Testing" — Conta Partnership

Bot Discord semplice: tiene il conteggio delle partnership per ogni utente, con classifica. Nessun ping/notifica viene mai inviato.

## 1. Crea l'applicazione Discord

1. Vai su https://discord.com/developers/applications e fai login.
2. Clicca **New Application**, dagli un nome (es. "Testing").
3. Nel menu a sinistra vai su **Bot** → **Add Bot**.
4. Sotto "Privileged Gateway Intents" attiva **SERVER MEMBERS INTENT** (serve per mostrare i nomi nella classifica).
5. Clicca **Reset Token** / **Copy** per ottenere il **TOKEN** del bot — tienilo segreto, non condividerlo con nessuno.
6. Vai su **OAuth2 → General** e copia il **CLIENT ID** (Application ID).

## 2. Invita il bot nel server

1. Vai su **OAuth2 → URL Generator**.
2. In "Scopes" seleziona: `bot` e `applications.commands`.
3. In "Bot Permissions" seleziona almeno: `Send Messages`, `Use Application Commands`.
4. Copia il link generato in fondo alla pagina, aprilo nel browser e seleziona il tuo server.

## 3. Recupera l'ID del server e dei ruoli

1. In Discord, vai su **Impostazioni utente → Avanzate** e attiva **Modalità sviluppatore**.
2. Tasto destro sull'icona del server → **Copia ID server** → questo è `GUILD_ID`.
3. Tasto destro sul ruolo **Staff** (se esiste) → **Copia ID ruolo** → questo è `STAFF_ROLE_ID`.
4. Tasto destro sul ruolo **Partnership Manager** → **Copia ID ruolo** → questo è `PARTNER_MANAGER_ROLE_ID`.

Puoi compilare uno solo dei due, entrambi, o nessuno (in quel caso solo gli Amministratori del server potranno usare `/partnership-add` e `/partnership-remove`).

## 4. Configura il bot

1. Copia il file `.env.example` e rinominalo in `.env`.
2. Compila i valori:
   ```
   TOKEN=il-token-copiato-al-punto-1.5
   CLIENT_ID=il-client-id-copiato-al-punto-1.6
   GUILD_ID=l-id-del-server
   STAFF_ROLE_ID=l-id-del-ruolo-staff
   PARTNER_MANAGER_ROLE_ID=l-id-del-ruolo-partnership-manager
   ```

## 5. Avvia il bot

Nella cartella del bot:
```bash
npm install
node index.js
```

Se vedi `✅ NomeBot è online! (bot testing - partnership)` nel terminale, il bot è connesso e i comandi sono stati registrati su Discord.

## Comandi disponibili

| Comando | Chi può usarlo | Cosa fa |
|---|---|---|
| `/partnership-add utente quantità` | Staff/Partnership Manager/Admin | Aggiunge partnership a un utente (default 1 se non specificato) |
| `/partnership-remove utente quantità` | Staff/Partnership Manager/Admin | Rimuove partnership a un utente (default 1, non va sotto 0) |
| `/partnership-classifica` | Tutti | Mostra la classifica (top 15) con numerazione 1, 2, 3... |
| `/partnership-conta [utente]` | Tutti | Mostra quante partnership ha un utente (default: te stesso) |

I dati vengono salvati nel file `partnership_counts.json` nella cartella del bot — fai un backup ogni tanto se vuoi conservare i dati.

## Note

- Nessun comando invia ping/notifiche agli utenti: la classifica mostra il nome, non la menzione `@`.
- Il bot deve restare in esecuzione (`node index.js`) per funzionare. Se lo chiudi, il bot va offline.
