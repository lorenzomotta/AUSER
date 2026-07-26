// Anagrafica Socio — logica maschera
let invoke, appWindow;

let currentIdsocio = '';
let tesseramentiList = [];
let telefoniList = [];
let emailList = [];
let editingTelefonoIndex = -1;
let isNewTelefono = false;
let editingEmailIndex = -1;
let isNewEmail = false;
let editingTesseramentoIndex = -1;
let isNewTesseramento = false;
let isAnagraficaEditMode = false;
let anagraficaEditSnapshot = null;
let allTipologieSocio = [];
let allComuniResidenza = [];
let isNuovoSocioMode = false;
let isRicercaMode = false;

const RICERCA_FILTRO_STORAGE_KEY = 'auser-ricerca-filtro-criteri';

const ANAGRAFICA_FLAG_IDS = [
    'field-operatore',
    'field-attivo',
    'field-archivia',
    'field-disp-autista',
    'field-disp-centralista'
];

async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        const windowModule = await import('@tauri-apps/api/window');
        invoke = tauriModule.invoke;
        appWindow = windowModule.appWindow;
        return true;
    } catch (error) {
        console.error('Errore caricamento API Tauri:', error);
        return false;
    }
}

function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

function getIdsocioFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('idsocio') || '').trim();
}

function isNuovoSocioFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('nuovo') === '1' || params.get('nuovo') === 'true';
}

function isRicercaFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const modo = (params.get('modo') || '').trim().toLowerCase();
    return modo === 'ricerca' || params.get('ricerca') === '1';
}

function createNuovoSocioTemplate(idsocio) {
    return {
        id: 0,
        idsocio: idsocio || '',
        nominativo: '',
        codicefiscale: '',
        sesso: '',
        nascita_comune: '',
        nascita_data: '',
        residenza_indirizzo: '',
        residenza_civico: '',
        residenza_cap: '',
        residenza_comune: '',
        residenza_provincia: '',
        telefono: '',
        tipologiasocio: 'NUOVO',
        operatore: false,
        attivo: true,
        archivia: false,
        disponibilita: '',
        notaaggiuntiva: ''
    };
}

async function closeAnagraficaWindow() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            const win = getCurrent();
            const label = win?.label || '';
            if (label.startsWith('anagrafica-')) {
                await win.close();
                return;
            }
        } catch (err) {
            console.warn('Chiusura finestra:', err);
        }
    }
    if (window.opener) {
        window.close();
    } else {
        window.history.back();
    }
}

function setSaveStatus(message, isError = false) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    if (message && !isError) {
        setTimeout(() => {
            if (el.textContent === message) el.textContent = '';
        }, 4000);
    }
}

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

function isScaduto(scadenzaStr) {
    const scadenza = parseItalianDate(scadenzaStr);
    if (!scadenza) return false;
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return scadenza < oggi;
}

