// Import Tauri API
import { richiediSessione } from './auth-session.js';
import { puoVedereSidebar } from './sidebar-permessi.js';
import { opzioniFinestraAnagrafica, preparaFinestraAnagraficaEsistente } from './anagrafica-finestra.js';

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

// Converte un valore campo (stringa, booleano o numero) in testo
function normalizeFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).trim();
}

// Verifica se un flag (Operatore, Attivo, ...) è "vero"
function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = normalizeFieldValue(value).toUpperCase();
    if (s === '' || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === 'S' || s === '1' ||
           s === 'YES' || s === 'Y' || s === 'ATTIVO';
}

// Funzione helper per verificare se un tesserato è operatore
function isOperatore(tesserato) {
    if (!tesserato) return false;
    return isTruthyFlag(tesserato.operatore);
}

// Funzione helper per verificare se un tesserato è attivo
function isAttivo(tesserato) {
    if (!tesserato) return false;
    return isTruthyFlag(tesserato.attivo);
}

// Apre la maschera anagrafica del socio/operatore in una nuova finestra Tauri
async function openAnagraficaSocio(idsocio, nominativo) {
    if (!idsocio) {
        alert('ID socio non disponibile');
        return;
    }

    const url = `ANAGRAFICASOCI.html?idsocio=${encodeURIComponent(idsocio)}`;
    const title = nominativo
        ? `Anagrafica — ${nominativo}`
        : `Anagrafica socio ${idsocio}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = `anagrafica-socio-${idsocio}`;

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await preparaFinestraAnagraficaEsistente(existing);
                return;
            } catch (err) {
                console.warn('Finestra anagrafica esistente non riutilizzabile, ne creo una nuova:', err);
                try {
                    await existing.close();
                } catch (_) { /* etichetta potrebbe essere già libera */ }
            }
        }

        const webview = new WebviewWindow(label, opzioniFinestraAnagrafica({ url, title }));

        webview.setFocus().catch((err) => {
            console.warn('setFocus anagrafica:', err);
        });
    } catch (error) {
        console.error('Errore apertura anagrafica:', error);
        alert(`Impossibile aprire l'anagrafica: ${error.message || error}`);
    }
}

// Ripristina il focus su Elenco Operatori (dopo chiusura servizi filtrati)
async function focusElencoOperatoriWindow() {
    if (!isTauri()) return;
    try {
        const { WebviewWindow, getCurrent } = await import('@tauri-apps/api/window');
        const elencoOperatori = WebviewWindow.getByLabel('elenco-operatori');
        if (elencoOperatori) {
            await elencoOperatori.show();
            await elencoOperatori.setFocus();
            return;
        }
        const current = getCurrent();
        if (current && /elencooperatori\.html/i.test(window.location.pathname)) {
            await current.show();
            await current.setFocus();
        }
    } catch (err) {
        console.warn('Ripristino focus Elenco Operatori:', err);
    }
}

function buildServiziOperatoreUrl(nominativo) {
    const params = new URLSearchParams({ operatore: String(nominativo || '').trim() });
    return `ELENCOSERVIZI.html?${params.toString()}`;
}

function labelFinestraServiziOperatore(idsocio, nominativo) {
    const safeId = String(idsocio || nominativo).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    return `elenco-servizi-operatore-${safeId}`;
}

async function openServiziOperatore(nominativo, idsocio) {
    const nome = String(nominativo || '').trim();
    if (!nome) {
        console.error('Nominativo operatore non disponibile');
        return;
    }

    const url = buildServiziOperatoreUrl(nome);
    const title = `Servizi — ${nome}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = labelFinestraServiziOperatore(idsocio, nome);

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await existing.show();
                await existing.maximize();
                await existing.setFocus();
                console.log('Finestra servizi operatore già aperta:', label);
                return;
            } catch (err) {
                console.warn('Finestra servizi operatore non riutilizzabile:', err);
                try {
                    await existing.close();
                } catch (_) { /* etichetta potrebbe essere già libera */ }
            }
        }

        console.log('Creazione finestra servizi operatore:', label, url);

        let finestraAperta = false;

        const webview = new WebviewWindow(label, {
            url,
            title,
            width: 1400,
            height: 900,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        webview.once('tauri://created', async () => {
            finestraAperta = true;
            console.log('Finestra servizi operatore creata:', label);
            try {
                await webview.maximize();
                await webview.setFocus();
            } catch (err) {
                console.warn('maximize/focus servizi operatore:', err);
            }
        });

        webview.once('tauri://error', (event) => {
            console.error('Errore creazione finestra servizi operatore:', event);
        });

        webview.once('tauri://destroyed', () => {
            if (finestraAperta) {
                focusElencoOperatoriWindow();
            }
        });
    } catch (error) {
        console.error('Errore apertura servizi operatore:', error);
    }
}

function buildChilometraggioUrl(nominativo, idsocio) {
    const params = new URLSearchParams();
    if (nominativo) params.set('operatore', String(nominativo).trim());
    if (idsocio) params.set('idsocio', String(idsocio).trim());
    return `REPORTCHILOMETRI.html?${params.toString()}`;
}

async function openChilometraggioOperatore(nominativo, idsocio) {
    const nome = String(nominativo || '').trim();
    if (!nome && !idsocio) {
        alert('Operatore non disponibile');
        return;
    }

    const url = buildChilometraggioUrl(nome, idsocio);
    const title = nome
        ? `Chilometraggio — ${nome}`
        : `Chilometraggio operatore ${idsocio}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const safe = String(idsocio || nome).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
        const label = `chilometraggio-operatore-${safe}`;

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (err) {
                console.warn('Finestra chilometraggio non riutilizzabile:', err);
                try { await existing.close(); } catch (_) { /* ignore */ }
            }
        }

        const webview = new WebviewWindow(label, {
            url,
            title,
            width: 1000,
            height: 900,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        webview.setFocus().catch((err) => console.warn('setFocus chilometraggio:', err));
    } catch (error) {
        console.error('Errore apertura chilometraggio:', error);
        window.open(url, '_blank');
    }
}

