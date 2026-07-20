import {
    initModificaServizio,
    setupModaleModifica,
    apriModalModifica,
    caricaDatiModificaServizio
} from './modifica-servizio.js';
import {
    initCompletaServizio,
    setupModaleCompleta,
    apriModalCompleta,
    caricaDatiCompletaServizio
} from './completa-servizio.js';
import {
    richiediSessione,
    isAdmin,
    logout
} from './auth-session.js';

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

/** Apre (o riporta in primo piano) una finestra popup Tauri 1.x */
async function apriFinestraPopup(label, options) {
    const { WebviewWindow } = await import('@tauri-apps/api/window');
    const shouldMaximize = !!options.maximized;
    const existing = WebviewWindow.getByLabel(label);
    if (existing) {
        try {
            await existing.unminimize().catch(() => {});
            await existing.show();
            if (shouldMaximize) await existing.maximize().catch(() => {});
            await existing.setFocus();
            return existing;
        } catch (err) {
            console.warn(`Finestra ${label} non riutilizzabile:`, err);
            try { await existing.close(); } catch (_) { /* ignore */ }
        }
    }

    return new Promise((resolve, reject) => {
        const webview = new WebviewWindow(label, options);
        const onCreated = async () => {
            try {
                if (shouldMaximize) await webview.maximize();
                await webview.setFocus();
            } catch (_) { /* ignore */ }
            resolve(webview);
        };
        const onError = (event) => {
            reject(event?.payload || event || new Error(`Errore creazione finestra ${label}`));
        };
        webview.once('tauri://created', onCreated);
        webview.once('tauri://error', onError);
    });
}

/** Chiede conferma prima di chiudere l'applicazione */
function chiediConfermaUscitaApp() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('home-dialog-esci');
        const btnSi = document.getElementById('home-dialog-esci-si');
        const btnNo = document.getElementById('home-dialog-esci-no');

        if (!overlay || !btnSi || !btnNo) {
            resolve(window.confirm("Vuoi davvero uscire dall'applicazione?"));
            return;
        }

        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = (risposta) => {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            resolve(risposta);
        };

        const onSi = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            chiudi(true);
        };

        const onNo = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            chiudi(false);
        };

        btnSi.addEventListener('click', onSi);
        btnNo.addEventListener('click', onNo);
    });
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
        ? `<button type="button" class="btn btn-completa">COMPLETA</button>`
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
            <button type="button" class="btn btn-stampa">STAMPA</button>
            <button type="button" class="btn btn-modifica">MODIFICA</button>
            ${completaButton}
        </div>
    `;

    div.querySelector('.btn-stampa')?.addEventListener('click', () => stampaServizio(servizio.id));
    div.querySelector('.btn-modifica')?.addEventListener('click', () => modificaServizio(servizio.id));
    div.querySelector('.btn-completa')?.addEventListener('click', () => completaServizio(servizio.id));

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

    const idsocio = String(tessera.idsocio || tessera.id || '').trim();
    const idDisplay = escapeHtmlHome(idsocio || tessera.id || '');
    const descrizione = escapeHtmlHome(tessera.descrizione || '');
    const nominativoAttr = escapeHtmlHome(tessera.descrizione || '');

    div.innerHTML = `
        <div class="card-id">${idDisplay}</div>
        <div class="card-description">
            <input type="text" value="${descrizione}" data-field="descrizione" data-idsocio="${idDisplay}" readonly>
        </div>
        <button type="button" class="btn btn-nuovo" data-action="nuova-tessera" data-idsocio="${idDisplay}">NUOVO</button>
        <button type="button" class="btn btn-arrow" data-action="apri-anagrafica" data-idsocio="${idDisplay}" data-nominativo="${nominativoAttr}" title="Apri anagrafica">→</button>
    `;

    return div;
}

function escapeHtmlHome(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function apriAnagraficaSocioDaHome(idsocio, nominativo) {
    const id = String(idsocio || '').trim();
    if (!id) {
        alert('ID socio non disponibile');
        return;
    }

    const url = `ANAGRAFICASOCI.html?idsocio=${encodeURIComponent(id)}`;
    const title = nominativo
        ? `Anagrafica — ${nominativo}`
        : `Anagrafica socio ${id}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const webview = await apriFinestraPopup(`anagrafica-socio-${id}`, {
            url,
            title,
            width: 1100,
            height: 540,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        // Quando chiudi l'anagrafica, aggiorna TESSERE DA FARE
        if (webview?.once) {
            webview.once('tauri://destroyed', () => {
                loadTessereDaFare();
            });
        }
    } catch (error) {
        console.error('Errore apertura anagrafica:', error);
        alert(`Impossibile aprire l'anagrafica: ${error.message || error}`);
    }
}

