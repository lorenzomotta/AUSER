# Guida all'Installazione e Setup

## Prerequisiti

Prima di iniziare, assicurati di avere installato:

1. **Node.js** (versione 18 o superiore)
   - Scarica da: https://nodejs.org/
   - Verifica installazione: `node --version`

2. **Rust** (ultima versione stabile)
   - Scarica da: https://www.rust-lang.org/tools/install
   - Verifica installazione: `rustc --version`

3. **Tauri CLI** (verrà installato automaticamente con npm)

## Installazione Dipendenze

Apri un terminale nella cartella del progetto ed esegui:

```bash
npm install
```

Questo installerà tutte le dipendenze necessarie, inclusi:
- Bootstrap per lo stile
- Tauri API per la comunicazione frontend-backend
- Vite come bundler

## Sviluppo

Per avviare l'applicazione in modalità sviluppo:

```bash
npm run dev
```

Questo comando:
1. Avvierà il server di sviluppo Vite sulla porta 1420
2. Compilerà il backend Rust
3. Aprirà la finestra dell'applicazione

## Build per Produzione

Per creare l'applicazione installabile:

```bash
npm run tauri build
```

Il comando creerà:
- **Windows**: File `.msi` e `.exe` nella cartella `src-tauri/target/release/bundle/`
- **macOS**: File `.dmg` e `.app`
- **Linux**: File `.deb` e `.AppImage`

## Configurazione SharePoint

### Prima di utilizzare l'app:

1. **Registra l'applicazione su Azure AD**:
   - Vai su https://portal.azure.com
   - Azure Active Directory > App registrations > New registration
   - Imposta un nome per l'app
   - Seleziona "Accounts in this organizational directory only"
   - Aggiungi un Redirect URI: `http://localhost:1420` (per sviluppo)
   - Salva il **Client ID** e **Tenant ID**

2. **Configura le API permissions**:
   - Nella sezione API permissions, aggiungi:
     - Microsoft Graph > Delegated permissions > `Sites.ReadWrite.All`
     - SharePoint > Delegated permissions > `Sites.ReadWrite.All`

3. **Crea un Client Secret**:
   - Vai su Certificates & secrets
   - Crea un nuovo client secret
   - **IMPORTANTE**: Salva il valore immediatamente, non sarà più visibile!

4. **Aggiorna il codice**:
   - Modifica `src-tauri/src/sharepoint.rs` con i tuoi valori
   - Oppure usa variabili d'ambiente (consigliato per sicurezza)

## Configurazione Aggiornamenti Automatici

Vedi il file **[AGGIORNAMENTI.md](AGGIORNAMENTI.md)** per la guida completa
(chiavi, secret GitHub, come pubblicare una nuova versione).

In sintesi: l'updater Tauri è attivo; dopo aver impostato il secret
`TAURI_PRIVATE_KEY` su GitHub, pubblica un tag `v1.0.1` e gli utenti
riceveranno l'avviso di aggiornamento.
## Risoluzione Problemi

### Errore "Rust not found"
- Assicurati che Rust sia installato e nel PATH
- Riavvia il terminale dopo l'installazione

### Errore durante la build
- Verifica di avere tutte le dipendenze di sistema necessarie
- Su Windows potrebbe essere necessario installare Visual Studio Build Tools

### L'app non si connette a SharePoint
- Verifica le credenziali e i permessi dell'app Azure AD
- Controlla che l'URL SharePoint sia corretto
- Verifica che l'app abbia i permessi necessari sulla lista SharePoint

## Supporto

Per problemi o domande, consulta la documentazione Tauri:
https://tauri.app/

