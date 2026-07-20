// Anagrafica Socio — logica maschera
let invoke, appWindow;

let currentIdsocio = '';
let tesseramentiList = [];
let editingTesseramentoIndex = -1;
let isNewTesseramento = false;
let isAnagraficaEditMode = false;
let anagraficaEditSnapshot = null;
let allTipologieSocio = [];
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
            if (win?.label?.startsWith('anagrafica-socio')) {
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
    const parts = ['<option value="">— Scegli tipologia —</option>'];

    options.forEach((value) => {
        parts.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    });
    parts.push('<option value="__custom__">➕ Nuova tipologia…</option>');

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

    if (!editing) {
        hideTesseramentoEditor();
    }

    if (!isRicercaMode) {
        renderStoricoTesseramenti();
    }
    setupTipologiaSocioField(editing);
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
    document.getElementById('field-telefono').value = data.telefono || '';
    document.getElementById('field-tipologiasocio').value = data.tipologiasocio || '';
    document.getElementById('field-operatore').checked = isTruthyFlag(data.operatore);
    document.getElementById('field-attivo').checked = isTruthyFlag(data.attivo);
    document.getElementById('field-archivia').checked = isTruthyFlag(data.archivia);
    document.getElementById('field-nota').value = data.notaaggiuntiva || '';
    setDisponibilitaCheckboxes(parseDisponibilita(data.disponibilita));

    const subtitle = document.getElementById('socio-subtitle');
    if (subtitle) {
        subtitle.textContent = `ID ${data.idsocio || '—'} · ${data.nominativo || 'Socio'}`;
    }
}

function collectAnagraficaPayload() {
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
        telefono: document.getElementById('field-telefono').value.trim(),
        tipologiasocio: document.getElementById('field-tipologiasocio').value.trim(),
        operatore: document.getElementById('field-operatore').checked,
        attivo: document.getElementById('field-attivo').checked,
        archivia: document.getElementById('field-archivia').checked,
        disponibilita: formatDisponibilita(),
        notaaggiuntiva: document.getElementById('field-nota').value.trim()
    };
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
        renderStoricoTesseramenti();

        const subtitle = document.getElementById('socio-subtitle');
        if (subtitle) subtitle.textContent = `Nuovo socio — ID ${nextId}`;

        const titleEl = document.querySelector('.page-title');
        if (titleEl) titleEl.textContent = 'NUOVO SOCIO';

        if (loading) loading.style.display = 'none';
        if (sectionAnag) sectionAnag.style.display = 'block';
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
        renderStoricoTesseramenti();

        if (loading) loading.style.display = 'none';
        if (sectionAnag) sectionAnag.style.display = 'block';
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

function clearRicercaForm() {
    populateAnagrafica(createNuovoSocioTemplate(''));
    document.getElementById('field-operatore').checked = false;
    document.getElementById('field-attivo').checked = false;
    document.getElementById('field-archivia').checked = false;
    setDisponibilitaCheckboxes([]);
    const nominativo = document.getElementById('field-nominativo');
    if (nominativo) nominativo.required = false;
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
    if (sectionTess) sectionTess.style.display = 'none';

    // Hint sotto l'header
    if (main && !document.getElementById('hint-ricerca')) {
        const hint = document.createElement('p');
        hint.id = 'hint-ricerca';
        hint.className = 'anagraficasoci-hint-ricerca';
        hint.textContent = 'Modalità ricerca: i campi compilati filtrano l\'elenco soci (anche corrispondenza parziale). Le caselle spuntate richiedono quel flag.';
        sectionAnag?.parentNode?.insertBefore(hint, sectionAnag);
    }

    setAnagraficaEditMode(true);
    const focusEl = document.getElementById('field-residenza-comune') || document.getElementById('field-nominativo');
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

            const titleEl = document.querySelector('.page-title');
            if (titleEl) titleEl.textContent = 'ANAGRAFICA SOCIO';

            const subtitle = document.getElementById('socio-subtitle');
            if (subtitle) {
                subtitle.textContent = `ID ${currentIdsocio} · ${saved.nominativo || payload.nominativo}`;
            }

            const statusMsg = savedTesseramenti.length
                ? `Nuovo socio creato con ${savedTesseramenti.length} tesseramento/i`
                : 'Nuovo socio creato';
            setSaveStatus(statusMsg);
            await notifySocioAnagraficaSaved(saved);
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
        await emit('socio-anagrafica-saved', payload);
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
