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
    setValue('mezzo-usato', costruisciStringaMezzo(servizio));
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
        mezzo: '3',
        tempo: '0',
        km: '15',
        tipo_pagamento: 'CONTANTI',
        data_bonifico: '',
        stato_servizio: 'ESEGUITO',
        note_fine_servizio: ''
    };
    populateForm(servizioDemo);
}

// Funzione per normalizzare un numero (rimuove .0 finale se presente)
// Gestisce sia stringhe che numeri
function normalizzaNumero(numStrOrNum) {
    if (numStrOrNum === null || numStrOrNum === undefined) return '';
    
    // Se è un numero, convertilo in stringa
    if (typeof numStrOrNum === 'number') {
        numStrOrNum = numStrOrNum.toString();
    }
    
    if (typeof numStrOrNum !== 'string') return '';
    
    const trimmed = numStrOrNum.trim();
    if (!trimmed) return '';
    
    // Rimuovi .0 finale se presente (es: "2.0" -> "2")
    if (trimmed.endsWith('.0')) {
        return trimmed.slice(0, -2);
    }
    
    // Se è un numero decimale senza parte frazionaria (es: "2.00"), converti in intero
    if (trimmed.includes('.')) {
        const num = parseFloat(trimmed);
        if (!isNaN(num) && num % 1 === 0) {
            return num.toString();
        }
    }
    
    return trimmed;
}

// Funzione per costruire la stringa del mezzo
function costruisciStringaMezzo(servizio) {
    // Se il servizio ha il campo "mezzo" (NR_AUTOMEZZO), cerca nell'elenco automezzi
    const nrAutomezzo = servizio.mezzo || '';
    
    if (!nrAutomezzo || (typeof nrAutomezzo === 'string' && nrAutomezzo.trim() === '')) {
        // Se non c'è il campo mezzo, usa direttamente mezzo_usato
        return servizio.mezzo_usato || '';
    }
    
    // Normalizza il numero del servizio (es: "2.0" -> "2")
    const nrAutomezzoNormalizzato = normalizzaNumero(nrAutomezzo);
    
    // Verifica se gli automezzi sono stati caricati
    if (!allAutomezzi || allAutomezzi.length === 0) {
        console.warn(`⚠️ Lista automezzi vuota o non ancora caricata per NR_AUTOMEZZO: "${nrAutomezzo}"`);
        return servizio.mezzo_usato || '';
    }
    
    // Cerca l'automezzo corrispondente (confronta anche con valori normalizzati)
    const automezzo = allAutomezzi.find(a => {
        if (!a || !a.nr_automezzo) return false;
        const nrAutomezzoLista = normalizzaNumero(a.nr_automezzo);
        return nrAutomezzoLista === nrAutomezzoNormalizzato;
    });
    
    if (automezzo) {
        // Costruisci la stringa nel formato: MARCA & MODELLO & (NR_AUTOMEZZO)
        const marca = (automezzo.marca || '').trim();
        const modello = (automezzo.modello || '').trim();
        // Usa il numero normalizzato per la visualizzazione
        const nr = normalizzaNumero(automezzo.nr_automezzo) || '';
        
        const parti = [];
        if (marca) parti.push(marca);
        if (modello) parti.push(modello);
        if (nr) parti.push(`(${nr})`);
        
        const risultato = parti.join(' - ');
        console.log(`✓ Mezzo trovato: "${nrAutomezzo}" (normalizzato: "${nrAutomezzoNormalizzato}") -> "${risultato}"`);
        return risultato;
    }
    
    // Se non trova l'automezzo, log per debug e usa il valore originale di mezzo_usato
    const automezziDisponibili = allAutomezzi.map(a => 
        `NR: "${normalizzaNumero(a.nr_automezzo)}" (MARCA: "${a.marca || ''}", MODELLO: "${a.modello || ''}")`
    ).join(', ');
    console.warn(`⚠️ Automezzo non trovato per NR_AUTOMEZZO: "${nrAutomezzo}" (normalizzato: "${nrAutomezzoNormalizzato}"). Automezzi disponibili (${allAutomezzi.length}):`, automezziDisponibili);
    return servizio.mezzo_usato || '';
}

// Carica tutti gli automezzi
async function caricaAutomezzi() {
    console.log('=== caricaAutomezzi chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio per automezzi');
        allAutomezzi = [
            { id: 1, nr_automezzo: "3", marca: "FIAT", modello: "PANDA" },
            { id: 2, nr_automezzo: "2", marca: "", modello: "" } // Esempio per test
        ];
        console.log(`✓ Caricati ${allAutomezzi.length} automezzi (demo):`, allAutomezzi);
        return;
    }
    
    try {
        console.log('Chiamata a invoke("get_all_automezzi") (Supabase)...');
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }
        const automezzi = await invoke('get_all_automezzi');
        console.log('Risposta ricevuta da get_all_automezzi:', automezzi);
        console.log('Tipo risposta:', typeof automezzi, 'È array:', Array.isArray(automezzi));
        
        allAutomezzi = automezzi || [];
        console.log(`✓ Caricati ${allAutomezzi.length} automezzi da Supabase (Automezzi_Supa)`);
        
        // Log dettagliato per debug
        if (allAutomezzi.length > 0) {
            console.log('Prime 10 automezzi caricate:');
            allAutomezzi.slice(0, 10).forEach((a, idx) => {
                console.log(`  [${idx + 1}] ID: ${a.id}, NR_AUTOMEZZO: "${a.nr_automezzo}" (tipo: ${typeof a.nr_automezzo}), MARCA: "${a.marca}", MODELLO: "${a.modello}"`);
            });
        } else {
            console.warn('⚠️ ATTENZIONE: Nessun automezzo caricato! Verifica supabase.tables.automezzi e la anon_key in config.json.');
        }
    } catch (error) {
        console.error('✗ Errore nel caricamento automezzi:', error);
        console.error('Dettagli errore:', error.message, error.stack);
        allAutomezzi = [];
    }
    
    console.log('=== Fine caricaAutomezzi ===');
}