async function setupTessereDaFareRefreshListener() {
    if (!isTauri()) return;
    try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen('socio-anagrafica-saved', () => {
            // Appena salvi (es. tipologia non più NUOVO), la lista si aggiorna subito
            loadTessereDaFare();
        });
    } catch (err) {
        console.warn('Listener aggiornamento tessere da fare:', err);
    }
}

// Funzioni per i pulsanti
window.stampaServizio = async function(id) {
    const idNum = parseInt(id, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) {
        alert('ID servizio non valido');
        return;
    }

    const url = `SCHEDASERVIZIO.html?id=${encodeURIComponent(idNum)}`;

    if (isTauri()) {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const label = `scheda-servizio-${idNum}`;

            const existing = WebviewWindow.getByLabel(label);
            if (existing) {
                try {
                    await existing.show();
                    await existing.setFocus();
                    return;
                } catch (err) {
                    console.warn('Finestra scheda non riutilizzabile:', err);
                    try { await existing.close(); } catch (_) { /* ignore */ }
                }
            }

            const webview = new WebviewWindow(label, {
                url,
                title: `Scheda servizio ${idNum}`,
                width: 900,
                height: 1100,
                resizable: true,
                maximized: false,
                decorations: true,
                center: true
            });

            webview.setFocus().catch((err) => console.warn('setFocus scheda:', err));
            return;
        } catch (error) {
            console.error('Errore apertura scheda servizio:', error);
        }
    }

    window.open(url, `scheda-servizio-${idNum}`, 'width=900,height=1100');
};

async function modificaServizio(id) {
    if (!isTauri() || !invoke) {
        console.warn('Modifica servizio (demo):', id);
        return;
    }

    try {
        await apriModalModifica(id);
    } catch (error) {
        console.error('Errore nella modifica:', error);
    }
}

window.modificaServizio = modificaServizio;

window.completaServizio = async function(id) {
    if (!isTauri() || !invoke) {
        console.warn('Completa servizio (demo):', id);
        return;
    }

    try {
        await apriModalCompleta(id);
    } catch (error) {
        console.error('Errore nel completamento:', error);
    }
};

window.nuovaTessera = async function(id) {
    const idNum = parseInt(id, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) {
        console.warn('Nuova tessera: ID non valido', id);
        return;
    }
    try {
        await invoke('nuova_tessera', { id: idNum });
    } catch (error) {
        console.error('Errore nella creazione tessera:', error);
    }
};

window.apriTessera = async function(id, nominativo) {
    await apriAnagraficaSocioDaHome(id, nominativo || '');
};

function setupTessereDaFareClickHandlers() {
    const container = document.getElementById('tessere-da-fare');
    if (!container || container.dataset.handlersBound === '1') return;
    container.dataset.handlersBound = '1';

    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !container.contains(btn)) return;

        const action = btn.getAttribute('data-action');
        const idsocio = btn.getAttribute('data-idsocio') || '';
        const nominativo = btn.getAttribute('data-nominativo') || '';

        if (action === 'apri-anagrafica') {
            e.preventDefault();
            await apriAnagraficaSocioDaHome(idsocio, nominativo);
            return;
        }

        if (action === 'nuova-tessera') {
            e.preventDefault();
            await window.nuovaTessera(idsocio);
        }
    });
}

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

// Inizializza Tauri all'avvio (Supabase — SharePoint non più richiesto)
async function initApp() {
    console.log('=== INIZIALIZZAZIONE APP ===');
    const tauriReady = await initTauri();
    console.log('Tauri inizializzato:', tauriReady, 'invoke disponibile:', typeof invoke !== 'undefined');

    if (tauriReady && invoke) {
        try {
            await invoke('init_supabase_from_config');
            console.log('✓ Supabase inizializzato da config.json');
        } catch (error) {
            console.warn('Init Supabase:', error);
        }
    }

    return tauriReady;
}

