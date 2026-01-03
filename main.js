// Import Tauri API
let invoke, appWindow;

// Funzione per inizializzare le API Tauri
async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        const windowModule = await import('@tauri-apps/api/window');
        invoke = tauriModule.invoke;
        appWindow = windowModule.appWindow;
        return true;
    } catch (error) {
        console.error('Errore nel caricamento API Tauri:', error);
        return false;
    }
}

// Verifica se siamo in ambiente Tauri
function isTauri() {
    return typeof window !== 'undefined' && 
           (window.__TAURI_INTERNALS__ !== undefined || 
            window.__TAURI_IPC__ !== undefined);
}

// Aggiorna data e settimana corrente
function updateDateInfo() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('it-IT', options);
    const dateElement = document.getElementById('current-date');
    const weekElement = document.getElementById('week-number');
    
    if (dateElement) {
        dateElement.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }
    
    if (weekElement) {
        // Calcola numero settimana
        const startDate = new Date(now.getFullYear(), 0, 1);
        const days = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
        const weekNumber = Math.ceil((days + startDate.getDay() + 1) / 7);
        weekElement.textContent = `Settimana numero ${weekNumber}`;
    }
}

// Carica servizi del giorno
async function loadServiziGiorno() {
    console.log('=== loadServiziGiorno chiamato ===');
    const container = document.getElementById('servizi-giorno');
    
    if (!container) {
        console.error('Contenitore servizi-giorno non trovato!');
        return;
    }
    
    // Se non siamo in Tauri o invoke non è disponibile, mostra dati di esempio
    if (!invoke) {
        console.log('Modalità demo: invoke non disponibile, caricamento dati di esempio');
        console.log('isTauri():', isTauri(), 'invoke:', typeof invoke);
        const serviziEsempio = [
            {
                id: 1146,
                operatore: "GAGLIARDI DESIDERATO",
                data: "23/12/2025",
                nominativo: "GALUPPO ANGELO",
                ora_sotto_casa: "08:30",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST"
            },
            {
                id: 1140,
                operatore: "ARNONE ANTONINO",
                data: "23/12/2025",
                nominativo: "GROSSO GRAZIELLA",
                ora_sotto_casa: "10:30",
                ora_destinazione: "",
                tipo_servizio: "Trasporto Via Scotti"
            },
            {
                id: 1132,
                operatore: "PASCARIELLO GIUSEPPE",
                data: "23/12/2025",
                nominativo: "CAMILLERI MARIANNA",
                ora_sotto_casa: "14:45",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO GENERICO"
            }
        ];
        
        container.innerHTML = '';
        serviziEsempio.forEach(servizio => {
            const entry = createServiceEntry(servizio, true); // true = con pulsante COMPLETA
            container.appendChild(entry);
        });
        return;
    }
    
    console.log('invoke disponibile, chiamo get_servizi_giorno...');
    try {
        // Chiamata API per caricare servizi del giorno da SharePoint
        console.log('Chiamata a invoke("get_servizi_giorno")...');
        const servizi = await invoke('get_servizi_giorno');
        console.log('✓ Risposta ricevuta da get_servizi_giorno:', servizi);
        console.log('Numero di servizi:', servizi ? servizi.length : 0);
        
        container.innerHTML = '';
        
        if (servizi && servizi.length > 0) {
            console.log('Mostro', servizi.length, 'servizi');
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, true); // true = con pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            console.log('Nessun servizio trovato, mostro messaggio');
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        console.error('✗ Errore nel caricamento servizi del giorno:', error);
        console.error('Dettagli errore:', error.message, error.stack);
        // Mostra un messaggio di errore visibile
        container.innerHTML = '<div style="padding: 20px; color: red;">Errore nel caricamento: ' + error.message + '</div>';
    }
    console.log('=== Fine loadServiziGiorno ===');
}

