# Aggiornamenti automatici dell'app (Tauri Updater)

Quando pubblichi una nuova versione su GitHub, i PC che hanno già installato
**AUSER Gestione Operativa** possono ricevere un avviso e aggiornare con un clic.

## Cosa è già configurato nel progetto

- Updater **attivo** in `src-tauri/tauri.conf.json`
- Dialogo nativo Tauri (`dialog: true`) all'avvio se c'è una versione nuova
- Endpoint: release GitHub `lorenzomotta/AUSER` → file `latest.json`
- Workflow `.github/workflows/release.yml` (build Windows + firma)

## Setup una tantum (obbligatorio)

### 1. Chiavi (già generate in locale)

Nella cartella `keys/` (ignorata da git, **non pubblicare**):

- `auser-updater.key` → chiave **privata** (segreta)
- `auser-updater.key.pub` → chiave pubblica (già messa in `tauri.conf.json`)

Se perdi la chiave privata, gli aggiornamenti firmati non funzioneranno più
con le app già installate: dovresti generare nuove chiavi e ridistribuire
un installer "base" a tutti.

### 2. Secret su GitHub

Nel repo **lorenzomotta/AUSER** → Settings → Secrets and variables → Actions:

| Secret | Valore |
|--------|--------|
| `TAURI_PRIVATE_KEY` | Contenuto intero del file `keys/auser-updater.key` (tutto il testo) |
| `TAURI_KEY_PASSWORD` | Lascia vuoto se non hai messo password (o crea il secret vuoto / omettilo) |

Come copiare la chiave privata su Windows (PowerShell):

```powershell
Get-Content .\keys\auser-updater.key -Raw | Set-Clipboard
```

Poi incolla nel secret `TAURI_PRIVATE_KEY`.

### 3. Versione dell'app

Prima di ogni release, aumenta la versione in **entrambi**:

- `src-tauri/tauri.conf.json` → `package.version`
- `src-tauri/Cargo.toml` → `version`

Esempio: da `1.0.0` a `1.0.1`.

## Pubblicare un aggiornamento

```powershell
# 1. Committa le modifiche e la nuova version
git add -A
git commit -m "Release v1.0.1"
git push origin main

# 2. Crea e invia il tag (attiva GitHub Actions)
git tag v1.0.1
git push origin v1.0.1
```

Poi su GitHub → Actions: aspetta che il job **Release** finisca.
Nella release troverai:

- l'installer Windows (`.exe` / NSIS)
- `latest.json` (usato dall'updater)

## Cosa vede l'utente

1. Apre l'app
2. Se su GitHub c'è una versione più nuova → dialogo “Nuova versione disponibile”
3. Conferma → scarica e installa l'aggiornamento

## Note importanti

- Funziona solo con l'app **installata** (installer), non in `npm run tauri dev`
- Il PC deve poter raggiungere GitHub (`https://github.com/...`)
- La prima installazione sui PC va ancora fatta a mano (installer); poi gli aggiornamenti sono automatici
- Non cambiare la chiave pubblica in `tauri.conf.json` senza ridistribuire un nuovo installer a tutti

## Rigenerare le chiavi (solo se necessario)

```powershell
npx tauri signer generate -w keys/auser-updater.key --ci -f
```

Poi:

1. Copia la nuova pubblica in `tauri.conf.json` → `updater.pubkey`
2. Aggiorna il secret `TAURI_PRIVATE_KEY` su GitHub
3. Rilascia un nuovo installer “completo” a tutti gli utenti