// Cache globale per i servizi
let serviziCache = [];
let serviziOriginali = []; // Cache per i servizi originali (prima del filtro)
const PAGE_SIZE = 50;
let currentPage = 1;
let filtroAnnoModo = 'corrente'; // corrente | precedente | tutti
const serviziAnnoCache = {
    corrente: null,
    precedente: null,
    tutti: null
};
let applicaFiltroArchiviaIniziale = true;
let filtroTrasportatoAttivo = false; // Stato del filtro TRASPORTATO
let valoreFiltroTrasportato = null; // Valore del filtro TRASPORTATO attualmente attivo
let filtroOperatoreAttivo = false; // Stato del filtro OPERATORE
let valoreFiltroOperatore = null; // Valore del filtro OPERATORE attualmente attivo
let filtroStatoAttivo = false; // Stato del filtro STATO DEL SERVIZIO
let valoreFiltroStato = null; // Valore del filtro STATO DEL SERVIZIO attualmente attivo ('DA ESEGUIRE', 'ESEGUITO', 'ANNULLATO')
let filtroRichiedenteAttivo = false; // Stato del filtro RICHIEDENTE
let valoreFiltroRichiedente = null; // Valore del filtro RICHIEDENTE attualmente attivo ('SOCIO', 'COMUNE', 'ALTRI')

// Filtri avanzati ricerca
let filtriRicerca = {
    idservizio: null,
    idsocio: null,
    nominativo: null,
    dataDa: null,
    dataA: null,
    statoIncasso: null,
    tipoPagamento: null,
    tipoServizio: null,
    carrozzina: null,
    richiedente: null,
    operatore: null
};

// Cache per tesserati e operatori
let allTesserati = [];
let allOperatori = [];

// Cache per automezzi
let allAutomezzi = [];
let servizioInModifica = null;

function getAnnoCorrente() {
    return new Date().getFullYear();
}

function getAnnoDaDataPrelievo(dataPrelievo) {
    if (!dataPrelievo || typeof dataPrelievo !== 'string') return null;
    const trimmed = dataPrelievo.trim();
    const slashParts = trimmed.split('/');
    if (slashParts.length === 3) {
        const year = parseInt(slashParts[2], 10);
        return Number.isNaN(year) ? null : year;
    }
    const isoParts = trimmed.split('-');
    if (isoParts.length === 3) {
        const year = parseInt(isoParts[0], 10);
        return Number.isNaN(year) ? null : year;
    }
    return null;
}

function getAnnoPrecedente() {
    return getAnnoCorrente() - 1;
}

function normalizeFieldValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).trim();
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = normalizeFieldValue(value).toUpperCase();
    if (s === '' || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === 'S' || s === '1' ||
           s === 'YES' || s === 'Y' || s === 'ATTIVO';
}

function isServizioArchiviato(servizio) {
    return isTruthyFlag(servizio.archivia);
}

function getServiziListaBaseForModo(modo) {
    const raw = serviziAnnoCache[modo] || [];
    if (applicaFiltroArchiviaIniziale && modo === 'corrente') {
        return raw.filter(s => !isServizioArchiviato(s));
    }
    return [...raw];
}

async function fetchServiziFromBackend(modo) {
    if (!isTauri() || !invoke) {
        return serviziOriginali.length ? [...serviziOriginali] : [];
    }

    if (modo === 'tutti') {
        return await invoke('get_all_servizi_completi', { anno: null, tuttiAnni: true });
    }
    if (modo === 'precedente') {
        return await invoke('get_all_servizi_completi', {
            anno: getAnnoPrecedente(),
            tuttiAnni: false
        });
    }
    return await invoke('get_all_servizi_completi', {
        anno: getAnnoCorrente(),
        tuttiAnni: false
    });
}

async function getServiziForModo(modo) {
    if (serviziAnnoCache[modo]) {
        return [...serviziAnnoCache[modo]];
    }
    const servizi = await fetchServiziFromBackend(modo);
    serviziAnnoCache[modo] = Array.isArray(servizi) ? servizi : [];
    return [...serviziAnnoCache[modo]];
}

function updateAnnoHeaderUI() {
    const titleEl = document.getElementById('servizi-title-text');
    const btnCorrente = document.getElementById('btn-anno-corrente');
    const btnPrec = document.getElementById('btn-anno-precedente');
    const btnTutti = document.getElementById('btn-tutti-anni');

    let titleText = 'ELENCO SERVIZI ANNO CORRENTE';
    if (filtroAnnoModo === 'precedente') {
        titleText = `ELENCO SERVIZI ANNO ${getAnnoPrecedente()}`;
    } else if (filtroAnnoModo === 'tutti') {
        titleText = 'ELENCO SERVIZI TUTTI GLI ANNI';
    }

    if (titleEl) {
        titleEl.textContent = titleText;
    }
    if (btnCorrente) {
        btnCorrente.classList.toggle('active', filtroAnnoModo === 'corrente');
    }
    if (btnPrec) {
        btnPrec.classList.toggle('active', filtroAnnoModo === 'precedente');
    }
    if (btnTutti) {
        btnTutti.classList.toggle('active', filtroAnnoModo === 'tutti');
    }
}

async function switchAnnoModo(modo) {
    if (modo === filtroAnnoModo) {
        return;
    }

    applicaFiltroArchiviaIniziale = false;
    filtroAnnoModo = modo;
    updateAnnoHeaderUI();

    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.innerHTML = '<div class="servizi-lista-loading">Caricamento servizi...</div>';
    }

    try {
        await getServiziForModo(filtroAnnoModo);
        serviziOriginali = getServiziListaBaseForModo(filtroAnnoModo);
        applyAllFilters();
        if (document.getElementById('ricerca-tipo-pagamento')) {
            popolaDropdownDaServizi();
        }
    } catch (error) {
        console.error('Errore cambio anno servizi:', error);
        if (containerBody) {
            containerBody.innerHTML = `<div class="servizi-lista-empty">Errore: ${error.message || error}</div>`;
        }
        updatePaginationBar(0, 1, 1);
    }
}

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
            data_prelievo: `02/09/${getAnnoCorrente()}`,
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
        mezzo: '3',
            tempo: '0',
            km: '15',
            tipo_pagamento: 'CONTANTI',
            data_bonifico: '',
            stato_servizio: 'ESEGUITO',
            note_fine_servizio: '',
            archivia: 'false'
        };
        serviziAnnoCache.corrente = [servizioDemo];
        applicaFiltroArchiviaIniziale = true;
        serviziOriginali = getServiziListaBaseForModo('corrente');
        serviziCache = [...serviziOriginali];
        filtroAnnoModo = 'corrente';
        updateAnnoHeaderUI();
        populateListaServizi([...serviziOriginali]);
        populateForm(servizioDemo);
        return;
    }
    
    try {
        applicaFiltroArchiviaIniziale = true;
        filtroAnnoModo = 'corrente';
        updateAnnoHeaderUI();
        console.log(`Caricamento servizi anno ${getAnnoCorrente()} (non archiviati)...`);
        await getServiziForModo('corrente');
        serviziOriginali = getServiziListaBaseForModo('corrente');
        console.log(`Servizi anno corrente non archiviati: ${serviziOriginali.length} di ${serviziAnnoCache.corrente?.length || 0}`);
        
        if (serviziOriginali.length === 0) {
            console.warn('Nessun servizio trovato per l\'anno corrente (non archiviati)');
            containerBody.innerHTML = '<div class="servizi-lista-empty">Nessun servizio trovato per l\'anno corrente</div>';
            serviziCache = [];
            updateServiziCount();
            updatePaginationBar(0, 1, 1);
            return;
        }
        
        applyAllFilters();
        
        // Popola dropdown dopo il caricamento servizi
        if (document.getElementById('ricerca-stato-incasso')) {
            popolaDropdownDaServizi();
        }
    } catch (error) {
        console.error('Errore nel caricamento servizi:', error);
        console.error('Stack trace:', error.stack);
        const errorMsg = error.message || 'Errore sconosciuto';
        containerBody.innerHTML = `<div class="servizi-lista-empty">Errore: ${errorMsg}</div>`;
    }
}