// Carica prossimi servizi
async function loadProssimiServizi() {
    const container = document.getElementById('prossimi-servizi');
    if (!container) return;
    
    // Se non siamo in Tauri, mostra dati di esempio
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: caricamento prossimi servizi di esempio');
        const serviziEsempio = [
            {
                id: 1153,
                operatore: "GUAZZINI LUCA",
                data: "24/12/2025",
                nominativo: "BESTENTE ANNA VINCENZA",
                ora_sotto_casa: "09:30",
                ora_destinazione: "",
                tipo_servizio: "Commissioni varie"
            },
            {
                id: 1099,
                operatore: "CONTI MARZIA",
                data: "24/12/2025",
                nominativo: "RESCE MARIA GIUSEPPINA",
                ora_sotto_casa: "09:30",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST"
            },
            {
                id: 1157,
                operatore: "PASCARIELLO GIUSEPPE",
                data: "24/12/2025",
                nominativo: "CHIRONE FILIPPO",
                ora_sotto_casa: "10:30",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO IN OSPEDALE CON MEZZO ATTREZ"
            }
        ];
        
        container.innerHTML = '';
        serviziEsempio.forEach(servizio => {
            const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
            container.appendChild(entry);
        });
        return;
    }
    
    try {
        // Chiamata API per caricare prossimi servizi da SharePoint
        const servizi = await invoke('get_prossimi_servizi');
        container.innerHTML = '';
        
        if (servizi && servizi.length > 0) {
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        console.error('Errore nel caricamento prossimi servizi:', error);
        container.innerHTML = '<div style="padding: 20px; color: red;">Errore nel caricamento: ' + error.message + '</div>';
    }
}

// Carica servizi inseriti oggi
async function loadServiziInseritiOggi() {
    const container = document.getElementById('servizi-inseriti-oggi');
    if (!container) return;
    
    // Se non siamo in Tauri, mostra dati di esempio
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: caricamento servizi inseriti oggi di esempio');
        const serviziEsempio = [
            {
                id: 1159,
                operatore: "FRANCO FRANCESCO",
                data: "30/12/2025",
                nominativo: "BOTTARO UGO",
                ora_sotto_casa: "09:30",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO IN OSPEDALE CARD. MASSAIA AST"
            },
            {
                id: 1157,
                operatore: "PASCARIELLO GIUSEPPE",
                data: "24/12/2025",
                nominativo: "CHIRONE FILIPPO",
                ora_sotto_casa: "10:30",
                ora_destinazione: "",
                tipo_servizio: "TRASPORTO IN OSPEDALE CON MEZZO ATTREZ"
            }
        ];
        
        container.innerHTML = '';
        serviziEsempio.forEach(servizio => {
            const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
            container.appendChild(entry);
        });
        return;
    }
    
    try {
        // Chiamata API per caricare servizi inseriti oggi da SharePoint
        const servizi = await invoke('get_servizi_inseriti_oggi');
        container.innerHTML = '';
        
        if (servizi && servizi.length > 0) {
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        console.error('Errore nel caricamento servizi inseriti oggi:', error);
        container.innerHTML = '<div style="padding: 20px; color: red;">Errore nel caricamento: ' + error.message + '</div>';
    }
}

// Carica tessere da fare
async function loadTessereDaFare() {
    const container = document.getElementById('tessere-da-fare');
    if (!container) {
        console.error('Contenitore tessere-da-fare non trovato!');
        return;
    }
    
    // Se non siamo in Tauri o invoke non è disponibile, mostra messaggio
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: invoke non disponibile per tessere da fare');
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Modalità demo - tessere non disponibili</div>';
        return;
    }
    
    try {
        console.log('Chiamata a invoke("get_tessere_da_fare")...');
        const tessere = await invoke('get_tessere_da_fare');
        console.log('✓ Risposta ricevuta da get_tessere_da_fare:', tessere);
        console.log('Numero di tessere:', tessere ? tessere.length : 0);
        
        container.innerHTML = '';
        
        if (tessere && Array.isArray(tessere) && tessere.length > 0) {
            console.log('Mostro', tessere.length, 'tessere');
            tessere.forEach(tessera => {
                const entry = createCardEntry(tessera);
                container.appendChild(entry);
            });
        } else {
            console.log('Nessuna tessera trovata, mostro messaggio');
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessuna tessera da fare</div>';
        }
    } catch (error) {
        console.error('✗ Errore nel caricamento tessere da fare:', error);
        console.error('Dettagli errore:', error.message, error.stack);
        // Mostra un messaggio di errore visibile con più dettagli
        let errorMsg = error.message || error.toString();
        // Sostituisci \n con <br> per formattare meglio
        let errorMsgFormatted = errorMsg.replace(/\n/g, '<br>');
        console.log('Messaggio errore completo:', errorMsg);
        container.innerHTML = '<div style="padding: 20px; color: red; background: #ffe6e6; border: 1px solid #ff9999; border-radius: 4px; max-height: 500px; overflow-y: auto; font-family: monospace; font-size: 11px;">' +
            '<strong>Errore nel caricamento tessere:</strong><br><br>' + 
            '<div style="white-space: pre-wrap;">' + errorMsgFormatted + '</div>' +
            '</div>';
    }
}