async function openChilometraggioTotali() {
    const url = 'REPORTCHILOMETRI.html?tutti=1';
    const title = 'Chilometri Totali — Tutti gli operatori';

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = 'chilometraggio-totali';

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try { await existing.close(); } catch (_) { /* ignore */ }
        }

        const webview = new WebviewWindow(label, {
            url,
            title,
            width: 1000,
            height: 900,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        webview.setFocus().catch((err) => console.warn('setFocus chilometri totali:', err));
    } catch (error) {
        console.error('Errore apertura chilometri totali:', error);
        window.open(url, '_blank');
    }
}

// Cache globale per gli operatori (prima del filtro di ricerca)
let allOperatori = [];

/** Usate se la tabella Mansioni_supa non è raggiungibile. */
const MANSIONI_PREDEFINITE = [
    { mansione: 'Autista', codice: 'AUTISTA' },
    { mansione: 'Centralista', codice: 'CENTRALISTA' },
    { mansione: 'Nonno Vigile', codice: 'NONNO_VIGILE' },
    { mansione: 'Scuolabus', codice: 'SCUOLABUS' }
];

/** Mansioni attive (da Impostazioni → Mansioni). */
let mansioniAttive = [...MANSIONI_PREDEFINITE];

/** Codici mansione spuntati nel filtro (vuoto = nessun filtro, mostra tutti). */
let mansioniFiltroSelezionate = [];

/** true = mostra solo operatori con ATTIVO spuntato. */
let filtroSoloAttivi = false;

/** IdSocio della riga in modifica (null = nessuna). */
let editingIdsocio = null;

/** Bozza delle spunte mentre si modifica (sopravvive a un refresh della lista). */
let editingDraft = null;

// Ordina per nominativo (A→Z, regole italiane)
function sortByNominativo(list) {
    return [...list].sort((a, b) =>
        (a.nominativo || '').localeCompare(b.nominativo || '', 'it', { sensitivity: 'base' })
    );
}

