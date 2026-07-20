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

// Cache globale per i tesserati (prima del filtro)
let allTesserati = [];
const PAGE_SIZE = 50;
let currentPage = 1;
let searchDebounceTimer = null;
let filterScaduteOnly = false;
let showArchiviatiOnly = false;
/** Set di IdSocio che hanno almeno un servizio collegato */
let idsocioConServizi = new Set();

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

// Verifica se la scadenza tessera (dd/mm/yyyy) è precedente a oggi
function parseItalianDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
        return null;
    }
    return date;
}

function isTesseraScaduta(scadenzatessera) {
    const scadenza = parseItalianDate(scadenzatessera);
    if (!scadenza) return false;
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return scadenza < oggi;
}

// Apre la maschera anagrafica per inserire un nuovo socio
async function openNuovoSocioAnagrafica() {
    const url = 'ANAGRAFICASOCI.html?nuovo=1';
    const title = 'Nuovo socio — AUSER';

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = 'anagrafica-socio-nuovo';

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (err) {
                console.warn('Finestra nuovo socio non riutilizzabile, ne creo una nuova:', err);
                try {
                    await existing.close();
                } catch (_) { /* etichetta potrebbe essere già libera */ }
            }
        }

        const webview = new WebviewWindow(label, {
            url,
            title,
            width: 1100,
            height: 540,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        webview.setFocus().catch((err) => {
            console.warn('setFocus nuovo socio:', err);
        });
    } catch (error) {
        console.error('Errore apertura nuovo socio:', error);
        alert(`Impossibile aprire l'anagrafica nuovo socio: ${error.message || error}`);
    }
}

// Apre la maschera anagrafica del socio in una nuova finestra Tauri
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
                await existing.show();
                await existing.setFocus();
                return;
            } catch (err) {
                console.warn('Finestra anagrafica esistente non riutilizzabile, ne creo una nuova:', err);
                try {
                    await existing.close();
                } catch (_) { /* etichetta potrebbe essere già libera */ }
            }
        }

        const webview = new WebviewWindow(label, {
            url,
            title,
            width: 1100,
            height: 540,
            resizable: true,
            maximized: false,
            decorations: true,
            center: true
        });

        // setFocus può fallire anche se la finestra si è aperta correttamente
        webview.setFocus().catch((err) => {
            console.warn('setFocus anagrafica:', err);
        });
    } catch (error) {
        console.error('Errore apertura anagrafica:', error);
        alert(`Impossibile aprire l'anagrafica: ${error.message || error}`);
    }
}

// Ripristina il focus sulla finestra Elenco Soci (dopo chiusura servizi filtrati)
async function focusElencoSociWindow() {
    if (!isTauri()) return;
    try {
        const { WebviewWindow, getCurrent } = await import('@tauri-apps/api/window');
        const elencoSoci = WebviewWindow.getByLabel('elenco-soci');
        if (elencoSoci) {
            await elencoSoci.show();
            await elencoSoci.setFocus();
            return;
        }
        // Elenco soci aperto nella finestra principale (navigazione da home)
        const current = getCurrent();
        if (current && /elencosoci\.html/i.test(window.location.pathname)) {
            await current.show();
            await current.setFocus();
        }
    } catch (err) {
        console.warn('Ripristino focus Elenco Soci:', err);
    }
}

function buildServiziSocioUrl(idsocio, nominativo) {
    const params = new URLSearchParams({ idsocio: String(idsocio).trim() });
    if (nominativo) params.set('nominativo', String(nominativo).trim());
    return `ELENCOSERVIZI.html?${params.toString()}`;
}

function labelFinestraServiziSocio(idsocio) {
    const safeId = String(idsocio).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `elenco-servizi-socio-${safeId}`;
}