// Crea il blocco HTML di un singolo servizio
function createServizioBlock(servizio) {
    const servizioBlock = document.createElement('div');
    servizioBlock.className = 'servizio-block';
    servizioBlock.dataset.servizioId = servizio.id || '';

    const formSections = document.createElement('div');
    formSections.className = 'form-sections';

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

    const formSection2 = document.createElement('div');
    formSection2.className = 'form-section';
    const formRow2 = document.createElement('div');
    formRow2.className = 'form-row';

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

    const formSection3 = document.createElement('div');
    formSection3.className = 'form-section';
    const formRow3 = document.createElement('div');
    formRow3.className = 'form-row';

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
            <input type="text" value="${costruisciStringaMezzo(servizio)}" readonly>
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

    formSections.appendChild(formSection1);
    formSections.appendChild(formSection2);
    formSections.appendChild(formSection3);
    formSections.appendChild(formSection4);
    servizioBlock.appendChild(formSections);

    return servizioBlock;
}

function getTotalPages(totalItems) {
    return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function updatePaginationBar(totalItems, page, totalPages) {
    const bar = document.getElementById('servizi-pagination-bar');
    if (!bar) return;

    if (totalItems === 0) {
        bar.innerHTML = '';
        return;
    }

    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);

    bar.innerHTML = `
        <button type="button" class="btn-pagination" id="btn-page-prev" ${page <= 1 ? 'disabled' : ''}>← Precedente</button>
        <span class="servizi-pagination-info">Pagina ${page} di ${totalPages} · servizi ${start}-${end} di ${totalItems}</span>
        <button type="button" class="btn-pagination" id="btn-page-next" ${page >= totalPages ? 'disabled' : ''}>Successiva →</button>
    `;

    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (btnPrev) btnPrev.addEventListener('click', () => goToPage(page - 1));
    if (btnNext) btnNext.addEventListener('click', () => goToPage(page + 1));
}

function goToPage(page) {
    const totalPages = getTotalPages(serviziCache.length);
    const nextPage = Math.min(Math.max(1, page), totalPages);
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    renderServiziView(false);
    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.scrollTop = 0;
    }
}

function renderServiziView(resetPage = false) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) return;

    if (resetPage) {
        currentPage = 1;
    }

    const totalItems = serviziCache.length;
    const totalPages = getTotalPages(totalItems);

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }

    updateServiziCount();

    if (totalItems === 0) {
        containerBody.innerHTML = '<div class="servizi-lista-empty">Nessun servizio trovato</div>';
        updatePaginationBar(0, 1, 1);
        return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = serviziCache.slice(start, start + PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const servizio of pageItems) {
        fragment.appendChild(createServizioBlock(servizio));
    }
    containerBody.innerHTML = '';
    containerBody.appendChild(fragment);
    updatePaginationBar(totalItems, currentPage, totalPages);
}

// Aggiorna la lista servizi (con paginazione: max PAGE_SIZE per pagina)
function populateListaServizi(servizi) {
    serviziCache = servizi || [];
    renderServiziView(true);
}

// Funzione per aggiornare il conteggio dei servizi visualizzati
function updateServiziCount() {
    const countElement = document.getElementById('servizi-count');
    if (!countElement) return;
    
    // Usa serviziCache per il conteggio (contiene i servizi attualmente visualizzati)
    const count = serviziCache.length;
    const total = serviziOriginali.length;
    
    // Controlla se ci sono filtri ricerca attivi
    const hasRicercaFilters = Object.values(filtriRicerca).some(val => val !== null && val !== '');
    
    // Se ci sono filtri attivi, mostra anche il totale
    if (filtroTrasportatoAttivo || filtroOperatoreAttivo || filtroStatoAttivo || filtroRichiedenteAttivo || hasRicercaFilters) {
        countElement.textContent = `(${count} di ${total})`;
    } else {
        countElement.textContent = `(${count})`;
    }
}

// Funzione per aggiornare il messaggio di attenzione filtro
function updateFilterWarning() {
    const filterWarning = document.getElementById('filter-warning');
    if (!filterWarning) return;
    
    // Controlla se ci sono filtri ricerca attivi
    const hasRicercaFilters = Object.values(filtriRicerca).some(val => val !== null && val !== '');
    
    // Mostra il messaggio se almeno un filtro è attivo
    if (filtroTrasportatoAttivo || filtroOperatoreAttivo || filtroStatoAttivo || filtroRichiedenteAttivo || hasRicercaFilters) {
        filterWarning.style.display = 'inline';
    } else {
        filterWarning.style.display = 'none';
    }
}

// Funzione per aggiornare lo stato visivo dei pulsanti filtro stato
function updateFiltroStatoButtons() {
    const btnDaEseguire = document.getElementById('btn-da-eseguire');
    const btnEseguiti = document.getElementById('btn-eseguiti');
    const btnAnnullati = document.getElementById('btn-annullati');
    const btnTutti = document.getElementById('btn-tutti');
    
    // Rimuovi classe active da tutti i pulsanti
    [btnDaEseguire, btnEseguiti, btnAnnullati, btnTutti].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    
    // Aggiungi classe active al pulsante corrispondente al filtro attivo
    if (filtroStatoAttivo && valoreFiltroStato) {
        if (valoreFiltroStato === 'DA ESEGUIRE' && btnDaEseguire) {
            btnDaEseguire.classList.add('active');
        } else if (valoreFiltroStato === 'ESEGUITO' && btnEseguiti) {
            btnEseguiti.classList.add('active');
        } else if (valoreFiltroStato === 'ANNULLATO' && btnAnnullati) {
            btnAnnullati.classList.add('active');
        }
    }
}

