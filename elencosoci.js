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
            disponibilita: 'AUTISTA',
            notaaggiuntiva: 'Note aggiuntive per questo socio'
        };
        allTesserati = [tesseratoDemo];
        populateListaSoci([tesseratoDemo]);
        return;
    }
    
    try {
        console.log('Chiamata a get_all_tesserati...');
        const tesserati = await invoke('get_all_tesserati');
        console.log('Risposta ricevuta:', tesserati);
        console.log(`Tipo: ${typeof tesserati}, È array: ${Array.isArray(tesserati)}`);
        console.log(`Numero tesserati: ${tesserati ? tesserati.length : 'null/undefined'}`);
        
        if (!tesserati || !Array.isArray(tesserati) || tesserati.length === 0) {
            console.warn('Nessun tesserato trovato o array vuoto');
            containerBody.innerHTML = '<div class="soci-lista-empty">Nessun tesserato trovato</div>';
            return;
        }
        
        // Log del primo elemento completo per debug
        if (tesserati.length > 0) {
            console.log('🔍 DEBUG - Primo tesserato completo:', tesserati[0]);
            console.log('🔍 DEBUG - Chiavi del primo tesserato:', Object.keys(tesserati[0]));
            console.log('🔍 DEBUG - Codice fiscale primo elemento:', tesserati[0].codicefiscale);
        }
        
        // SALVA la copia completa PRIMA di popolare
        allTesserati = tesserati || [];
        
        // Aggiorna il conteggio nel titolo
        updateSociCount(tesserati.length);
        
        console.log(`Popolamento container con ${tesserati.length} tesserati`);
        populateListaSoci(tesserati);
    } catch (error) {
        console.error('Errore nel caricamento tesserati:', error);
        console.error('Stack trace:', error.stack);
        const errorMsg = error.message || 'Errore sconosciuto';
        containerBody.innerHTML = `<div class="soci-lista-empty">Errore: ${errorMsg}</div>`;
    }
}

// Popola la lista dei soci con i dati
function populateListaSoci(tesserati) {
    const containerBody = document.getElementById('soci-container-body');
    if (!containerBody) {
        console.error('Container soci non trovato');
        return;
    }
    
    // Svuota il container
    containerBody.innerHTML = '';
    
    tesserati.forEach((tesserato, index) => {
        // Crea un blocco per ogni socio
        const socioBlock = document.createElement('div');
        socioBlock.className = 'socio-block';
        socioBlock.dataset.socioId = tesserato.id || '';
        
        // Crea la struttura del form per questo socio
        const formSections = document.createElement('div');
        formSections.className = 'socio-form-sections';
        
        // Determina se OPERATORE è selezionato
        // I valori arrivano come stringhe "true" o "false" da SharePoint
        const operatoreValue = (tesserato.operatore || '').toString().trim();
        const operatoreUpper = operatoreValue.toUpperCase();
        const isOperatore = operatoreValue !== '' && 
            (operatoreUpper === 'TRUE' || operatoreUpper === 'SI' || operatoreUpper === 'SÌ' || 
             operatoreUpper === 'S' || operatoreUpper === '1' || operatoreUpper === 'YES' || 
             operatoreUpper === 'Y') &&
            operatoreUpper !== 'FALSE' && operatoreUpper !== 'NO' && operatoreUpper !== '0';
        
        // Log per debug (solo primi 5 elementi)
        if (index < 5) {
            console.log(`[DEBUG] Elemento ${index + 1} - ID: ${tesserato.id}, OPERATORE: "${operatoreValue}" (isOperatore: ${isOperatore}), ATTIVO: "${tesserato.attivo}"`);
        }
        
        // Determina se ATTIVO è selezionato
        // I valori arrivano come stringhe "true" o "false" da SharePoint
        const attivoValue = (tesserato.attivo || '').toString().trim().toUpperCase();
        const isAttivo = attivoValue !== '' && 
            (attivoValue === 'TRUE' || attivoValue === 'SI' || attivoValue === 'SÌ' || 
             attivoValue === 'S' || attivoValue === '1' || attivoValue === 'YES' || 
             attivoValue === 'Y' || attivoValue === 'ATTIVO') &&
            attivoValue !== 'FALSE' && attivoValue !== 'NO' && attivoValue !== '0';
        
        // Prima riga: IDSOCIO, NOMINATIVO, COD. FISC., TIPOLOGIASOCIO, OPERATORE, ATTIVO, DISPONIBILITA, TELEFONO, NUMEROTESSERA, SCADENZATESSERA
        const formSection1 = document.createElement('div');
        formSection1.className = 'socio-form-section';
        const formRow1 = document.createElement('div');
        formRow1.className = 'socio-form-row';
        
        formRow1.innerHTML = `
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
            <div class="socio-form-group socio-form-group-scadenzatessera">
                <label>SCADENZA TESSERA</label>
                <input type="text" value="${escapeHtml(tesserato.scadenzatessera || '')}" readonly>
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
                <textarea readonly>${escapeHtml(tesserato.notaaggiuntiva || '')}</textarea>
            </div>
            <div class="socio-form-actions">
                <button class="btn btn-anagrafica" data-socio-id="${tesserato.id || ''}" data-idsocio="${escapeHtml(tesserato.idsocio || '')}">ANAGRAFICA</button>
                <button class="btn btn-servizi" data-socio-id="${tesserato.id || ''}" data-idsocio="${escapeHtml(tesserato.idsocio || '')}">SERVIZI</button>
            </div>
        `;
        
        formSection2.appendChild(formRow2);
        
        // Aggiungi tutte le sezioni
        formSections.appendChild(formSection1);
        formSections.appendChild(formSection2);
        
        socioBlock.appendChild(formSections);
        containerBody.appendChild(socioBlock);
    });
    
    console.log(`✓ Aggiunti ${tesserati.length} blocchi socio`);
}