// Apre l'elenco servizi filtrato sull'IDSOCIO del socio selezionato
async function openServiziSocio(idsocio, nominativo) {
    if (!idsocio) {
        console.error('ID socio non disponibile');
        return;
    }

    const url = buildServiziSocioUrl(idsocio, nominativo);
    const title = nominativo
        ? `Servizi — ${nominativo}`
        : `Servizi socio ${idsocio}`;

    if (!isTauri()) {
        window.open(url, '_blank');
        return;
    }

    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const label = labelFinestraServiziSocio(idsocio);

        const existing = WebviewWindow.getByLabel(label);
        if (existing) {
            try {
                await existing.show();
                await existing.maximize();
                await existing.setFocus();
                console.log('Finestra servizi socio già aperta, portata in primo piano:', label);
                return;
            } catch (err) {
                console.warn('Finestra servizi socio non riutilizzabile, ne creo una nuova:', err);
                try {
                    await existing.close();
                } catch (_) { /* etichetta potrebbe essere già libera */ }
            }
        }

        console.log('Creazione finestra servizi socio:', label, url);

        let finestraServiziAperta = false;

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
            finestraServiziAperta = true;
            console.log('Finestra servizi socio creata:', label);
            try {
                await webview.maximize();
                await webview.setFocus();
            } catch (err) {
                console.warn('maximize/focus servizi socio:', err);
            }
        });

        webview.once('tauri://error', (event) => {
            console.error('Errore creazione finestra servizi socio:', event);
        });

        webview.once('tauri://destroyed', () => {
            if (finestraServiziAperta) {
                focusElencoSociWindow();
            }
        });
    } catch (error) {
        console.error('Errore apertura servizi socio:', error);
    }
}

// Ordina per nominativo (A→Z, regole italiane)
function sortByNominativo(list) {
    return [...list].sort((a, b) =>
        (a.nominativo || '').localeCompare(b.nominativo || '', 'it', { sensitivity: 'base' })
    );
}

function socioHaServiziCollegati(idsocio) {
    const id = String(idsocio || '').trim();
    if (!id) return false;
    return idsocioConServizi.has(id);
}

async function loadIdsocioConServizi() {
    idsocioConServizi = new Set();
    if (!isTauri() || !invoke) return;

    try {
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase (idsocio servizi):', initErr);
        }
        const list = await invoke('get_idsocio_con_servizi');
        if (Array.isArray(list)) {
            list.forEach((id) => {
                const trimmed = String(id || '').trim();
                if (trimmed) idsocioConServizi.add(trimmed);
            });
        }
        console.log(`✓ IdSocio con servizi collegati: ${idsocioConServizi.size}`);
    } catch (error) {
        console.error('Errore caricamento IdSocio con servizi:', error);
    }
}

// Carica tutti i tesserati e popola la lista
async function loadAllTesserati() {
    console.log('=== loadAllTesserati chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) {
        console.error('Container soci non trovato');
        alert('Errore: Container soci non trovato nel DOM');
        return;
    }
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio');
        const tesseratoDemo = {
            id: 1,
            idsocio: '12345',
            nominativo: 'ROSSI MARIO',
            codicefiscale: 'RSSMRA80A01H501X',
            numerotessera: 'T001234',
            scadenzatessera: '31/12/2025',
            telefono: '333-1234567',
            tipologiasocio: 'ORDINARIO',
            operatore: 'OPERATORE TEST',
            attivo: 'SI',
            archivia: 'false',
            disponibilita: 'AUTISTA',
            notaaggiuntiva: 'Note aggiuntive per questo socio'
        };
        allTesserati = [tesseratoDemo];
        updateArchiviatiButtonUI();
        updateTessereScaduteUI();
        currentPage = 1;
        renderSociView();
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
        console.log(`Numero tesserati: ${tesserati ? tesserati.length : 'null/undefined'}`);
        
        if (!tesserati || !Array.isArray(tesserati) || tesserati.length === 0) {
            console.warn('Nessun tesserato trovato o array vuoto');
            containerBody.innerHTML = '<div class="soci-lista-empty">Nessun tesserato trovato</div>';
            return;
        }
        
        allTesserati = sortByNominativo(tesserati);
        updateArchiviatiButtonUI();
        updateTessereScaduteUI();
        updateSociCount(getSociNonArchiviati().length);
        currentPage = 1;
        renderSociView();
    } catch (error) {
        console.error('Errore nel caricamento tesserati:', error);
        console.error('Stack trace:', error.stack);
        const errorMsg = error.message || 'Errore sconosciuto';
        containerBody.innerHTML = `<div class="soci-lista-empty">Errore: ${errorMsg}</div>`;
    }
}