/** Spezza il campo disponibilita (es. "AUTISTA,CENTRALISTA") in codici. */
function parseDisponibilita(value) {
    if (!value) return [];
    return String(value)
        .split(/[,;]/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
}

async function loadMansioni() {
    if (isTauri() && invoke) {
        try {
            try {
                await invoke('init_supabase_from_config');
            } catch (initErr) {
                console.warn('Init Supabase mansioni:', initErr);
            }
            const list = await invoke('get_mansioni');
            const attive = (Array.isArray(list) ? list : [])
                .filter((m) => m && m.attiva !== false && m.codice && m.mansione)
                .map((m) => ({
                    mansione: m.mansione,
                    codice: String(m.codice).toUpperCase()
                }));
            mansioniAttive = attive.length ? attive : [...MANSIONI_PREDEFINITE];
        } catch (error) {
            console.error('Errore caricamento mansioni:', error);
            mansioniAttive = [...MANSIONI_PREDEFINITE];
        }
    } else {
        mansioniAttive = [...MANSIONI_PREDEFINITE];
    }

    // Se una mansione è stata eliminata dalle impostazioni, toglila anche dal filtro
    const codiciValidi = new Set(mansioniAttive.map((m) => m.codice));
    const prima = mansioniFiltroSelezionate.length;
    mansioniFiltroSelezionate = mansioniFiltroSelezionate.filter((c) => codiciValidi.has(c));
    if (mansioniFiltroSelezionate.length !== prima) {
        applicaFiltriOperatori();
    }
    aggiornaStatoBottoneFiltraMansioni();
}

function renderFiltraMansioniFlags() {
    const lista = document.getElementById('filtra-mansioni-lista');
    if (!lista) return;

    if (!mansioniAttive.length) {
        lista.innerHTML = '<p class="op-modal-empty">Nessuna mansione attiva in Impostazioni.</p>';
        return;
    }

    const selezionati = new Set(mansioniFiltroSelezionate);
    lista.innerHTML = mansioniAttive.map(({ mansione, codice }) => `
        <label class="op-modal-flag">
            <input type="checkbox" value="${escapeHtml(codice)}"${selezionati.has(codice) ? ' checked' : ''}>
            <span>${escapeHtml(mansione)}</span>
        </label>
    `).join('');
}

function aggiornaStatoBottoneFiltraMansioni() {
    const btn = document.getElementById('btn-filtra-mansioni');
    if (!btn) return;
    const attivo = mansioniFiltroSelezionate.length > 0;
    btn.classList.toggle('is-active', attivo);
    btn.title = attivo
        ? `Filtro attivo: ${mansioniFiltroSelezionate.length} mansioni`
        : 'Filtra per mansioni';
}

function apriModaleFiltraMansioni() {
    const modal = document.getElementById('modal-filtra-mansioni');
    if (!modal) return;
    // Ricarica sempre le mansioni da Impostazioni così le caselle restano aggiornate
    loadMansioni().then(() => {
        renderFiltraMansioniFlags();
        // Aggiorna anche le caselle mansioni nelle righe operatori
        applicaFiltriOperatori();
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
    });
}

function chiudiModaleFiltraMansioni() {
    const modal = document.getElementById('modal-filtra-mansioni');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
}

function syncMansioniFiltroDaModale() {
    const checks = document.querySelectorAll('#filtra-mansioni-lista input[type="checkbox"]');
    mansioniFiltroSelezionate = [...checks]
        .filter((el) => el.checked)
        .map((el) => String(el.value).toUpperCase());
    aggiornaStatoBottoneFiltraMansioni();
    applicaFiltriOperatori();
}

function azzeraFiltroMansioni() {
    mansioniFiltroSelezionate = [];
    document.querySelectorAll('#filtra-mansioni-lista input[type="checkbox"]').forEach((el) => {
        el.checked = false;
    });
    aggiornaStatoBottoneFiltraMansioni();
    applicaFiltriOperatori();
}

/** Filtra per mansioni: almeno una delle spunte deve essere nella disponibilita dell'operatore. */
function filterOperatoriByMansioni(lista) {
    if (!mansioniFiltroSelezionate.length) {
        return lista;
    }
    const volute = new Set(mansioniFiltroSelezionate);
    return lista.filter((operatore) => {
        const sue = parseDisponibilita(operatore.disponibilita);
        return sue.some((codice) => volute.has(codice));
    });
}

/** Filtra solo chi ha la spunta ATTIVO. */
function filterOperatoriByAttivi(lista) {
    if (!filtroSoloAttivi) return lista;
    return lista.filter((operatore) => isAttivo(operatore));
}

function aggiornaBottoneFiltroAttivi() {
    const btn = document.getElementById('btn-filtro-attivi');
    if (!btn) return;
    if (filtroSoloAttivi) {
        btn.textContent = 'TUTTI';
        btn.title = 'Mostra di nuovo tutti gli operatori';
        btn.classList.add('is-filtrato');
        btn.setAttribute('aria-pressed', 'true');
    } else {
        btn.textContent = 'ATTIVI';
        btn.title = 'Mostra solo operatori attivi';
        btn.classList.remove('is-filtrato');
        btn.setAttribute('aria-pressed', 'false');
    }
}

function toggleFiltroAttivi() {
    filtroSoloAttivi = !filtroSoloAttivi;
    aggiornaBottoneFiltroAttivi();
    applicaFiltriOperatori();
}

/** Applica ricerca testo + filtro mansioni + filtro attivi e aggiorna la lista a video. */
function applicaFiltriOperatori() {
    const searchInput = document.getElementById('search-input');
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) return;

    const searchTerm = searchInput ? searchInput.value : '';
    let filtrati = filterOperatoriByNominativo(searchTerm);
    filtrati = filterOperatoriByMansioni(filtrati);
    filtrati = filterOperatoriByAttivi(filtrati);

    updateOperatoriCount(filtrati.length);
    populateListaOperatori(filtrati);

    if (filtrati.length === 0) {
        const pezzi = [];
        if (searchTerm.trim()) pezzi.push(`nominativo "${escapeHtml(searchTerm.trim())}"`);
        if (mansioniFiltroSelezionate.length) pezzi.push('mansioni selezionate');
        if (filtroSoloAttivi) pezzi.push('solo attivi');
        const motivo = pezzi.length ? ` per: ${pezzi.join(' + ')}` : '';
        containerBody.innerHTML = `<div class="soci-lista-empty">Nessun operatore trovato${motivo}</div>`;
    }
}

function setupFiltraMansioniModal() {
    document.getElementById('btn-filtra-mansioni')?.addEventListener('click', () => {
        apriModaleFiltraMansioni();
    });
    document.getElementById('btn-filtra-mansioni-chiudi')?.addEventListener('click', chiudiModaleFiltraMansioni);
    document.getElementById('btn-filtra-mansioni-ok')?.addEventListener('click', chiudiModaleFiltraMansioni);
    document.getElementById('btn-filtra-mansioni-azzera')?.addEventListener('click', azzeraFiltroMansioni);

    const modal = document.getElementById('modal-filtra-mansioni');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) chiudiModaleFiltraMansioni();
        });
    }

    document.getElementById('filtra-mansioni-lista')?.addEventListener('change', (e) => {
        if (e.target && e.target.matches('input[type="checkbox"]')) {
            syncMansioniFiltroDaModale();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const m = document.getElementById('modal-filtra-mansioni');
        if (m && !m.hidden) {
            chiudiModaleFiltraMansioni();
        }
    });
}

