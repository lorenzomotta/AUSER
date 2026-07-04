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

        webview.setFocus().catch((err) => {
            console.warn('setFocus anagrafica:', err);
        });
    } catch (error) {
        console.error('Errore apertura anagrafica:', error);
        alert(`Impossibile aprire l'anagrafica: ${error.message || error}`);
    }
}

// Cache globale per gli operatori (prima del filtro di ricerca)
let allOperatori = [];

// Ordina per nominativo (A→Z, regole italiane)
function sortByNominativo(list) {
    return [...list].sort((a, b) =>
        (a.nominativo || '').localeCompare(b.nominativo || '', 'it', { sensitivity: 'base' })
    );
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
        
        // Prima riga: IDSOCIO, NOMINATIVO, COD. FISC., TIPOLOGIASOCIO, OPERATORE, ATTIVO, DISPONIBILITA, TELEFONO, NUMEROTESSERA, SCADENZATESSERA
        const formSection1 = document.createElement('div');
        formSection1.className = 'socio-form-section';
        const formRow1 = document.createElement('div');
        formRow1.className = 'socio-form-row';
        
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
                    <input type="checkbox" ${isOperatoreChecked ? 'checked' : ''} disabled>
                </div>
            </div>
            <div class="socio-form-group socio-form-group-attivo">
                <label>ATTIVO</label>
                <div class="socio-checkbox-container">
                    <input type="checkbox" ${isAttivoChecked ? 'checked' : ''} disabled>
                </div>
            </div>
            <div class="socio-form-group socio-form-group-disponibilita">
                <label>DISPONIBILITA</label>
                <input type="text" value="${escapeHtml(operatore.disponibilita || '')}" readonly>
            </div>
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
        `;
        
        formSection1.appendChild(formRow1);
        
        // Seconda riga: NOTAAGGIUNTIVA e pulsanti ANAGRAFICA e SERVIZI
        const formSection2 = document.createElement('div');
        formSection2.className = 'socio-form-section';
        const formRow2 = document.createElement('div');
        formRow2.className = 'socio-form-row';
        
        formRow2.innerHTML = `
            <div class="socio-form-group socio-form-group-nota">
                <label>NOTA AGGIUNTIVA</label>
                <textarea readonly>${escapeHtml(operatore.notaaggiuntiva || '')}</textarea>
            </div>
            <div class="socio-form-actions">
                <button class="btn btn-anagrafica" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}">ANAGRAFICA</button>
                <button class="btn btn-servizi" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}">SERVIZI</button>
                <button class="btn btn-chilometraggio" data-socio-id="${operatore.id || ''}" data-idsocio="${escapeHtml(operatore.idsocio || '')}">CHILOMETRAGGIO</button>
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
    const searchInput = document.getElementById('search-input');
    const containerBody = document.getElementById('soci-container-body');
    
    if (!searchInput || !containerBody) {
        return;
    }
    
    const searchTerm = searchInput.value;
    const filteredOperatori = filterOperatoriByNominativo(searchTerm);
    
    console.log(`Ricerca: "${searchTerm}" - Trovati ${filteredOperatori.length} operatori su ${allOperatori.length} totali`);
    
    // Aggiorna il conteggio nel titolo
    updateOperatoriCount(filteredOperatori.length);
    
    // Ripopola la lista con i risultati filtrati
    populateListaOperatori(filteredOperatori);
    
    // Mostra messaggio se non ci sono risultati
    if (filteredOperatori.length === 0 && searchTerm.trim() !== '') {
        containerBody.innerHTML = '<div class="soci-lista-empty">Nessun operatore trovato per: "' + escapeHtml(searchTerm) + '"</div>';
    }
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
        
        // Aggiorna il conteggio nel titolo
        updateOperatoriCount(allOperatori.length);
        
        // Ripristina tutti gli operatori
        console.log('Ricerca cancellata - Ripristino di tutti gli operatori');
        populateListaOperatori(allOperatori);
    }
}

function refreshOperatoriView() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.trim() : '';

    if (searchTerm) {
        handleSearch();
        return;
    }

    updateOperatoriCount(allOperatori.length);
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) return;

    if (allOperatori.length === 0) {
        containerBody.innerHTML = '<div class="soci-lista-empty">Nessun operatore trovato</div>';
        return;
    }

    populateListaOperatori(allOperatori);
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
    } catch (err) {
        console.warn('Listener aggiornamento anagrafica:', err);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOOPERATORI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();
    await setupSocioAnagraficaListener();
    
    // Carica tutti gli operatori e popola la lista
    await loadAllOperatori();
    
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
                const socioId = e.target.getAttribute('data-socio-id');
                const idsocio = e.target.getAttribute('data-idsocio');
                console.log('Pulsante SERVIZI cliccato per operatore ID:', socioId, 'IDSOCIO:', idsocio);
                // TODO: Implementare apertura servizi dell'operatore
                alert(`Apertura servizi per operatore ID: ${idsocio} (funzionalità in sviluppo)`);
            } else if (e.target.classList.contains('btn-chilometraggio')) {
                e.stopPropagation();
                const socioId = e.target.getAttribute('data-socio-id');
                const idsocio = e.target.getAttribute('data-idsocio');
                console.log('Pulsante CHILOMETRAGGIO cliccato per operatore ID:', socioId, 'IDSOCIO:', idsocio);
                // TODO: Implementare apertura chilometraggio dell'operatore
                alert(`Apertura chilometraggio per operatore ID: ${idsocio} (funzionalità in sviluppo)`);
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