// Event listener per chiusura applicazione
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOMContentLoaded index.html ===');

    // Login obbligatorio
    const sessione = richiediSessione();
    if (!sessione) return;

    const admin = isAdmin(sessione);
    const btnImpostazioni = document.getElementById('btn-impostazioni');
    const btnUtenti = document.getElementById('btn-utenti');
    const btnRiepilogoPagamenti = document.getElementById('btn-riepilogo-pagamenti');
    if (btnImpostazioni) btnImpostazioni.hidden = !admin;
    if (btnUtenti) btnUtenti.hidden = !admin;
    if (btnRiepilogoPagamenti) btnRiepilogoPagamenti.hidden = !admin;

    const sidebarUser = document.getElementById('sidebar-user');
    const sidebarUserLabel = document.getElementById('sidebar-user-label');
    if (sidebarUser) sidebarUser.hidden = false;
    if (sidebarUserLabel) {
        sidebarUserLabel.textContent = sessione.username || sessione.email || 'Utente';
    }
    document.getElementById('btn-logout')?.addEventListener('click', () => logout());
    
    const tauriReady = await initApp();
    console.log('Tauri ready per caricamento dati:', tauriReady, 'invoke:', typeof invoke);

    initModificaServizio({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        onSaveSuccess: async () => {
            await loadServiziGiorno();
            await loadProssimiServizi();
            await loadServiziInseritiOggi();
        },
        onDeleteSuccess: async () => {
            await loadServiziGiorno();
            await loadProssimiServizi();
            await loadServiziInseritiOggi();
        }
    });
    initCompletaServizio({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        onSaveSuccess: async () => {
            await loadServiziGiorno();
            await loadProssimiServizi();
            await loadServiziInseritiOggi();
        }
    });
    setupModaleCompleta();
    if (tauriReady) {
        await caricaDatiCompletaServizio();
    }

    setupModaleModifica();
    if (tauriReady) {
        await caricaDatiModificaServizio();
    }
    
    // Imposta il listener per il pulsante di chiusura (header o footer)
    const closeBtn = document.querySelector('.btn-close-app-header') || document.querySelector('.btn-close-app');
    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            const conferma = await chiediConfermaUscitaApp();
            if (!conferma) return;

            if (isTauri() && appWindow) {
                await appWindow.close();
            } else {
                // In modalità browser, chiudi la finestra
                window.close();
            }
        });
    }

    // Pulsante IMPOSTAZIONI (ingranaggio) — solo is_admin
    const impostazioniBtn = document.getElementById('btn-impostazioni');
    if (impostazioniBtn) {
        impostazioniBtn.addEventListener('click', async () => {
            if (!isAdmin()) {
                alert('Solo gli amministratori possono aprire Impostazioni.');
                return;
            }
            if (isTauri()) {
                try {
                    await apriFinestraPopup('impostazioni', {
                        url: 'IMPOSTAZIONI.html',
                        title: 'Impostazioni',
                        width: 680,
                        height: 620,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura impostazioni:', error);
                    alert('Impossibile aprire le Impostazioni.');
                }
            } else {
                window.open('IMPOSTAZIONI.html', '_blank', 'width=680,height=620');
            }
        });
    }

    // Pulsante GESTIONE UTENTI (persona) — solo is_admin
    const utentiBtn = document.getElementById('btn-utenti');
    if (utentiBtn) {
        utentiBtn.addEventListener('click', async () => {
            if (!isAdmin()) {
                alert('Solo gli amministratori possono gestire gli utenti.');
                return;
            }
            if (isTauri()) {
                try {
                    await apriFinestraPopup('gestione-utenti', {
                        url: 'UTENTI.html',
                        title: 'Gestione utenti',
                        width: 860,
                        height: 700,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura gestione utenti:', error);
                    alert('Impossibile aprire la Gestione utenti.');
                }
            } else {
                window.open('UTENTI.html', '_blank', 'width=860,height=700');
            }
        });
    }
    
    // Imposta il listener per il pulsante CALENDARIO SERVIZI
    const calendarioBtn = document.getElementById('btn-calendario-servizi');
    if (calendarioBtn) {
        calendarioBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    await apriFinestraPopup('calendario-servizi', {
                        url: 'CALENDARIO.html',
                        title: 'Calendario Servizi',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore nella creazione della finestra calendario:', error);
                    window.location.href = 'CALENDARIO.html';
                }
            } else {
                window.open('CALENDARIO.html', '_blank');
            }
        });
    }

    // Imposta il listener per il pulsante NUOVO SERVIZIO
    const nuovoServizioBtn = document.getElementById('btn-nuovo-servizio');
    if (nuovoServizioBtn) {
        nuovoServizioBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { Window } = await import('@tauri-apps/api/window');
                    const webview = await Window.create('nuovo-servizio', {
                        url: 'NUOVOSERVIZIO.html',
                        title: 'Nuovo Servizio',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore apertura nuovo servizio:', error);
                    window.location.href = 'NUOVOSERVIZIO.html';
                }
            } else {
                window.open('NUOVOSERVIZIO.html', '_blank');
            }
        });
    }

    // Imposta il listener per il pulsante REPORT DEL GIORNO
    const reportGiornoBtn = document.getElementById('btn-report-giorno');
    if (reportGiornoBtn) {
        reportGiornoBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { Window } = await import('@tauri-apps/api/window');
                    const webview = await Window.create('report-giornaliero', {
                        url: 'REPORTGIORNALIERO.html',
                        title: 'Report Giornaliero',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore apertura report giornaliero:', error);
                    window.location.href = 'REPORTGIORNALIERO.html';
                }
            } else {
                window.open('REPORTGIORNALIERO.html', '_blank');
            }
        });
    }

    // Imposta il listener per il pulsante REPORT SETTIMANALE
    const reportSettimanaleBtn = document.getElementById('btn-report-settimanale');
    if (reportSettimanaleBtn) {
        reportSettimanaleBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { Window } = await import('@tauri-apps/api/window');
                    const webview = await Window.create('report-settimanale', {
                        url: 'REPORTSETTIMANALE.html',
                        title: 'Report Settimanale',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore apertura report settimanale:', error);
                    window.location.href = 'REPORTSETTIMANALE.html';
                }
            } else {
                window.open('REPORTSETTIMANALE.html', '_blank');
            }
        });
    }

    // Imposta il listener per il pulsante INCASSI GIORNALIERI
    const riepilogoIncassiBtn = document.getElementById('btn-riepilogo-incassi');
    if (riepilogoIncassiBtn) {
        riepilogoIncassiBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { Window } = await import('@tauri-apps/api/window');
                    const webview = await Window.create('selezione-data-incassi', {
                        url: 'SELEZIONEDATAINCASSI.html',
                        title: 'Seleziona data incassi',
                        width: 480,
                        height: 340,
                        resizable: false,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                    await webview.setFocus();
                } catch (error) {
                    console.error('Errore apertura selezione data incassi:', error);
                    window.location.href = 'SELEZIONEDATAINCASSI.html';
                }
            } else {
                window.open('SELEZIONEDATAINCASSI.html', '_blank', 'width=480,height=340');
            }
        });
    }

    // Pulsante RIEPILOGO PAGAMENTI — solo is_admin
    const riepilogoPagamentiBtn = document.getElementById('btn-riepilogo-pagamenti');
    if (riepilogoPagamentiBtn) {
        riepilogoPagamentiBtn.addEventListener('click', async () => {
            if (!isAdmin()) {
                alert('Solo gli amministratori possono aprire il Riepilogo Pagamenti.');
                return;
            }
            if (isTauri()) {
                try {
                    await apriFinestraPopup('riepilogo-pagamenti', {
                        url: 'RIEPILOGOPAGAMENTI.html',
                        title: 'Riepilogo Pagamenti',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura riepilogo pagamenti:', error);
                    alert('Impossibile aprire il Riepilogo Pagamenti.');
                }
            } else {
                window.open('RIEPILOGOPAGAMENTI.html', '_blank');
            }
        });
    }
    
    // Imposta il listener per il pulsante ELENCO SERVIZI
    const elencoServiziBtn = document.getElementById('btn-elenco-servizi');
    if (elencoServiziBtn) {
        elencoServiziBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    await apriFinestraPopup('elenco-servizi', {
                        url: 'ELENCOSERVIZI.html',
                        title: 'Elenco Servizi',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore nella creazione della finestra Elenco Servizi:', error);
                }
            } else {
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

    // Imposta il listener per il pulsante ELENCO MEZZI
    const elencoMezziBtn = document.getElementById('btn-elenco-mezzi');
    if (elencoMezziBtn) {
        elencoMezziBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { Window } = await import('@tauri-apps/api/window');

                    const webview = await Window.create('elenco-mezzi', {
                        url: 'ELENCOMEZZI.html',
                        title: 'Elenco Mezzi',
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
                    window.location.href = 'ELENCOMEZZI.html';
                }
            } else {
                window.open('ELENCOMEZZI.html', '_blank');
            }
        });
    }

    // Pulsante TRATTE FUORI ASTI
    const tratteBtn = document.getElementById('btn-tratte-fuori-asti');
    if (tratteBtn) {
        tratteBtn.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { WebviewWindow } = await import('@tauri-apps/api/window');
                    const label = 'tratte-fuori-asti';

                    const existing = WebviewWindow.getByLabel(label);
                    if (existing) {
                        try {
                            await existing.show();
                            await existing.setFocus();
                            return;
                        } catch (err) {
                            console.warn('Finestra tratte non riutilizzabile:', err);
                            try { await existing.close(); } catch (_) { /* ignore */ }
                        }
                    }

                    const webview = new WebviewWindow(label, {
                        url: 'TRATTEFUORIASTI.html',
                        title: 'Costo Tratte Fuori Asti',
                        width: 800,
                        height: 800,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        center: true
                    });

                    webview.setFocus().catch((err) => console.warn('setFocus tratte:', err));
                } catch (error) {
                    console.error('Errore apertura Tratte Fuori Asti:', error);
                    window.location.href = 'TRATTEFUORIASTI.html';
                }
            } else {
                window.open('TRATTEFUORIASTI.html', '_blank');
            }
        });
    }
    
    // Aggiorna data e settimana
    updateDateInfo();
    setupTessereDaFareClickHandlers();
    await setupTessereDaFareRefreshListener();
    
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