// Funzione per aggiornare lo stato visivo dei pulsanti filtro richiedente
function updateFiltroRichiedenteButtons() {
    const btnSocio = document.getElementById('btn-socio');
    const btnComune = document.getElementById('btn-comune');
    const btnAltri = document.getElementById('btn-altri');
    
    // Rimuovi classe active da tutti i pulsanti
    [btnSocio, btnComune, btnAltri].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    
    // Aggiungi classe active al pulsante corrispondente al filtro attivo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente) {
        if (valoreFiltroRichiedente === 'SOCIO' && btnSocio) {
            btnSocio.classList.add('active');
        } else if (valoreFiltroRichiedente === 'COMUNE' && btnComune) {
            btnComune.classList.add('active');
        } else if (valoreFiltroRichiedente === 'ALTRI' && btnAltri) {
            btnAltri.classList.add('active');
        }
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
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per TRASPORTATO: "${trasportatoValue}"`);
        filtroTrasportatoAttivo = true;
        valoreFiltroTrasportato = trasportatoValue.trim();
        
        // Applica tutti i filtri
        applyAllFilters();
        
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
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per OPERATORE: "${operatoreValue}"`);
        filtroOperatoreAttivo = true;
        valoreFiltroOperatore = operatoreValue.trim();
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    }
}

// Funzione per filtrare i servizi per STATO DEL SERVIZIO o rimuovere il filtro
function filtraPerStato(statoValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con lo stesso valore, rimuovilo
    if (filtroStatoAttivo && valoreFiltroStato === statoValue) {
        console.log('Rimozione filtro STATO - mostro tutti i servizi');
        filtroStatoAttivo = false;
        valoreFiltroStato = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroStatoButtons();
    } else {
        // Applica il filtro
        console.log(`Filtro per STATO DEL SERVIZIO: "${statoValue}"`);
        filtroStatoAttivo = true;
        valoreFiltroStato = statoValue;
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroStatoButtons();
    }
}

// Funzione per filtrare i servizi per RICHIEDENTE o rimuovere il filtro
function filtraPerRichiedente(richiedenteValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con lo stesso valore, rimuovilo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente === richiedenteValue) {
        console.log('Rimozione filtro RICHIEDENTE - mostro tutti i servizi');
        filtroRichiedenteAttivo = false;
        valoreFiltroRichiedente = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroRichiedenteButtons();
    } else {
        // Applica il filtro
        console.log(`Filtro per RICHIEDENTE: "${richiedenteValue}"`);
        filtroRichiedenteAttivo = true;
        valoreFiltroRichiedente = richiedenteValue;
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroRichiedenteButtons();
    }
}

// Funzione per rimuovere tutti i filtri e mostrare tutti i servizi
function rimuoviTuttiFiltri() {
    console.log('Rimozione di tutti i filtri - mostro tutti i servizi');
    
    // Rimuovi tutti i filtri
    filtroTrasportatoAttivo = false;
    valoreFiltroTrasportato = null;
    filtroOperatoreAttivo = false;
    valoreFiltroOperatore = null;
    filtroStatoAttivo = false;
    valoreFiltroStato = null;
    filtroRichiedenteAttivo = false;
    valoreFiltroRichiedente = null;
    
    // Rimuovi filtri ricerca
    filtriRicerca = {
        idservizio: null,
        idsocio: null,
        nominativo: null,
        dataDa: null,
        dataA: null,
        statoIncasso: null,
        tipoPagamento: null,
        tipoServizio: null,
        carrozzina: null,
        richiedente: null,
        operatore: null
    };
    
    // Reset form modale
    resetFormRicerca();
    
    // Ripristina servizi del periodo anno selezionato (senza altri filtri)
    populateListaServizi([...serviziOriginali]);
    
    // Aggiorna lo stato visivo di tutti i pulsanti
    updateFilterWarning();
    updateFiltroStatoButtons();
    updateFiltroRichiedenteButtons();
    updateServiziCount();
    
    console.log('✓ Tutti i filtri rimossi');
}

