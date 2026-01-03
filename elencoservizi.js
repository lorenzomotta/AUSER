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

// Carica i dati del servizio da SharePoint
async function loadServizioData(servizioId) {
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: caricamento dati di esempio');
        loadDemoData();
        return;
    }
    
    try {
        console.log('Caricamento servizio ID:', servizioId);
        const servizio = await invoke('get_servizio_completo', { servizio_id: parseInt(servizioId) });
        console.log('Servizio caricato:', servizio);
        populateForm(servizio);
    } catch (error) {
        console.error('Errore nel caricamento dati servizio:', error);
        // Fallback a dati di esempio in caso di errore
        loadDemoData();
    }
}

// Popola il form con i dati
function populateForm(servizio) {
    if (!servizio) {
        console.error('Servizio è null o undefined');
        return;
    }
    
    // Funzione helper per impostare il valore in modo sicuro
    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
        } else {
            console.warn(`Elemento con id "${id}" non trovato`);
        }
    };
    
    setValue('ids', servizio.id);
    setValue('data-prelievo', servizio.data_prelievo);
    setValue('idsocio', servizio.idsocio);
    setValue('socio-trasportato', servizio.socio_trasportato);
    setValue('ora-inizio', servizio.ora_inizio);
    setValue('comune-prelievo', servizio.comune_prelievo);
    setValue('luogo-prelievo', servizio.luogo_prelievo);
    setValue('tipo-servizio', servizio.tipo_servizio);
    setValue('carrozzina', servizio.carrozzina);
    setValue('richiedente', servizio.richiedente);
    setValue('motivazione', servizio.motivazione);
    setValue('ora-arrivo', servizio.ora_arrivo);
    setValue('comune-destinazione', servizio.comune_destinazione);
    setValue('luogo-destinazione', servizio.luogo_destinazione);
    setValue('pagamento', servizio.pagamento);
    setValue('stato-incasso', servizio.stato_incasso);
    setValue('operatore', servizio.operatore);
    setValue('mezzo-usato', servizio.mezzo_usato);
    setValue('tempo', servizio.tempo);
    setValue('km', servizio.km);
    setValue('tipo-pagamento', servizio.tipo_pagamento);
    setValue('data-bonifico', servizio.data_bonifico);
    setValue('stato-servizio', servizio.stato_servizio);
    setValue('note-fine-servizio', servizio.note_fine_servizio);
}

// Carica dati di esempio per demo
function loadDemoData() {
    const servizioDemo = {
        id: '159',
        data_prelievo: '02/09/2025',
        idsocio: '12345',
        socio_trasportato: 'ASTUTI GUIDO',
        ora_inizio: '08:00',
        comune_prelievo: 'ROMA',
        luogo_prelievo: 'VIA ROMA 123',
        tipo_servizio: 'STANDARD',
        carrozzina: '',
        richiedente: 'SOCIO',
        motivazione: 'Visita medica',
        ora_arrivo: '09:30',
        comune_destinazione: 'ROMA',
        luogo_destinazione: 'OSPEDALE SANTO SPIRITO',
        pagamento: '0,00 €',
        stato_incasso: 'DA INCASSARE',
        operatore: 'ANDREAZZA MARIA',
        operatore_2: '',
        mezzo_usato: 'FIAT PANDA (3)',
        tempo: '0',
        km: '15',
        tipo_pagamento: 'CONTANTI',
        data_bonifico: '',
        stato_servizio: 'ESEGUITO',
        note_fine_servizio: ''
    };
    populateForm(servizioDemo);
}

// Cache globale per i servizi
let serviziCache = [];
let serviziOriginali = []; // Cache per i servizi originali (prima del filtro)
let filtroTrasportatoAttivo = false; // Stato del filtro TRASPORTATO
let valoreFiltroTrasportato = null; // Valore del filtro TRASPORTATO attualmente attivo
let filtroOperatoreAttivo = false; // Stato del filtro OPERATORE
let valoreFiltroOperatore = null; // Valore del filtro OPERATORE attualmente attivo