function isArchiviato(tesserato) {
    return isTruthyFlag(tesserato.archivia);
}

function getSociArchiviati(list = allTesserati) {
    return list.filter(t => isArchiviato(t));
}

function getSociNonArchiviati(list = allTesserati) {
    return list.filter(t => !isArchiviato(t));
}

function getBaseListForView() {
    return showArchiviatiOnly ? getSociArchiviati() : getSociNonArchiviati();
}

function updateArchiviatiButtonUI() {
    const btn = document.getElementById('btn-mostra-archiviati');
    if (!btn) return;

    const archiviatiCount = getSociArchiviati().length;
    btn.classList.toggle('active', showArchiviatiOnly);
    btn.textContent = showArchiviatiOnly ? 'Mostra Attivi' : 'Mostra Archiviati';
    btn.disabled = archiviatiCount === 0 && !showArchiviatiOnly;
    btn.title = showArchiviatiOnly
        ? 'Torna ai soci non archiviati'
        : archiviatiCount === 0
            ? 'Nessun socio archiviato'
            : `Mostra ${archiviatiCount} soci archiviati`;
}

function toggleMostraArchiviati() {
    if (!showArchiviatiOnly && getSociArchiviati().length === 0) return;

    showArchiviatiOnly = !showArchiviatiOnly;
    if (showArchiviatiOnly) {
        filterScaduteOnly = false;
    }

    updateArchiviatiButtonUI();
    updateTessereScaduteUI();
    currentPage = 1;
    renderSociView();
}

function countTessereScadute() {
    return getSociNonArchiviati().filter(t => isTesseraScaduta(t.scadenzatessera)).length;
}

function updateTessereScaduteUI() {
    const count = countTessereScadute();
    const countEl = document.getElementById('tessere-scadute-count');
    const btn = document.getElementById('btn-filter-scadute');

    if (countEl) {
        countEl.textContent = count;
    }

    if (count === 0) {
        filterScaduteOnly = false;
    }

    if (btn) {
        btn.disabled = count === 0 || showArchiviatiOnly;
        btn.classList.toggle('active', filterScaduteOnly && count > 0 && !showArchiviatiOnly);
        btn.title = count === 0
            ? 'Nessuna tessera scaduta'
            : filterScaduteOnly
                ? 'Mostra tutti i soci non archiviati'
                : 'Mostra solo tessere scadute';
    }
}

function toggleFilterScadute() {
    if (countTessereScadute() === 0) return;
    filterScaduteOnly = !filterScaduteOnly;
    updateTessereScaduteUI();
    currentPage = 1;
    renderSociView();
}

function getSearchTerm() {
    const searchInput = document.getElementById('search-input');
    return searchInput ? searchInput.value.trim() : '';
}

function getDisplayedTesserati() {
    let list = getBaseListForView();

    if (filterScaduteOnly && !showArchiviatiOnly) {
        list = list.filter(t => isTesseraScaduta(t.scadenzatessera));
    }

    const searchTerm = getSearchTerm();
    if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        list = list.filter(t => (t.nominativo || '').toLowerCase().includes(searchLower));
    }

    return list;
}

