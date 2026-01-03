// Import dinamico di Tauri API
let invoke, appWindow, WebviewWindow;

// Funzione per inizializzare Tauri API
async function initTauriAPI() {
    try {
        // Verifica se siamo in Tauri (controlla sia __TAURI_INTERNALS__ che __TAURI_IPC__)
        const isTauriEnv = typeof window !== 'undefined' && 
                           (window.__TAURI_INTERNALS__ !== undefined || 
                            window.__TAURI_IPC__ !== undefined);
        
        if (isTauriEnv) {
            try {
                const tauriModule = await import('@tauri-apps/api/tauri');
                const windowModule = await import('@tauri-apps/api/window');
                invoke = tauriModule.invoke;
                appWindow = windowModule.appWindow;
                WebviewWindow = windowModule.WebviewWindow;
                console.log('✓ Tauri API inizializzate correttamente');
                return true;
            } catch (importError) {
                console.log('Errore nell\'import di Tauri API:', importError);
                return false;
            }
        } else {
            console.log('Tauri non rilevato (window.__TAURI_INTERNALS__ e __TAURI_IPC__ non disponibili)');
            return false;
        }
    } catch (error) {
        console.log('Tauri non disponibile (modalità browser):', error);
        return false;
    }
}

// Verifica se Tauri è disponibile
function isTauriAvailable() {
    const hasTauriInternals = typeof window !== 'undefined' && 
                              window.__TAURI_INTERNALS__ !== undefined;
    const hasTauriIPC = typeof window !== 'undefined' && 
                        window.__TAURI_IPC__ !== undefined;
    const hasInvoke = invoke !== undefined;
    
    const isAvailable = hasTauriInternals || (hasTauriIPC && hasInvoke);
    
    if (!isAvailable) {
        console.log('Tauri check - Internals:', hasTauriInternals, 'IPC:', hasTauriIPC, 'invoke:', hasInvoke);
    }
    
    return isAvailable;
}

// Configurazione SharePoint
const SHAREPOINT_URL = 'https://astiauser.sharepoint.com/sites/CALENDARIOSERVIZISHARE';
const REDIRECT_URI = 'http://localhost:1420'; // Azure AD non accetta path nel redirect URI

// Configurazione di default (da sostituire con valori reali)
let tenantId = '';
let clientId = '';
let clientSecret = '';

// Carica configurazione salvata
async function loadConfig() {
    console.log('=== CARICAMENTO CONFIGURAZIONE ===');
    try {
        // Se Tauri è disponibile, prova a caricare da config.json
        if (isTauriAvailable() && invoke) {
            try {
                console.log('Tentativo di caricare config.json...');
                const fileConfig = await invoke('load_config_file');
                console.log('Config ricevuta:', fileConfig);
                
                if (fileConfig && fileConfig.sharepoint) {
                    tenantId = fileConfig.sharepoint.tenant_id || '';
                    clientId = fileConfig.sharepoint.client_id || '';
                    clientSecret = fileConfig.sharepoint.client_secret || '';
                    
                    console.log('Valori estratti - tenantId:', tenantId ? 'presente' : 'vuoto', 'clientId:', clientId ? 'presente' : 'vuoto');
                    
                    if (tenantId && clientId) {
                        const tenantInput = document.getElementById('tenant-id');
                        const clientInput = document.getElementById('client-id');
                        const secretInput = document.getElementById('client-secret');
                        
                        if (tenantInput) tenantInput.value = tenantId;
                        if (clientInput) clientInput.value = clientId;
                        if (secretInput && clientSecret) secretInput.value = clientSecret;
                        
                        console.log('✓ Configurazione caricata da config.json e inserita nei campi');
                        return; // Configurazione da file trovata, non cercare in localStorage
                    } else {
                        console.log('✗ Configurazione presente ma valori mancanti');
                    }
                } else {
                    console.log('✗ Configurazione non valida o sharepoint non presente');
                }
            } catch (fileError) {
                console.log('✗ config.json non trovato o errore:', fileError);
            }
        } else {
            console.log('Tauri non disponibile, salto il caricamento da config.json');
        }
        
        // Fallback: carica da localStorage
        console.log('Tentativo di caricare da localStorage...');
        const savedConfig = localStorage.getItem('sharepoint_config');
        if (savedConfig) {
            const config = JSON.parse(savedConfig);
            tenantId = config.tenant_id || '';
            clientId = config.client_id || '';
            clientSecret = config.client_secret || '';
            
            if (tenantId && clientId) {
                const tenantInput = document.getElementById('tenant-id');
                const clientInput = document.getElementById('client-id');
                if (tenantInput) tenantInput.value = tenantId;
                if (clientInput) clientInput.value = clientId;
                console.log('✓ Configurazione caricata da localStorage');
            }
        } else {
            console.log('✗ Nessuna configurazione in localStorage');
            
            // Se siamo in modalità browser e non c'è configurazione, mostra un messaggio
            if (!isTauriAvailable()) {
                console.log('💡 Modalità browser: inserisci manualmente i valori nei campi');
            }
        }
    } catch (error) {
        console.error('Errore nel caricamento configurazione:', error);
    }
    console.log('=== FINE CARICAMENTO CONFIGURAZIONE ===');
}