function isoToItalian(iso) {
    if (!iso) return '';
    const parts = iso.split('T')[0].split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function italianToIso(italian) {
    if (!italian) return '';
    const parts = italian.trim().split('/');
    if (parts.length !== 3) return '';
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

function scadenzaFromAnno(anno) {
    if (!anno) return '';
    return `31/12/${anno}`;
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value || '').trim().toUpperCase();
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' || s === 'ATTIVO';
}

function parseDisponibilita(value) {
    if (!value) return [];
    return String(value).split(/[,;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function formatDisponibilita() {
    const values = [];
    if (document.getElementById('field-disp-autista')?.checked) values.push('AUTISTA');
    if (document.getElementById('field-disp-centralista')?.checked) values.push('CENTRALISTA');
    return values.join(',');
}

function setDisponibilitaCheckboxes(values) {
    const set = new Set(values.map(v => v.toUpperCase()));
    const autista = document.getElementById('field-disp-autista');
    const centralista = document.getElementById('field-disp-centralista');
    if (autista) autista.checked = set.has('AUTISTA');
    if (centralista) centralista.checked = set.has('CENTRALISTA');
    syncOperatoreDisponibilitaFlags();
}

/** Attivo, Autista e Centralista attivi solo se Operatore è spuntato (in modifica). */
function syncOperatoreDisponibilitaFlags() {
    const operatore = document.getElementById('field-operatore');
    const attivo = document.getElementById('field-attivo');
    const autista = document.getElementById('field-disp-autista');
    const centralista = document.getElementById('field-disp-centralista');
    if (!operatore || !attivo || !autista || !centralista) return;

    // In ricerca i flag sono indipendenti (ognuno è un criterio opzionale)
    if (isRicercaMode) {
        attivo.disabled = !isAnagraficaEditMode;
        autista.disabled = !isAnagraficaEditMode;
        centralista.disabled = !isAnagraficaEditMode;
        attivo.closest('.flag-item')?.classList.remove('flag-item-disabled');
        autista.closest('.flag-item')?.classList.remove('flag-item-disabled');
        centralista.closest('.flag-item')?.classList.remove('flag-item-disabled');
        return;
    }

    const isOperatore = operatore.checked;
    const flagsEnabled = isAnagraficaEditMode && isOperatore;

    if (!isOperatore) {
        attivo.checked = false;
        autista.checked = false;
        centralista.checked = false;
    }

    attivo.disabled = !flagsEnabled;
    autista.disabled = !flagsEnabled;
    centralista.disabled = !flagsEnabled;

    attivo.closest('.flag-item')?.classList.toggle('flag-item-disabled', !flagsEnabled);
    autista.closest('.flag-item')?.classList.toggle('flag-item-disabled', !flagsEnabled);
    centralista.closest('.flag-item')?.classList.toggle('flag-item-disabled', !flagsEnabled);
}

function normalizeSesso(value) {
    const s = String(value || '').trim().toUpperCase();
    if (s === 'M' || s === 'MASCHIO' || s === 'MALE') return 'M';
    if (s === 'F' || s === 'FEMMINA' || s === 'FEMALE') return 'F';
    return s.slice(0, 1) === 'M' || s.slice(0, 1) === 'F' ? s.slice(0, 1) : '';
}

const TIPOLOGIA_FIELD_ANAGRAFICA = {
    groupSelector: '.field-tipologia',
    inputId: 'field-tipologiasocio',
    selectAttr: 'data-tipologia-select'
};

const TIPOLOGIA_FIELD_TESSERAMENTO = {
    groupSelector: '.field-tess-tipologia',
    inputId: 'tess-tipologia',
    selectAttr: 'data-tess-tipologia-select'
};

function normalizeTipologiaValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function sortTipologieSocio(list) {
    return [...list].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

function tipologiaGiaPresente(value) {
    const t = normalizeTipologiaValue(value);
    if (!t) return false;
    return allTipologieSocio.some(
        (s) => s.localeCompare(t, 'it', { sensitivity: 'base' }) === 0
    );
}

function getTipologieSelectOptions(currentValue = '') {
    const set = new Set(allTipologieSocio);
    const current = normalizeTipologiaValue(currentValue);
    if (current) set.add(current);
    return sortTipologieSocio([...set]);
}

async function loadTipologieSocio() {
    if (!invoke) return;

    try {
        await initSupabase();
        const list = await invoke('get_all_tipologie_socio');
        allTipologieSocio = Array.isArray(list)
            ? sortTipologieSocio(list.map((v) => normalizeTipologiaValue(v)).filter(Boolean))
            : [];
    } catch (error) {
        console.error('Errore caricamento tipologie socio:', error);
        allTipologieSocio = [];
    }

    if (isAnagraficaEditMode) {
        refreshActiveTipologiaFields();
    }
}

function populateTipologiaSelect(select, currentValue) {
    const options = getTipologieSelectOptions(currentValue);
    const parts = isRicercaMode
        ? ['<option value="">Tutti</option>']
        : ['<option value="">— Scegli tipologia —</option>'];

    options.forEach((value) => {
        parts.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    });
    if (!isRicercaMode) {
        parts.push('<option value="__custom__">➕ Nuova tipologia…</option>');
    }

    select.innerHTML = parts.join('');
}

function findTipologiaOptionValue(options, currentValue) {
    const current = normalizeTipologiaValue(currentValue);
    if (!current) return '';
    return options.find(
        (option) => option.localeCompare(current, 'it', { sensitivity: 'base' }) === 0
    ) || '';
}

function syncTipologiaSelectAndInput(select, input) {
    const options = getTipologieSelectOptions(input.value);
    const current = normalizeTipologiaValue(input.value);
    const matchingOption = findTipologiaOptionValue(options, current);

    if (!current) {
        select.value = '';
        input.value = '';
        input.classList.add('tipologia-input-hidden');
        input.readOnly = true;
    } else if (matchingOption) {
        select.value = matchingOption;
        input.value = matchingOption;
        input.classList.add('tipologia-input-hidden');
        input.readOnly = true;
    } else {
        select.value = '__custom__';
        input.classList.remove('tipologia-input-hidden');
        input.readOnly = false;
    }
}

function teardownTipologiaControls(config) {
    const group = document.querySelector(config.groupSelector);
    const select = group?.querySelector(`[${config.selectAttr}]`);
    const input = document.getElementById(config.inputId);

    if (select) {
        select.onchange = null;
        select.remove();
    }

    if (input) {
        input.oninput = null;
        input.classList.remove('tipologia-input-hidden');
        input.readOnly = true;
    }
}

function teardownTipologiaSocioControls() {
    teardownTipologiaControls(TIPOLOGIA_FIELD_ANAGRAFICA);
}

function teardownTipologiaTessControls() {
    teardownTipologiaControls(TIPOLOGIA_FIELD_TESSERAMENTO);
}

function isTesseramentoEditorVisible() {
    const editor = document.getElementById('tesseramento-editor');
    return editor && editor.style.display !== 'none';
}

function refreshActiveTipologiaFields() {
    if (isAnagraficaEditMode) {
        setupTipologiaField(TIPOLOGIA_FIELD_ANAGRAFICA, true);
    }
    if (isTesseramentoEditorVisible()) {
        setupTipologiaField(TIPOLOGIA_FIELD_TESSERAMENTO, true);
    }
}

async function ensureTipologiaInTable(tipologia) {
    const value = normalizeTipologiaValue(tipologia);
    if (!value || tipologiaGiaPresente(value)) return;

    if (!invoke) {
        allTipologieSocio = sortTipologieSocio([...allTipologieSocio, value]);
        refreshActiveTipologiaFields();
        return;
    }

    try {
        await initSupabase();
        await invoke('add_tipologia_socio', { tipologia: value });
        allTipologieSocio = sortTipologieSocio([...allTipologieSocio, value]);
        refreshActiveTipologiaFields();
    } catch (error) {
        console.error('Errore aggiunta tipologia socio:', error);
        setSaveStatus(`Tipologia non salvata in elenco: ${error}`, true);
    }
}

function setupTipologiaField(config, active) {
    const group = document.querySelector(config.groupSelector);
    const input = document.getElementById(config.inputId);
    if (!group || !input) return;

    if (!active) {
        teardownTipologiaControls(config);
        return;
    }

    let select = group.querySelector(`[${config.selectAttr}]`);
    if (!select) {
        select = document.createElement('select');
        select.className = 'form-control tipologia-select';
        select.setAttribute(config.selectAttr, '1');
        group.insertBefore(select, input);
    }

    populateTipologiaSelect(select, input.value);
    syncTipologiaSelectAndInput(select, input);

    select.onchange = () => {
        if (select.value === '__custom__') {
            input.classList.remove('tipologia-input-hidden');
            input.readOnly = false;
            if (findTipologiaOptionValue(getTipologieSelectOptions(''), input.value)) {
                input.value = '';
            }
            input.focus();
            return;
        }

        input.classList.add('tipologia-input-hidden');
        input.readOnly = true;
        input.value = select.value;
    };

    input.oninput = () => {
        if (select.value === '__custom__') {
            input.readOnly = false;
        }
    };
}

function setupTipologiaSocioField(editing) {
    setupTipologiaField(TIPOLOGIA_FIELD_ANAGRAFICA, editing);
}

function setupTipologiaTessField(active) {
    setupTipologiaField(TIPOLOGIA_FIELD_TESSERAMENTO, active);
}

function setAnagraficaEditMode(editing) {
    isAnagraficaEditMode = editing;

    const container = document.querySelector('.anagrafica-container');
    if (container) {
        container.classList.toggle('mode-readonly', !editing && !isRicercaMode);
        container.classList.toggle('mode-editing', editing && !isRicercaMode);
        container.classList.toggle('mode-ricerca', isRicercaMode);
    }

    const form = document.getElementById('form-anagrafica');
    if (form) {
        form.querySelectorAll('input, select, textarea').forEach((el) => {
            if (el.id === 'field-row-id') {
                el.readOnly = true;
                el.disabled = false;
                return;
            }
            // Telefono principale: sempre in sola lettura (derivato da Telefoni_supa)
            if (el.id === 'field-telefono' && !isRicercaMode) {
                el.readOnly = true;
                el.disabled = false;
                return;
            }
            // In ricerca anche ID socio è editabile (filtro)
            if (el.id === 'field-idsocio' && !isRicercaMode) {
                el.readOnly = true;
                el.disabled = false;
                return;
            }
            if (el.type === 'checkbox') {
                el.disabled = !editing;
            } else if (el.tagName === 'SELECT') {
                el.disabled = !editing;
            } else {
                el.readOnly = !editing;
                el.disabled = false;
            }
        });
    }

    ANAGRAFICA_FLAG_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !editing;
    });

    syncOperatoreDisponibilitaFlags();

    const btnModifica = document.getElementById('btn-modifica-anagrafica');
    const btnSalva = document.getElementById('btn-salva-anagrafica');
    const btnAnnulla = document.getElementById('btn-annulla-anagrafica');
    const btnCerca = document.getElementById('btn-cerca-filtro');
    const btnAzzera = document.getElementById('btn-azzera-filtro');

    if (isRicercaMode) {
        if (btnModifica) btnModifica.hidden = true;
        if (btnSalva) btnSalva.hidden = true;
        if (btnAnnulla) btnAnnulla.hidden = true;
        if (btnCerca) btnCerca.hidden = false;
        if (btnAzzera) btnAzzera.hidden = false;
    } else {
        if (btnModifica) btnModifica.hidden = editing || isNuovoSocioMode;
        if (btnSalva) btnSalva.hidden = !editing;
        if (btnAnnulla) btnAnnulla.hidden = !editing;
        if (btnCerca) btnCerca.hidden = true;
        if (btnAzzera) btnAzzera.hidden = true;
    }

    const btnNuovo = document.getElementById('btn-nuovo-tesseramento');
    if (btnNuovo) btnNuovo.hidden = !editing || isRicercaMode;

    const btnNuovoTel = document.getElementById('btn-nuovo-telefono');
    const btnNuovoEm = document.getElementById('btn-nuovo-email');
    if (btnNuovoTel) btnNuovoTel.hidden = !editing || isRicercaMode;
    if (btnNuovoEm) btnNuovoEm.hidden = !editing || isRicercaMode;

    if (!editing) {
        hideTesseramentoEditor();
        hideTelefonoEditor();
        hideEmailEditor();
    }

    if (!isRicercaMode) {
        renderStoricoTesseramenti();
        renderContatti();
    }
    setupTipologiaSocioField(editing);

    if (isRicercaMode) {
        const comuneInput = document.getElementById('field-residenza-comune');
        if (comuneInput) {
            comuneInput.readOnly = true;
            comuneInput.classList.add('ricerca-comune-input-hidden');
        }
    }
}

function enableAnagraficaEdit() {
    if (isNuovoSocioMode) return;
    anagraficaEditSnapshot = collectAnagraficaPayload();
    setAnagraficaEditMode(true);
    loadTipologieSocio();
    setSaveStatus('');
    document.getElementById('field-nominativo')?.focus();
}

function cancelAnagraficaEdit() {
    if (isNuovoSocioMode) {
        if (!window.confirm('Confermi di annullare l\'inserimento del nuovo socio?')) {
            return;
        }
        closeAnagraficaWindow();
        return;
    }

    if (!isAnagraficaEditMode) return;

    if (anagraficaEditSnapshot) {
        populateAnagrafica(anagraficaEditSnapshot);
    }

    anagraficaEditSnapshot = null;
    setSaveStatus('');
    setAnagraficaEditMode(false);
}

function populateAnagrafica(data) {
    document.getElementById('field-row-id').value = data.id || '';
    document.getElementById('field-idsocio').value = data.idsocio || '';
    document.getElementById('field-nominativo').value = data.nominativo || '';
    document.getElementById('field-codicefiscale').value = data.codicefiscale || '';
    document.getElementById('field-sesso').value = normalizeSesso(data.sesso);
    document.getElementById('field-nascita-comune').value = data.nascita_comune || '';
    document.getElementById('field-nascita-data').value = italianToIso(data.nascita_data);
    document.getElementById('field-residenza-indirizzo').value = data.residenza_indirizzo || '';
    document.getElementById('field-residenza-civico').value = data.residenza_civico || '';
    document.getElementById('field-residenza-cap').value = data.residenza_cap || '';
    document.getElementById('field-residenza-comune').value = data.residenza_comune || '';
    document.getElementById('field-residenza-provincia').value = (data.residenza_provincia || '').toUpperCase();
    document.getElementById('field-telefono').value = formatTelefonoPrincipaleDisplay(
        data.telefono || '',
        telefoniList
    );
    document.getElementById('field-tipologiasocio').value = data.tipologiasocio || '';
    document.getElementById('field-operatore').checked = isTruthyFlag(data.operatore);
    document.getElementById('field-attivo').checked = isTruthyFlag(data.attivo);
    document.getElementById('field-archivia').checked = isTruthyFlag(data.archivia);
    document.getElementById('field-nota').value = data.notaaggiuntiva || '';
    setDisponibilitaCheckboxes(parseDisponibilita(data.disponibilita));
    syncComuniMultiFromInput();

    const subtitle = document.getElementById('socio-subtitle');
    if (subtitle) {
        subtitle.textContent = `ID ${data.idsocio || '—'} · ${data.nominativo || 'Socio'}`;
    }
}

/** Mostra "numero (riferimento)" se c'è un telefono principale in lista. */
function formatTelefonoPrincipaleDisplay(fallback, lista) {
    const list = Array.isArray(lista) ? lista : [];
    const principale = list.find((t) => t.principale && (t.telefono || '').trim());
    const chosen = principale || list.find((t) => (t.telefono || '').trim());
    if (!chosen) return fallback || '';
    const num = (chosen.telefono || '').trim();
    const rif = (chosen.riferimento || '').trim();
    return rif ? `${num} (${rif})` : num;
}

function collectAnagraficaPayload() {
    // In salvataggio: numero "pulito" del telefono principale (senza riferimento tra parentesi)
    let telefonoSalvataggio = document.getElementById('field-telefono').value.trim();
    const principale = telefoniList.find((t) => t.principale && (t.telefono || '').trim());
    if (principale) {
        telefonoSalvataggio = (principale.telefono || '').trim();
    } else {
        const match = telefonoSalvataggio.match(/^(.*?)\s*\([^)]*\)\s*$/);
        if (match) telefonoSalvataggio = match[1].trim();
    }

    return {
        id: parseInt(document.getElementById('field-row-id').value, 10) || 0,
        idsocio: document.getElementById('field-idsocio').value.trim(),
        nominativo: document.getElementById('field-nominativo').value.trim(),
        codicefiscale: document.getElementById('field-codicefiscale').value.trim().toUpperCase(),
        sesso: document.getElementById('field-sesso').value.trim().toUpperCase(),
        nascita_comune: document.getElementById('field-nascita-comune').value.trim(),
        nascita_data: isoToItalian(document.getElementById('field-nascita-data').value),
        residenza_indirizzo: document.getElementById('field-residenza-indirizzo').value.trim(),
        residenza_civico: document.getElementById('field-residenza-civico').value.trim(),
        residenza_cap: document.getElementById('field-residenza-cap').value.trim(),
        residenza_comune: document.getElementById('field-residenza-comune').value.trim(),
        residenza_provincia: document.getElementById('field-residenza-provincia').value.trim().toUpperCase(),
        telefono: telefonoSalvataggio,
        tipologiasocio: document.getElementById('field-tipologiasocio').value.trim(),
        operatore: document.getElementById('field-operatore').checked,
        attivo: document.getElementById('field-attivo').checked,
        archivia: document.getElementById('field-archivia').checked,
        disponibilita: formatDisponibilita(),
        notaaggiuntiva: document.getElementById('field-nota').value.trim()
    };
}

function renderContatti() {
    renderTelefoniTable();
    renderEmailTable();
}

function sortContattiByPrincipale(list) {
    return [...list].sort((a, b) => {
        const pa = a.principale ? 1 : 0;
        const pb = b.principale ? 1 : 0;
        if (pb !== pa) return pb - pa;
        const oa = parseFloat(a.ordine_utilizzo) || 9999;
        const ob = parseFloat(b.ordine_utilizzo) || 9999;
        return oa - ob;
    });
}

function refreshTelefonoPrincipaleField() {
    const el = document.getElementById('field-telefono');
    if (!el) return;
    el.value = formatTelefonoPrincipaleDisplay('', telefoniList);
}

function renderTelefoniTable() {
    const tbody = document.getElementById('telefoni-tbody');
    const table = document.getElementById('telefoni-table');
    const vuoto = document.getElementById('telefoni-vuoto');
    if (!tbody || !table || !vuoto) return;

    tbody.innerHTML = '';

    if (!telefoniList.length) {
        vuoto.style.display = 'block';
        table.style.display = 'none';
        vuoto.textContent = isAnagraficaEditMode && !isRicercaMode
            ? 'Nessun telefono. Clicca + TELEFONO per aggiungerne uno.'
            : 'Nessun telefono registrato.';
        return;
    }

    vuoto.style.display = 'none';
    table.style.display = 'table';

    sortContattiByPrincipale(telefoniList).forEach((tel) => {
        const realIndex = telefoniList.indexOf(tel);
        const tr = document.createElement('tr');
        if (tel.principale) tr.classList.add('contatto-principale');
        const azioni = isAnagraficaEditMode && !isRicercaMode
            ? `<td class="col-azioni">
                    <button type="button" class="btn-modifica-contatto" data-tel-index="${realIndex}">Modifica</button>
                    <button type="button" class="btn-elimina-contatto" data-tel-index="${realIndex}">Elimina</button>
               </td>`
            : '<td class="col-azioni"></td>';
        tr.innerHTML = `
            <td>${escapeHtml(tel.telefono || '')}</td>
            <td>${escapeHtml(tel.riferimento || '')}</td>
            <td class="col-princ">${tel.principale ? '<span class="contatti-check" title="Principale">✓</span>' : ''}</td>
            <td>${escapeHtml(tel.note || '')}</td>
            ${azioni}
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-modifica-contatto').forEach((btn) => {
        btn.addEventListener('click', () => {
            openTelefonoEditor(parseInt(btn.dataset.telIndex, 10), false);
        });
    });
    tbody.querySelectorAll('.btn-elimina-contatto').forEach((btn) => {
        btn.addEventListener('click', () => {
            deleteTelefonoAt(parseInt(btn.dataset.telIndex, 10));
        });
    });
}

function renderEmailTable() {
    const tbody = document.getElementById('email-tbody');
    const table = document.getElementById('email-table');
    const vuoto = document.getElementById('email-vuoto');
    if (!tbody || !table || !vuoto) return;

    tbody.innerHTML = '';

    if (!emailList.length) {
        vuoto.style.display = 'block';
        table.style.display = 'none';
        vuoto.textContent = isAnagraficaEditMode && !isRicercaMode
            ? 'Nessuna email. Clicca + EMAIL per aggiungerne una.'
            : 'Nessuna email registrata.';
        return;
    }

    vuoto.style.display = 'none';
    table.style.display = 'table';

    sortContattiByPrincipale(emailList).forEach((em) => {
        const realIndex = emailList.indexOf(em);
        const tr = document.createElement('tr');
        if (em.principale) tr.classList.add('contatto-principale');
        const azioni = isAnagraficaEditMode && !isRicercaMode
            ? `<td class="col-azioni">
                    <button type="button" class="btn-modifica-contatto" data-em-index="${realIndex}">Modifica</button>
                    <button type="button" class="btn-elimina-contatto" data-em-index="${realIndex}">Elimina</button>
               </td>`
            : '<td class="col-azioni"></td>';
        tr.innerHTML = `
            <td>${escapeHtml(em.email || '')}</td>
            <td>${escapeHtml(em.riferimento || '')}</td>
            <td class="col-princ">${em.principale ? '<span class="contatti-check" title="Principale">✓</span>' : ''}</td>
            <td>${escapeHtml(em.note || '')}</td>
            ${azioni}
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-modifica-contatto').forEach((btn) => {
        btn.addEventListener('click', () => {
            openEmailEditor(parseInt(btn.dataset.emIndex, 10), false);
        });
    });
    tbody.querySelectorAll('.btn-elimina-contatto').forEach((btn) => {
        btn.addEventListener('click', () => {
            deleteEmailAt(parseInt(btn.dataset.emIndex, 10));
        });
    });
}

function hideTelefonoEditor() {
    const editor = document.getElementById('telefono-editor');
    if (editor) editor.hidden = true;
    editingTelefonoIndex = -1;
    isNewTelefono = false;
}

function hideEmailEditor() {
    const editor = document.getElementById('email-editor');
    if (editor) editor.hidden = true;
    editingEmailIndex = -1;
    isNewEmail = false;
}

function openTelefonoEditor(index, isNew) {
    if (!isAnagraficaEditMode || isRicercaMode) return;
    hideEmailEditor();

    isNewTelefono = isNew;
    editingTelefonoIndex = isNew ? -1 : index;

    const editor = document.getElementById('telefono-editor');
    const title = document.getElementById('telefono-editor-title');
    if (!editor) return;

    const tel = isNew
        ? {
            id: '',
            idsocio: currentIdsocio,
            telefono: '',
            riferimento: '',
            principale: telefoniList.length === 0,
            ordine_utilizzo: String(telefoniList.length + 1),
            note: ''
        }
        : telefoniList[index];

    if (!tel) return;

    document.getElementById('tel-id').value = tel.id || '';
    document.getElementById('tel-numero').value = tel.telefono || '';
    document.getElementById('tel-riferimento').value = tel.riferimento || '';
    document.getElementById('tel-ordine').value = tel.ordine_utilizzo || '';
    document.getElementById('tel-principale').checked = !!tel.principale;
    document.getElementById('tel-note').value = tel.note || '';

    if (title) title.textContent = isNew ? 'Nuovo telefono' : 'Modifica telefono';
    editor.hidden = false;
    document.getElementById('tel-numero')?.focus();
}

function openEmailEditor(index, isNew) {
    if (!isAnagraficaEditMode || isRicercaMode) return;
    hideTelefonoEditor();

    isNewEmail = isNew;
    editingEmailIndex = isNew ? -1 : index;

    const editor = document.getElementById('email-editor');
    const title = document.getElementById('email-editor-title');
    if (!editor) return;

    const em = isNew
        ? {
            id: '',
            idsocio: currentIdsocio,
            email: '',
            riferimento: '',
            principale: emailList.length === 0,
            ordine_utilizzo: String(emailList.length + 1),
            note: ''
        }
        : emailList[index];

    if (!em) return;

    document.getElementById('em-id').value = em.id || '';
    document.getElementById('em-indirizzo').value = em.email || '';
    document.getElementById('em-riferimento').value = em.riferimento || '';
    document.getElementById('em-ordine').value = em.ordine_utilizzo || '';
    document.getElementById('em-principale').checked = !!em.principale;
    document.getElementById('em-note').value = em.note || '';

    if (title) title.textContent = isNew ? 'Nuova email' : 'Modifica email';
    editor.hidden = false;
    document.getElementById('em-indirizzo')?.focus();
}

function collectTelefonoPayload() {
    const id = document.getElementById('tel-id').value.trim();
    return {
        id: id || null,
        idsocio: currentIdsocio,
        telefono: document.getElementById('tel-numero').value.trim(),
        riferimento: document.getElementById('tel-riferimento').value.trim(),
        principale: document.getElementById('tel-principale').checked,
        ordine_utilizzo: document.getElementById('tel-ordine').value.trim(),
        note: document.getElementById('tel-note').value.trim()
    };
}

function collectEmailPayload() {
    const id = document.getElementById('em-id').value.trim();
    return {
        id: id || null,
        idsocio: currentIdsocio,
        email: document.getElementById('em-indirizzo').value.trim(),
        riferimento: document.getElementById('em-riferimento').value.trim(),
        principale: document.getElementById('em-principale').checked,
        ordine_utilizzo: document.getElementById('em-ordine').value.trim(),
        note: document.getElementById('em-note').value.trim()
    };
}

function applyPrincipaleExclusive(list, saved, isNew, editingIndex) {
    if (!saved.principale) return;
    list.forEach((item, i) => {
        if (isNew || i !== editingIndex) item.principale = false;
    });
}

async function saveTelefono(e) {
    if (e) e.preventDefault();
    if (!isAnagraficaEditMode) return;

    const payload = collectTelefonoPayload();
    if (!payload.telefono) {
        setSaveStatus('Il numero di telefono è obbligatorio', true);
        return;
    }

    const btn = document.getElementById('btn-salva-telefono');
    if (btn) btn.disabled = true;

    try {
        if (isNuovoSocioMode) {
            const localTel = { ...payload, idsocio: currentIdsocio };
            applyPrincipaleExclusive(telefoniList, localTel, isNewTelefono, editingTelefonoIndex);
            if (isNewTelefono) {
                telefoniList.push(localTel);
            } else if (editingTelefonoIndex >= 0) {
                telefoniList[editingTelefonoIndex] = localTel;
            }
            renderTelefoniTable();
            refreshTelefonoPrincipaleField();
            hideTelefonoEditor();
            setSaveStatus('Telefono aggiunto');
            return;
        }

        if (!invoke) {
            setSaveStatus('Database non disponibile', true);
            return;
        }

        await initSupabase();
        const saved = await invoke('save_socio_telefono', { telefono: payload });
        applyPrincipaleExclusive(telefoniList, saved, isNewTelefono, editingTelefonoIndex);
        if (isNewTelefono) {
            telefoniList.push(saved);
        } else if (editingTelefonoIndex >= 0) {
            telefoniList[editingTelefonoIndex] = saved;
        } else {
            // fallback: aggiorna per id
            const idx = telefoniList.findIndex((t) => t.id && saved.id && String(t.id) === String(saved.id));
            if (idx >= 0) telefoniList[idx] = saved;
            else telefoniList.push(saved);
        }
        renderTelefoniTable();
        refreshTelefonoPrincipaleField();
        hideTelefonoEditor();
        setSaveStatus('Telefono salvato');
        await notifySocioAnagraficaSaved({
            ...collectAnagraficaPayload(),
            telefono: document.getElementById('field-telefono')?.value || ''
        });
    } catch (error) {
        console.error('Errore salvataggio telefono:', error);
        setSaveStatus(`Errore telefono: ${error}`, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function saveEmail(e) {
    if (e) e.preventDefault();
    if (!isAnagraficaEditMode) return;

    const payload = collectEmailPayload();
    if (!payload.email) {
        setSaveStatus('L\'indirizzo email è obbligatorio', true);
        return;
    }

    const btn = document.getElementById('btn-salva-email');
    if (btn) btn.disabled = true;

    try {
        if (isNuovoSocioMode) {
            const localEm = { ...payload, idsocio: currentIdsocio };
            applyPrincipaleExclusive(emailList, localEm, isNewEmail, editingEmailIndex);
            if (isNewEmail) {
                emailList.push(localEm);
            } else if (editingEmailIndex >= 0) {
                emailList[editingEmailIndex] = localEm;
            }
            renderEmailTable();
            hideEmailEditor();
            setSaveStatus('Email aggiunta');
            return;
        }

        if (!invoke) {
            setSaveStatus('Database non disponibile', true);
            return;
        }

        await initSupabase();
        const saved = await invoke('save_socio_email', { email: payload });
        applyPrincipaleExclusive(emailList, saved, isNewEmail, editingEmailIndex);
        if (isNewEmail) {
            emailList.push(saved);
        } else if (editingEmailIndex >= 0) {
            emailList[editingEmailIndex] = saved;
        } else {
            const idx = emailList.findIndex((t) => t.id && saved.id && String(t.id) === String(saved.id));
            if (idx >= 0) emailList[idx] = saved;
            else emailList.push(saved);
        }
        renderEmailTable();
        hideEmailEditor();
        setSaveStatus('Email salvata');
    } catch (error) {
        console.error('Errore salvataggio email:', error);
        setSaveStatus(`Errore email: ${error}`, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteTelefonoAt(index) {
    if (!isAnagraficaEditMode || isRicercaMode) return;
    const tel = telefoniList[index];
    if (!tel) return;

    const label = tel.telefono || 'questo telefono';
    if (!window.confirm(`Eliminare il telefono "${label}"?`)) return;
    if (!window.confirm('Confermi definitivamente l\'eliminazione di questo telefono?')) return;

    try {
        if (isNuovoSocioMode) {
            telefoniList.splice(index, 1);
            renderTelefoniTable();
            refreshTelefonoPrincipaleField();
            hideTelefonoEditor();
            setSaveStatus('Telefono eliminato');
            return;
        }

        if (!invoke) {
            setSaveStatus('Database non disponibile', true);
            return;
        }

        await initSupabase();
        await invoke('delete_socio_telefono', {
            telefono: {
                id: tel.id || null,
                idsocio: currentIdsocio,
                telefono: tel.telefono || '',
                riferimento: tel.riferimento || '',
                principale: !!tel.principale,
                ordine_utilizzo: tel.ordine_utilizzo || '',
                note: tel.note || ''
            }
        });
        telefoniList.splice(index, 1);
        renderTelefoniTable();
        refreshTelefonoPrincipaleField();
        hideTelefonoEditor();
        setSaveStatus('Telefono eliminato');
        await notifySocioAnagraficaSaved({
            ...collectAnagraficaPayload(),
            telefono: document.getElementById('field-telefono')?.value || ''
        });
    } catch (error) {
        console.error('Errore eliminazione telefono:', error);
        setSaveStatus(`Errore eliminazione telefono: ${error}`, true);
    }
}

async function deleteEmailAt(index) {
    if (!isAnagraficaEditMode || isRicercaMode) return;
    const em = emailList[index];
    if (!em) return;

    const label = em.email || 'questa email';
    if (!window.confirm(`Eliminare l'email "${label}"?`)) return;
    if (!window.confirm('Confermi definitivamente l\'eliminazione di questa email?')) return;

    try {
        if (isNuovoSocioMode) {
            emailList.splice(index, 1);
            renderEmailTable();
            hideEmailEditor();
            setSaveStatus('Email eliminata');
            return;
        }

        if (!invoke) {
            setSaveStatus('Database non disponibile', true);
            return;
        }

        await initSupabase();
        await invoke('delete_socio_email', {
            email: {
                id: em.id || null,
                idsocio: currentIdsocio,
                email: em.email || '',
                riferimento: em.riferimento || '',
                principale: !!em.principale,
                ordine_utilizzo: em.ordine_utilizzo || '',
                note: em.note || ''
            }
        });
        emailList.splice(index, 1);
        renderEmailTable();
        hideEmailEditor();
        setSaveStatus('Email eliminata');
    } catch (error) {
        console.error('Errore eliminazione email:', error);
        setSaveStatus(`Errore eliminazione email: ${error}`, true);
    }
}

function renderStoricoTesseramenti() {
    const tbody = document.getElementById('storico-tbody');
    const table = document.getElementById('storico-table');
    const vuoto = document.getElementById('storico-vuoto');

    if (!tbody || !table || !vuoto) return;

    tbody.innerHTML = '';

    if (!tesseramentiList.length) {
        vuoto.style.display = 'block';
        table.style.display = 'none';
        vuoto.textContent = isNuovoSocioMode
            ? 'Nessun tesseramento. Clicca + NUOVO per aggiungerne uno (opzionale).'
            : 'Nessun tesseramento registrato.';
        return;
    }

    vuoto.style.display = 'none';
    table.style.display = 'table';

    const sorted = [...tesseramentiList].sort((a, b) =>
        parseInt(b.anno, 10) - parseInt(a.anno, 10)
    );

    const maxAnno = Math.max(...sorted.map(t => parseInt(t.anno, 10) || 0));

    sorted.forEach((tess, index) => {
        const realIndex = tesseramentiList.indexOf(tess);
        const tr = document.createElement('tr');
        const anno = parseInt(tess.anno, 10) || 0;
        if (anno === maxAnno) tr.classList.add('attivo');
        if (isScaduto(tess.scadenza)) tr.classList.add('scaduto');

        tr.innerHTML = `
            <td>${escapeHtml(tess.anno)}</td>
            <td>${escapeHtml(tess.numero)}</td>
            <td>${escapeHtml(tess.data)}</td>
            <td>${escapeHtml(tess.scadenza)}</td>
            <td>${escapeHtml(tess.tipologia)}</td>
            <td>${escapeHtml(tess.quota)}</td>
            <td>${isAnagraficaEditMode
                ? `<button type="button" class="btn-modifica-tess" data-index="${realIndex}">Modifica</button>`
                : ''}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-modifica-tess').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            openTesseramentoEditor(idx, false);
        });
    });
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function openTesseramentoEditor(index, isNew) {
    if (!isAnagraficaEditMode) return;

    isNewTesseramento = isNew;
    editingTesseramentoIndex = index;

    const editor = document.getElementById('tesseramento-editor');
    const title = document.getElementById('editor-title');
    if (editor) editor.style.display = 'block';

    if (isNew) {
        title.textContent = 'Nuovo tesseramento annuale';
        const annoCorrente = new Date().getFullYear();
        const anniEsistenti = new Set(tesseramentiList.map(t => String(t.anno)));
        let nuovoAnno = annoCorrente;
        while (anniEsistenti.has(String(nuovoAnno))) {
            nuovoAnno += 1;
        }

        document.getElementById('tess-id').value = '';
        document.getElementById('tess-anno').value = String(nuovoAnno);
        document.getElementById('tess-numero').value = '';
        document.getElementById('tess-data').value = '';
        document.getElementById('tess-scadenza').value = scadenzaFromAnno(nuovoAnno);
        document.getElementById('tess-tipologia').value =
            document.getElementById('field-tipologiasocio').value || '';
        document.getElementById('tess-quota').value = '';
        document.getElementById('tess-note').value = '';
        document.getElementById('tess-anno').readOnly = false;
    } else {
        const tess = tesseramentiList[index];
        if (!tess) return;
        title.textContent = `Modifica tesseramento ${tess.anno}`;
        document.getElementById('tess-id').value = tess.id || '';
        document.getElementById('tess-anno').value = tess.anno || '';
        document.getElementById('tess-numero').value = tess.numero || '';
        document.getElementById('tess-data').value = italianToIso(tess.data);
        document.getElementById('tess-scadenza').value = tess.scadenza || scadenzaFromAnno(tess.anno);
        document.getElementById('tess-tipologia').value = tess.tipologia || '';
        document.getElementById('tess-quota').value = tess.quota || '';
        document.getElementById('tess-note').value = tess.note || '';
        document.getElementById('tess-anno').readOnly = true;
    }

    document.getElementById('tesseramento-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setupTipologiaTessField(true);
}

function hideTesseramentoEditor() {
    editingTesseramentoIndex = -1;
    isNewTesseramento = false;
    teardownTipologiaTessControls();
    const editor = document.getElementById('tesseramento-editor');
    if (editor) editor.style.display = 'none';
}

function collectTesseramentoPayload() {
    const anno = document.getElementById('tess-anno').value.trim();
    return {
        id: document.getElementById('tess-id').value.trim() || null,
        idsocio: currentIdsocio,
        anno,
        numero: document.getElementById('tess-numero').value.trim(),
        data: isoToItalian(document.getElementById('tess-data').value),
        scadenza: scadenzaFromAnno(anno),
        tipologia: document.getElementById('tess-tipologia').value.trim(),
        quota: document.getElementById('tess-quota').value.trim(),
        note: document.getElementById('tess-note').value.trim()
    };
}

async function ensureInvokeReady() {
    for (let attempt = 0; attempt < 15; attempt++) {
        await initTauri();
        if (invoke) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

async function initSupabase() {
    if (!invoke) return;
    try {
        await invoke('init_supabase_from_config');
    } catch (err) {
        console.warn('Init Supabase:', err);
    }
}

async function loadNuovoSocio() {
    const loading = document.getElementById('loading-message');
    const sectionAnag = document.getElementById('section-anagrafica');
    const sectionTess = document.getElementById('section-tesseramenti');

    isNuovoSocioMode = true;
    currentIdsocio = '';

    const ready = await ensureInvokeReady();
    if (!ready) {
        if (loading) {
            loading.textContent = 'Database non disponibile. Apri questa pagina dall\'app AUSER (non dal browser).';
        }
        return;
    }

    try {
        await initSupabase();
        await loadTipologieSocio();

        let nextId = '1';
        if (invoke) {
            nextId = await invoke('get_next_idsocio');
        }

        currentIdsocio = nextId;
        populateAnagrafica(createNuovoSocioTemplate(nextId));
        tesseramentiList = [];
        telefoniList = [];
        emailList = [];
        renderStoricoTesseramenti();
        renderContatti();

        const subtitle = document.getElementById('socio-subtitle');
        if (subtitle) subtitle.textContent = `Nuovo socio — ID ${nextId}`;

        const titleEl = document.querySelector('.page-title');
        if (titleEl) titleEl.textContent = 'NUOVO SOCIO';

        if (loading) loading.style.display = 'none';
        if (sectionAnag) sectionAnag.style.display = 'block';
        const sectionContatti = document.getElementById('section-contatti');
        if (sectionContatti) sectionContatti.style.display = 'block';
        if (sectionTess) sectionTess.style.display = 'block';

        setAnagraficaEditMode(true);
        document.getElementById('field-nominativo')?.focus();
    } catch (error) {
        console.error('Errore preparazione nuovo socio:', error);
        if (loading) loading.textContent = `Errore: ${error}`;
        setSaveStatus('Impossibile preparare il nuovo socio', true);
    }
}

async function loadSocioData() {
    const loading = document.getElementById('loading-message');
    const sectionAnag = document.getElementById('section-anagrafica');
    const sectionTess = document.getElementById('section-tesseramenti');

    if (isRicercaFromUrl()) {
        await loadRicercaMode();
        return;
    }

    if (isNuovoSocioFromUrl()) {
        await loadNuovoSocio();
        return;
    }

    currentIdsocio = getIdsocioFromUrl();
    if (!currentIdsocio) {
        if (loading) loading.textContent = 'Errore: ID socio mancante nell\'indirizzo.';
        return;
    }

    const ready = await ensureInvokeReady();
    if (!ready) {
        if (loading) {
            loading.textContent = 'Database non disponibile. Apri questa pagina dall\'app AUSER (non dal browser).';
        }
        return;
    }

    try {
        await initSupabase();
        await loadTipologieSocio();
        const result = await invoke('get_socio_anagrafica', { idsocio: currentIdsocio });
        populateAnagrafica(result.anagrafica);
        tesseramentiList = result.tesseramenti || [];
        telefoniList = result.telefoni || [];
        emailList = result.email || [];
        renderStoricoTesseramenti();
        renderContatti();

        if (loading) loading.style.display = 'none';
        if (sectionAnag) sectionAnag.style.display = 'block';
        const sectionContatti = document.getElementById('section-contatti');
        if (sectionContatti) sectionContatti.style.display = 'block';
        if (sectionTess) sectionTess.style.display = 'block';
        setAnagraficaEditMode(false);
    } catch (error) {
        console.error('Errore caricamento anagrafica:', error);
        if (loading) loading.textContent = `Errore: ${error}`;
        setSaveStatus('Impossibile caricare i dati', true);
    }
}

function readStoredRicercaCriteri() {
    try {
        const raw = localStorage.getItem(RICERCA_FILTRO_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function parseComuniResidenza(value) {
    if (!value || typeof value !== 'string') return [];
    return value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function sortComuni(list) {
    return [...list].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

async function loadComuniResidenza() {
    if (!invoke) {
        allComuniResidenza = [];
        return;
    }

    try {
        await initSupabase();
        const tesserati = await invoke('get_all_tesserati');
        const set = new Set();
        (Array.isArray(tesserati) ? tesserati : []).forEach((t) => {
            const comune = normalizeTipologiaValue(t?.residenza_comune);
            if (comune) set.add(comune);
        });
        allComuniResidenza = sortComuni([...set]);
    } catch (error) {
        console.error('Errore caricamento comuni residenza:', error);
        allComuniResidenza = [];
    }
}

function updateComuniMultiToggleLabel() {
    const toggle = document.getElementById('ricerca-comuni-toggle');
    const input = document.getElementById('field-residenza-comune');
    if (!toggle || !input) return;

    const selected = parseComuniResidenza(input.value);
    if (!selected.length) {
        toggle.textContent = 'Tutti i comuni';
        return;
    }
    if (selected.length === 1) {
        toggle.textContent = selected[0];
        return;
    }
    toggle.textContent = `${selected.length} comuni selezionati`;
}

function syncComuniMultiFromInput() {
    if (!isRicercaMode) return;

    const input = document.getElementById('field-residenza-comune');
    const list = document.getElementById('ricerca-comuni-list');
    if (!input || !list) return;

    const selected = new Set(parseComuniResidenza(input.value).map((c) => c.toLowerCase()));
    list.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.checked = selected.has(String(checkbox.value).toLowerCase());
    });
    updateComuniMultiToggleLabel();
}

function syncInputFromComuniMulti() {
    const input = document.getElementById('field-residenza-comune');
    const list = document.getElementById('ricerca-comuni-list');
    if (!input || !list) return;

    const selected = [];
    list.querySelectorAll('input[type="checkbox"]:checked').forEach((checkbox) => {
        selected.push(checkbox.value);
    });
    input.value = sortComuni(selected).join(', ');
    updateComuniMultiToggleLabel();
}

function clearComuniMultiSelection() {
    const input = document.getElementById('field-residenza-comune');
    if (input) input.value = '';
    syncComuniMultiFromInput();
}

function closeComuniMultiPanel() {
    const panel = document.getElementById('ricerca-comuni-panel');
    const toggle = document.getElementById('ricerca-comuni-toggle');
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function renderComuniMultiList() {
    const list = document.getElementById('ricerca-comuni-list');
    if (!list) return;

    if (!allComuniResidenza.length) {
        list.innerHTML = '<p class="ricerca-comuni-empty">Nessun comune disponibile</p>';
        return;
    }

    list.innerHTML = allComuniResidenza.map((comune, index) => `
        <div class="ricerca-comuni-item" role="option">
            <input type="checkbox" id="ricerca-comune-${index}" value="${escapeHtml(comune)}">
            <label for="ricerca-comune-${index}">${escapeHtml(comune)}</label>
        </div>
    `).join('');

    list.querySelectorAll('.ricerca-comuni-item').forEach((row) => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        row.addEventListener('click', (e) => {
            if (e.target === checkbox) return;
            checkbox.checked = !checkbox.checked;
            syncInputFromComuniMulti();
        });
        checkbox?.addEventListener('change', syncInputFromComuniMulti);
    });

    syncComuniMultiFromInput();
}

function setupRicercaComuneField() {
    const group = document.querySelector('.field-comune');
    const input = document.getElementById('field-residenza-comune');
    const label = document.querySelector('label[for="field-residenza-comune"]');
    if (!group || !input) return;

    if (label) {
        label.textContent = 'COMUNE/I';
        label.title = 'Seleziona uno o più comuni di residenza';
    }

    input.classList.add('ricerca-comune-input-hidden');
    input.readOnly = true;
    input.tabIndex = -1;

    if (!document.getElementById('ricerca-comuni-multi')) {
        const wrapper = document.createElement('div');
        wrapper.id = 'ricerca-comuni-multi';
        wrapper.className = 'ricerca-comuni-multi';
        wrapper.innerHTML = `
            <button type="button" class="ricerca-comuni-toggle" id="ricerca-comuni-toggle" aria-expanded="false">
                Tutti i comuni
            </button>
            <div class="ricerca-comuni-panel" id="ricerca-comuni-panel" hidden>
                <div class="ricerca-comuni-actions">
                    <button type="button" class="ricerca-comuni-action" id="ricerca-comuni-seleziona-tutti">Seleziona tutti</button>
                    <button type="button" class="ricerca-comuni-action" id="ricerca-comuni-deseleziona-tutti">Deseleziona tutti</button>
                </div>
                <div class="ricerca-comuni-list" id="ricerca-comuni-list"></div>
            </div>
        `;
        group.appendChild(wrapper);

        document.getElementById('ricerca-comuni-toggle')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('ricerca-comuni-panel');
            const toggle = document.getElementById('ricerca-comuni-toggle');
            if (!panel || !toggle) return;
            const open = panel.hidden;
            panel.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        document.getElementById('ricerca-comuni-seleziona-tutti')?.addEventListener('click', () => {
            document.querySelectorAll('#ricerca-comuni-list input[type="checkbox"]').forEach((cb) => {
                cb.checked = true;
            });
            syncInputFromComuniMulti();
        });

        document.getElementById('ricerca-comuni-deseleziona-tutti')?.addEventListener('click', () => {
            clearComuniMultiSelection();
        });

        document.addEventListener('click', (e) => {
            const multi = document.getElementById('ricerca-comuni-multi');
            if (multi && !multi.contains(e.target)) {
                closeComuniMultiPanel();
            }
        });
    }

    renderComuniMultiList();
    updateComuniMultiToggleLabel();
}

function clearRicercaForm() {
    populateAnagrafica({
        ...createNuovoSocioTemplate(''),
        tipologiasocio: '',
        operatore: false,
        attivo: false,
        archivia: false
    });
    setDisponibilitaCheckboxes([]);
    const nominativo = document.getElementById('field-nominativo');
    if (nominativo) nominativo.required = false;
    if (isAnagraficaEditMode) {
        setupTipologiaSocioField(true);
    }
    clearComuniMultiSelection();
    closeComuniMultiPanel();
}

function collectRicercaCriteri() {
    const payload = collectAnagraficaPayload();
    const criteri = {
        idsocio: payload.idsocio,
        nominativo: payload.nominativo,
        codicefiscale: payload.codicefiscale,
        sesso: payload.sesso,
        nascita_comune: payload.nascita_comune,
        nascita_data: payload.nascita_data,
        residenza_indirizzo: payload.residenza_indirizzo,
        residenza_civico: payload.residenza_civico,
        residenza_cap: payload.residenza_cap,
        residenza_comune: payload.residenza_comune,
        residenza_provincia: payload.residenza_provincia,
        telefono: payload.telefono,
        tipologiasocio: payload.tipologiasocio,
        notaaggiuntiva: payload.notaaggiuntiva,
        // Flag: solo se spuntati (altrimenti "non filtrare")
        operatore: document.getElementById('field-operatore')?.checked === true,
        attivo: document.getElementById('field-attivo')?.checked === true,
        archivia: document.getElementById('field-archivia')?.checked === true,
        disp_autista: document.getElementById('field-disp-autista')?.checked === true,
        disp_centralista: document.getElementById('field-disp-centralista')?.checked === true
    };

    // Rimuovi stringhe vuote dai criteri testo
    Object.keys(criteri).forEach((key) => {
        if (typeof criteri[key] === 'string' && !criteri[key].trim()) {
            delete criteri[key];
        }
        if (typeof criteri[key] === 'boolean' && criteri[key] === false) {
            delete criteri[key];
        }
    });

    return criteri;
}

async function applyRicercaFiltro() {
    const criteri = collectRicercaCriteri();
    try {
        localStorage.setItem(RICERCA_FILTRO_STORAGE_KEY, JSON.stringify(criteri));
    } catch (_) { /* ignore */ }

    if (isTauri()) {
        try {
            const { emit } = await import('@tauri-apps/api/event');
            await emit('socio-ricerca-filtro', criteri);
        } catch (err) {
            console.warn('Emit filtro ricerca:', err);
        }
    } else if (window.opener && !window.opener.closed) {
        try {
            window.opener.postMessage({ type: 'socio-ricerca-filtro', criteri }, '*');
        } catch (err) {
            console.warn('postMessage filtro ricerca:', err);
        }
    }

    const n = Object.keys(criteri).length;
    setSaveStatus(n === 0 ? 'Filtro rimosso' : `Filtro applicato (${n} criteri)`);
    await closeAnagraficaWindow();
}

async function loadRicercaMode() {
    const loading = document.getElementById('loading-message');
    const sectionAnag = document.getElementById('section-anagrafica');
    const sectionTess = document.getElementById('section-tesseramenti');
    const main = document.getElementById('anagrafica-main');

    isRicercaMode = true;
    isNuovoSocioMode = false;
    currentIdsocio = '';

    document.title = 'Ricerca soci - AUSER Asti';
    const titleEl = document.querySelector('.page-title');
    if (titleEl) titleEl.textContent = 'RICERCA SOCI';

    const subtitle = document.getElementById('socio-subtitle');
    if (subtitle) {
        subtitle.textContent = 'Compila i campi da cercare, poi premi CERCA';
    }

    await ensureInvokeReady();
    try {
        await initSupabase();
        await loadTipologieSocio();
        await loadComuniResidenza();
    } catch (err) {
        console.warn('Init ricerca (opzionale):', err);
    }

    const stored = readStoredRicercaCriteri();
    clearRicercaForm();
    if (stored && typeof stored === 'object') {
        populateAnagrafica({
            id: 0,
            idsocio: stored.idsocio || '',
            nominativo: stored.nominativo || '',
            codicefiscale: stored.codicefiscale || '',
            sesso: stored.sesso || '',
            nascita_comune: stored.nascita_comune || '',
            nascita_data: stored.nascita_data || '',
            residenza_indirizzo: stored.residenza_indirizzo || '',
            residenza_civico: stored.residenza_civico || '',
            residenza_cap: stored.residenza_cap || '',
            residenza_comune: stored.residenza_comune || '',
            residenza_provincia: stored.residenza_provincia || '',
            telefono: stored.telefono || '',
            tipologiasocio: stored.tipologiasocio || '',
            operatore: !!stored.operatore,
            attivo: !!stored.attivo,
            archivia: !!stored.archivia,
            disponibilita: [
                stored.disp_autista ? 'AUTISTA' : '',
                stored.disp_centralista ? 'CENTRALISTA' : ''
            ].filter(Boolean).join(', '),
            notaaggiuntiva: stored.notaaggiuntiva || ''
        });
        if (subtitle) {
            subtitle.textContent = 'Compila i campi da cercare, poi premi CERCA';
        }
    }

    if (loading) loading.style.display = 'none';
    if (sectionAnag) sectionAnag.style.display = 'block';
    const sectionContatti = document.getElementById('section-contatti');
    if (sectionContatti) sectionContatti.style.display = 'none';
    if (sectionTess) sectionTess.style.display = 'none';

    // Hint sotto l'header
    if (main && !document.getElementById('hint-ricerca')) {
        const hint = document.createElement('p');
        hint.id = 'hint-ricerca';
        hint.className = 'anagraficasoci-hint-ricerca';
        hint.textContent = 'Modalità ricerca: i campi compilati filtrano l\'elenco soci (anche corrispondenza parziale). Le caselle spuntate richiedono quel flag. Nel campo COMUNE/I seleziona uno o più comuni dal menu a tendina.';
        sectionAnag?.parentNode?.insertBefore(hint, sectionAnag);
    }

    setupRicercaComuneField();
    setAnagraficaEditMode(true);
    closeComuniMultiPanel();

    const focusEl = document.getElementById('ricerca-comuni-toggle') || document.getElementById('field-nominativo');
    focusEl?.focus();
}

async function saveAnagrafica() {
    if (!isAnagraficaEditMode) return;

    const nominativo = document.getElementById('field-nominativo').value.trim();
    if (!nominativo) {
        setSaveStatus('Il nominativo è obbligatorio', true);
        return;
    }

    const payload = collectAnagraficaPayload();
    const btn = document.getElementById('btn-salva-anagrafica');
    if (btn) btn.disabled = true;

    if (!invoke) {
        setSaveStatus('Database non disponibile', true);
        if (btn) btn.disabled = false;
        return;
    }

    try {
        await initSupabase();
        await ensureTipologiaInTable(payload.tipologiasocio);

        if (isNuovoSocioMode) {
            const pendingTesseramenti = [...tesseramentiList];
            const pendingTelefoni = [...telefoniList];
            const pendingEmail = [...emailList];
            const saved = await invoke('create_socio_anagrafica', { anagrafica: payload });
            isNuovoSocioMode = false;
            currentIdsocio = saved.idsocio || payload.idsocio;
            populateAnagrafica(saved);

            const savedTesseramenti = [];
            for (const tess of pendingTesseramenti) {
                await ensureTipologiaInTable(tess.tipologia);
                const tessPayload = {
                    ...tess,
                    idsocio: currentIdsocio
                };
                const savedTess = await invoke('save_tesseramento', { tesseramento: tessPayload });
                savedTesseramenti.push(savedTess);
            }
            tesseramentiList = savedTesseramenti;
            renderStoricoTesseramenti();
            hideTesseramentoEditor();

            const savedTelefoni = [];
            for (const tel of pendingTelefoni) {
                const telPayload = {
                    ...tel,
                    id: null,
                    idsocio: currentIdsocio
                };
                const savedTel = await invoke('save_socio_telefono', { telefono: telPayload });
                savedTelefoni.push(savedTel);
            }
            telefoniList = savedTelefoni;

            const savedEmails = [];
            for (const em of pendingEmail) {
                const emPayload = {
                    ...em,
                    id: null,
                    idsocio: currentIdsocio
                };
                const savedEm = await invoke('save_socio_email', { email: emPayload });
                savedEmails.push(savedEm);
            }
            emailList = savedEmails;
            renderContatti();
            refreshTelefonoPrincipaleField();
            hideTelefonoEditor();
            hideEmailEditor();

            const titleEl = document.querySelector('.page-title');
            if (titleEl) titleEl.textContent = 'ANAGRAFICA SOCIO';

            const subtitle = document.getElementById('socio-subtitle');
            if (subtitle) {
                subtitle.textContent = `ID ${currentIdsocio} · ${saved.nominativo || payload.nominativo}`;
            }

            const extras = [];
            if (savedTesseramenti.length) extras.push(`${savedTesseramenti.length} tesseramento/i`);
            if (savedTelefoni.length) extras.push(`${savedTelefoni.length} telefono/i`);
            if (savedEmails.length) extras.push(`${savedEmails.length} email`);
            const statusMsg = extras.length
                ? `Nuovo socio creato con ${extras.join(', ')}`
                : 'Nuovo socio creato';
            setSaveStatus(statusMsg);
            await notifySocioAnagraficaSaved({
                ...saved,
                telefono: document.getElementById('field-telefono')?.value || saved.telefono || ''
            });
            anagraficaEditSnapshot = null;
            setAnagraficaEditMode(false);
        } else {
            await invoke('save_socio_anagrafica', { anagrafica: payload });
            setSaveStatus('Anagrafica salvata');
            const subtitle = document.getElementById('socio-subtitle');
            if (subtitle) subtitle.textContent = `ID ${payload.idsocio} · ${payload.nominativo}`;
            await notifySocioAnagraficaSaved(payload);
            anagraficaEditSnapshot = null;
            setAnagraficaEditMode(false);
        }
    } catch (error) {
        console.error('Errore salvataggio anagrafica:', error);
        setSaveStatus(`Errore salvataggio: ${error}`, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function notifySocioAnagraficaSaved(payload) {
    if (!isTauri()) return;
    try {
        const { emit } = await import('@tauri-apps/api/event');
        // In elenco soci mostriamo il testo formattato (numero + riferimento)
        const telefonoDisplay = document.getElementById('field-telefono')?.value?.trim()
            || payload.telefono
            || '';
        await emit('socio-anagrafica-saved', { ...payload, telefono: telefonoDisplay });
    } catch (err) {
        console.warn('Notifica aggiornamento elenco soci:', err);
    }
}

async function saveTesseramento(e) {
    if (e) e.preventDefault();
    if (!isAnagraficaEditMode) return;

    const payload = collectTesseramentoPayload();
    if (!payload.anno) {
        setSaveStatus('L\'anno del tesseramento è obbligatorio', true);
        return;
    }

    const duplicato = tesseramentiList.some((t, i) =>
        String(t.anno) === String(payload.anno) &&
        (isNewTesseramento || i !== editingTesseramentoIndex)
    );
    if (duplicato) {
        setSaveStatus(`Esiste già un tesseramento per l'anno ${payload.anno}`, true);
        return;
    }

    const btn = document.getElementById('btn-salva-tess');
    if (btn) btn.disabled = true;

    try {
        await ensureTipologiaInTable(payload.tipologia);

        if (isNuovoSocioMode) {
            const localTess = { ...payload, idsocio: currentIdsocio };
            if (isNewTesseramento) {
                tesseramentiList.push(localTess);
            } else if (editingTesseramentoIndex >= 0) {
                tesseramentiList[editingTesseramentoIndex] = localTess;
            }
            renderStoricoTesseramenti();
            hideTesseramentoEditor();
            setSaveStatus(`Tesseramento ${payload.anno} aggiunto`);
            return;
        }

        if (!invoke) {
            setSaveStatus('Database non disponibile', true);
            return;
        }

        await initSupabase();
        const saved = await invoke('save_tesseramento', { tesseramento: payload });
        if (isNewTesseramento) {
            tesseramentiList.push(saved);
        } else if (editingTesseramentoIndex >= 0) {
            tesseramentiList[editingTesseramentoIndex] = saved;
        }
        renderStoricoTesseramenti();
        hideTesseramentoEditor();
        setSaveStatus(`Tesseramento ${payload.anno} salvato`);
    } catch (error) {
        console.error('Errore salvataggio tesseramento:', error);
        setSaveStatus(`Errore: ${error}`, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('field-operatore')?.addEventListener('change', syncOperatoreDisponibilitaFlags);

    document.getElementById('tess-anno')?.addEventListener('input', (e) => {
        const anno = e.target.value;
        document.getElementById('tess-scadenza').value = scadenzaFromAnno(anno);
    });

    document.getElementById('btn-modifica-anagrafica')?.addEventListener('click', enableAnagraficaEdit);
    document.getElementById('btn-salva-anagrafica')?.addEventListener('click', saveAnagrafica);
    document.getElementById('btn-annulla-anagrafica')?.addEventListener('click', cancelAnagraficaEdit);
    document.getElementById('btn-cerca-filtro')?.addEventListener('click', applyRicercaFiltro);
    document.getElementById('btn-azzera-filtro')?.addEventListener('click', () => {
        clearRicercaForm();
        setSaveStatus('Campi azzerati');
        document.getElementById('field-nominativo')?.focus();
    });
    document.getElementById('form-tesseramento')?.addEventListener('submit', saveTesseramento);

    document.getElementById('btn-nuovo-tesseramento')?.addEventListener('click', () => {
        if (!isAnagraficaEditMode || isRicercaMode) return;
        openTesseramentoEditor(-1, true);
    });

    document.getElementById('btn-annulla-tess')?.addEventListener('click', hideTesseramentoEditor);

    document.getElementById('form-telefono')?.addEventListener('submit', saveTelefono);
    document.getElementById('form-email')?.addEventListener('submit', saveEmail);
    document.getElementById('btn-nuovo-telefono')?.addEventListener('click', () => {
        if (!isAnagraficaEditMode || isRicercaMode) return;
        openTelefonoEditor(-1, true);
    });
    document.getElementById('btn-nuovo-email')?.addEventListener('click', () => {
        if (!isAnagraficaEditMode || isRicercaMode) return;
        openEmailEditor(-1, true);
    });
    document.getElementById('btn-annulla-telefono')?.addEventListener('click', hideTelefonoEditor);
    document.getElementById('btn-annulla-email')?.addEventListener('click', hideEmailEditor);

    document.getElementById('btn-chiudi')?.addEventListener('click', async () => {
        if (isNuovoSocioMode && isAnagraficaEditMode) {
            cancelAnagraficaEdit();
            return;
        }
        await closeAnagraficaWindow();
    });

    // Invio = CERCA in modalità ricerca
    document.getElementById('form-anagrafica')?.addEventListener('keydown', (e) => {
        if (!isRicercaMode) return;
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            applyRicercaFiltro();
        }
    });

    await loadSocioData();
});