// Carica tutti i tesserati, filtra solo quelli con operatore = "SI" e popola la lista
async function loadAllOperatori() {
    console.log('=== loadAllOperatori chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) {
        console.error('Container operatori non trovato');
        alert('Errore: Container operatori non trovato nel DOM');
        return;
    }
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio');
        const operatoreDemo = {
            id: 1,
            idsocio: '12345',
            nominativo: 'ROSSI MARIO',
            codicefiscale: 'RSSMRA80A01H501X',
            numerotessera: 'T001234',
            scadenzatessera: '31/12/2025',
            telefono: '333-1234567',
            tipologiasocio: 'ORDINARIO',
            operatore: 'true',
            attivo: 'SI',
            disponibilita: 'AUTISTA',
            notaaggiuntiva: 'Note aggiuntive per questo operatore'
        };
        allOperatori = [operatoreDemo];
        populateListaOperatori([operatoreDemo]);
        return;
    }
    
    try {
        console.log('Chiamata a get_all_tesserati (Supabase)...');
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }
        const tesserati = await invoke('get_all_tesserati');
        console.log('Risposta ricevuta:', tesserati);
        console.log(`Tipo: ${typeof tesserati}, È array: ${Array.isArray(tesserati)}`);
        console.log(`Numero tesserati totali: ${tesserati ? tesserati.length : 'null/undefined'}`);
        
        if (!tesserati || !Array.isArray(tesserati) || tesserati.length === 0) {
            console.warn('Nessun tesserato trovato o array vuoto');
            containerBody.innerHTML = '<div class="soci-lista-empty">Nessun operatore trovato</div>';
            return;
        }
        
        // DEBUG: Log dei primi 10 tesserati per vedere i valori del campo operatore
        console.log('🔍 DEBUG - Analisi campo operatore per i primi 10 tesserati:');
        for (let i = 0; i < Math.min(10, tesserati.length); i++) {
            const t = tesserati[i];
            const opValue = (t.operatore || '').toString().trim();
            const isOp = isOperatore(t);
            console.log(`  [${i + 1}] ID: ${t.id}, Nominativo: ${t.nominativo}, operatore: "${opValue}" (tipo: ${typeof t.operatore}, isOperatore: ${isOp})`);
        }
        
        // FILTRA solo i tesserati con operatore = "SI" o true
        const operatori = tesserati.filter(tesserato => {
            const result = isOperatore(tesserato);
            // Log dettagliato per i primi 5 elementi filtrati
            if (tesserati.indexOf(tesserato) < 5) {
                console.log(`  🔍 Filtro: ID ${tesserato.id} - operatore="${tesserato.operatore}" -> isOperatore=${result}`);
            }
            return result;
        });
        console.log(`📊 STATISTICHE: Tesserati totali: ${tesserati.length}, Operatori trovati: ${operatori.length}`);
        
        // Se il filtro non funziona (trovati troppi), log dettagliato
        if (operatori.length > 10) {
            console.warn(`⚠️ ATTENZIONE: Trovati ${operatori.length} operatori, ma dovrebbero essere solo 2. Verifica i valori del campo operatore:`);
            operatori.slice(0, 5).forEach((op, idx) => {
                console.log(`  [${idx + 1}] ID: ${op.id}, operatore: "${op.operatore}" (tipo: ${typeof op.operatore})`);
            });
        }
        
        if (operatori.length === 0) {
            console.warn('Nessun operatore trovato');
            containerBody.innerHTML = '<div class="soci-lista-empty">Nessun operatore trovato</div>';
            return;
        }
        
        // Log del primo elemento completo per debug
        if (operatori.length > 0) {
            console.log('🔍 DEBUG - Primo operatore completo:', operatori[0]);
            console.log('🔍 DEBUG - Chiavi del primo operatore:', Object.keys(operatori[0]));
            console.log('🔍 DEBUG - Codice fiscale primo elemento:', operatori[0].codicefiscale);
        }
        
        // SALVA la copia completa degli operatori PRIMA di popolare (ordine alfabetico)
        allOperatori = sortByNominativo(operatori);
        
        // Aggiorna il conteggio nel titolo
        updateOperatoriCount(allOperatori.length);
        
        console.log(`Popolamento container con ${allOperatori.length} operatori`);
        populateListaOperatori(allOperatori);
    } catch (error) {
        console.error('Errore nel caricamento operatori:', error);
        console.error('Stack trace:', error.stack);
        const errorMsg = error.message || 'Errore sconosciuto';
        containerBody.innerHTML = `<div class="soci-lista-empty">Errore: ${errorMsg}</div>`;
    }
}