// Funzione helper per applicare tutti i filtri attivi
function applyAllFilters() {
    let serviziFiltrati = [...serviziOriginali];
    
    // Applica filtro TRASPORTATO se attivo
    if (filtroTrasportatoAttivo && valoreFiltroTrasportato) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const trasportato = servizio.socio_trasportato || '';
            return trasportato.trim() === valoreFiltroTrasportato.trim();
        });
    }
    
    // Applica filtro OPERATORE se attivo
    if (filtroOperatoreAttivo && valoreFiltroOperatore) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const operatore = servizio.operatore || '';
            return operatore.trim() === valoreFiltroOperatore.trim();
        });
    }
    
    // Applica filtro STATO DEL SERVIZIO se attivo
    if (filtroStatoAttivo && valoreFiltroStato) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const stato = servizio.stato_servizio || '';
            return stato.trim().toUpperCase() === valoreFiltroStato.trim().toUpperCase();
        });
    }
    
    // Applica filtro RICHIEDENTE se attivo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const richiedente = (servizio.richiedente || '').trim().toUpperCase();
            
            if (valoreFiltroRichiedente === 'SOCIO') {
                return richiedente === 'SOCIO';
            } else if (valoreFiltroRichiedente === 'COMUNE') {
                return richiedente === 'COMUNE';
            } else if (valoreFiltroRichiedente === 'ALTRI') {
                // ALTRI = tutto ciò che non è SOCIO né COMUNE
                return richiedente !== 'SOCIO' && richiedente !== 'COMUNE' && richiedente !== '';
            }
            
            return false;
        });
    }
    
    // Applica filtri ricerca avanzata
    if (filtriRicerca.idservizio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const id = String(servizio.id || '').trim();
            return id === filtriRicerca.idservizio.trim();
        });
    }
    
    if (filtriRicerca.idsocio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const idsocio = (servizio.idsocio || '').trim();
            return idsocio === filtriRicerca.idsocio.trim();
        });
    }
    
    if (filtriRicerca.nominativo) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const nominativo = (servizio.socio_trasportato || '').trim().toUpperCase();
            return nominativo.includes(filtriRicerca.nominativo.trim().toUpperCase());
        });
    }
    
    if (filtriRicerca.dataDa) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const dataPrelievo = servizio.data_prelievo || '';
            if (!dataPrelievo) return false;
            // Converti data da formato DD/MM/YYYY a Date per confronto
            const parts = dataPrelievo.split('/');
            if (parts.length === 3) {
                const servizioDate = new Date(parts[2], parts[1] - 1, parts[0]);
                const dataDa = new Date(filtriRicerca.dataDa);
                return servizioDate >= dataDa;
            }
            return false;
        });
    }
    
    if (filtriRicerca.dataA) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const dataPrelievo = servizio.data_prelievo || '';
            if (!dataPrelievo) return false;
            const parts = dataPrelievo.split('/');
            if (parts.length === 3) {
                const servizioDate = new Date(parts[2], parts[1] - 1, parts[0]);
                const dataA = new Date(filtriRicerca.dataA);
                dataA.setHours(23, 59, 59, 999); // Fine giornata
                return servizioDate <= dataA;
            }
            return false;
        });
    }
    
    if (filtriRicerca.statoIncasso) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const stato = (servizio.stato_incasso || '').trim().toUpperCase();
            const filtroValore = filtriRicerca.statoIncasso.trim().toUpperCase();
            
            // Il campo stato_incasso viene costruito dal backend in base ai campi INCASSATO, GRATIS, etc.
            // Quindi possiamo filtrare direttamente sul valore di stato_incasso
            return stato === filtroValore;
        });
    }
    
    if (filtriRicerca.tipoPagamento) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const tipo = (servizio.tipo_pagamento || '').trim().toUpperCase();
            return tipo === filtriRicerca.tipoPagamento.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.tipoServizio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const tipo = (servizio.tipo_servizio || '').trim().toUpperCase();
            return tipo === filtriRicerca.tipoServizio.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.carrozzina) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const carr = (servizio.carrozzina || '').trim().toUpperCase();
            return carr === filtriRicerca.carrozzina.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.richiedente) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const richiedente = (servizio.richiedente || '').trim().toUpperCase();
            if (filtriRicerca.richiedente === 'ALTRI') {
                return richiedente !== 'SOCIO' && richiedente !== 'COMUNE' && richiedente !== '';
            }
            return richiedente === filtriRicerca.richiedente.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.operatore) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const operatore = (servizio.operatore || '').trim();
            return operatore === filtriRicerca.operatore.trim();
        });
    }
    
    console.log(`✓ Servizi filtrati: ${serviziFiltrati.length} di ${serviziOriginali.length}`);
    
    // Aggiorna la cache con i servizi filtrati
    serviziCache = serviziFiltrati;

    // Ripopola la lista con i servizi filtrati (pagina 1)
    populateListaServizi(serviziFiltrati);
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOSERVIZI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();
    
    // Carica gli automezzi prima di caricare i servizi
    await caricaAutomezzi();
    
    // Carica tutti i servizi e popola la lista
    await loadAllServizi();
    
    // Inizializza lo stato dei pulsanti filtro stato
    updateFiltroStatoButtons();
    updateFiltroRichiedenteButtons();
    
    // Event listener per i pulsanti filtro stato
    const btnDaEseguire = document.getElementById('btn-da-eseguire');
    const btnEseguiti = document.getElementById('btn-eseguiti');
    const btnAnnullati = document.getElementById('btn-annullati');
    const btnTutti = document.getElementById('btn-tutti');
    
    if (btnDaEseguire) {
        btnDaEseguire.addEventListener('click', () => filtraPerStato('DA ESEGUIRE'));
    }
    if (btnEseguiti) {
        btnEseguiti.addEventListener('click', () => filtraPerStato('ESEGUITO'));
    }
    if (btnAnnullati) {
        btnAnnullati.addEventListener('click', () => filtraPerStato('ANNULLATO'));
    }
    if (btnTutti) {
        btnTutti.addEventListener('click', () => rimuoviTuttiFiltri());
    }

    const btnAnnoCorrente = document.getElementById('btn-anno-corrente');
    const btnAnnoPrecedente = document.getElementById('btn-anno-precedente');
    const btnTuttiAnni = document.getElementById('btn-tutti-anni');
    if (btnAnnoCorrente) {
        btnAnnoCorrente.addEventListener('click', () => switchAnnoModo('corrente'));
    }
    if (btnAnnoPrecedente) {
        btnAnnoPrecedente.addEventListener('click', () => switchAnnoModo('precedente'));
    }
    if (btnTuttiAnni) {
        btnTuttiAnni.addEventListener('click', () => switchAnnoModo('tutti'));
    }
    
    // Event listener per i pulsanti filtro richiedente
    const btnSocio = document.getElementById('btn-socio');
    const btnComune = document.getElementById('btn-comune');
    const btnAltri = document.getElementById('btn-altri');
    
    if (btnSocio) {
        btnSocio.addEventListener('click', () => {
            console.log('Pulsante SOCIO cliccato');
            filtraPerRichiedente('SOCIO');
        });
    }
    if (btnComune) {
        btnComune.addEventListener('click', () => {
            console.log('Pulsante COMUNE cliccato');
            filtraPerRichiedente('COMUNE');
        });
    }
    if (btnAltri) {
        btnAltri.addEventListener('click', () => {
            console.log('Pulsante ALTRI cliccato');
            filtraPerRichiedente('ALTRI');
        });
    }
    
    // Pulsante RICERCA - Apri modale
    const btnRicerca = document.getElementById('btn-ricerca');
    if (btnRicerca) {
        btnRicerca.addEventListener('click', () => {
            apriModaleRicerca();
        });
    }
    
    // Carica tesserati e operatori per i dropdown
    await caricaDatiPerDropdown();
    
    // Setup modale modifica
    setupModaleModifica();
    
    // Setup modale ricerca
    setupModaleRicerca();
    
    // Event listener per i pulsanti FILTRA usando event delegation
    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-modifica')) {
                e.stopPropagation();
                const block = e.target.closest('.servizio-block');
                const servizioId = block?.dataset?.servizioId;
                if (servizioId) {
                    apriModalModifica(servizioId);
                }
                return;
            }

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

// ========== MODALE MODIFICA SERVIZIO ==========

