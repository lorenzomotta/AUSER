# AUSER Asti - Gestione Operativa

Applicazione desktop Tauri per la gestione operativa dei servizi AUSER Asti.

## Caratteristiche

- Interfaccia desktop moderna con Bootstrap
- Integrazione con SharePoint per i dati
- Autenticazione utente
- Aggiornamenti automatici
- Installabile su PC Windows

## Requisiti

- Node.js (v18 o superiore)
- Rust (ultima versione stabile)
- Tauri CLI

## Installazione

1. Installa le dipendenze:
```bash
npm install
```

2. Installa Tauri CLI (se non già installato):
```bash
npm install -g @tauri-apps/cli
```

## Sviluppo

Per avviare l'app in modalità sviluppo:
```bash
npm run dev
```

## Build

Per creare l'applicazione installabile:
```bash
npm run tauri build
```

## Configurazione SharePoint

La configurazione per l'integrazione SharePoint verrà aggiunta nei prossimi passi.

## Note

- L'app è configurata per aggiornamenti automatici tramite GitHub Releases
- Assicurati di configurare correttamente le chiavi di aggiornamento prima della pubblicazione

