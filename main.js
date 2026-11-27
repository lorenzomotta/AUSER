import {
    initModificaServizio,
    setupModaleModifica,
    apriModalModifica,
    caricaDatiModificaServizio
} from './modifica-servizio.js';
import {
    initCompletaServizio,
    setupModaleCompleta,
    apriModalCompleta
} from './completa-servizio.js';
import {
    richiediSessione,
    isAdmin,
    leggiSessione
} from './auth-session.js';
import {
    applicaVisibilitaSidebar,
    puoVedereSidebar,
    puoFareBackupProton
} from './sidebar-permessi.js';
import { applicaTitoloFinestra, mostraVersioneInElemento } from './app-version.js';
import { opzioniFinestraAnagrafica } from './anagrafica-finestra.js';
import { initBackupProton } from './backup-proton.js';

// Import Tauri API
let invoke, appWindow;
let backupProton = null;
/** Evita di ripresentare i dialoghi durante la chiusura confermata */
let chiusuraInCorso = false;

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
function aggiornaConteggioSezione(elementId, count) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (count == null || count === '') {
        el.textContent = '';
        return;
    }
    const n = Number(count);
    el.textContent = Number.isFinite(n) ? `(${n})` : '';
}

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
        aggiornaConteggioSezione('count-servizi-giorno', serviziEsempio.length);
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
        const totale = Array.isArray(servizi) ? servizi.length : 0;
        aggiornaConteggioSezione('count-servizi-giorno', totale);
        
        if (totale > 0) {
            console.log('Mostro', totale, 'servizi');
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, true); // true = con pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            console.log('Nessun servizio trovato, mostro messaggio');
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        aggiornaConteggioSezione('count-servizi-giorno', null);
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
        aggiornaConteggioSezione('count-prossimi-servizi', serviziEsempio.length);
        return;
    }
    
    try {
        // Chiamata API per caricare prossimi servizi da SharePoint
        const servizi = await invoke('get_prossimi_servizi');
        container.innerHTML = '';
        const totale = Array.isArray(servizi) ? servizi.length : 0;
        aggiornaConteggioSezione('count-prossimi-servizi', totale);
        
        if (totale > 0) {
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        aggiornaConteggioSezione('count-prossimi-servizi', null);
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
        aggiornaConteggioSezione('count-servizi-inseriti-oggi', serviziEsempio.length);
        return;
    }
    
    try {
        // Chiamata API per caricare servizi inseriti oggi da SharePoint
        const servizi = await invoke('get_servizi_inseriti_oggi');
        container.innerHTML = '';
        const totale = Array.isArray(servizi) ? servizi.length : 0;
        aggiornaConteggioSezione('count-servizi-inseriti-oggi', totale);
        
        if (totale > 0) {
            servizi.forEach(servizio => {
                const entry = createServiceEntry(servizio, false); // false = senza pulsante COMPLETA
                container.appendChild(entry);
            });
        } else {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessun servizio trovato</div>';
        }
    } catch (error) {
        aggiornaConteggioSezione('count-servizi-inseriti-oggi', null);
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
        aggiornaConteggioSezione('count-tessere-da-fare', null);
        return;
    }
    
    try {
        console.log('Chiamata a invoke("get_tessere_da_fare")...');
        const tessere = await invoke('get_tessere_da_fare');
        console.log('✓ Risposta ricevuta da get_tessere_da_fare:', tessere);
        console.log('Numero di tessere:', tessere ? tessere.length : 0);
        
        container.innerHTML = '';
        const totale = Array.isArray(tessere) ? tessere.length : 0;
        aggiornaConteggioSezione('count-tessere-da-fare', totale);
        
        if (totale > 0) {
            console.log('Mostro', totale, 'tessere');
            tessere.forEach(tessera => {
                const entry = createCardEntry(tessera);
                container.appendChild(entry);
            });
        } else {
            console.log('Nessuna tessera trovata, mostro messaggio');
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nessuna tessera da fare</div>';
        }
    } catch (error) {
        aggiornaConteggioSezione('count-tessere-da-fare', null);
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
        <span class="card-label-nuovo">NUOVO</span>
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
        const webview = await apriFinestraPopup(
            `anagrafica-socio-${id}`,
            opzioniFinestraAnagrafica({ url, title })
        );

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
        await listen('socio-anagrafica-deleted', () => {
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

function oggiIsoLocale() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Giorni che mancano alla scadenza. Negativo = già passata. null = data vuota o non valida. */
function giorniMancantiScadenza(dateStr) {
    if (!dateStr || !String(dateStr).trim()) return null;
    const s = String(dateStr).trim();
    let year;
    let month;
    let day;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        [year, month, day] = s.slice(0, 10).split('-').map((v) => parseInt(v, 10));
    } else {
        const parts = s.split('/');
        if (parts.length !== 3) return null;
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
    }
    const scadenza = new Date(year, month - 1, day);
    if (scadenza.getFullYear() !== year || scadenza.getMonth() !== month - 1 || scadenza.getDate() !== day) {
        return null;
    }
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return Math.round((scadenza - oggi) / (1000 * 60 * 60 * 24));
}

function dateDocumentiMezzo(mezzo) {
    if (!mezzo) return [];
    return [
        mezzo.scadenza_ztl || mezzo.scadenzaZtl || '',
        mezzo.scadenza_assicurazione || mezzo.scadenzaAssicurazione || ''
    ];
}

function mezzoHaDocumentoScaduto(mezzo) {
    return dateDocumentiMezzo(mezzo).some((data) => {
        const giorni = giorniMancantiScadenza(data);
        return giorni !== null && giorni < 0;
    });
}

/** Manca da 0 a 30 giorni. Se la data è già passata non conta: resta solo l'avviso rosso. */
function mezzoHaDocumentoEntro30Giorni(mezzo) {
    return dateDocumentiMezzo(mezzo).some((data) => {
        const giorni = giorniMancantiScadenza(data);
        return giorni !== null && giorni >= 0 && giorni <= 30;
    });
}

function nomeMezzoPerAvviso(mezzo) {
    const targa = String(mezzo?.targa || '').trim();
    const numero = String(mezzo?.nr_automezzo || mezzo?.nrAutomezzo || '').trim();
    if (targa && numero) return `${numero} ${targa}`;
    return targa || numero || 'un mezzo';
}

function mostraAvvisoScadenza(alertEl, mezzi, titolo) {
    if (!alertEl) return;
    if (mezzi.length > 0) {
        const nomi = mezzi.slice(0, 4).map(nomeMezzoPerAvviso).join(', ');
        const altri = mezzi.length > 4 ? ` e altri ${mezzi.length - 4}` : '';
        alertEl.hidden = false;
        alertEl.title = `${titolo}: ${nomi}${altri}`;
        alertEl.setAttribute('aria-label', alertEl.title);
    } else {
        alertEl.hidden = true;
        alertEl.title = titolo;
        alertEl.setAttribute('aria-label', titolo);
    }
}

/** Due punti esclamativi accanto al numerino: giallo entro 30 giorni, bianco se già scaduta. */
async function aggiornaAvvisoScadenzeMezzi() {
    const alertRosso = document.getElementById('badge-scadenze-mezzi');
    const alertGiallo = document.getElementById('badge-scadenze-mezzi-30');
    if (!alertRosso && !alertGiallo) return;
    if (!invoke) {
        if (alertRosso) alertRosso.hidden = true;
        if (alertGiallo) alertGiallo.hidden = true;
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_all_automezzi');
        const mezzi = Array.isArray(list) ? list : [];
        mostraAvvisoScadenza(
            alertRosso,
            mezzi.filter(mezzoHaDocumentoScaduto),
            'Assicurazione o ZTL scaduta'
        );
        mostraAvvisoScadenza(
            alertGiallo,
            mezzi.filter(mezzoHaDocumentoEntro30Giorni),
            'Assicurazione o ZTL in scadenza entro 30 giorni'
        );
    } catch (err) {
        console.warn('Avviso scadenze mezzi non disponibile:', err);
        if (alertRosso) alertRosso.hidden = true;
        if (alertGiallo) alertGiallo.hidden = true;
    }
}

function tesseraGiaScaduta(dateStr) {
    if (!dateStr || !String(dateStr).trim()) return false;
    const s = String(dateStr).trim();
    let year;
    let month;
    let day;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        [year, month, day] = s.slice(0, 10).split('-').map((v) => parseInt(v, 10));
    } else {
        const parts = s.split('/');
        if (parts.length !== 3) return false;
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
    }
    const scadenza = new Date(year, month - 1, day);
    if (scadenza.getFullYear() !== year || scadenza.getMonth() !== month - 1 || scadenza.getDate() !== day) {
        return false;
    }
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return scadenza < oggi;
}

function socioArchiviato(socio) {
    const value = socio?.archivia;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value || '').trim().toUpperCase();
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === 'S' || s === '1' || s === 'YES' || s === 'Y';
}

function dataOggiItaliana() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function incassoDiOggi(servizio) {
    const valore = String(
        servizio?.data_bonifico
        || servizio?.dataBonifico
        || servizio?.data_ricevuta
        || servizio?.dataRicevuta
        || ''
    ).trim();
    if (!valore) return false;
    if (valore === dataOggiItaliana()) return true;
    return valore.slice(0, 10) === oggiIsoLocale();
}

/** Numerino su INCASSI GIORNALIERI = pagamenti con data incasso di oggi. */
async function aggiornaBadgeIncassiOggi() {
    const badge = document.getElementById('badge-incassi-oggi');
    const btn = document.getElementById('btn-riepilogo-incassi');
    if (!badge) return;
    if (!invoke) {
        badge.hidden = true;
        badge.textContent = '0';
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        let list = [];
        try {
            list = await invoke('get_servizi_incassati_giorno', { data: oggiIsoLocale() });
        } catch (veloceErr) {
            console.warn('Ricerca incassi del giorno non disponibile, scarico l\'anno:', veloceErr);
            const anno = new Date().getFullYear();
            const liste = await Promise.all([anno, anno - 1].map((a) =>
                invoke('get_all_servizi_completi', { anno: a, tuttiAnni: false })
            ));
            const visti = new Set();
            liste.forEach((parte) => {
                (Array.isArray(parte) ? parte : []).forEach((servizio) => {
                    const id = String(servizio?.id || '');
                    if (!id || visti.has(id)) return;
                    visti.add(id);
                    list.push(servizio);
                });
            });
        }
        const n = (Array.isArray(list) ? list : []).filter(incassoDiOggi).length;
        if (n > 0) {
            badge.hidden = false;
            badge.textContent = String(n);
            badge.title = n === 1
                ? '1 pagamento incassato oggi'
                : `${n} pagamenti incassati oggi`;
            if (btn) btn.title = badge.title;
        } else {
            badge.hidden = true;
            badge.textContent = '0';
            badge.title = 'Pagamenti incassati oggi';
            if (btn) btn.removeAttribute('title');
        }
    } catch (err) {
        console.warn('Badge incassi di oggi non disponibile:', err);
        badge.hidden = true;
        badge.textContent = '0';
    }
}

/** Numerino su GESTIONE SOCI = tessere già scadute, senza i soci archiviati. */
async function aggiornaBadgeTessereScadute() {
    const badge = document.getElementById('badge-tessere-scadute');
    const btn = document.getElementById('btn-elenco-soci');
    if (!badge) return;
    if (!invoke) {
        badge.hidden = true;
        badge.textContent = '0';
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_all_tesserati', { escludiArchiviati: true });
        const n = (Array.isArray(list) ? list : []).filter((socio) => {
            return !socioArchiviato(socio) && tesseraGiaScaduta(socio?.scadenzatessera);
        }).length;
        if (n > 0) {
            badge.hidden = false;
            badge.textContent = String(n);
            badge.title = n === 1
                ? '1 tessera scaduta'
                : `${n} tessere scadute`;
            if (btn) btn.title = badge.title;
        } else {
            badge.hidden = true;
            badge.textContent = '0';
            badge.title = 'Tessere scadute';
            if (btn) btn.removeAttribute('title');
        }
    } catch (err) {
        console.warn('Badge tessere scadute non disponibile:', err);
        badge.hidden = true;
        badge.textContent = '0';
    }
}

/** Numerino su GESTIONE MEZZI = totale manutenzioni ancora aperte. */
async function aggiornaBadgeManutenzioniAperte() {
    const badge = document.getElementById('badge-manut-aperte');
    const btn = document.getElementById('btn-elenco-mezzi');
    if (!badge) return;
    if (!invoke) {
        badge.hidden = true;
        badge.textContent = '0';
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const n = Number(await invoke('get_conteggio_manutenzioni_aperte')) || 0;
        if (n > 0) {
            badge.hidden = false;
            badge.textContent = String(n);
            badge.title = n === 1
                ? '1 manutenzione aperta da completare'
                : `${n} manutenzioni aperte da completare`;
            if (btn) {
                btn.title = badge.title;
            }
        } else {
            badge.hidden = true;
            badge.textContent = '0';
            if (btn) btn.removeAttribute('title');
        }
    } catch (err) {
        console.warn('Badge manutenzioni aperte non disponibile:', err);
        badge.hidden = true;
        badge.textContent = '0';
    }
}

/** Alert in sidebar: giallo in preavviso, rosso se scaduta (resta finché non completi). */
async function aggiornaAvvisoManutenzioni() {
    const alertEl = document.getElementById('sidebar-manutenzione-alert');
    if (!alertEl) return;
    if (!invoke) {
        alertEl.hidden = true;
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_manutenzioni_scadute');
        const items = Array.isArray(list) ? list : [];
        const n = items.length;
        if (n > 0) {
            const nRosse = items.filter((m) => {
                const liv = String(m?.livello || '').toLowerCase();
                return liv === 'scaduta';
            }).length;
            // Se c'è almeno una scaduta → rosso; altrimenti solo preavviso → giallo
            const isRosso = nRosse > 0;
            alertEl.hidden = false;
            alertEl.classList.toggle('is-preavviso', !isRosso);
            alertEl.classList.toggle('is-scaduta', isRosso);
            const primo = items[0]?.etichetta_mezzo || items[0]?.etichettaMezzo || '';
            alertEl.textContent = n === 1 ? 'MANUTENZIONE!!' : `MANUTENZIONE!! (${n})`;
            if (isRosso) {
                alertEl.title = primo
                    ? `Manutenzione scaduta: ${primo}${n > 1 ? ` e altre ${n - 1}` : ''} — completa la scheda`
                    : 'Manutenzioni scadute — completa la scheda';
            } else {
                alertEl.title = primo
                    ? `Manutenzione in arrivo: ${primo}${n > 1 ? ` e altre ${n - 1}` : ''} — apri scheda`
                    : 'Manutenzioni in preavviso — apri scheda';
            }
        } else {
            alertEl.hidden = true;
            alertEl.classList.remove('is-preavviso', 'is-scaduta');
            alertEl.textContent = 'MANUTENZIONE!!';
        }
    } catch (err) {
        // Tabella non ancora creata in Supabase: niente alert, non bloccare la Home
        console.warn('Avviso manutenzioni non disponibile:', err);
        alertEl.hidden = true;
    }
}

/** Mostra bustina + avviso se oggi ci sono appunti in agenda per l'utente. */
async function aggiornaAvvisoAgenda(sessione) {
    const bustina = document.getElementById('agenda-bustina');
    const countEl = document.getElementById('agenda-bustina-count');
    const btn = document.getElementById('btn-appunti');
    if (!bustina || !btn || btn.hidden) {
        if (bustina) bustina.hidden = true;
        return;
    }
    if (!invoke || !sessione?.user_id) {
        bustina.hidden = true;
        return;
    }

    try {
        const list = await invoke('get_appunti_giorno', {
            userId: sessione.user_id,
            user_id: sessione.user_id,
            data: oggiIsoLocale()
        });
        const n = Array.isArray(list) ? list.length : 0;
        if (n > 0) {
            bustina.hidden = false;
            if (countEl) countEl.textContent = String(n);
            btn.title = 'Agenda — ci sono appunti per oggi';
        } else {
            bustina.hidden = true;
            btn.title = 'Agenda';
        }
    } catch (err) {
        console.warn('Avviso agenda non disponibile:', err);
        bustina.hidden = true;
    }
}

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
const CHIAVE_LATO_SIDEBAR = 'auser_sidebar_sinistra';

/** Barra a destra (come ora) oppure a sinistra, per chi usa la mano sinistra. */
function applicaLatoSidebar(sinistra) {
    document.body.classList.toggle('sidebar-sinistra', sinistra);
    const btn = document.getElementById('btn-sidebar-lato');
    if (!btn) return;
    if (sinistra) {
        btn.textContent = '▶';
        btn.title = 'Riporta la barra a destra';
        btn.setAttribute('aria-label', 'Riporta la barra a destra');
    } else {
        btn.textContent = '◀';
        btn.title = 'Sposta la barra a sinistra';
        btn.setAttribute('aria-label', 'Sposta la barra a sinistra');
    }
}

function impostaLatoSidebar() {
    applicaLatoSidebar(localStorage.getItem(CHIAVE_LATO_SIDEBAR) === '1');
    document.getElementById('btn-sidebar-lato')?.addEventListener('click', () => {
        const sinistra = !document.body.classList.contains('sidebar-sinistra');
        localStorage.setItem(CHIAVE_LATO_SIDEBAR, sinistra ? '1' : '0');
        applicaLatoSidebar(sinistra);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOMContentLoaded index.html ===');
    impostaLatoSidebar();

    // Login obbligatorio
    const sessione = await richiediSessione();
    if (!sessione) return;

    await applicaTitoloFinestra('AUSER Asti - Accesso');
    await mostraVersioneInElemento('app-version');

    const admin = isAdmin(sessione);
    const btnImpostazioni = document.getElementById('btn-impostazioni');
    const btnUtenti = document.getElementById('btn-utenti');
    // Impostazioni e Gestione utenti restano solo admin (header)
    if (btnImpostazioni) btnImpostazioni.hidden = !admin;
    if (btnUtenti) btnUtenti.hidden = !admin;
    // Pulsanti sidebar: in base alle spunte in Gestione utenti (admin = tutti)
    applicaVisibilitaSidebar(sessione);

    const sidebarUser = document.getElementById('sidebar-user');
    const sidebarUserLabel = document.getElementById('sidebar-user-label');
    if (sidebarUser) sidebarUser.hidden = false;
    if (sidebarUserLabel) {
        sidebarUserLabel.textContent = sessione.username || sessione.email || 'Utente';
    }
    
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
    setupModaleModifica();

    // Le tre colonne e le tessere partono subito.
    // Soci, telefoni e mezzi servono solo ai popup: si scaricano dopo, una volta sola.
    const caricamentoServiziHome = Promise.all([
        loadServiziGiorno(),
        loadProssimiServizi(),
        loadServiziInseritiOggi(),
        loadTessereDaFare(),
    ]);
    if (tauriReady) {
        caricamentoServiziHome.finally(() => {
            caricaDatiModificaServizio();
        });
    }
    
    backupProton = initBackupProton({
        getInvoke: () => invoke,
        isTauriEnv: isTauri
    });

    async function eseguiChiusuraConBackup() {
        if (chiusuraInCorso) return true;
        const conferma = await chiediConfermaUscitaApp();
        if (!conferma) return false;

        // Solo se l'utente ha il permesso PROTONDRIVE (o è admin)
        const sessione = leggiSessione();
        if (puoFareBackupProton(sessione) && backupProton?.chiediBackupAllaChiusura) {
            const esito = await backupProton.chiediBackupAllaChiusura();
            // Annulla → resta nell'app, non chiudere
            if (esito?.annulla) return false;
        }

        chiusuraInCorso = true;
        if (isTauri() && appWindow) {
            await appWindow.close();
        } else {
            window.close();
        }
        return true;
    }

    // Imposta il listener per il pulsante di chiusura (header o footer)
    const closeBtn = document.querySelector('.btn-close-app-header') || document.querySelector('.btn-close-app');
    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            await eseguiChiusuraConBackup();
        });
    }

    // Anche la X della finestra: stessa conferma + eventuale backup
    if (isTauri() && appWindow?.onCloseRequested) {
        appWindow.onCloseRequested(async (event) => {
            // Se abbiamo già confermato, lascia chiudere
            if (chiusuraInCorso) return;
            // Blocca la chiusura e mostra i dialoghi
            event.preventDefault();
            await eseguiChiusuraConBackup();
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
                        width: 780,
                        height: 700,
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
                window.open('IMPOSTAZIONI.html', '_blank', 'width=780,height=700');
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
            if (!puoVedereSidebar('riepilogo_incassi', sessione)) {
                alert('Non hai il permesso per aprire Incassi Giornalieri.');
                return;
            }
            const oggi = oggiIsoLocale();
            const url = `RIEPILOGOINCASSI.html?data=${encodeURIComponent(oggi)}`;
            if (isTauri()) {
                try {
                    const { WebviewWindow } = await import('@tauri-apps/api/window');
                    const existing = WebviewWindow.getByLabel('riepilogo-incassi');
                    if (existing) {
                        await existing.close().catch(() => {});
                        for (let i = 0; i < 20; i += 1) {
                            if (!WebviewWindow.getByLabel('riepilogo-incassi')) break;
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                    }
                    await apriFinestraPopup('riepilogo-incassi', {
                        url,
                        title: 'INCASSI GIORNALIERI',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura incassi giornalieri:', error);
                    alert('Impossibile aprire Incassi Giornalieri.');
                }
            } else {
                window.open(url, '_blank');
            }
        });
    }

    // Pulsante RIEPILOGO PAGAMENTI
    const riepilogoPagamentiBtn = document.getElementById('btn-riepilogo-pagamenti');
    if (riepilogoPagamentiBtn) {
        riepilogoPagamentiBtn.addEventListener('click', async () => {
            if (!puoVedereSidebar('riepilogo_pagamenti', sessione)) {
                alert('Non hai il permesso per aprire il Riepilogo Pagamenti.');
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

    // Pulsante VERIFICA TESSERAMENTI (anomalie) — di default solo admin
    const verificaTesseramentiBtn = document.getElementById('btn-verifica-tesseramenti');
    if (verificaTesseramentiBtn) {
        verificaTesseramentiBtn.addEventListener('click', async () => {
            if (!puoVedereSidebar('verifica_tesseramenti', sessione)) {
                alert('Non hai il permesso per aprire la Verifica Tesseramenti.');
                return;
            }
            if (isTauri()) {
                try {
                    await apriFinestraPopup('verifica-tesseramenti', {
                        url: 'VERIFICATESSERAMENTI.html',
                        title: 'Verifica anomalie tesseramento',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: true,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura verifica tesseramenti:', error);
                    alert('Impossibile aprire la Verifica Tesseramenti.');
                }
            } else {
                window.open('VERIFICATESSERAMENTI.html', '_blank');
            }
        });
    }

    // Pulsante AGENDA — visibile solo se abilitato in Gestione utenti (admin: sempre)
    const appuntiBtn = document.getElementById('btn-appunti');
    if (appuntiBtn) {
        appuntiBtn.addEventListener('click', async () => {
            if (!puoVedereSidebar('appunti', sessione)) {
                alert('Non hai il permesso per aprire l\'Agenda.');
                return;
            }
            if (isTauri()) {
                try {
                    const { WebviewWindow, LogicalSize } = await import('@tauri-apps/api/window');
                    const giaAperta = WebviewWindow.getByLabel('appunti');
                    if (giaAperta) {
                        await giaAperta.setSize(new LogicalSize(780, 680)).catch(() => {});
                        await giaAperta.center().catch(() => {});
                    }
                    await apriFinestraPopup('appunti', {
                        url: 'APPUNTI.html',
                        title: 'Agenda',
                        width: 780,
                        height: 680,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } catch (error) {
                    console.error('Errore apertura agenda:', error);
                    alert('Impossibile aprire l\'Agenda.');
                }
            } else {
                window.open('APPUNTI.html', '_blank', 'width=780,height=680');
            }
        });
    }

    // Bustina se oggi ci sono appunti/agenda da vedere
    if (tauriReady && puoVedereSidebar('appunti', sessione)) {
        await aggiornaAvvisoAgenda(sessione);
        // Aggiorna quando torni sulla home (es. dopo aver usato l'Agenda)
        window.addEventListener('focus', () => {
            aggiornaAvvisoAgenda(sessione);
        });
    }

    // Alert scadute + badge aperte su GESTIONE MEZZI
    if (tauriReady) {
        await Promise.all([
            aggiornaAvvisoManutenzioni(),
            aggiornaBadgeManutenzioniAperte(),
            aggiornaAvvisoScadenzeMezzi(),
            aggiornaBadgeTessereScadute(),
            aggiornaBadgeIncassiOggi()
        ]);
        window.addEventListener('focus', () => {
            aggiornaAvvisoManutenzioni();
            aggiornaBadgeManutenzioniAperte();
            aggiornaAvvisoScadenzeMezzi();
            aggiornaBadgeTessereScadute();
            aggiornaBadgeIncassiOggi();
        });
        document.getElementById('sidebar-manutenzione-alert')?.addEventListener('click', async () => {
            try {
                await invoke('init_supabase_from_config').catch(() => {});
                const list = await invoke('get_manutenzioni_scadute');
                const scadute = Array.isArray(list) ? list : [];
                if (!scadute.length) {
                    aggiornaAvvisoManutenzioni();
                    return;
                }

                let query = 'mostraScadute=1';
                if (scadute.length === 1) {
                    query = `completaManutenzione=${encodeURIComponent(scadute[0].id)}`;
                }
                const url = `ELENCOMEZZI.html?${query}`;

                if (isTauri()) {
                    const { WebviewWindow } = await import('@tauri-apps/api/window');
                    const label = 'elenco-mezzi';
                    const existing = WebviewWindow.getByLabel(label);
                    if (existing) {
                        try {
                            await existing.close();
                        } catch (_) { /* ignore */ }
                        await new Promise((r) => setTimeout(r, 200));
                    }
                    await apriFinestraPopup(label, {
                        url,
                        title: 'Manutenzione mezzo',
                        width: 1400,
                        height: 900,
                        resizable: true,
                        maximized: false,
                        decorations: true,
                        alwaysOnTop: false,
                        center: true
                    });
                } else {
                    window.open(url, '_blank');
                }
            } catch (err) {
                console.error('Apertura scheda manutenzione:', err);
                document.getElementById('btn-elenco-mezzi')?.click();
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
            if (!puoVedereSidebar('elenco_operatori', sessione)) {
                alert('Non hai il permesso per aprire Elenco Operatori.');
                return;
            }
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
                    const { WebviewWindow, LogicalSize } = await import('@tauri-apps/api/window');
                    const label = 'tratte-fuori-asti';
                    const larghezza = 933;
                    const altezza = 680;

                    const existing = WebviewWindow.getByLabel(label);
                    if (existing) {
                        try {
                            await existing.show();
                            await existing.setSize(new LogicalSize(larghezza, altezza)).catch(() => {});
                            await existing.center().catch(() => {});
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
                        width: larghezza,
                        height: altezza,
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

    // Aggiorna data ogni minuto
    setInterval(updateDateInfo, 60000);
});