// Popola la lista degli operatori con i dati
function populateListaOperatori(operatori) {
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) {
        console.error('Container operatori non trovato');
        return;
    }
    
    // Svuota il container
    containerBody.innerHTML = '';
    
    operatori.forEach((operatore, index) => {
        // Crea un blocco per ogni operatore
        const socioBlock = document.createElement('div');
        socioBlock.className = 'socio-block';
        socioBlock.dataset.socioId = operatore.id || '';
        
        // Crea la struttura del form per questo operatore
        const formSections = document.createElement('div');
        formSections.className = 'socio-form-sections';
        
        // Determina se OPERATORE e ATTIVO sono selezionati
        const isOperatoreChecked = isOperatore(operatore);
        const isAttivoChecked = isAttivo(operatore);
        
        // Log per debug (solo primi 5 elementi)
        if (index < 5) {
            console.log(`[DEBUG] Elemento ${index + 1} - ID: ${operatore.id}, OPERATORE: ${JSON.stringify(operatore.operatore)} (checked: ${isOperatoreChecked}), ATTIVO: ${JSON.stringify(operatore.attivo)} (checked: ${isAttivoChecked})`);
        }
        
        // Codici mansione dell'operatore (campo disponibilita)
        const mansioniOperatore = new Set(parseDisponibilita(operatore.disponibilita));
        const codiciConCasella = new Set(mansioniAttive.map((m) => m.codice));
        const mansioniOrfane = [...mansioniOperatore].filter((c) => !codiciConCasella.has(c));
        const mansioniFlagsHtml = mansioniAttive.length
            ? mansioniAttive.map(({ mansione, codice }) => `
                <label class="op-mansione-flag${mansioniOperatore.has(codice) ? ' is-on' : ''}">
                    <input type="checkbox" value="${escapeHtml(codice)}" ${mansioniOperatore.has(codice) ? 'checked' : ''} disabled>
                    <span>${escapeHtml(mansione)}</span>
                </label>
            `).join('')
            : '<span class="op-mansioni-vuoto">—</span>';

        // Prima riga: IDSOCIO … ATTIVO, MANSIONI, pulsante MODIFICA (a destra)
        const formSection1 = document.createElement('div');
        formSection1.className = 'socio-form-section';
        const formRow1 = document.createElement('div');
        formRow1.className = 'socio-form-row socio-form-row-prima';
        
        formRow1.innerHTML = `
            <div class="socio-form-group socio-form-group-idsocio">
                <label>IDSOCIO</label>
                <input type="text" value="${escapeHtml(operatore.idsocio || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-nominativo">
                <label>NOMINATIVO</label>
                <input type="text" value="${escapeHtml(operatore.nominativo || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-codicefiscale">
                <label>COD. FISC.</label>
                <input type="text" value="${escapeHtml(operatore.codicefiscale || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-tipologiasocio">
                <label>TIPOLOGIA SOCIO</label>
                <input type="text" value="${escapeHtml(operatore.tipologiasocio || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-operatore">
                <label>OPERATORE</label>
                <div class="socio-checkbox-container">
                    <input type="checkbox" class="op-flag-operatore" ${isOperatoreChecked ? 'checked' : ''} disabled>
                </div>
            </div>
            <div class="socio-form-group socio-form-group-attivo">
                <label>ATTIVO</label>
                <div class="socio-checkbox-container">
                    <input type="checkbox" class="op-flag-attivo" ${isAttivoChecked ? 'checked' : ''} disabled>
                </div>
            </div>
            <div class="socio-form-group socio-form-group-mansioni">
                <label>MANSIONI</label>
                <div class="op-mansioni-flags">
                    ${mansioniFlagsHtml}
                </div>
            </div>
            <div class="socio-form-actions socio-form-actions-riga1">
                <button type="button" class="btn btn-modifica-operatore" data-idsocio="${escapeHtml(operatore.idsocio || '')}">MODIFICA</button>
            </div>
        `;
        
        formSection1.appendChild(formRow1);
        socioBlock.dataset.idsocio = operatore.idsocio || '';
        if (mansioniOrfane.length) {
            socioBlock.dataset.mansioniOrfane = mansioniOrfane.join(',');
        }

        const nominativo = String(operatore.nominativo || '').trim();

        // Seconda riga: TELEFONO, NUMERO TESSERA, SCADENZA TESSERA, NOTA (stretta), pulsanti
        const formSection2 = document.createElement('div');
        formSection2.className = 'socio-form-section';
        const formRow2 = document.createElement('div');
        formRow2.className = 'socio-form-row socio-form-row-seconda';

        formRow2.innerHTML = `
            <div class="socio-form-group socio-form-group-telefono">
                <label>TELEFONO</label>
                <input type="text" value="${escapeHtml(operatore.telefono || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-numerotessera">
                <label>NUMERO TESSERA</label>
                <input type="text" value="${escapeHtml(operatore.numerotessera || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-scadenzatessera">
                <label>SCADENZA TESSERA</label>
                <input type="text" value="${escapeHtml(operatore.scadenzatessera || '')}" readonly>
            </div>
            <div class="socio-form-group socio-form-group-nota">
                <label>NOTA AGGIUNTIVA</label>
                <textarea readonly>${escapeHtml(operatore.notaaggiuntiva || '')}</textarea>
            </div>
            <div class="socio-form-actions">
                <button type="button" class="btn btn-anagrafica" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}">ANAGRAFICA</button>
                <button type="button" class="btn btn-servizi" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}" data-nominativo="${escapeHtml(nominativo)}">SERVIZI</button>
                <button type="button" class="btn btn-chilometraggio" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}" data-nominativo="${escapeHtml(nominativo)}">CHILOMETRAGGIO</button>
            </div>
        `;
        
        formSection2.appendChild(formRow2);
        
        // Aggiungi tutte le sezioni
        formSections.appendChild(formSection1);
        formSections.appendChild(formSection2);
        
        socioBlock.appendChild(formSections);
        containerBody.appendChild(socioBlock);
    });
    
    console.log(`✓ Aggiunti ${operatori.length} blocchi operatore`);

    // Se stavi modificando una riga e la lista si è ricreata, ripristina la bozza
    if (editingIdsocio) {
        const blocco = containerBody.querySelector(`.socio-block[data-idsocio="${CSS.escape(String(editingIdsocio))}"]`);
        if (blocco && editingDraft) {
            applyDraftToBlocco(blocco, editingDraft);
            setBloccoEditMode(blocco, true);
        } else {
            editingIdsocio = null;
            editingDraft = null;
        }
    }
}