function getTotalPages(totalItems) {
    return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function renderSociView() {
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) return;

    const displayed = getDisplayedTesserati();
    const totalPages = getTotalPages(displayed.length);

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }

    const searchTerm = getSearchTerm();
    updateSociCount(displayed.length, searchTerm, filterScaduteOnly, showArchiviatiOnly);

    if (displayed.length === 0) {
        let emptyMsg = 'Nessun tesserato trovato';
        if (showArchiviatiOnly && searchTerm) {
            emptyMsg = `Nessun socio archiviato trovato per: "${escapeHtml(searchTerm)}"`;
        } else if (showArchiviatiOnly) {
            emptyMsg = 'Nessun socio archiviato';
        } else if (filterScaduteOnly && searchTerm) {
            emptyMsg = `Nessun socio con tessera scaduta trovato per: "${escapeHtml(searchTerm)}"`;
        } else if (filterScaduteOnly) {
            emptyMsg = 'Nessun socio con tessera scaduta';
        } else if (searchTerm) {
            emptyMsg = `Nessun socio trovato per: "${escapeHtml(searchTerm)}"`;
        }
        containerBody.innerHTML = `<div class="soci-lista-empty">${emptyMsg}</div>`;
        updatePaginationBar(0, 1, 1);
        updateArchiviatiButtonUI();
        return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = displayed.slice(start, start + PAGE_SIZE);
    renderSocioBlocks(pageItems);
    updatePaginationBar(displayed.length, currentPage, totalPages);
    updateArchiviatiButtonUI();
}

function goToPage(page) {
    const totalPages = getTotalPages(getDisplayedTesserati().length);
    const nextPage = Math.min(Math.max(1, page), totalPages);
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    renderSociView();
    const containerBody = document.getElementById('soci-container-body');
    if (containerBody) {
        containerBody.scrollTop = 0;
    }
}

function updatePaginationBar(totalItems, page, totalPages) {
    const bar = document.getElementById('soci-pagination-bar');
    if (!bar) return;

    if (totalItems === 0) {
        bar.innerHTML = '';
        return;
    }

    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);

    bar.innerHTML = `
        <button type="button" class="btn-pagination" id="btn-page-prev" ${page <= 1 ? 'disabled' : ''}>← Precedente</button>
        <span class="soci-pagination-info">Pagina ${page} di ${totalPages} · soci ${start}-${end} di ${totalItems}</span>
        <button type="button" class="btn-pagination" id="btn-page-next" ${page >= totalPages ? 'disabled' : ''}>Successiva →</button>
    `;

    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (btnPrev) btnPrev.addEventListener('click', () => goToPage(page - 1));
    if (btnNext) btnNext.addEventListener('click', () => goToPage(page + 1));
}