// Crea elemento servizio
function createServiceEntry(servizio, showCompleta = true) {
    const div = document.createElement('div');
    div.className = 'service-entry';
    
    const completaButton = showCompleta 
        ? `<button class="btn btn-completa" onclick="completaServizio(${servizio.id})">COMPLETA</button>`
        : '';
    
    div.innerHTML = `
        <div class="service-header">
            <div class="service-id">${servizio.id}</div>
            <div class="service-field-inline">
                <label>OPERATORE:</label>
                <input type="text" value="${servizio.operatore || ''}" data-field="operatore" data-id="${servizio.id}" readonly>
            </div>
        </div>
        <div class="service-row">
            <div class="service-field-inline service-nominativo service-nominativo-full">
                <label>Nominativo:</label>
                <input type="text" value="${servizio.nominativo || ''}" data-field="nominativo" data-id="${servizio.id}" readonly>
            </div>
        </div>
        <div class="service-row">
            <div class="service-field-inline service-data-field">
                <label>DATA:</label>
                <input type="text" class="service-date-input" value="${servizio.data || ''}" data-field="data" data-id="${servizio.id}" readonly>
            </div>
            <div class="service-field-inline service-ora-sotto-casa">
                <label title="ORA SOTTO CASA">O.S.C.:</label>
                <input type="text" value="${servizio.ora_sotto_casa || ''}" data-field="ora_sotto_casa" data-id="${servizio.id}" readonly>
            </div>
            <div class="service-field-inline service-ora-destinazione">
                <label title="ORA A DESTINAZIONE">O.A.D.:</label>
                <input type="text" value="${servizio.ora_destinazione || ''}" data-field="ora_destinazione" data-id="${servizio.id}" readonly>
            </div>
        </div>
        <div class="service-field-full">
            <label>TIPO DI SERVIZIO:</label>
            <input type="text" value="${servizio.tipo_servizio || ''}" data-field="tipo_servizio" data-id="${servizio.id}" readonly>
        </div>
        <div class="service-buttons">
            <button class="btn btn-stampa" onclick="stampaServizio(${servizio.id})">STAMPA</button>
            <button class="btn btn-modifica" onclick="modificaServizio(${servizio.id})">MODIFICA</button>
            ${completaButton}
        </div>
    `;
    
    // Aggiungi event listener per gli altri campi
    const entryDiv = div;
    setTimeout(() => {
        const inputs = entryDiv.querySelectorAll('input[data-field]');
        inputs.forEach(input => {
            if (input.getAttribute('data-field') !== 'tipo_servizio') {
                input.addEventListener('change', function() {
                    const field = this.getAttribute('data-field');
                    const id = parseInt(this.getAttribute('data-id'));
                    const value = this.value;
                    updateServizioField(id, field, value);
                });
            }
        });
    }, 100);
    
    return div;
}

// Crea elemento tessera
function createCardEntry(tessera) {
    const div = document.createElement('div');
    div.className = 'card-entry';
    
    div.innerHTML = `
        <div class="card-id">${tessera.id}</div>
        <div class="card-description">
            <input type="text" value="${tessera.descrizione || ''}" data-field="descrizione" data-id="${tessera.id}" readonly>
        </div>
        <button class="btn btn-nuovo" onclick="nuovaTessera(${tessera.id})">NUOVO</button>
        <button class="btn btn-arrow" onclick="apriTessera(${tessera.id})">→</button>
    `;
    
    return div;
}