// Salva configurazione
async function saveConfig() {
    const config = {
        tenant_id: tenantId,
        client_id: clientId,
        client_secret: clientSecret,
        sharepoint_url: SHAREPOINT_URL
    };
    localStorage.setItem('sharepoint_config', JSON.stringify(config));
}

// Toggle configurazione avanzata
document.getElementById('toggle-config').addEventListener('click', () => {
    const configSection = document.getElementById('config-section');
    const toggleBtn = document.getElementById('toggle-config');
    
    if (configSection.style.display === 'none') {
        configSection.style.display = 'block';
        toggleBtn.textContent = 'Nascondi configurazione avanzata';
    } else {
        configSection.style.display = 'none';
        toggleBtn.textContent = 'Mostra configurazione avanzata';
    }
});

// Form configurazione manuale
document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    tenantId = document.getElementById('tenant-id').value.trim();
    clientId = document.getElementById('client-id').value.trim();
    clientSecret = document.getElementById('client-secret').value.trim();
    
    if (!tenantId || !clientId) {
        showError('Inserisci almeno Tenant ID e Client ID');
        return;
    }
    
    await saveConfig();
    showSuccess('Configurazione salvata. Ora puoi procedere con l\'autenticazione.');
    
    // Abilita il pulsante OAuth
    document.getElementById('oauth-login-btn').disabled = false;
});