// Crea il blocco HTML di un singolo socio
function createSocioBlock(tesserato) {
    const isOperatore = isTruthyFlag(tesserato.operatore);
    const isAttivo = isTruthyFlag(tesserato.attivo);
    const isArchivia = isTruthyFlag(tesserato.archivia);
    const tesseraScaduta = isTesseraScaduta(tesserato.scadenzatessera);
    const scadenzaGroupClass = tesseraScaduta
        ? 'socio-form-group socio-form-group-scadenzatessera scadenza-scaduta'
        : 'socio-form-group socio-form-group-scadenzatessera';
    const scadenzaWarning = tesseraScaduta
        ? '<span class="tessera-scaduta-label">TESSERA SCADUTA!!</span>'
        : '';

    const idsocio = String(tesserato.idsocio || '').trim();
    const haServizi = socioHaServiziCollegati(idsocio);
    const serviziBtnAttrs = haServizi
        ? ''
        : ' disabled title="Nessun servizio collegato a questo socio"';

    const socioBlock = document.createElement('div');
    socioBlock.className = 'socio-block';
    socioBlock.dataset.socioId = tesserato.id || '';

    socioBlock.innerHTML = `
        <div class="socio-form-sections">
            <div class="socio-form-section">
                <div class="socio-form-row">
                    <div class="socio-form-group socio-form-group-idsocio">
                        <label>IDSOCIO</label>
                        <input type="text" value="${escapeHtml(tesserato.idsocio || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-nominativo">
                        <label>NOMINATIVO</label>
                        <input type="text" value="${escapeHtml(tesserato.nominativo || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-codicefiscale">
                        <label>COD. FISC.</label>
                        <input type="text" value="${escapeHtml(tesserato.codicefiscale || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-tipologiasocio">
                        <label>TIPOLOGIA SOCIO</label>
                        <input type="text" value="${escapeHtml(tesserato.tipologiasocio || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-operatore">
                        <label>OPERATORE</label>
                        <div class="socio-checkbox-container">
                            <input type="checkbox" ${isOperatore ? 'checked' : ''} disabled>
                        </div>
                    </div>
                    <div class="socio-form-group socio-form-group-attivo">
                        <label>ATTIVO</label>
                        <div class="socio-checkbox-container">
                            <input type="checkbox" ${isAttivo ? 'checked' : ''} disabled>
                        </div>
                    </div>
                    <div class="socio-form-group socio-form-group-disponibilita">
                        <label>DISPONIBILITA</label>
                        <input type="text" value="${escapeHtml(tesserato.disponibilita || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-telefono">
                        <label>TELEFONO</label>
                        <input type="text" value="${escapeHtml(tesserato.telefono || '')}" readonly>
                    </div>
                    <div class="socio-form-group socio-form-group-numerotessera">
                        <label>NUMERO TESSERA</label>
                        <input type="text" value="${escapeHtml(tesserato.numerotessera || '')}" readonly>
                    </div>
                    <div class="${scadenzaGroupClass}">
                        <label>SCADENZA TESSERA</label>
                        <input type="text" value="${escapeHtml(tesserato.scadenzatessera || '')}" readonly>
                        ${scadenzaWarning}
                    </div>
                </div>
            </div>
            <div class="socio-form-section">
                <div class="socio-form-row">
                    <div class="socio-form-group socio-form-group-nota">
                        <label>NOTA AGGIUNTIVA</label>
                        <textarea readonly>${escapeHtml(tesserato.notaaggiuntiva || '')}</textarea>
                    </div>
                    <div class="socio-form-group socio-form-group-archivia">
                        <label>ARCHIVIA</label>
                        <div class="socio-checkbox-container">
                            <input type="checkbox" ${isArchivia ? 'checked' : ''} disabled>
                        </div>
                    </div>
                    <div class="socio-form-actions">
                        <button type="button" class="btn btn-anagrafica" data-socio-id="${tesserato.id || ''}" data-idsocio="${escapeHtml(tesserato.idsocio || '')}">ANAGRAFICA</button>
                        <button type="button" class="btn btn-servizi" data-socio-id="${tesserato.id || ''}" data-idsocio="${escapeHtml(tesserato.idsocio || '')}"${serviziBtnAttrs}>SERVIZI</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    return socioBlock;
}

// Renderizza solo la pagina corrente (max PAGE_SIZE soci)
function renderSocioBlocks(tesserati) {
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) return;

    const fragment = document.createDocumentFragment();
    for (const tesserato of tesserati) {
        fragment.appendChild(createSocioBlock(tesserato));
    }
    containerBody.innerHTML = '';
    containerBody.appendChild(fragment);
}

// Funzione helper per escape HTML (evita XSS)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Funzione per aggiornare il conteggio visualizzato
function updateSociCount(count, searchTerm = '', scaduteFilter = false, archiviatiView = false) {
    const countElement = document.getElementById('soci-count');
    if (countElement) {
        if (archiviatiView && !searchTerm) {
            countElement.textContent = `(${count} archiviati)`;
        } else if (scaduteFilter && !searchTerm) {
            countElement.textContent = `(${count} scadute)`;
        } else if (searchTerm || scaduteFilter || archiviatiView) {
            countElement.textContent = `(${count} trovati)`;
        } else {
            countElement.textContent = `(${count})`;
        }
    }
}

// Funzione per filtrare i tesserati per nominativo (usata solo se serve isolatamente)
function filterTesseratiByNominativo(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        return allTesserati;
    }
    
    const searchLower = searchTerm.trim().toLowerCase();
    
    return allTesserati.filter(tesserato => {
        const nominativo = (tesserato.nominativo || '').toLowerCase();
        return nominativo.includes(searchLower);
    });
}

// Funzione per gestire la ricerca in tempo reale (con debounce)
function handleSearch() {
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
        currentPage = 1;
        renderSociView();
    }, 250);
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
        
        // Cancella il filtro
        if (searchInput) {
            searchInput.value = '';
        }
        
        currentPage = 1;
        renderSociView();
    }
}

function applySocioUpdateFromAnagrafica(data) {
    if (!data || data.idsocio == null || data.idsocio === '') return;

    const idsocio = String(data.idsocio);
    const index = allTesserati.findIndex(t => String(t.idsocio) === idsocio);

    if (index < 0) {
        loadAllTesserati();
        return;
    }

    const prev = allTesserati[index];
    const updated = {
        ...prev,
        nominativo: data.nominativo ?? prev.nominativo,
        codicefiscale: data.codicefiscale ?? prev.codicefiscale,
        tipologiasocio: data.tipologiasocio ?? prev.tipologiasocio,
        telefono: data.telefono ?? prev.telefono,
        notaaggiuntiva: data.notaaggiuntiva ?? prev.notaaggiuntiva,
        disponibilita: data.disponibilita ?? prev.disponibilita,
        operatore: data.operatore,
        attivo: data.attivo,
        archivia: data.archivia
    };

    allTesserati[index] = updated;

    if (data.nominativo && data.nominativo !== prev.nominativo) {
        allTesserati = sortByNominativo(allTesserati);
    }

    updateArchiviatiButtonUI();
    updateTessereScaduteUI();
    renderSociView();
}

async function setupSocioAnagraficaListener() {
    if (!isTauri()) return;
    try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen('socio-anagrafica-saved', (event) => {
            applySocioUpdateFromAnagrafica(event.payload);
        });
    } catch (err) {
        console.warn('Listener aggiornamento anagrafica:', err);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOSOCI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();
    await setupSocioAnagraficaListener();

    // Prima gli IdSocio con servizi, poi la lista soci (per abilitare/disabilitare SERVIZI)
    await loadIdsocioConServizi();
    await loadAllTesserati();
    
    // Event listener per mostrare/nascondere la ricerca
    const btnShowSearch = document.getElementById('btn-show-search');
    const btnHideSearch = document.getElementById('btn-hide-search');
    
    if (btnShowSearch) {
        btnShowSearch.addEventListener('click', showSearch);
    }
    
    if (btnHideSearch) {
        btnHideSearch.addEventListener('click', hideSearch);
    }

    const btnFilterScadute = document.getElementById('btn-filter-scadute');
    if (btnFilterScadute) {
        btnFilterScadute.addEventListener('click', toggleFilterScadute);
    }

    const btnMostraArchiviati = document.getElementById('btn-mostra-archiviati');
    if (btnMostraArchiviati) {
        btnMostraArchiviati.addEventListener('click', toggleMostraArchiviati);
    }

    document.getElementById('btn-nuovo-socio')?.addEventListener('click', openNuovoSocioAnagrafica);
    
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
    
    // Event listener per i pulsanti ANAGRAFICA e SERVIZI usando event delegation
    const containerBody = document.getElementById('soci-container-body');
    if (containerBody) {
        containerBody.addEventListener('click', (e) => {
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
                if (e.target.disabled) return;
                const idsocio = e.target.getAttribute('data-idsocio');
                const blocco = e.target.closest('.socio-block');
                const nominativoEl = blocco?.querySelector('.socio-form-group-nominativo input');
                const nominativo = nominativoEl?.value?.trim() || '';
                console.log('Pulsante SERVIZI cliccato, IDSOCIO:', idsocio);
                openServiziSocio(idsocio, nominativo);
            }
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
                    
                    // Verifica che questa sia la finestra elenco-soci e non la principale
                    if (currentWindow && currentWindow.label) {
                        const label = currentWindow.label;
                        console.log('Label finestra corrente:', label);
                        
                        // Chiudi solo se è la finestra elenco-soci
                        if (label === 'elenco-soci') {
                            await currentWindow.close();
                        } else {
                            // Se per qualche motivo non è elenco-soci, naviga alla home
                            console.warn('Finestra non è elenco-soci, navigazione a home invece di chiusura');
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