// Funzioni per i pulsanti
window.stampaServizio = async function(id) {
    if (!isTauri() || !invoke) {
        alert('Stampa avviata per servizio ' + id + ' (modalità demo)');
        return;
    }
    
    try {
        await invoke('stampa_servizio', { id });
        alert('Stampa avviata per servizio ' + id);
    } catch (error) {
        console.error('Errore nella stampa:', error);
    }
};

window.modificaServizio = async function(id) {
    if (!isTauri() || !invoke) {
        alert('Modifica servizio ' + id + ' (modalità demo)');
        return;
    }
    
    try {
        await invoke('modifica_servizio', { id });
        // TODO: Aprire finestra/modale di modifica
    } catch (error) {
        console.error('Errore nella modifica:', error);
    }
};

window.completaServizio = async function(id) {
    if (!isTauri() || !invoke) {
        alert('Servizio ' + id + ' completato (modalità demo)');
        await loadServiziGiorno();
        return;
    }
    
    try {
        await invoke('completa_servizio', { id });
        // Ricarica i servizi
        await loadServiziGiorno();
    } catch (error) {
        console.error('Errore nel completamento:', error);
    }
};

window.nuovaTessera = async function(id) {
    try {
        await invoke('nuova_tessera', { id });
    } catch (error) {
        console.error('Errore nella creazione tessera:', error);
    }
};

window.apriTessera = async function(id) {
    try {
        await invoke('apri_tessera', { id });
    } catch (error) {
        console.error('Errore nell\'apertura tessera:', error);
    }
};

// Funzione per aggiornare un campo specifico di un servizio su SharePoint
window.updateServizioField = async function(id, field, value) {
    if (!isTauri() || !invoke) {
        console.log(`DEMO MODE: Aggiornamento servizio ${id}, campo ${field}: ${value}`);
        return;
    }
    try {
        // Prepara i parametri per la chiamata
        const params = { id };
        if (field === 'operatore') params.operatore = value;
        else if (field === 'data') params.data = value;
        else if (field === 'nominativo') params.nominativo = value;
        else if (field === 'ora_sotto_casa') params.ora_sotto_casa = value;
        else if (field === 'ora_destinazione') params.ora_destinazione = value;
        else if (field === 'tipo_servizio') params.tipo_servizio = value;
        
        await invoke('update_servizio_sharepoint', params);
        console.log(`Servizio ${id}, campo ${field} aggiornato a ${value}`);
    } catch (error) {
        console.error(`Errore nell'aggiornamento del servizio ${id}, campo ${field}:`, error);
    }
};

// Verifica autenticazione e reindirizza se necessario
async function checkAuthAndRedirect() {
    console.log('=== INIZIO CONTROLLO AUTENTICAZIONE ===');
    
    // Prima inizializza Tauri per avere accesso a invoke
    const tauriReady = await initTauri();
    console.log('Tauri inizializzato:', tauriReady, 'invoke disponibile:', typeof invoke !== 'undefined');
    
    if (!tauriReady || !invoke) {
        // In modalità browser/demo, non reindirizzare (per sviluppo)
        console.log('Modalità demo: autenticazione saltata');
        return true;
    }
    
    try {
        // Prova prima a inizializzare SharePoint da config.json
        try {
            console.log('Tentativo di inizializzare SharePoint da config.json...');
            await invoke('init_sharepoint_from_config');
            console.log('✓ Client SharePoint inizializzato da config.json');
        } catch (error) {
            console.log('✗ config.json non trovato o errore nell\'inizializzazione:', error);
        }
        
        // Verifica se l'utente è autenticato
        console.log('Verifica stato autenticazione...');
        const isAuthenticated = await invoke('check_authentication');
        console.log('Stato autenticazione ricevuto:', isAuthenticated);
        
        if (!isAuthenticated) {
            console.log('❌ Utente NON autenticato, reindirizzamento a auth.html');
            window.location.href = 'auth.html';
            return false;
        }
        
        console.log('✓ Utente autenticato, procedo con il caricamento dati');
        console.log('=== FINE CONTROLLO AUTENTICAZIONE ===');
        return true;
    } catch (error) {
        console.error('❌ Errore nel controllo autenticazione:', error);
        // In caso di errore, reindirizza comunque alla pagina di autenticazione
        window.location.href = 'auth.html';
        return false;
    }
}