// Carica tutti i servizi e popola la lista
async function loadAllServizi() {
    console.log('=== loadAllServizi chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        alert('Errore: Container servizi non trovato nel DOM');
        return;
    }
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio');
        const servizioDemo = {
            id: '159',
            data_prelievo: '02/09/2025',
            idsocio: '12345',
            socio_trasportato: 'ASTUTI GUIDO',
            ora_inizio: '08:00',
            comune_prelievo: 'ROMA',
            luogo_prelievo: 'VIA ROMA 123',
            tipo_servizio: 'STANDARD',
            carrozzina: '',
            richiedente: 'SOCIO',
            motivazione: 'Visita medica',
            ora_arrivo: '09:30',
            comune_destinazione: 'ROMA',
            luogo_destinazione: 'OSPEDALE SANTO SPIRITO',
            pagamento: '0,00 €',
            stato_incasso: 'DA INCASSARE',
            operatore: 'ANDREAZZA MARIA',
            operatore_2: '',
            mezzo_usato: 'FIAT PANDA (3)',
            tempo: '0',
            km: '15',
            tipo_pagamento: 'CONTANTI',
            data_bonifico: '',
            stato_servizio: 'ESEGUITO',
            note_fine_servizio: ''
        };
        serviziCache = [servizioDemo];
        serviziOriginali = [servizioDemo]; // Salva anche negli originali
        populateListaServizi([servizioDemo]);
        populateForm(servizioDemo);
        return;
    }
    
    try {
        console.log('Chiamata a get_all_servizi_completi...');
        const servizi = await invoke('get_all_servizi_completi');
        console.log('Risposta ricevuta:', servizi);
        console.log(`Tipo: ${typeof servizi}, È array: ${Array.isArray(servizi)}`);
        console.log(`Numero servizi: ${servizi ? servizi.length : 'null/undefined'}`);
        
        // Salva nella cache globale (sia serviziCache che serviziOriginali)
        serviziCache = servizi || [];
        serviziOriginali = servizi ? [...servizi] : []; // Copia per mantenere l'originale
        console.log(`✓ Servizi salvati in cache: ${serviziCache.length}`);
        
        if (!servizi || !Array.isArray(servizi) || servizi.length === 0) {
            console.warn('Nessun servizio trovato o array vuoto');
            containerBody.innerHTML = '<div class="servizi-lista-empty">Nessun servizio trovato</div>';
            return;
        }
        
        console.log(`Popolamento container con ${servizi.length} servizi`);
        populateListaServizi(servizi);
    } catch (error) {
        console.error('Errore nel caricamento servizi:', error);
        console.error('Stack trace:', error.stack);
        const errorMsg = error.message || 'Errore sconosciuto';
        containerBody.innerHTML = `<div class="servizi-lista-empty">Errore: ${errorMsg}</div>`;
    }
}