// Pulsante OAuth login
document.getElementById('oauth-login-btn').addEventListener('click', async () => {
    const errorDiv = document.getElementById('error-message');
    const successDiv = document.getElementById('success-message');
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    console.log('=== CLICK PULSANTE OAUTH ===');
    
    // Verifica che Tauri sia disponibile
    if (!isTauriAvailable() || !invoke) {
        showError('L\'autenticazione OAuth funziona solo quando l\'app è eseguita con Tauri. Avvia l\'app con: npm run tauri dev');
        return;
    }
    
    console.log('Valori attuali - tenantId:', tenantId ? 'presente' : 'vuoto', 'clientId:', clientId ? 'presente' : 'vuoto');
    
    // Carica configurazione se non già caricata
    if (!tenantId || !clientId) {
        console.log('Configurazione non presente, carico...');
        await loadConfig();
        
        // Leggi i valori dai campi input (potrebbero essere stati popolati da loadConfig)
        const tenantInput = document.getElementById('tenant-id');
        const clientInput = document.getElementById('client-id');
        
        if (tenantInput) tenantId = tenantInput.value.trim();
        if (clientInput) clientId = clientInput.value.trim();
        
        console.log('Valori dopo loadConfig - tenantId:', tenantId ? 'presente' : 'vuoto', 'clientId:', clientId ? 'presente' : 'vuoto');
    }
    
    if (!tenantId || !clientId) {
        console.error('✗ Configurazione ancora incompleta dopo il caricamento');
        showError('Configurazione incompleta. Inserisci Tenant ID e Client ID nella sezione configurazione avanzata oppure assicurati che config.json sia presente nella root del progetto.');
        return;
    }
    
    console.log('✓ Configurazione completa, procedo con OAuth');
    
    try {
        // Ottieni URL di autorizzazione
        const authUrl = await invoke('get_oauth_authorization_url', {
            tenantId: tenantId,
            clientId: clientId,
            sharepointUrl: SHAREPOINT_URL,
            redirectUri: REDIRECT_URI
        });
        
        console.log('Opening OAuth URL:', authUrl);
        
        // Crea una finestra webview Tauri per l'autenticazione
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        
        try {
            const authWindow = new WebviewWindow('oauth-auth', {
                url: authUrl,
                title: 'Autenticazione Microsoft',
                width: 600,
                height: 700,
                center: true,
                resizable: false,
                decorations: true,
                visible: true, // Assicurati che sia visibile
                focus: false,  // NON portare in focus per non nascondere la finestra principale
            });
            
            // Aspetta un momento per assicurarsi che la finestra sia completamente creata
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Assicurati che la finestra principale rimanga visibile e in primo piano
            try {
                const { appWindow } = await import('@tauri-apps/api/window');
                await appWindow.show(); // Assicura che la finestra principale sia visibile
                await appWindow.setFocus(); // Porta la finestra principale in primo piano
                console.log('✓ Finestra principale mantenuta visibile e in focus');
            } catch (e) {
                console.log('Errore nel mostrare/focus finestra principale:', e);
            }
            
            // Assicurati che la finestra OAuth sia visibile (ma NON in focus)
            try {
                await authWindow.show();
                console.log('✓ Finestra OAuth mostrata (senza focus)');
                // NON chiamare setFocus() per non nascondere la finestra principale
            } catch (e) {
                console.log('show() non disponibile:', e);
            }
            
            console.log('Finestra OAuth creata e mostrata (finestra principale rimane visibile)');
            
            // Monitora la navigazione della finestra OAuth per intercettare il codice
            // Quando Microsoft reindirizza, la finestra caricherà una pagina con ?code=...
            // Usiamo un listener per intercettare quando la finestra naviga
            try {
                // Polling per verificare se la finestra OAuth ha un codice nella URL
                // Questo è necessario perché non possiamo accedere direttamente alla URL della finestra OAuth
                const urlCheckInterval = setInterval(async () => {
                    try {
                        // Prova a verificare se la finestra OAuth è ancora aperta
                        // e se ha navigato a una pagina con un codice
                        // Nota: questo potrebbe non funzionare direttamente, quindi usiamo un approccio alternativo
                        // Invece, aspettiamo che oauth-callback.html venga caricato e emetta l'evento
                    } catch (e) {
                        // Ignora errori
                    }
                }, 1000);
                
                // Pulisci l'intervallo quando la finestra viene chiusa
                authWindow.once('tauri://close-requested', () => {
                    clearInterval(urlCheckInterval);
                });
            } catch (e) {
                console.log('Errore nel setup monitoraggio URL:', e);
            }
            
            // Mostra messaggio di attesa
            showSuccess('🔐 Finestra di autenticazione aperta. Completa il login nella finestra che si è aperta.');
            
            // Salva il riferimento alla finestra per usarlo dopo
            window.oauthAuthWindow = authWindow;
            
            // Ascolta quando la finestra OAuth naviga (quando Microsoft reindirizza)
            // Questo ci permette di intercettare quando la finestra carica index.html con il codice
            authWindow.listen('tauri://navigation', async (event) => {
                console.log('🔍 Evento di navigazione nella finestra OAuth:', event);
            });
            
            // Ascolta l'evento con il codice dalla finestra OAuth
            // Questo listener è nella finestra principale e intercetta il codice emesso dalla finestra OAuth
            try {
                const { listen } = await import('@tauri-apps/api/event');
                
                const codeListener = await listen('oauth-code-received', async (event) => {
                    console.log('✓✓✓ Evento oauth-code-received ricevuto nella finestra principale');
                    const code = event.payload.code;
                    console.log('Codice ricevuto (primi 20 caratteri):', code.substring(0, 20));
                    
                    codeListener(); // Rimuovi il listener
                    
                    // Completa l'autenticazione con il codice ricevuto
                    await completeAuthenticationWithCode(code);
                });
                
                // Ascolta anche l'evento di successo (per compatibilità)
                const successListener = await listen('oauth-success', async (event) => {
                    console.log('✓ Evento oauth-success ricevuto nella finestra principale, reindirizziamo a index.html');
                    successListener(); // Rimuovi il listener
                    
                    // Reindirizza la finestra principale a index.html
                    setTimeout(() => {
                        console.log('Reindirizzamento a index.html...');
                        window.location.href = 'index.html';
                    }, 500);
                });
                
                console.log('Listener per oauth-code-received e oauth-success configurati nella finestra principale');
            } catch (e) {
                console.log('Errore nel setup listener evento:', e);
            }
            
            // Polling per verificare periodicamente se l'autenticazione è completata
            // Questo funziona come fallback se gli eventi non vengono ricevuti
            let pollingCount = 0;
            const maxPollingAttempts = 60; // Massimo 2 minuti (60 * 2 secondi)
            const authCheckInterval = setInterval(async () => {
                pollingCount++;
                try {
                    const isAuth = await invoke('check_authentication');
                    console.log(`🔍 Polling autenticazione (tentativo ${pollingCount}/${maxPollingAttempts}):`, isAuth);
                    
                    if (isAuth) {
                        console.log('✓✓✓ Autenticazione rilevata tramite polling!');
                        clearInterval(authCheckInterval);
                        
                        // Chiudi la finestra OAuth se ancora aperta
                        try {
                            if (window.oauthAuthWindow) {
                                await window.oauthAuthWindow.close();
                            }
                        } catch (e) {
                            console.log('Finestra OAuth già chiusa o errore:', e);
                        }
                        
                        // Reindirizza alla homepage
                        console.log('Reindirizzamento a index.html...');
                        window.location.href = 'index.html';
                    } else if (pollingCount >= maxPollingAttempts) {
                        console.log('⏱️ Timeout polling autenticazione, interrompo');
                        clearInterval(authCheckInterval);
                        showError('Timeout nell\'autenticazione. Riprova.');
                    }
                } catch (e) {
                    console.log('Errore nel polling autenticazione:', e);
                    // Ignora errori nel polling
                }
            }, 2000); // Controlla ogni 2 secondi
            
            // Pulisci l'intervallo quando la finestra viene chiusa
            authWindow.once('tauri://close-requested', () => {
                clearInterval(authCheckInterval);
                console.log('Finestra OAuth chiusa, pulizia intervallo polling');
                
                // Verifica se l'autenticazione è completata
                setTimeout(async () => {
                    try {
                        const isAuth = await invoke('check_authentication');
                        console.log('Stato autenticazione dopo chiusura finestra OAuth:', isAuth);
                        
                        if (isAuth) {
                            console.log('✓✓✓ Autenticazione completata! Reindirizziamo a index.html');
                            window.location.href = 'index.html';
                        } else {
                            console.log('Autenticazione non completata, rimaniamo su auth.html');
                        }
                    } catch (e) {
                        console.log('Errore nel controllo autenticazione:', e);
                    }
                }, 1500);
            });
            
        } catch (error) {
            console.error('Errore nella creazione della finestra OAuth:', error);
            showError('Errore nell\'apertura della finestra di autenticazione: ' + error);
            // Fallback: apri nel browser di sistema
            const { open } = await import('@tauri-apps/api/shell');
            await open(authUrl);
            showCodeInput();
            return;
        }
        
        // Funzione per gestire il codice OAuth ricevuto
        const handleOAuthCode = async (code) => {
            console.log('Codice ricevuto automaticamente:', code.substring(0, 20) + '...');
            
            // Chiudi la finestra di autenticazione
            try {
                if (window.oauthAuthWindow) {
                    await window.oauthAuthWindow.close();
                }
            } catch (e) {
                console.log('Finestra già chiusa');
            }
            
            // Completa automaticamente l'autenticazione
            showSuccess('✅ Codice ricevuto! Completamento autenticazione...');
            
            // Assicurati che clientSecret sia disponibile
            if (!clientSecret) {
                clientSecret = document.getElementById('client-secret')?.value.trim() || '';
            }
            
            if (!clientSecret) {
                showError('Client Secret richiesto. Inseriscilo nella sezione configurazione avanzata.');
                showCodeInput(); // Fallback a input manuale
                return;
            }
            
            try {
                const result = await invoke('complete_oauth_authentication', {
                    code: code,
                    tenantId: tenantId,
                    clientId: clientId,
                    clientSecret: clientSecret,
                    sharepointUrl: SHAREPOINT_URL,
                    redirectUri: REDIRECT_URI
                });
                
                if (result.success) {
                    await invoke('save_credentials', {
                        sharepointUrl: SHAREPOINT_URL,
                        token: result.access_token
                    });
                    
                    showSuccess('✅ Autenticazione completata con successo! Reindirizzamento...');
                    
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1500);
                } else {
                    showError('Autenticazione fallita');
                    showCodeInput(); // Fallback
                }
            } catch (error) {
                console.error('Errore completamento autenticazione:', error);
                showError('Errore: ' + error);
                showCodeInput(); // Fallback a input manuale
            }
        };
        
        // Funzione per gestire errori OAuth
        const handleOAuthError = async (error) => {
            showError('Errore autenticazione: ' + error);
            try {
                if (window.oauthAuthWindow) {
                    await window.oauthAuthWindow.close();
                }
            } catch (e) {}
        };
        
        // Quando la webview viene reindirizzata a http://localhost:1420?code=...
        // caricherà auth.html che intercetterà automaticamente il codice
        // Non serve fare altro, auth.html gestirà tutto nel DOMContentLoaded
        
    } catch (error) {
        console.error('Errore OAuth:', error);
        showError('Errore nell\'avvio autenticazione: ' + error);
    }
});

