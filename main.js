const path = require('path');

// Carica .env da un percorso esplicito (root del progetto per default)
const dotenvPath = process.env.ENV_PATH || path.join(__dirname, '.env');
require('dotenv').config({ path: dotenvPath });

// Verifica e segnala variabili mancanti
function ensureEnv(keys) {
  const missing = keys.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error('Variabili .env mancanti:', missing.join(', '), ' (file:', dotenvPath, ')');
  } else {
    console.log('Variabili .env caricate da', dotenvPath);
  }
}
ensureEnv(['TENANT_ID', 'CLIENT_ID', 'SP_TENANT', 'SITE_URL', 'LIST_NAME']);

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const axios = require('axios');
const crypto = require('crypto');
const express = require('express');

let authWindow = null; // finestra principale
let server = null;
let loginWindow = null; // finestra di login (separata)
let oidcClient = null; // client OpenID condiviso (non più obbligatorio con token exchange manuale)
let pendingAuth = null; // dati PKCE/state/nonce per la sessione corrente

// Util: base64url
function base64url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Genera PKCE code_verifier e code_challenge (S256)
function generatePkce() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const sha256 = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64url(sha256);
  return { codeVerifier, codeChallenge, method: 'S256' };
}

// Genera state/nonce
function generateStateNonce() {
  return {
    state: base64url(crypto.randomBytes(16)),
    nonce: base64url(crypto.randomBytes(16))
  };
}

// Attende che il client OIDC sia pronto (fino a timeout)
function waitForOidcClient(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkReady = () => {
      if (oidcClient) return resolve(true);
      if (Date.now() - startTime > timeoutMs) return reject(new Error('Client OpenID non pronto'));
      setTimeout(checkReady, 100);
    };
    checkReady();
  });
}