function escapeHtmlModifica(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function trovaServizioById(id) {
    const sid = String(id);
    return serviziOriginali.find(s => String(s.id) === sid)
        || serviziCache.find(s => String(s.id) === sid);
}

function aggiornaServizioInCache(servizio) {
    const id = String(servizio.id);
    const replaceIn = (arr) => {
        if (!Array.isArray(arr)) return;
        const idx = arr.findIndex(s => String(s.id) === id);
        if (idx >= 0) arr[idx] = servizio;
    };
    replaceIn(serviziOriginali);
    replaceIn(serviziCache);
    Object.keys(serviziAnnoCache).forEach(key => replaceIn(serviziAnnoCache[key]));
}

function getTipiPagamentoUnici() {
    const tipi = new Set();
    serviziOriginali.forEach(s => {
        if (s.tipo_pagamento) tipi.add(s.tipo_pagamento.trim());
    });
    return Array.from(tipi).sort();
}

function creaSelectModifica(id, label, value, options, spanClass = '') {
    const opts = options.map(opt => {
        const val = typeof opt === 'object' ? opt.value : opt;
        const text = typeof opt === 'object' ? opt.label : opt;
        const selected = String(val) === String(value || '') ? ' selected' : '';
        return `<option value="${escapeHtmlModifica(val)}"${selected}>${escapeHtmlModifica(text)}</option>`;
    }).join('');
    return `<div class="modifica-form-group ${spanClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <select id="${id}">${opts}</select>
    </div>`;
}

function creaInputModifica(id, label, value, spanClass = '', readonly = false) {
    return `<div class="modifica-form-group ${spanClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <input type="text" id="${id}" value="${escapeHtmlModifica(value)}"${readonly ? ' readonly' : ''}>
    </div>`;
}

function creaTextareaModifica(id, label, value, spanClass = '') {
    return `<div class="modifica-form-group ${spanClass}">
        <label for="${id}">${escapeHtmlModifica(label)}</label>
        <textarea id="${id}">${escapeHtmlModifica(value)}</textarea>
    </div>`;
}

function costruisciFormModifica(servizio) {
    const tipiPagamento = getTipiPagamentoUnici();
    if (servizio.tipo_pagamento && !tipiPagamento.includes(servizio.tipo_pagamento.trim())) {
        tipiPagamento.push(servizio.tipo_pagamento.trim());
    }

    const operatoriOpts = [{ value: '', label: '' }].concat(
        (allOperatori || []).map(op => ({
            value: op.nominativo || '',
            label: op.nominativo || ''
        }))
    );
    if (servizio.operatore && !operatoriOpts.some(o => o.value === servizio.operatore)) {
        operatoriOpts.push({ value: servizio.operatore, label: servizio.operatore });
    }

    const mezziOpts = [{ value: '', label: '— Nessuno —' }].concat(
        (allAutomezzi || []).map(m => {
            const nr = normalizzaNumero(m.nr_automezzo);
            const label = [m.marca, m.modello].filter(Boolean).join(' - ') + (nr ? ` (${nr})` : '');
            return { value: nr, label: label || nr };
        })
    );
    const mezzoCorrente = normalizzaNumero(servizio.mezzo || '');
    if (mezzoCorrente && !mezziOpts.some(o => o.value === mezzoCorrente)) {
        mezziOpts.push({ value: mezzoCorrente, label: costruisciStringaMezzo(servizio) || mezzoCorrente });
    }

    const archiviaVal = String(servizio.archivia || '').toLowerCase();
    const archiviaSi = ['true', 'si', 'sì', '1', 'yes'].includes(archiviaVal);

    return `
        <div class="modifica-form-grid">
            ${creaInputModifica('mod-id', 'IDSERVIZIO', servizio.id, '', true)}
            ${creaInputModifica('mod-idsocio', 'IDSOCIO', servizio.idsocio)}
            ${creaInputModifica('mod-data-prelievo', 'DATA PRELIEVO', servizio.data_prelievo)}
            ${creaInputModifica('mod-ora-inizio', 'ORA PRELIEVO (O.S.C.)', servizio.ora_inizio)}
            ${creaInputModifica('mod-comune-prelievo', 'COMUNE PRELIEVO', servizio.comune_prelievo)}
            ${creaInputModifica('mod-luogo-prelievo', 'LUOGO PRELIEVO', servizio.luogo_prelievo, 'span-2')}
            ${creaInputModifica('mod-socio-trasportato', 'TRASPORTATO', servizio.socio_trasportato, 'span-2')}
            ${creaSelectModifica('mod-richiedente', 'RICHIEDENTE', servizio.richiedente, ['', 'SOCIO', 'COMUNE', 'ALTRI'])}
            ${creaSelectModifica('mod-tipo-servizio', 'TIPO SERVIZIO', servizio.tipo_servizio, ['', 'STANDARD', 'SOLLEVATORE'])}
            ${creaSelectModifica('mod-carrozzina', 'CARROZZINA', servizio.carrozzina, ['', 'AUSER', 'SOCIO'])}
            ${creaInputModifica('mod-motivazione', 'MOTIVAZIONE', servizio.motivazione, 'span-2')}
            ${creaInputModifica('mod-ora-arrivo', 'DATA DESTINAZIONE (O.A.D.)', servizio.ora_arrivo)}
            ${creaInputModifica('mod-comune-destinazione', 'COMUNE DESTINAZIONE', servizio.comune_destinazione)}
            ${creaInputModifica('mod-luogo-destinazione', 'LUOGO DESTINAZIONE', servizio.luogo_destinazione, 'span-2')}
            ${creaSelectModifica('mod-stato-incasso', 'STATO INCASSO', servizio.stato_incasso, ['DA INCASSARE', 'INCASSATO', 'GRATIS', 'ANNULLATO'])}
            ${creaSelectModifica('mod-tipo-pagamento', 'TIPO PAGAMENTO', servizio.tipo_pagamento, ['', ...tipiPagamento])}
            ${creaInputModifica('mod-pagamento', 'DONAZIONE / PAGAMENTO', servizio.pagamento)}
            ${creaSelectModifica('mod-operatore', 'OPERATORE', servizio.operatore, operatoriOpts, 'span-2')}
            ${creaInputModifica('mod-operatore-2', 'OPERATORE 2', servizio.operatore_2)}
            ${creaSelectModifica('mod-mezzo', 'MEZZO USATO', mezzoCorrente, mezziOpts, 'span-2')}
            ${creaInputModifica('mod-tempo', 'TEMPO', servizio.tempo)}
            ${creaInputModifica('mod-km', 'KM', servizio.km)}
            ${creaInputModifica('mod-data-bonifico', 'DATA BONIFICO', servizio.data_bonifico)}
            ${creaInputModifica('mod-data-ricevuta', 'DATA INCASSO / RICEVUTA', servizio.data_ricevuta)}
            ${creaSelectModifica('mod-stato-servizio', 'STATO SERVIZIO', servizio.stato_servizio, ['DA ESEGUIRE', 'ESEGUITO', 'ANNULLATO'])}
            ${creaSelectModifica('mod-archivia', 'ARCHIVIA', archiviaSi ? 'SI' : 'NO', ['NO', 'SI'])}
            ${creaTextareaModifica('mod-note-prelievo', 'NOTE PRELIEVO', servizio.note_prelievo, 'span-2')}
            ${creaTextareaModifica('mod-note-arrivo', 'NOTE ARRIVO', servizio.note_arrivo, 'span-2')}
            ${creaTextareaModifica('mod-note-fine-servizio', 'NOTE FINE SERVIZIO', servizio.note_fine_servizio, 'span-4')}
        </div>
    `;
}

function getValoreModifica(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function raccogliPayloadModifica() {
    return {
        id: parseInt(getValoreModifica('mod-id'), 10),
        data_prelievo: getValoreModifica('mod-data-prelievo'),
        idsocio: getValoreModifica('mod-idsocio'),
        socio_trasportato: getValoreModifica('mod-socio-trasportato'),
        ora_inizio: getValoreModifica('mod-ora-inizio'),
        comune_prelievo: getValoreModifica('mod-comune-prelievo'),
        luogo_prelievo: getValoreModifica('mod-luogo-prelievo'),
        tipo_servizio: getValoreModifica('mod-tipo-servizio'),
        carrozzina: getValoreModifica('mod-carrozzina'),
        richiedente: getValoreModifica('mod-richiedente'),
        motivazione: getValoreModifica('mod-motivazione'),
        ora_arrivo: getValoreModifica('mod-ora-arrivo'),
        comune_destinazione: getValoreModifica('mod-comune-destinazione'),
        luogo_destinazione: getValoreModifica('mod-luogo-destinazione'),
        pagamento: getValoreModifica('mod-pagamento'),
        stato_incasso: getValoreModifica('mod-stato-incasso'),
        operatore: getValoreModifica('mod-operatore'),
        operatore_2: getValoreModifica('mod-operatore-2'),
        mezzo: getValoreModifica('mod-mezzo'),
        tempo: getValoreModifica('mod-tempo'),
        km: getValoreModifica('mod-km'),
        tipo_pagamento: getValoreModifica('mod-tipo-pagamento'),
        data_bonifico: getValoreModifica('mod-data-bonifico'),
        data_ricevuta: getValoreModifica('mod-data-ricevuta'),
        stato_servizio: getValoreModifica('mod-stato-servizio'),
        note_prelievo: document.getElementById('mod-note-prelievo')?.value || '',
        note_arrivo: document.getElementById('mod-note-arrivo')?.value || '',
        note_fine_servizio: document.getElementById('mod-note-fine-servizio')?.value || '',
        archivia: getValoreModifica('mod-archivia') === 'SI' ? 'SI' : 'NO'
    };
}

async function apriModalModifica(servizioId) {
    const modal = document.getElementById('modal-modifica');
    const body = document.getElementById('modal-modifica-body');
    const title = document.getElementById('modal-modifica-title');
    if (!modal || !body) return;

    let servizio = trovaServizioById(servizioId);

    if (isTauri() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            servizio = await invoke('get_servizio_completo', { servizio_id: parseInt(servizioId, 10) });
        } catch (error) {
            console.warn('Caricamento servizio da server:', error);
            if (!servizio) {
                alert('Impossibile caricare il servizio: ' + (error.message || error));
                return;
            }
        }
    }

    if (!servizio) {
        alert('Servizio non trovato.');
        return;
    }

    servizioInModifica = servizio;
    if (title) {
        title.textContent = `MODIFICA SERVIZIO ${servizio.id || ''}`;
    }
    body.innerHTML = costruisciFormModifica(servizio);
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function chiudiModalModifica() {
    const modal = document.getElementById('modal-modifica');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    servizioInModifica = null;
}

async function salvaModificaServizio() {
    const payload = raccogliPayloadModifica();
    if (!payload.id || Number.isNaN(payload.id)) {
        alert('ID servizio non valido.');
        return;
    }

    const btnSalva = document.getElementById('btn-salva-modifica');
    if (btnSalva) btnSalva.disabled = true;

    try {
        if (isTauri() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('update_servizio_completo', { payload });
            const aggiornato = await invoke('get_servizio_completo', { servizio_id: payload.id });
            aggiornaServizioInCache(aggiornato);
            renderServiziView(false);
            chiudiModalModifica();
        } else {
            const demo = { ...servizioInModifica, ...payload, id: String(payload.id) };
            aggiornaServizioInCache(demo);
            renderServiziView(false);
            chiudiModalModifica();
        }
    } catch (error) {
        console.error('Errore salvataggio servizio:', error);
        alert('Errore nel salvataggio: ' + (error.message || error));
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

function setupModaleModifica() {
    document.getElementById('btn-annulla-modifica')?.addEventListener('click', chiudiModalModifica);
    document.getElementById('btn-close-modal-modifica')?.addEventListener('click', chiudiModalModifica);
    document.getElementById('btn-salva-modifica')?.addEventListener('click', salvaModificaServizio);

    const modal = document.getElementById('modal-modifica');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) chiudiModalModifica();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display === 'flex') {
            chiudiModalModifica();
        }
    });
}

