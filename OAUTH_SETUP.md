# Guida Setup Autenticazione OAuth2 SharePoint

## Panoramica

L'applicazione ora supporta l'autenticazione OAuth2 completa con Microsoft Identity Platform per accedere a SharePoint. Il sistema gestisce automaticamente:
- Generazione URL di autorizzazione
- Scambio del codice di autorizzazione con access token
- Refresh automatico del token quando scade
- Salvataggio sicuro delle credenziali

## Prerequisiti

Prima di utilizzare l'autenticazione OAuth2, devi registrare l'applicazione su Azure AD:

### 1. Registrazione App su Azure Portal

1. Vai su https://portal.azure.com
2. Azure Active Directory > App registrations > New registration
3. Imposta:
   - **Name**: AUSER Tauri App (o un nome a tua scelta)
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: 
     - Platform: Web
     - URI: `http://localhost:1420` (⚠️ IMPORTANTE: Azure AD non accetta path nel redirect URI!)
4. Clicca su **Register**
5. Salva il **Application (client) ID** e **Directory (tenant) ID**

### 2. Configurazione API Permissions

1. Nella sezione **API permissions**, clicca su **Add a permission**
2. Seleziona **Microsoft Graph** > **Delegated permissions**
3. Aggiungi le seguenti permissions:
   - `Sites.ReadWrite.All` (per leggere e scrivere su SharePoint)
   - `User.Read` (per leggere il profilo utente)
4. Clicca su **Add permissions**
5. **IMPORTANTE**: Clicca su **Grant admin consent** per consentire le permissions

### 3. Creazione Client Secret

1. Vai su **Certificates & secrets**
2. Clicca su **New client secret**
3. Imposta:
   - **Description**: AUSER App Secret
   - **Expires**: Scegli una durata (consigliato 24 mesi)
4. Clicca su **Add**
5. **IMPORTANTE**: Copia immediatamente il **Value** del secret (non sarà più visibile!)

## Utilizzo

### Prima Configurazione

1. Avvia l'applicazione
2. Vai alla pagina di autenticazione (`auth.html`)
3. Clicca su **Mostra configurazione avanzata**
4. Inserisci:
   - **Tenant ID**: Il Directory (tenant) ID salvato prima
   - **Client ID**: L'Application (client) ID salvato prima
   - **Client Secret**: Il valore del secret creato
5. Clicca su **Salva Configurazione**

### Autenticazione

1. Clicca su **Accedi con Microsoft**
2. Si aprirà il browser con la pagina di login Microsoft
3. Accedi con le tue credenziali Office 365/SharePoint
4. Autorizza l'applicazione
5. Dopo il redirect, copia il codice dalla URL (parametro `code`)
6. Incolla il codice nel campo **Codice di Autorizzazione**
7. Clicca su **Completa Autenticazione**

### Autenticazione Automatica

Una volta completata la prima autenticazione, l'applicazione:
- Salva il token di accesso e refresh token
- Aggiorna automaticamente il token quando scade
- Mantiene la sessione attiva tra i riavvii

## Struttura File

- `auth.html`: Interfaccia di autenticazione
- `auth.js`: Logica frontend per OAuth2 flow
- `src-tauri/src/sharepoint.rs`: Implementazione backend OAuth2
- `src-tauri/src/main.rs`: Comandi Tauri per autenticazione

## Comandi Tauri Disponibili

### `get_oauth_authorization_url`
Genera l'URL per iniziare il flusso OAuth2.

**Parametri:**
- `tenant_id`: ID del tenant Azure AD
- `client_id`: ID dell'app registrata
- `sharepoint_url`: URL del sito SharePoint
- `redirect_uri`: URI di redirect configurato

**Ritorna:** URL di autorizzazione

### `complete_oauth_authentication`
Completa l'autenticazione scambiando il codice con il token.

**Parametri:**
- `code`: Codice di autorizzazione dalla URL di redirect
- `tenant_id`: ID del tenant Azure AD
- `client_id`: ID dell'app registrata
- `client_secret`: Secret dell'app
- `sharepoint_url`: URL del sito SharePoint
- `redirect_uri`: URI di redirect configurato

**Ritorna:** Token di accesso e informazioni di scadenza

## Sicurezza

- I token vengono salvati in memoria durante l'esecuzione
- Il refresh token viene utilizzato automaticamente quando il token scade
- Le credenziali vengono salvate in localStorage (considera di implementare storage più sicuro per produzione)
- Il client secret viene utilizzato solo durante l'autenticazione iniziale

## Troubleshooting

### Errore: "Tenant ID non configurato"
- Assicurati di aver inserito il Tenant ID nella configurazione avanzata

### Errore: "Token scaduto e refresh token non disponibile"
- Esegui una nuova autenticazione completa

### Errore: "Errore nell'ottenimento token"
- Verifica che Client ID e Client Secret siano corretti
- Controlla che le API permissions siano state concesse
- Verifica che il redirect URI corrisponda esattamente a quello configurato in Azure

### Il codice di autorizzazione non funziona
- Assicurati di copiare solo il valore del parametro `code` dalla URL
- Il codice scade dopo pochi minuti, genera uno nuovo se necessario

## Note Implementazione

- Il sistema usa Microsoft Graph API per ottenere i token
- I token hanno una durata di default di 1 ora
- Il refresh avviene automaticamente 5 minuti prima della scadenza
- Il sistema fallback ai dati di esempio se SharePoint non è disponibile