// Event listener per chiusura applicazione
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOMContentLoaded index.html ===');
    console.log('URL completa:', window.location.href);
    console.log('Query string:', window.location.search);
    
    // Se c'è un codice OAuth nella URL, gestiscilo
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    console.log('Codice nella URL:', code ? 'SÌ (' + code.substring(0, 20) + '...)' : 'NO');
    
    if (code) {
        console.log('🔍🔍🔍 Codice OAuth trovato in index.html');
        console.log('URL completa:', window.location.href);
        console.log('Codice (primi 20 caratteri):', code.substring(0, 20));
        
        // Verifica se siamo nella finestra OAuth o nella finestra principale
        try {
            const { appWindow } = await import('@tauri-apps/api/window');
            const { emit: emitEvent } = await import('@tauri-apps/api/event');
            const currentWindow = appWindow;
            
            let currentLabel;
            try {
                currentLabel = await currentWindow.label();
                console.log('Label finestra corrente:', currentLabel);
            } catch (e) {
                console.error('Errore nel recupero label:', e);
                // Se non riusciamo a ottenere il label, proviamo comunque
                currentLabel = 'unknown';
            }
            
            if (currentLabel === 'oauth-auth') {
                // Siamo nella finestra OAuth, emetti l'evento con il codice e chiudi la finestra
                console.log('✓✓✓ Siamo nella finestra OAuth, emettiamo evento oauth-code-received');
                
                try {
                    await emitEvent('oauth-code-received', { code: code });
                    console.log('✓✓✓ Evento oauth-code-received emesso dalla finestra OAuth');
                    
                    // Chiudi questa finestra dopo un breve delay
                    setTimeout(async () => {
                        try {
                            console.log('Chiudendo finestra OAuth...');
                            await currentWindow.close();
                            console.log('✓✓✓ Finestra OAuth chiusa');
                        } catch (e) {
                            console.error('Errore chiusura finestra:', e);
                        }
                    }, 1000);
                } catch (e) {
                    console.error('Errore nell\'emissione evento:', e);
                    // Fallback: reindirizza a oauth-callback.html
                    const params = new URLSearchParams(window.location.search);
                    window.location.href = `oauth-callback.html?${params.toString()}`;
                }
                return;
            } else {
                // Siamo nella finestra principale, reindirizza a auth.html con il codice
                console.log('Siamo nella finestra principale, reindirizziamo a auth.html con il codice');
                const params = new URLSearchParams(window.location.search);
                window.location.href = `auth.html?${params.toString()}`;
                return;
            }
        } catch (error) {
            console.error('Errore nel controllo finestra:', error);
            // Fallback: reindirizza a auth.html
            const params = new URLSearchParams(window.location.search);
            window.location.href = `auth.html?${params.toString()}`;
            return;
        }
    }
    
    // Verifica autenticazione prima di procedere
    const isAuthenticated = await checkAuthAndRedirect();
    
    if (!isAuthenticated) {
        // Se non autenticato, il reindirizzamento è già stato fatto
        return;
    }
    
    // Assicurati che Tauri sia inizializzato
    if (!invoke) {
        console.log('invoke non disponibile, inizializzo Tauri...');
        await initTauri();
    }
    
    // Tauri è già inizializzato in checkAuthAndRedirect
    const tauriReady = isTauri() && invoke !== undefined;
    console.log('Tauri ready per caricamento dati:', tauriReady, 'invoke:', typeof invoke);
    
    // Imposta il listener per il pulsante di chiusura (header o footer)
    const closeBtn = document.querySelector('.btn-close-app-header') || document.querySelector('.btn-close-app');
    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            if (isTauri() && appWindow) {
                await appWindow.close();
            } else {
                // In modalità browser, chiudi la finestra
                window.close();
            }
        });
    }
    
    // Imposta il listener per il pulsante CALENDARIO ONLINE
    const calendarioBtn = document.getElementById('btn-calendario-online');
    if (calendarioBtn) {
        calendarioBtn.addEventListener('click', async () => {
            const url = 'https://astiauser.sharepoint.com/sites/CALENDARIOSERVIZISHARE';
            if (isTauri()) {
                try {
                    // Crea una nuova finestra Tauri a schermo intero
                    const { Window } = await import('@tauri-apps/api/window');
                    
                    // Crea una nuova finestra con l'URL SharePoint
                    const webview = await Window.create('calendario-online', {
                        url: url,
                        title: 'Calendario Online - SharePoint',
                        fullscreen: true,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        width: screen.width,
                        height: screen.height
                    });
                    
                    // Imposta la finestra a fullscreen e metti a fuoco
                    await webview.setFullscreen(true);
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore nella creazione della finestra:', error);
                    // Fallback: usa shell.open
                    try {
                        const { shell } = await import('@tauri-apps/api/shell');
                        await shell.open(url);
                    } catch (shellError) {
                        console.error('Errore nell\'apertura del browser:', shellError);
                        window.open(url, '_blank');
                    }
                }
            } else {
                // In modalità browser, usa window.open a schermo intero
                const newWindow = window.open(url, '_blank', 'fullscreen=yes');
                if (newWindow) {
                    newWindow.moveTo(0, 0);
                    newWindow.resizeTo(screen.width, screen.height);
                }
            }
        });
    }
    
    // Imposta il listener per il pulsante ELENCO SERVIZI
    const elencoServiziBtn = document.getElementById('btn-elenco-servizi');
    if (elencoServiziBtn) {
        elencoServiziBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    // Crea una nuova finestra Tauri per ELENCO SERVIZI
                    const { Window } = await import('@tauri-apps/api/window');
                    
                    const webview = await Window.create('elenco-servizi', {
                        url: 'ELENCOSERVIZI.html',
                        title: 'Elenco Servizi',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore nella creazione della finestra:', error);
                    // Fallback: naviga nella stessa finestra
                    window.location.href = 'ELENCOSERVIZI.html';
                }
            } else {
                // In modalità browser, apri in una nuova scheda
                window.open('ELENCOSERVIZI.html', '_blank');
            }
        });
    }
    
    // Imposta il listener per il pulsante ELENCO SOCI
    const elencoSociBtn = document.getElementById('btn-elenco-soci');
    if (elencoSociBtn) {
        elencoSociBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    // Crea una nuova finestra Tauri per ELENCO SOCI
                    const { Window } = await import('@tauri-apps/api/window');
                    
                    const webview = await Window.create('elenco-soci', {
                        url: 'ELENCOSOCI.html',
                        title: 'Elenco Soci',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore nella creazione della finestra:', error);
                    // Fallback: naviga nella stessa finestra
                    window.location.href = 'ELENCOSOCI.html';
                }
            } else {
                // In modalità browser, apri in una nuova scheda
                window.open('ELENCOSOCI.html', '_blank');
            }
        });
    }
    
    // Imposta il listener per il pulsante ELENCO OPERATORI
    const elencoOperatoriBtn = document.getElementById('btn-elenco-operatori');
    if (elencoOperatoriBtn) {
        elencoOperatoriBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    // Crea una nuova finestra Tauri per ELENCO OPERATORI
                    const { Window } = await import('@tauri-apps/api/window');
                    
                    const webview = await Window.create('elenco-operatori', {
                        url: 'ELENCOOPERATORI.html',
                        title: 'Elenco Operatori',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore nella creazione della finestra:', error);
                    // Fallback: naviga nella stessa finestra
                    window.location.href = 'ELENCOOPERATORI.html';
                }
            } else {
                // In modalità browser, apri in una nuova scheda
                window.open('ELENCOOPERATORI.html', '_blank');
            }
        });
    }
    
    // Aggiorna data e settimana
    updateDateInfo();
    
    // Carica i dati
    loadServiziGiorno();
    
    // Aspetta che Tauri sia pronto prima di caricare gli altri dati
    if (tauriReady) {
        loadProssimiServizi();
        loadServiziInseritiOggi();
        loadTessereDaFare();
    } else {
        // Anche se Tauri non è pronto, chiama le funzioni per mostrare messaggi appropriati
        console.log('Tauri non pronto, carico comunque le funzioni per mostrare messaggi');
        loadProssimiServizi();
        loadServiziInseritiOggi();
        loadTessereDaFare();
    }
    
    // Aggiorna data ogni minuto
    setInterval(updateDateInfo, 60000);
});