function getCheckboxFlagsFromBlocco(blocco) {
    const operatore = !!blocco.querySelector('.op-flag-operatore')?.checked;
    const attivo = !!blocco.querySelector('.op-flag-attivo')?.checked;
    const mansioni = [...blocco.querySelectorAll('.op-mansioni-flags input[type="checkbox"]:checked')]
        .map((el) => String(el.value || '').toUpperCase())
        .filter(Boolean);
    const orfane = parseDisponibilita(blocco.dataset.mansioniOrfane || '');
    orfane.forEach((c) => {
        if (!mansioni.includes(c)) mansioni.push(c);
    });
    return {
        operatore,
        attivo: operatore ? attivo : false,
        disponibilita: operatore ? mansioni.join(',') : '',
        mansioniSpuntate: mansioni
    };
}

function readDraftFromBlocco(blocco) {
    return {
        operatore: !!blocco.querySelector('.op-flag-operatore')?.checked,
        attivo: !!blocco.querySelector('.op-flag-attivo')?.checked,
        mansioni: [...blocco.querySelectorAll('.op-mansioni-flags input[type="checkbox"]')]
            .filter((el) => el.checked)
            .map((el) => String(el.value || '').toUpperCase())
    };
}

function applyDraftToBlocco(blocco, draft) {
    if (!blocco || !draft) return;
    const op = blocco.querySelector('.op-flag-operatore');
    const at = blocco.querySelector('.op-flag-attivo');
    if (op) op.checked = !!draft.operatore;
    if (at) at.checked = !!draft.attivo;
    const setMansioni = new Set((draft.mansioni || []).map((c) => String(c).toUpperCase()));
    blocco.querySelectorAll('.op-mansioni-flags input[type="checkbox"]').forEach((el) => {
        el.checked = setMansioni.has(String(el.value || '').toUpperCase());
        el.closest('.op-mansione-flag')?.classList.toggle('is-on', el.checked);
    });
    syncFlagsOperatoreNelBlocco(blocco);
}

function syncFlagsOperatoreNelBlocco(blocco) {
    const op = blocco.querySelector('.op-flag-operatore');
    const at = blocco.querySelector('.op-flag-attivo');
    const mansioniInputs = [...blocco.querySelectorAll('.op-mansioni-flags input[type="checkbox"]')];
    if (!op) return;

    const isOp = op.checked;
    if (!isOp) {
        if (at) at.checked = false;
        mansioniInputs.forEach((el) => {
            el.checked = false;
            el.closest('.op-mansione-flag')?.classList.remove('is-on');
        });
    }

    const editing = blocco.classList.contains('is-editing');
    if (at) {
        at.disabled = !editing || !isOp;
    }
    mansioniInputs.forEach((el) => {
        el.disabled = !editing || !isOp;
        el.closest('.op-mansione-flag')?.classList.toggle('is-disabled', !isOp);
    });
}

function setBloccoEditMode(blocco, editing) {
    if (!blocco) return;
    blocco.classList.toggle('is-editing', editing);

    const op = blocco.querySelector('.op-flag-operatore');
    if (op) op.disabled = !editing;

    const btn = blocco.querySelector('.btn-modifica-operatore');
    if (btn) {
        btn.textContent = editing ? 'SALVA' : 'MODIFICA';
        btn.classList.toggle('is-salva', editing);
        btn.disabled = false;
        btn.title = editing ? 'Salva le spunte' : 'Modifica le spunte';
    }

    syncFlagsOperatoreNelBlocco(blocco);
}

function aggiornaStileMansioniFlags(blocco) {
    blocco.querySelectorAll('.op-mansioni-flags input[type="checkbox"]').forEach((el) => {
        el.closest('.op-mansione-flag')?.classList.toggle('is-on', el.checked);
    });
}

async function avviaModificaOperatore(blocco) {
    const idsocio = blocco?.dataset?.idsocio;
    if (!idsocio) {
        alert('ID socio non disponibile');
        return;
    }

    if (editingIdsocio && editingIdsocio !== idsocio) {
        alert('Hai già una modifica in corso su un altro operatore.\nPremi SALVA lì prima di modificarne un altro.');
        return;
    }

    editingIdsocio = idsocio;
    editingDraft = readDraftFromBlocco(blocco);
    setBloccoEditMode(blocco, true);
}

async function salvaModificaOperatore(blocco) {
    const idsocio = blocco?.dataset?.idsocio;
    if (!idsocio) {
        alert('ID socio non disponibile');
        return;
    }

    const flags = getCheckboxFlagsFromBlocco(blocco);
    const btn = blocco.querySelector('.btn-modifica-operatore');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'SALVO…';
    }

    try {
        if (!isTauri() || !invoke) {
            // Modalità demo: aggiorna solo in memoria
            applyOperatoreUpdateFromAnagrafica({
                idsocio,
                operatore: flags.operatore,
                attivo: flags.attivo,
                disponibilita: flags.disponibilita
            });
            editingIdsocio = null;
            editingDraft = null;
            return;
        }

        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase salvataggio:', initErr);
        }

        const result = await invoke('get_socio_anagrafica', { idsocio });
        const anag = result?.anagrafica;
        if (!anag) {
            throw new Error('Anagrafica non trovata');
        }

        const payload = {
            ...anag,
            operatore: flags.operatore,
            attivo: flags.attivo,
            disponibilita: flags.disponibilita
        };

        await invoke('save_socio_anagrafica', { anagrafica: payload });

        try {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('socio-anagrafica-saved', payload);
        } catch (emitErr) {
            console.warn('Emit aggiornamento anagrafica:', emitErr);
            applyOperatoreUpdateFromAnagrafica(payload);
        }

        editingIdsocio = null;
        editingDraft = null;
        // Se l'evento non ha già aggiornato, applyOperatoreUpdateFromAnagrafica lo fa via listener.
        // In ogni caso togli modalità modifica sulla riga se è ancora in lista.
        const ancora = document.querySelector(`.socio-block[data-idsocio="${CSS.escape(String(idsocio))}"]`);
        if (ancora) setBloccoEditMode(ancora, false);
    } catch (error) {
        console.error('Errore salvataggio spunte operatore:', error);
        alert(`Impossibile salvare: ${error.message || error}`);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'SALVA';
        }
    }
}