// Mostra campo per inserire codice di autorizzazione
function showCodeInput() {
    const oauthSection = document.getElementById('oauth-section');
    
    // Rimuovi eventuale campo esistente
    const existingCodeInput = document.getElementById('auth-code');
    if (existingCodeInput) {
        existingCodeInput.parentElement.remove();
    }
    const existingBtn = document.getElementById('complete-auth-btn');
    if (existingBtn) {
        existingBtn.remove();
    }
    
    const codeInputHtml = `
        <div class="mb-3 mt-3" style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <label class="form-label" style="font-weight: bold; color: #333; font-size: 16px; margin-bottom: 12px;">
                📋 Codice di Autorizzazione
            </label>
            <input type="text" class="form-control" id="auth-code" 
                   placeholder="Incolla qui il codice dalla URL del browser (stringa lunga)"
                   style="font-family: monospace; font-size: 11px; padding: 12px;">
            <small class="form-text text-muted" style="display: block; margin-top: 12px; line-height: 1.8;">
                <strong style="color: #495057;">📖 Come trovare il codice nel browser:</strong><br>
                <ol style="margin: 10px 0 10px 20px; padding: 0; color: #6c757d;">
                    <li style="margin-bottom: 8px;">Nel <strong>browser</strong> che si è aperto, completa il login Microsoft</li>
                    <li style="margin-bottom: 8px;">Dopo il login, verrai reindirizzato (la pagina potrebbe essere vuota, è normale)</li>
                    <li style="margin-bottom: 8px;">Guarda la <strong>barra degli indirizzi</strong> del browser</li>
                    <li style="margin-bottom: 8px;">Cerca nella URL il parametro <code style="background: #e9ecef; padding: 2px 6px; border-radius: 3px; color: #d63384;">code=</code></li>
                    <li style="margin-bottom: 8px;">Copia <strong>tutto</strong> il valore dopo <code>code=</code> (fino al prossimo <code>&</code> o fine URL)</li>
                    <li style="margin-bottom: 8px;">Torna all'<strong>app Tauri</strong> e incolla qui sopra</li>
                </ol>
                <div style="background: #fff3cd; padding: 12px; border-radius: 5px; margin-top: 12px; border-left: 4px solid #ffc107;">
                    <strong>⚠️ Importante:</strong> Il codice è una stringa molto lunga (circa 200-300 caratteri). 
                    Assicurati di copiare <strong>tutto</strong> il valore, non solo una parte!<br>
                    <span style="font-size: 11px; color: #856404;">Esempio: <code>0.AXkA...</code> (continua per molte righe)</span>
                </div>
            </small>
        </div>
        <button id="complete-auth-btn" class="btn btn-success" style="width: 100%; padding: 14px; font-weight: 600; font-size: 16px; margin-top: 10px;">
            ✅ Completa Autenticazione
        </button>
    `;
    
    oauthSection.insertAdjacentHTML('beforeend', codeInputHtml);
    
    document.getElementById('complete-auth-btn').addEventListener('click', async () => {
        await completeAuthentication();
    });
    
    // Focus sul campo input
    setTimeout(() => {
        const codeInput = document.getElementById('auth-code');
        if (codeInput) {
            codeInput.focus();
        }
    }, 100);
}

