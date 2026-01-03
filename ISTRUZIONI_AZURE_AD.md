# Istruzioni per Configurare Redirect URI in Azure AD

## Problema
L'errore `AADSTS50011` indica che il redirect URI `http://localhost:1420/oauth-callback.html` non è configurato in Azure AD.

## Soluzione: Aggiungere Redirect URI in Azure AD

### Passo 1: Accedi a Azure Portal
1. Vai su https://portal.azure.com
2. Accedi con il tuo account

### Passo 2: Trova la tua App Registration
1. Cerca "Azure Active Directory" nella barra di ricerca
2. Vai su **App registrations**
3. Cerca la tua app (probabilmente "AUSER Tauri App" o simile)
4. Oppure cerca usando il Client ID: `34d360f9-1e0e-4228-97d3-a964ad4f9b8a`

### Passo 3: Aggiungi Redirect URI
1. Nella pagina della tua app, vai su **Authentication** (nel menu a sinistra)
2. Scorri fino alla sezione **Redirect URIs**
3. Clicca su **Add URI**
4. Seleziona **Web** come tipo di piattaforma
5. Inserisci: `http://localhost:1420/oauth-callback.html`
6. Clicca su **Save** (in alto)

### Passo 4: Verifica
Assicurati che nella lista dei Redirect URIs ci sia:
- `http://localhost:1420/oauth-callback.html`

## Nota Importante
Se Azure AD non accetta `http://localhost:1420/oauth-callback.html` (alcune versioni di Azure AD accettano solo `http://localhost` senza path), hai due opzioni:

### Opzione A: Usa solo `http://localhost:1420`
1. Cambia il redirect URI in Azure AD a: `http://localhost:1420`
2. Modifica `REDIRECT_URI` in `auth.js` da `http://localhost:1420/oauth-callback.html` a `http://localhost:1420`
3. Modifica `index.html` per gestire il codice OAuth quando viene caricato (già implementato)

### Opzione B: Usa `http://localhost:1420/oauth-callback.html`
1. Se Azure AD accetta il path, aggiungi `http://localhost:1420/oauth-callback.html` come sopra
2. Mantieni il codice attuale

## Dopo la Configurazione
1. Riavvia l'applicazione Tauri
2. Prova di nuovo l'autenticazione
3. L'errore `AADSTS50011` dovrebbe essere risolto

## Screenshot Approximativo della Configurazione
```
Authentication > Redirect URIs
├── Platform: Web
├── URI: http://localhost:1420/oauth-callback.html
└── [Save Button]
```