// Funzione helper per escape HTML (evita XSS)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Funzione per aggiornare il conteggio visualizzato
function updateOperatoriCount(count) {
    const countElement = document.getElementById('operatori-count');
    if (countElement) {
        countElement.textContent = `(${count})`;
    }
}

// Funzione per filtrare gli operatori per nominativo
function filterOperatoriByNominativo(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        // Se il campo è vuoto, mostra tutti gli operatori
        return allOperatori;
    }
    
    const searchLower = searchTerm.trim().toLowerCase();
    
    return sortByNominativo(
        allOperatori.filter(operatore => {
            const nominativo = (operatore.nominativo || '').toLowerCase();
            return nominativo.includes(searchLower);
        })
    );
}

// Funzione per gestire la ricerca in tempo reale
function handleSearch() {
    applicaFiltriOperatori();
}

// Funzione per mostrare la casella di ricerca
function showSearch() {
    const searchContainer = document.getElementById('search-container');
    const btnShowSearch = document.getElementById('btn-show-search');
    const searchInput = document.getElementById('search-input');
    
    if (searchContainer && btnShowSearch) {
        searchContainer.style.display = 'flex';
        btnShowSearch.style.display = 'none';
        
        // Focus sulla casella di ricerca dopo un breve delay
        if (searchInput) {
            setTimeout(() => {
                searchInput.focus();
            }, 100);
        }
    }
}

// Funzione per nascondere la casella di ricerca e cancellare il filtro
function hideSearch() {
    const searchContainer = document.getElementById('search-container');
    const btnShowSearch = document.getElementById('btn-show-search');
    const searchInput = document.getElementById('search-input');
    
    if (searchContainer && btnShowSearch) {
        searchContainer.style.display = 'none';
        btnShowSearch.style.display = 'flex';
        
        // Cancella solo il filtro testo (il filtro mansioni resta attivo)
        if (searchInput) {
            searchInput.value = '';
        }

        console.log('Ricerca cancellata - Ripristino operatori (con eventuale filtro mansioni)');
        applicaFiltriOperatori();
    }
}

function refreshOperatoriView() {
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) return;

    if (allOperatori.length === 0) {
        updateOperatoriCount(0);
        containerBody.innerHTML = '<div class="soci-lista-empty">Nessun operatore trovato</div>';
        return;
    }

    applicaFiltriOperatori();
}

function applyOperatoreUpdateFromAnagrafica(data) {
    if (!data || data.idsocio == null || data.idsocio === '') return;

    const idsocio = String(data.idsocio);
    const isNowOperatore = isTruthyFlag(data.operatore);
    const index = allOperatori.findIndex(t => String(t.idsocio) === idsocio);

    if (!isNowOperatore) {
        if (index >= 0) {
            allOperatori.splice(index, 1);
            refreshOperatoriView();
        }
        return;
    }

    const prev = index >= 0 ? allOperatori[index] : {};
    const updated = {
        ...prev,
        id: data.id || prev.id || 0,
        idsocio,
        nominativo: data.nominativo ?? prev.nominativo ?? '',
        codicefiscale: data.codicefiscale ?? prev.codicefiscale ?? '',
        tipologiasocio: data.tipologiasocio ?? prev.tipologiasocio ?? '',
        telefono: data.telefono ?? prev.telefono ?? '',
        notaaggiuntiva: data.notaaggiuntiva ?? prev.notaaggiuntiva ?? '',
        disponibilita: data.disponibilita ?? prev.disponibilita ?? '',
        numerotessera: prev.numerotessera ?? '',
        scadenzatessera: prev.scadenzatessera ?? '',
        operatore: data.operatore,
        attivo: data.attivo,
        archivia: data.archivia
    };

    if (index >= 0) {
        allOperatori[index] = updated;
    } else {
        allOperatori.push(updated);
    }

    if (data.nominativo && data.nominativo !== prev.nominativo) {
        allOperatori = sortByNominativo(allOperatori);
    }

    refreshOperatoriView();
}