// ========== FUNZIONI MODALE RICERCA ==========

// Carica dati per popolare i dropdown
async function caricaDatiPerDropdown() {
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio per dropdown');
        return;
    }
    
    try {
        // Carica tutti i tesserati per il dropdown nominativo
        const tesserati = await invoke('get_all_tesserati');
        allTesserati = tesserati || [];
        
        // Filtra solo gli operatori
        allOperatori = allTesserati.filter(t => {
            const op = (t.operatore || '').toString().trim().toUpperCase();
            return op === 'SI' || op === 'TRUE' || op === '1';
        });
        
        console.log(`✓ Caricati ${allTesserati.length} tesserati e ${allOperatori.length} operatori`);
        
        // Popola dropdown stato incasso e tipo pagamento dai servizi
        popolaDropdownDaServizi();
        
        // Popola dropdown operatori
        popolaDropdownOperatori();
        
        // Setup autocomplete nominativo
        setupAutocompleteNominativo();
    } catch (error) {
        console.error('Errore nel caricamento dati per dropdown:', error);
    }
}

// Popola dropdown tipo pagamento dai servizi esistenti
// (STATO INCASSO ha valori fissi nell'HTML)
function popolaDropdownDaServizi() {
    const tipiPagamento = new Set();
    
    serviziOriginali.forEach(servizio => {
        if (servizio.tipo_pagamento) {
            tipiPagamento.add(servizio.tipo_pagamento.trim());
        }
    });
    
    // Popola dropdown tipo pagamento
    const selectTipoPagamento = document.getElementById('ricerca-tipo-pagamento');
    if (selectTipoPagamento) {
        const currentValue = selectTipoPagamento.value;
        tipiPagamento.forEach(tipo => {
            const option = document.createElement('option');
            option.value = tipo;
            option.textContent = tipo;
            selectTipoPagamento.appendChild(option);
        });
        if (currentValue) selectTipoPagamento.value = currentValue;
    }
}