// Popola la lista dei servizi con form completi
function populateListaServizi(servizi) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Svuota il container
    containerBody.innerHTML = '';
    
    // Log per verificare i campi stato_servizio e data_bonifico
    if (servizi.length > 0) {
        console.log('=== DEBUG: Verifica campi stato_servizio e data_bonifico ===');
        servizi.slice(0, 3).forEach((servizio, idx) => {
            console.log(`Servizio ${idx + 1} (ID: ${servizio.id}):`);
            console.log(`  - stato_servizio: "${servizio.stato_servizio}" (tipo: ${typeof servizio.stato_servizio})`);
            console.log(`  - data_bonifico: "${servizio.data_bonifico}" (tipo: ${typeof servizio.data_bonifico})`);
            console.log(`  - Oggetto servizio completo:`, servizio);
        });
    }
    
    servizi.forEach((servizio, index) => {
        // Crea un blocco per ogni servizio (replica del form)
        const servizioBlock = document.createElement('div');
        servizioBlock.className = 'servizio-block';
        servizioBlock.dataset.servizioId = servizio.id || '';
        
        // Crea la struttura del form per questo servizio
        const formSections = document.createElement('div');
        formSections.className = 'form-sections';
        
        // Prima riga
        const formSection1 = document.createElement('div');
        formSection1.className = 'form-section';
        const formRow1 = document.createElement('div');
        formRow1.className = 'form-row';
        
        formRow1.innerHTML = `
            <div class="form-group form-group-small">
                <label>IDSERVIZIO</label>
                <input type="text" value="${servizio.id || ''}" readonly>
            </div>
            <div class="form-group form-group-small">
                <label>IDSOCIO</label>
                <input type="text" value="${servizio.idsocio || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>DATA PRELIEVO</label>
                <input type="text" value="${servizio.data_prelievo || ''}" readonly>
            </div>
            <div class="form-group form-group-ora">
                <label>O.S.C.</label>
                <input type="text" value="${servizio.ora_inizio || ''}" readonly>
            </div>
            <div class="form-group form-group-comune">
                <label>COMUNE DI PRELIEVO</label>
                <input type="text" value="${servizio.comune_prelievo || ''}" readonly>
            </div>
            <div class="form-group form-group-indirizzo">
                <label>LUOGO DI PRELIEVO</label>
                <input type="text" value="${servizio.luogo_prelievo || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>RICHIEDENTE</label>
                <input type="text" value="${servizio.richiedente || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>TIPO SERVIZIO</label>
                <input type="text" value="${servizio.tipo_servizio || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>CARROZZINA</label>
                <input type="text" value="${servizio.carrozzina || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>TIPO DI PAGAMENTO</label>
                <input type="text" value="${servizio.tipo_pagamento || ''}" readonly>
            </div>
        `;
        
        formSection1.appendChild(formRow1);
        
        // Seconda riga
        const formSection2 = document.createElement('div');
        formSection2.className = 'form-section';
        const formRow2 = document.createElement('div');
        formRow2.className = 'form-row';
        
        // Determina la label del pulsante FILTRA per TRASPORTATO
        const trasportatoValue = servizio.socio_trasportato || '';
        const isFiltroTrasportatoAttivoPerQuesto = filtroTrasportatoAttivo && valoreFiltroTrasportato === trasportatoValue.trim();
        const labelFiltraTrasportato = isFiltroTrasportatoAttivoPerQuesto ? 'TUTTI' : 'FILTRA';
        
        formRow2.innerHTML = `
            <div class="form-group form-group-name form-group-with-filtra">
                <label>TRASPORTATO</label>
                <div class="input-button-group">
                    <input type="text" value="${servizio.socio_trasportato || ''}" readonly>
                    <button class="btn btn-filtra" data-filtra-trasportato="${servizio.socio_trasportato || ''}">${labelFiltraTrasportato}</button>
                </div>
            </div>
            <div class="form-group form-group-ora">
                <label>O.A.D</label>
                <input type="text" value="${servizio.ora_arrivo || ''}" readonly>
            </div>
            <div class="form-group form-group-comune">
                <label>COMUNE DI DESTINAZIONE</label>
                <input type="text" value="${servizio.comune_destinazione || ''}" readonly>
            </div>
            <div class="form-group form-group-indirizzo">
                <label>LUOGO DI DESTINAZIONE</label>
                <input type="text" value="${servizio.luogo_destinazione || ''}" readonly>
            </div>
            <div class="form-group form-group-large form-group-motivazione">
                <label>MOTIVAZIONE DEL SERVIZIO</label>
                <input type="text" value="${servizio.motivazione || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>STATO INCASSO</label>
                <input type="text" value="${servizio.stato_incasso || ''}" readonly>
            </div>
        `;
        
        formSection2.appendChild(formRow2);
        
        // Terza riga
        const formSection3 = document.createElement('div');
        formSection3.className = 'form-section';
        const formRow3 = document.createElement('div');
        formRow3.className = 'form-row';
        
        // Determina la label del pulsante FILTRA per OPERATORE
        const operatoreValue = servizio.operatore || '';
        const isFiltroOperatoreAttivoPerQuesto = filtroOperatoreAttivo && valoreFiltroOperatore === operatoreValue.trim();
        const labelFiltraOperatore = isFiltroOperatoreAttivoPerQuesto ? 'TUTTI' : 'FILTRA';
        
        formRow3.innerHTML = `
            <div class="form-group form-group-name form-group-with-filtra">
                <label>OPERATORE</label>
                <div class="input-button-group operatore-name">
                    <input type="text" value="${servizio.operatore || ''}" readonly>
                    <button class="btn btn-filtra" data-filtra-operatore="${servizio.operatore || ''}">${labelFiltraOperatore}</button>
                </div>
            </div>
            <div class="form-group form-group-mezzo">
                <label>MEZZO USATO</label>
                <input type="text" value="${servizio.mezzo_usato || ''}" readonly>
            </div>
            <div class="form-group form-group-small">
                <label>TEMPO</label>
                <input type="text" value="${servizio.tempo || ''}" readonly>
            </div>
            <div class="form-group form-group-small">
                <label>KM</label>
                <input type="text" value="${servizio.km || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>DATA BONIFICO</label>
                <input type="text" value="${servizio.data_bonifico || ''}" readonly>
            </div>
            <div class="form-group form-group-small">
                <label>PAGAMENTO</label>
                <input type="text" value="${servizio.pagamento || ''}" readonly>
            </div>
            <div class="form-group form-group-medium">
                <label>STATO DEL SERVIZIO</label>
                <input type="text" value="${servizio.stato_servizio || ''}" readonly>
            </div>
            <div class="form-actions-inline">
                <button class="btn btn-stampa">STAMPA</button>
                <button class="btn btn-modifica">MODIFICA</button>
                <button class="btn btn-completa">COMPLETA</button>
            </div>
        `;
        
        formSection3.appendChild(formRow3);
        
        // Quarta riga - Note
        const formSection4 = document.createElement('div');
        formSection4.className = 'form-section';
        const formRow4 = document.createElement('div');
        formRow4.className = 'form-row';
        
        formRow4.innerHTML = `
            <div class="form-group form-group-note">
                <label>NOTE PRELIEVO</label>
                <textarea readonly>${servizio.note_prelievo || ''}</textarea>
            </div>
            <div class="form-group form-group-note">
                <label>NOTE ARRIVO</label>
                <textarea readonly>${servizio.note_arrivo || ''}</textarea>
            </div>
            <div class="form-group form-group-note">
                <label>NOTE FINE SERVIZIO</label>
                <textarea readonly>${servizio.note_fine_servizio || ''}</textarea>
            </div>
        `;
        
        formSection4.appendChild(formRow4);
        
        // Aggiungi tutte le sezioni
        formSections.appendChild(formSection1);
        formSections.appendChild(formSection2);
        formSections.appendChild(formSection3);
        formSections.appendChild(formSection4);
        
        servizioBlock.appendChild(formSections);
        containerBody.appendChild(servizioBlock);
    });
    
    console.log(`✓ Aggiunti ${servizi.length} blocchi servizio`);
}