// Completa autenticazione con codice (versione che accetta il codice come parametro)
async function completeAuthenticationWithCode(code) {
    console.log('Completamento autenticazione con codice ricevuto...');
    
    if (!code) {
        showError('Codice di autorizzazione non valido');
        return;
    }
    
    // Assicurati che clientSecret sia disponibile
    if (!clientSecret) {
        clientSecret = document.getElementById('client-secret')?.value.trim() || '';
    }
    
    if (!clientSecret) {
        showError('Client Secret richiesto. Inseriscilo nella sezione configurazione avanzata.');
        return;
    }
    
    try {
        showSuccess('✅ Completamento autenticazione in corso...');
        
        const result = await invoke('complete_oauth_authentication', {
            code: code,
            tenantId: tenantId,
            clientId: clientId,
            clientSecret: clientSecret,
            sharepointUrl: SHAREPOINT_URL,
            redirectUri: REDIRECT_URI
        });
        
        if (result.success) {
            // Salva token
            await invoke('save_credentials', {
                sharepointUrl: SHAREPOINT_URL,
                token: result.access_token
            });
            
            showSuccess('✅ Autenticazione completata con successo! Reindirizzamento...');
            
            // Reindirizza alla homepage dopo 1 secondo
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        } else {
            showError('Autenticazione fallita');
        }
    } catch (error) {
        console.error('Errore completamento autenticazione:', error);
        showError('Errore nel completamento autenticazione: ' + error);
    }
}