// Popola dropdown operatori
function popolaDropdownOperatori() {
    const selectOperatore = document.getElementById('ricerca-operatore');
    if (!selectOperatore) return;
    
    const currentValue = selectOperatore.value;
    selectOperatore.innerHTML = '<option value="">Tutti</option>';
    
    allOperatori.forEach(operatore => {
        const option = document.createElement('option');
        option.value = operatore.nominativo || '';
        option.textContent = operatore.nominativo || '';
        selectOperatore.appendChild(option);
    });
    
    if (currentValue) selectOperatore.value = currentValue;
}

// Setup autocomplete per nominativo
function setupAutocompleteNominativo() {
    const inputNominativo = document.getElementById('ricerca-nominativo');
    const suggestionsDiv = document.getElementById('ricerca-nominativo-suggestions');
    
    if (!inputNominativo || !suggestionsDiv) return;
    
    let selectedIndex = -1;
    let filteredSuggestions = [];
    
    inputNominativo.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim().toUpperCase();
        
        if (searchTerm.length === 0) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        filteredSuggestions = allTesserati.filter(t => {
            const nominativo = (t.nominativo || '').toUpperCase();
            return nominativo.includes(searchTerm);
        }).slice(0, 10); // Massimo 10 suggerimenti
        
        if (filteredSuggestions.length > 0) {
            suggestionsDiv.innerHTML = '';
            filteredSuggestions.forEach((tesserato, index) => {
                const div = document.createElement('div');
                div.className = 'autocomplete-suggestion';
                div.textContent = tesserato.nominativo || '';
                div.dataset.index = index;
                div.addEventListener('click', () => {
                    inputNominativo.value = tesserato.nominativo || '';
                    suggestionsDiv.style.display = 'none';
                });
                suggestionsDiv.appendChild(div);
            });
            suggestionsDiv.style.display = 'block';
            selectedIndex = -1;
        } else {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    inputNominativo.addEventListener('blur', () => {
        // Delay per permettere il click sul suggerimento
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 200);
    });
    
    inputNominativo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
            updateSelectedSuggestion();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            const tesserato = filteredSuggestions[selectedIndex];
            inputNominativo.value = tesserato.nominativo || '';
            suggestionsDiv.style.display = 'none';
        }
    });
    
    function updateSelectedSuggestion() {
        const suggestions = suggestionsDiv.querySelectorAll('.autocomplete-suggestion');
        suggestions.forEach((sug, idx) => {
            sug.classList.toggle('selected', idx === selectedIndex);
        });
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }
}

// Apri modale ricerca
function apriModaleRicerca() {
    const modal = document.getElementById('modal-ricerca');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Chiudi modale ricerca
function chiudiModaleRicerca() {
    const modal = document.getElementById('modal-ricerca');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Reset form ricerca
function resetFormRicerca() {
    document.getElementById('ricerca-idservizio').value = '';
    document.getElementById('ricerca-idsocio').value = '';
    document.getElementById('ricerca-nominativo').value = '';
    document.getElementById('ricerca-data-da').value = '';
    document.getElementById('ricerca-data-a').value = '';
    document.getElementById('ricerca-stato-incasso').value = '';
    document.getElementById('ricerca-tipo-pagamento').value = '';
    document.getElementById('ricerca-tipo-servizio').value = '';
    document.getElementById('ricerca-carrozzina').value = '';
    document.getElementById('ricerca-richiedente').value = '';
    document.getElementById('ricerca-operatore').value = '';
}

// Applica filtri ricerca
function applicaFiltriRicerca() {
    // Leggi valori dal form
    filtriRicerca = {
        idservizio: document.getElementById('ricerca-idservizio').value.trim() || null,
        idsocio: document.getElementById('ricerca-idsocio').value.trim() || null,
        nominativo: document.getElementById('ricerca-nominativo').value.trim() || null,
        dataDa: document.getElementById('ricerca-data-da').value || null,
        dataA: document.getElementById('ricerca-data-a').value || null,
        statoIncasso: document.getElementById('ricerca-stato-incasso').value || null,
        tipoPagamento: document.getElementById('ricerca-tipo-pagamento').value || null,
        tipoServizio: document.getElementById('ricerca-tipo-servizio').value || null,
        carrozzina: document.getElementById('ricerca-carrozzina').value || null,
        richiedente: document.getElementById('ricerca-richiedente').value || null,
        operatore: document.getElementById('ricerca-operatore').value || null
    };
    
    console.log('Applicazione filtri ricerca:', filtriRicerca);
    
    // Applica tutti i filtri (inclusi quelli ricerca)
    applyAllFilters();
    
    // Aggiorna warning e conteggio
    updateFilterWarning();
    updateServiziCount();
    
    // Chiudi modale
    chiudiModaleRicerca();
}

// Setup event listener modale
function setupModaleRicerca() {
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnAnnullaModal = document.getElementById('btn-annulla-modal');
    const btnRicercaModal = document.getElementById('btn-ricerca-modal');
    const modal = document.getElementById('modal-ricerca');
    
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            chiudiModaleRicerca();
        });
    }
    
    if (btnAnnullaModal) {
        btnAnnullaModal.addEventListener('click', () => {
            chiudiModaleRicerca();
        });
    }
    
    if (btnRicercaModal) {
        btnRicercaModal.addEventListener('click', () => {
            applicaFiltriRicerca();
        });
    }
    
    // Chiudi modale cliccando fuori
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                chiudiModaleRicerca();
            }
        });
    }
}