// Avvia il server Express per gestire il callback
async function startAuthServer() {
  const expressApp = express();
  
  console.log('🔧 Avvio server di autenticazione...');
  // Route di test per verificare che il server funzioni
  expressApp.get('/', (req, res) => {
    res.send('Server di autenticazione attivo');
  });

  // Route callback sempre disponibile (evita ERR_CONNECTION_REFUSED)
  expressApp.get('/auth/callback', async (req, res) => {
    console.log('🔄 Callback ricevuto:', req.url);
    try {
      // Verifica state
      const queryState = req.query && req.query.state;
      if (!pendingAuth || !pendingAuth.state || queryState !== pendingAuth.state) {
        console.error('❌ State non valido o sessione non inizializzata');
        res.status(400).send('State non valido o sessione non inizializzata');
        return;
      }

      // Scambio manuale del codice con PKCE (senza openid-client)
      const code = req.query && req.query.code;
      if (!code) {
        throw new Error('Codice di autorizzazione mancante');
      }

      const tenantId = process.env.TENANT_ID;
      const clientId = process.env.CLIENT_ID;
      const spTenant = process.env.SP_TENANT;
      const redirectUri = 'http://localhost:3000/auth/callback';
      const scope = `openid offline_access https://${spTenant}.sharepoint.com/AllSites.Read`;

      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
        code_verifier: pendingAuth.codeVerifier,
        scope
      });

      const tokenResp = await axios.post(tokenUrl, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
      });
      console.log('🔐 Risposta token:', tokenResp.status, tokenResp.data && Object.keys(tokenResp.data));
      const accessToken = tokenResp.data && tokenResp.data.access_token;
      if (!accessToken) {
        throw new Error('Token non ricevuto');
      }

      console.log('✅ Token ricevuto con successo');

      if (authWindow) {
        authWindow.webContents.send('auth-success', accessToken);
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Autenticazione completata</title>
          <meta charset="utf-8">
        </head>
        <body>
          <h2>✅ Autenticazione completata!</h2>
          <p>L'applicazione è stata autenticata con successo.</p>
          <script>
            setTimeout(() => { window.close(); }, 1000);
            try { window.close(); } catch(e) {}
          </script>
        </body>
        </html>
      `);

      if (loginWindow && !loginWindow.isDestroyed()) {
        setTimeout(() => {
          if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
          }
        }, 1500);
      }
      pendingAuth = null;
    } catch (error) {
      const status = error && error.response && error.response.status;
      const data = error && error.response && error.response.data;
      console.error('❌ Errore di autenticazione:', status, data || error);
      if (authWindow) {
        const msg = data ? `${status || ''} ${data.error || ''} ${data.error_description || ''}`.trim() : String(error && error.message ? error.message : error);
        authWindow.webContents.send('auth-error', msg);
      }
      res.status(status || 500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Errore di autenticazione</title>
          <meta charset="utf-8">
        </head>
        <body>
          <h2>❌ Errore di autenticazione</h2>
          <p>Si è verificato un errore durante lo scambio del token.</p>
          <pre>${status || ''} ${data && (data.error + ' - ' + data.error_description) || (error && error.message) || 'Errore sconosciuto'}</pre>
          <button onclick="window.close()">Chiudi finestra</button>
        </body>
        </html>
      `);
    }
  });

  // Avvia subito il server per evitare connection refused
  server = expressApp.listen(3000, () => {
    console.log('🚀 Server di autenticazione in ascolto su http://localhost:3000');
  });
  server.on('error', (error) => {
    console.error('❌ Errore server Express:', error);
  });

  // Inizializza il client OIDC in background
  try {
    const openidClientMod = await import('openid-client');
    const Issuer = openidClientMod.Issuer || (openidClientMod.default && openidClientMod.default.Issuer);
    if (!Issuer) throw new Error('openid-client: Issuer non disponibile');
    console.log('✅ openid-client importato con successo');
    const issuer = await Issuer.discover(`https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0`);
    oidcClient = new issuer.Client({
      client_id: process.env.CLIENT_ID,
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
    console.log('✅ Client OpenID inizializzato');
  } catch (error) {
    console.error('❌ Errore nell\'inizializzazione del client OpenID:', error);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  authWindow = win;
}

app.whenReady().then(async () => {
  await startAuthServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (server) server.close();
    app.quit();
  }
});

// Gestione dell'autenticazione quando riceve il messaggio da renderer.js
ipcMain.on('start-auth', async (event) => {
  console.log('=== INIZIO PROCESSO DI AUTH ===');
  
  const spTenant = process.env.SP_TENANT;
  console.log('SP_TENANT:', spTenant);
  
  if (!spTenant || String(spTenant).trim() === '') {
    console.error('❌ SP_TENANT non definito nelle variabili .env');
    if (authWindow) {
      authWindow.webContents.send('auth-error', 'SP_TENANT non definito nelle variabili .env');
    }
    return;
  }

  // Genera PKCE + state/nonce e costruisci URL
  const { codeVerifier, codeChallenge, method } = generatePkce();
  const { state, nonce } = generateStateNonce();
  pendingAuth = { codeVerifier, state, nonce };

  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  
  console.log('TENANT_ID:', tenantId);
  console.log('CLIENT_ID:', clientId);

  const redirectUri = 'http://localhost:3000/auth/callback';
  const scope = `openid offline_access https://${spTenant}.sharepoint.com/AllSites.Read`;

  // URL corretto senza spazi extra
  const authUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=${encodeURIComponent(method)}` +
    `&state=${encodeURIComponent(state)}` +
    `&nonce=${encodeURIComponent(nonce)}`;

  console.log('Auth URL generato:', authUrl);

  // Chiude eventuale vecchia finestra di login
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }

  loginWindow = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Gestione pop-up esterni: apri nel browser di sistema
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(url); } catch (e) { console.error('Impossibile aprire URL esterno:', url, e); }
    return { action: 'deny' };
  });

  // Aggiungi questi eventi per debugging
  loginWindow.webContents.on('did-start-loading', () => {
    console.log('🔄 [LOGIN] did-start-loading');
  });

  loginWindow.webContents.on('did-finish-load', () => {
    const url = loginWindow.webContents.getURL();
    console.log('✅ [LOGIN] did-finish-load:', url);
  });

  loginWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('❌ [LOGIN] did-fail-load:', { 
      errorCode, 
      errorDescription, 
      validatedURL, 
      isMainFrame 
    });
    // -3 = ERR_ABORTED: navigazione annullata (spesso benigno durante redirect). Non trattarlo come errore.
    if (errorCode === -3) {
      console.log('[LOGIN] did-fail-load (-3 ERR_ABORTED) ignorato');
      return;
    }
    if (authWindow) {
      authWindow.webContents.send('auth-error', `Caricamento fallito (${errorCode}): ${errorDescription}`);
    }
    // Fallback: apri il browser esterno se la finestra non riesce a caricare (es. ERR_CONNECTION_REFUSED)
    if (errorCode === -102 || (errorDescription && String(errorDescription).includes('ERR_CONNECTION_REFUSED'))) {
      console.log('[LOGIN] Fallback: apro il browser esterno per l\'autenticazione');
      try { shell.openExternal(authUrl); } catch (e) { console.error('Impossibile aprire il browser esterno:', e); }
    }
  });

  loginWindow.loadURL(authUrl);
  console.log('🚀 URL caricato nella finestra di login');
}); 