// Completa autenticazione con codice (versione originale che legge dal campo input)
async function completeAuthentication() {
    const code = document.getElementById('auth-code').value.trim();
    
    if (!code) {
        showError('Inserisci il codice di autorizzazione');
        return;
    }
    
    await completeAuthenticationWithCode(code);
}

// Verifica se l'utente è già autenticato
async function checkIfAlreadyAuthenticated() {
    if (!isTauriAvailable() || !invoke) {
        return false;
    }
    
    try {
        const isAuthenticated = await invoke('check_authentication');
        if (isAuthenticated) {
            // Se già autenticato, reindirizza alla homepage
            console.log('Utente già autenticato, reindirizzamento a index.html');
            window.location.href = 'index.html';
            return true;
        }
    } catch (error) {
        console.log('Errore nel controllo autenticazione (probabilmente non inizializzato):', error);
    }
    return false;
}

// Gestione callback OAuth (se l'app viene aperta con redirect)
window.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOMContentLoaded auth.html ===');
    console.log('window.__TAURI_INTERNALS__:', typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : 'window non definito');
    console.log('window.__TAURI_IPC__:', typeof window !== 'undefined' ? window.__TAURI_IPC__ : 'window non definito');
    
    // Inizializza Tauri API
    const tauriAvailable = await initTauriAPI();
    console.log('Tauri disponibile:', tauriAvailable);
    
    // Se Tauri non è disponibile, aspetta un po' e riprova (potrebbe essere ancora in fase di inizializzazione)
    if (!tauriAvailable) {
        console.log('Tentativo di rilevare Tauri dopo un breve delay...');
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryAvailable = await initTauriAPI();
        console.log('Tauri disponibile dopo retry:', retryAvailable);
    }
    
    // Carica configurazione PRIMA di tutto
    await loadConfig();
    
    // Verifica se già autenticato (solo se Tauri è disponibile)
    if (tauriAvailable && invoke) {
        const alreadyAuth = await checkIfAlreadyAuthenticated();
        if (alreadyAuth) {
            return; // Reindirizzamento già in corso
        }
        
        // Prova a inizializzare SharePoint da config.json
        try {
            await invoke('init_sharepoint_from_config');
            console.log('Client SharePoint inizializzato da config.json');
            
            // Ricontrolla autenticazione dopo l'inizializzazione
            const isAuth = await invoke('check_authentication');
            if (isAuth) {
                window.location.href = 'index.html';
                return;
            }
        } catch (error) {
            console.log('config.json non trovato o errore nell\'inizializzazione:', error);
        }
    } else {
        console.log('💡 Modalità browser: l\'autenticazione OAuth funzionerà solo in modalità Tauri');
        console.log('💡 Per testare l\'autenticazione, avvia l\'app con: npm run tauri dev');
    }
    
    // Controlla se c'è un codice nella URL (può essere nella query string o nell'hash)
    console.log('🔍 Controllo URL per codice OAuth...');
    console.log('URL completa:', window.location.href);
    console.log('Query string:', window.location.search);
    console.log('Hash:', window.location.hash);
    
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    
    const code = urlParams.get('code') || hashParams.get('code');
    const error = urlParams.get('error') || hashParams.get('error');
    
    console.log('Codice trovato:', code ? 'SÌ (' + code.substring(0, 20) + '...)' : 'NO');
    console.log('Errore trovato:', error || 'NO');
    
    if (error) {
        showError('Errore autenticazione: ' + error);
        // Rimuovi il parametro error dalla URL
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    
    if (code) {
        console.log('✓✓✓ Codice OAuth ricevuto dalla URL, completamento automatico...');
        console.log('Codice (primi 20 caratteri):', code.substring(0, 20));
        
        // Mostra messaggio di attesa
        showSuccess('✅ Codice ricevuto! Completamento autenticazione in corso...');
        
        // Non mostrare il campo input, completa direttamente
        // Assicurati che clientSecret sia disponibile
        if (!clientSecret) {
            clientSecret = document.getElementById('client-secret')?.value.trim() || '';
        }
        
        if (!clientSecret) {
            showError('Client Secret richiesto. Inseriscilo nella sezione configurazione avanzata.');
            showCodeInput();
            const codeInput = document.getElementById('auth-code');
            if (codeInput) {
                codeInput.value = code;
            }
            return;
        }
        
        // Rimuovi il parametro code dalla URL per pulizia
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Completa automaticamente l'autenticazione
        try {
            const result = await invoke('complete_oauth_authentication', {
                code: code,
                tenantId: tenantId,
                clientId: clientId,
                clientSecret: clientSecret,
                sharepointUrl: SHAREPOINT_URL,
                redirectUri: REDIRECT_URI
            });
            
            if (result.success) {
                await invoke('save_credentials', {
                    sharepointUrl: SHAREPOINT_URL,
                    token: result.access_token
                });
                
                showSuccess('✅ Autenticazione completata con successo!');
                
                // Verifica se siamo nella finestra OAuth (webview) o nella finestra principale
                try {
                    const { appWindow, getAll } = await import('@tauri-apps/api/window');
                    const currentWindow = appWindow;
                    const currentLabel = await currentWindow.label();
                    
                    console.log('Label finestra corrente:', currentLabel);
                    
                    // Se siamo nella finestra OAuth, chiudila e comunica alla finestra principale
                    if (currentLabel === 'oauth-auth') {
                        console.log('Siamo nella finestra OAuth, chiudiamo e comunichiamo alla finestra principale');
                        
                        // Comunica alla finestra principale che l'autenticazione è completata
                        try {
                            const { emit } = await import('@tauri-apps/api/event');
                            await emit('oauth-success', { message: 'Autenticazione completata' });
                        } catch (e) {
                            console.log('Errore nell\'emissione evento:', e);
                        }
                        
                        // Chiudi questa finestra dopo un breve delay
                        setTimeout(async () => {
                            try {
                                await currentWindow.close();
                            } catch (e) {
                                console.log('Errore nella chiusura finestra:', e);
                            }
                        }, 1000);
                    } else {
                        // Siamo nella finestra principale, reindirizza a index.html
                        console.log('Siamo nella finestra principale, reindirizziamo a index.html');
                        setTimeout(() => {
                            window.location.href = 'index.html';
                        }, 1000);
                    }
                } catch (error) {
                    console.error('Errore nel controllo finestra:', error);
                    // Fallback: reindirizza sempre
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1000);
                }
            } else {
                showError('Autenticazione fallita');
                showCodeInput();
            }
        } catch (error) {
            console.error('Errore completamento autenticazione:', error);
            showError('Errore: ' + error);
            showCodeInput();
        }
    }
});

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function showSuccess(message) {
    const successDiv = document.getElementById('success-message');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
}