// Funzione per aggiornare il messaggio di attenzione filtro
function updateFilterWarning() {
    const filterWarning = document.getElementById('filter-warning');
    if (!filterWarning) return;
    
    // Mostra il messaggio se almeno un filtro è attivo
    if (filtroTrasportatoAttivo || filtroOperatoreAttivo) {
        filterWarning.style.display = 'inline';
    } else {
        filterWarning.style.display = 'none';
    }
}

// Funzione per filtrare i servizi per TRASPORTATO o rimuovere il filtro
function filtraPerTrasportato(trasportatoValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con questo valore, rimuovilo
    if (filtroTrasportatoAttivo && valoreFiltroTrasportato === trasportatoValue.trim()) {
        console.log('Rimozione filtro TRASPORTATO - mostro tutti i servizi');
        filtroTrasportatoAttivo = false;
        valoreFiltroTrasportato = null;
        
        // Se c'è un filtro operatore attivo, mantienilo
        if (filtroOperatoreAttivo) {
            const serviziFiltrati = serviziOriginali.filter(servizio => {
                const operatore = servizio.operatore || '';
                return operatore.trim() === valoreFiltroOperatore.trim();
            });
            serviziCache = serviziFiltrati;
            populateListaServizi(serviziFiltrati);
        } else {
            // Ripristina tutti i servizi
            serviziCache = [...serviziOriginali];
            populateListaServizi(serviziOriginali);
        }
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per TRASPORTATO: "${trasportatoValue}"`);
        filtroTrasportatoAttivo = true;
        valoreFiltroTrasportato = trasportatoValue.trim();
        
        // Filtra i servizi originali
        let serviziFiltrati = serviziOriginali.filter(servizio => {
            const trasportato = servizio.socio_trasportato || '';
            return trasportato.trim() === trasportatoValue.trim();
        });
        
        // Se c'è anche un filtro operatore attivo, applica anche quello
        if (filtroOperatoreAttivo) {
            serviziFiltrati = serviziFiltrati.filter(servizio => {
                const operatore = servizio.operatore || '';
                return operatore.trim() === valoreFiltroOperatore.trim();
            });
        }
        
        console.log(`✓ Trovati ${serviziFiltrati.length} servizi con TRASPORTATO = "${trasportatoValue}"`);
        
        // Aggiorna la cache con i servizi filtrati
        serviziCache = serviziFiltrati;
        
        // Ripopola la lista con i servizi filtrati
        populateListaServizi(serviziFiltrati);
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    }
}

// Funzione per filtrare i servizi per OPERATORE o rimuovere il filtro
function filtraPerOperatore(operatoreValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con questo valore, rimuovilo
    if (filtroOperatoreAttivo && valoreFiltroOperatore === operatoreValue.trim()) {
        console.log('Rimozione filtro OPERATORE - mostro tutti i servizi');
        filtroOperatoreAttivo = false;
        valoreFiltroOperatore = null;
        
        // Se c'è un filtro trasportato attivo, mantienilo
        if (filtroTrasportatoAttivo) {
            const serviziFiltrati = serviziOriginali.filter(servizio => {
                const trasportato = servizio.socio_trasportato || '';
                return trasportato.trim() === valoreFiltroTrasportato.trim();
            });
            serviziCache = serviziFiltrati;
            populateListaServizi(serviziFiltrati);
        } else {
            // Ripristina tutti i servizi
            serviziCache = [...serviziOriginali];
            populateListaServizi(serviziOriginali);
        }
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per OPERATORE: "${operatoreValue}"`);
        filtroOperatoreAttivo = true;
        valoreFiltroOperatore = operatoreValue.trim();
        
        // Filtra i servizi originali
        let serviziFiltrati = serviziOriginali.filter(servizio => {
            const operatore = servizio.operatore || '';
            return operatore.trim() === operatoreValue.trim();
        });
        
        // Se c'è anche un filtro trasportato attivo, applica anche quello
        if (filtroTrasportatoAttivo) {
            serviziFiltrati = serviziFiltrati.filter(servizio => {
                const trasportato = servizio.socio_trasportato || '';
                return trasportato.trim() === valoreFiltroTrasportato.trim();
            });
        }
        
        console.log(`✓ Trovati ${serviziFiltrati.length} servizi con OPERATORE = "${operatoreValue}"`);
        
        // Aggiorna la cache con i servizi filtrati
        serviziCache = serviziFiltrati;
        
        // Ripopola la lista con i servizi filtrati
        populateListaServizi(serviziFiltrati);
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOSERVIZI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();
    
    // Carica tutti i servizi e popola la lista
    await loadAllServizi();
    
    // Event listener per i pulsanti FILTRA usando event delegation
    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-filtra')) {
                e.stopPropagation(); // Evita event bubbling
                
                // Controlla se è il filtro TRASPORTATO
                if (e.target.hasAttribute('data-filtra-trasportato')) {
                    const trasportatoValue = e.target.getAttribute('data-filtra-trasportato');
                    if (trasportatoValue !== null && trasportatoValue !== undefined) {
                        filtraPerTrasportato(trasportatoValue);
                    }
                }
                // Controlla se è il filtro OPERATORE
                else if (e.target.hasAttribute('data-filtra-operatore')) {
                    const operatoreValue = e.target.getAttribute('data-filtra-operatore');
                    if (operatoreValue !== null && operatoreValue !== undefined) {
                        filtraPerOperatore(operatoreValue);
                    }
                }
            }
        });
    }
    
    // Pulsante STAMPA
    const btnStampa = document.getElementById('btn-stampa');
    if (btnStampa) {
        btnStampa.addEventListener('click', async () => {
            console.log('STAMPA cliccato');
            if (isTauri() && invoke) {
                try {
                    const servizioId = document.getElementById('ids').value;
                    await invoke('stampa_servizio', { id: parseInt(servizioId) });
                    alert('Stampa avviata per servizio ' + servizioId);
                } catch (error) {
                    console.error('Errore nella stampa:', error);
                    alert('Errore nella stampa: ' + error.message);
                }
            } else {
                alert('Stampa avviata (modalità demo)');
            }
        });
    }
    
    // Pulsante MODIFICA
    const btnModifica = document.getElementById('btn-modifica');
    if (btnModifica) {
        btnModifica.addEventListener('click', async () => {
            console.log('MODIFICA cliccato');
            if (isTauri() && invoke) {
                try {
                    const servizioId = document.getElementById('ids').value;
                    await invoke('modifica_servizio', { id: parseInt(servizioId) });
                    // TODO: Aprire finestra/modale di modifica
                    alert('Modifica servizio ' + servizioId + ' (in sviluppo)');
                } catch (error) {
                    console.error('Errore nella modifica:', error);
                    alert('Errore nella modifica: ' + error.message);
                }
            } else {
                alert('Modifica servizio (modalità demo)');
            }
        });
    }
    
    // Pulsante COMPLETA
    const btnCompleta = document.getElementById('btn-completa');
    if (btnCompleta) {
        btnCompleta.addEventListener('click', async () => {
            console.log('COMPLETA cliccato');
            if (isTauri() && invoke) {
                try {
                    const servizioId = document.getElementById('ids').value;
                    await invoke('completa_servizio', { id: parseInt(servizioId) });
                    alert('Servizio ' + servizioId + ' completato');
                    // Ricarica i dati o torna alla home
                    window.location.href = 'index.html';
                } catch (error) {
                    console.error('Errore nel completamento:', error);
                    alert('Errore nel completamento: ' + error.message);
                }
            } else {
                alert('Servizio completato (modalità demo)');
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
                    
                    // Verifica che questa sia la finestra elenco-servizi e non la principale
                    if (currentWindow && currentWindow.label) {
                        const label = currentWindow.label;
                        console.log('Label finestra corrente:', label);
                        
                        // Chiudi solo se è la finestra elenco-servizi
                        if (label === 'elenco-servizi') {
                            await currentWindow.close();
                        } else {
                            // Se per qualche motivo non è elenco-servizi, naviga alla home
                            console.warn('Finestra non è elenco-servizi, navigazione a home invece di chiusura');
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