// Funzione helper per escape HTML (evita XSS)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Funzione per aggiornare il conteggio visualizzato
function updateSociCount(count) {
    const countElement = document.getElementById('soci-count');
    if (countElement) {
        countElement.textContent = `(${count})`;
    }
}

// Funzione per filtrare i tesserati per nominativo
function filterTesseratiByNominativo(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        // Se il campo è vuoto, mostra tutti
        return allTesserati;
    }
    
    const searchLower = searchTerm.trim().toLowerCase();
    
    return allTesserati.filter(tesserato => {
        const nominativo = (tesserato.nominativo || '').toLowerCase();
        return nominativo.includes(searchLower);
    });
}

// Funzione per gestire la ricerca in tempo reale
function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const containerBody = document.getElementById('soci-container-body');
    
    if (!searchInput || !containerBody) {
        return;
    }
    
    const searchTerm = searchInput.value;
    const filteredTesserati = filterTesseratiByNominativo(searchTerm);
    
    console.log(`Ricerca: "${searchTerm}" - Trovati ${filteredTesserati.length} risultati su ${allTesserati.length} totali`);
    
    // Aggiorna il conteggio nel titolo
    updateSociCount(filteredTesserati.length);
    
    // Ripopola la lista con i risultati filtrati
    populateListaSoci(filteredTesserati);
    
    // Mostra messaggio se non ci sono risultati
    if (filteredTesserati.length === 0 && searchTerm.trim() !== '') {
        containerBody.innerHTML = '<div class="soci-lista-empty">Nessun socio trovato per: "' + escapeHtml(searchTerm) + '"</div>';
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
        updateSociCount(allTesserati.length);
        
        // Ripristina tutti i tesserati
        console.log('Ricerca cancellata - Ripristino di tutti i tesserati');
        populateListaSoci(allTesserati);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOSOCI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();
    
    // Carica tutti i tesserati e popola la lista
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
                const socioId = e.target.getAttribute('data-socio-id');
                const idsocio = e.target.getAttribute('data-idsocio');
                console.log('Pulsante ANAGRAFICA cliccato per socio ID:', socioId, 'IDSOCIO:', idsocio);
                // TODO: Implementare apertura anagrafica
                alert(`Apertura anagrafica per socio ID: ${idsocio} (funzionalità in sviluppo)`);
            } else if (e.target.classList.contains('btn-servizi')) {
                e.stopPropagation();
                const socioId = e.target.getAttribute('data-socio-id');
                const idsocio = e.target.getAttribute('data-idsocio');
                console.log('Pulsante SERVIZI cliccato per socio ID:', socioId, 'IDSOCIO:', idsocio);
                // TODO: Implementare apertura servizi del socio
                alert(`Apertura servizi per socio ID: ${idsocio} (funzionalità in sviluppo)`);
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