async function setupSocioAnagraficaListener() {
    if (!isTauri()) return;
    try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen('socio-anagrafica-saved', (event) => {
            applyOperatoreUpdateFromAnagrafica(event.payload);
        });
        await listen('socio-anagrafica-deleted', (event) => {
            const idsocio = String(event.payload?.idsocio || '').trim();
            if (!idsocio) return;
            allOperatori = allOperatori.filter((o) => String(o.idsocio) !== idsocio);
            refreshOperatoriView();
        });
    } catch (err) {
        console.warn('Listener aggiornamento anagrafica:', err);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOOPERATORI.html caricato ===');

    const sessione = await richiediSessione();
    if (!sessione) return;
    if (!puoVedereSidebar('elenco_operatori', sessione)) {
        alert('Non hai il permesso per questa pagina.');
        window.location.href = 'index.html';
        return;
    }
    
    // Inizializza Tauri
    await initTauri();
    await setupSocioAnagraficaListener();
    setupFiltraMansioniModal();

    // Mansioni da Impostazioni (le caselle del filtro usano questa lista)
    await loadMansioni();
    await loadAllOperatori();

    document.getElementById('btn-filtro-attivi')?.addEventListener('click', () => {
        toggleFiltroAttivi();
    });
    aggiornaBottoneFiltroAttivi();

    document.getElementById('btn-chilometri-totali')?.addEventListener('click', () => {
        openChilometraggioTotali();
    });
    
    // Event listener per mostrare/nascondere la ricerca
    const btnShowSearch = document.getElementById('btn-show-search');
    const btnHideSearch = document.getElementById('btn-hide-search');
    
    if (btnShowSearch) {
        btnShowSearch.addEventListener('click', showSearch);
    }
    
    if (btnHideSearch) {
        btnHideSearch.addEventListener('click', hideSearch);
    }
    
    // Event listener per la ricerca in tempo reale
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        // Filtra ad ogni battitura (input event)
        searchInput.addEventListener('input', handleSearch);
        
        // Filtra anche quando si incolla (per sicurezza)
        searchInput.addEventListener('paste', () => {
            setTimeout(handleSearch, 10); // Piccolo delay per permettere il paste
        });
        
        // Chiudi ricerca premendo ESC
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideSearch();
            }
        });
    }
    
    // Event listener per i pulsanti usando event delegation
    const containerBody = document.getElementById('soci-container-body');
    if (containerBody) {
        containerBody.addEventListener('click', (e) => {
            const btnModifica = e.target.closest?.('.btn-modifica-operatore');
            if (btnModifica) {
                e.stopPropagation();
                const blocco = btnModifica.closest('.socio-block');
                if (!blocco) return;
                if (btnModifica.classList.contains('is-salva')) {
                    salvaModificaOperatore(blocco);
                } else {
                    avviaModificaOperatore(blocco);
                }
                return;
            }

            if (e.target.classList.contains('btn-anagrafica')) {
                e.stopPropagation();
                const idsocio = e.target.getAttribute('data-idsocio');
                const blocco = e.target.closest('.socio-block');
                const nominativoEl = blocco?.querySelector('.socio-form-group-nominativo input');
                const nominativo = nominativoEl?.value?.trim() || '';
                console.log('Pulsante ANAGRAFICA cliccato, IDSOCIO:', idsocio);
                openAnagraficaSocio(idsocio, nominativo);
            } else if (e.target.classList.contains('btn-servizi')) {
                e.stopPropagation();
                const idsocio = e.target.getAttribute('data-idsocio');
                const nominativo = e.target.getAttribute('data-nominativo')
                    || e.target.closest('.socio-block')?.querySelector('.socio-form-group-nominativo input')?.value?.trim()
                    || '';
                console.log('Pulsante SERVIZI cliccato, operatore:', nominativo);
                openServiziOperatore(nominativo, idsocio);
            } else if (e.target.classList.contains('btn-chilometraggio')) {
                e.stopPropagation();
                const idsocio = e.target.getAttribute('data-idsocio');
                const nominativo = e.target.getAttribute('data-nominativo')
                    || e.target.closest('.socio-block')?.querySelector('.socio-form-group-nominativo input')?.value?.trim()
                    || '';
                console.log('Pulsante CHILOMETRAGGIO cliccato, operatore:', nominativo, 'IDSOCIO:', idsocio);
                openChilometraggioOperatore(nominativo, idsocio);
            }
        });

        // Durante la modifica: aggiorna bozza e stile caselle mansioni
        containerBody.addEventListener('change', (e) => {
            const blocco = e.target.closest?.('.socio-block.is-editing');
            if (!blocco) return;
            if (!e.target.matches('input[type="checkbox"]')) return;

            if (e.target.classList.contains('op-flag-operatore')) {
                syncFlagsOperatoreNelBlocco(blocco);
            }
            aggiornaStileMansioniFlags(blocco);
            editingDraft = readDraftFromBlocco(blocco);
        });
    }
    
    // Pulsante CHIUDI
    const btnChiudi = document.getElementById('btn-chiudi');
    if (btnChiudi) {
        btnChiudi.addEventListener('click', async () => {
            console.log('CHIUDI cliccato');
            if (isTauri()) {
                try {
                    const { getCurrent } = await import('@tauri-apps/api/window');
                    const currentWindow = getCurrent();
                    
                    // Verifica che questa sia la finestra elenco-operatori e non la principale
                    if (currentWindow && currentWindow.label) {
                        const label = currentWindow.label;
                        console.log('Label finestra corrente:', label);
                        
                        // Chiudi solo se è la finestra elenco-operatori
                        if (label === 'elenco-operatori') {
                            await currentWindow.close();
                        } else {
                            // Se per qualche motivo non è elenco-operatori, naviga alla home
                            console.warn('Finestra non è elenco-operatori, navigazione a home invece di chiusura');
                            window.location.href = 'index.html';
                        }
                    } else {
                        // Fallback: naviga alla home
                        window.location.href = 'index.html';
                    }
                } catch (error) {
                    console.error('Errore nella chiusura finestra:', error);
                    // Fallback: naviga alla home invece di chiudere
                    window.location.href = 'index.html';
                }
            } else {
                // Fallback per browser: chiudi la finestra o torna alla home
                if (window.opener) {
                    window.close();
                } else {
                    window.location.href = 'index.html';
                }
            }
        });
    }
});

