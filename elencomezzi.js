// Elenco Mezzi — logica modulo (tabella Supabase Automezzi_Supa).
// N. MEZZO = IdAutomezzo | N. INTERNO = Numero_Mezzo | COLORE = ColoreMezzo
import {
    initManutenzioneMezzoModal,
    initElencoManutenzioniModal,
    initCompletaManutenzioneModal,
    initModificaManutenzioneModal,
    initScaduteManutenzioniModal
} from './manutenzioni-mezzo.js';
import { etichettaMezzo } from './mezzo-etichetta.js';

let invoke;
let manutenzioneModal = null;
let elencoManutenzioniModal = null;
let completaManutenzioneModal = null;
let modificaManutenzioneModal = null;
let scaduteManutenzioniModal = null;

async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        invoke = tauriModule.invoke;
        return true;
    } catch (error) {
        console.error('Errore nel caricamento API Tauri:', error);
        return false;
    }
}

function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

let allMezzi = [];
let editingMezzoId = null;
let mezzoEditSnapshot = null;
let allDotazioni = [];
let nuovoMezzoModalOpen = false;
/** IdAutomezzo in attesa di conferma eliminazione */
let mezzoDaEliminareId = null;
/** IdAutomezzo → chilometraggio di arrivo più alto trovato nei servizi */
let ultimiKmPerMezzo = {};
/** IdAutomezzo (stringa) con almeno una manutenzione aperta / non completata */
let idMezziManutAperte = new Set();

/** Numero mostrato in "N. MEZZO": è IdAutomezzo (il campo id del mezzo). */
function numeroMezzoVisibile(mezzo) {
    const id = parseInt(mezzo?.id, 10);
    if (!Number.isNaN(id) && id > 0) return String(id);
    return '';
}

function suggestNextNumeroMezzo() {
    const numbers = allMezzi
        .map((m) => parseInt(numeroMezzoVisibile(m), 10))
        .filter((n) => !Number.isNaN(n) && n > 0);
    if (!numbers.length) return '1';
    return String(Math.max(...numbers) + 1);
}

function createEmptyMezzoTemplate() {
    return {
        id: 0,
        id_display: suggestNextNumeroMezzo(),
        nr_automezzo: '',
        colore_mezzo: '',
        marca: '',
        modello: '',
        targa: '',
        dotazione: '',
        scadenza_ztl: '',
        scadenza_assicurazione: '',
        scadenza_bollo: '',
        in_servizio: 'true',
        note_mezzo: ''
    };
}

function updateNuovoMezzoButtonState() {
    const btn = document.getElementById('btn-nuovo-mezzo');
    if (!btn) return;
    btn.disabled = editingMezzoId != null || nuovoMezzoModalOpen;
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
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' ||
        s === 'YES' || s === 'Y' || s === 'ATTIVO' || s === 'IN SERVIZIO';
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

function isScadenzaScaduta(dateStr) {
    const scadenza = parseItalianDate(dateStr);
    if (!scadenza) return false;
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return scadenza < oggi;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function sortByNumeroMezzo(list) {
    return [...list].sort((a, b) => {
        const na = parseInt(numeroMezzoVisibile(a), 10);
        const nb = parseInt(numeroMezzoVisibile(b), 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
            return na - nb;
        }
        return numeroMezzoVisibile(a).localeCompare(numeroMezzoVisibile(b), 'it', { numeric: true });
    });
}

function dotazioneGiaPresente(value) {
    const d = normalizeFieldValue(value);
    if (!d) return false;
    return allDotazioni.some(
        (s) => s.localeCompare(d, 'it', { sensitivity: 'base' }) === 0
    );
}

function sortDotazioni(list) {
    return [...list].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

function getDotazioniSelectOptions(currentValue = '') {
    const set = new Set(allDotazioni);
    const current = normalizeFieldValue(currentValue);
    if (current) set.add(current);
    return sortDotazioni([...set]);
}

async function loadDotazioniMezzi() {
    if (!isTauri() || !invoke) {
        allDotazioni = sortDotazioni(
            allMezzi
                .map((m) => normalizeFieldValue(m.dotazione))
                .filter(Boolean)
        );
        refreshDotazioneSelectInEditMode();
        return;
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_all_dotazioni_mezzi');
        allDotazioni = Array.isArray(list)
            ? sortDotazioni(list.map((v) => normalizeFieldValue(v)).filter(Boolean))
            : [];
    } catch (error) {
        console.error('Errore caricamento dotazioni mezzi:', error);
    }

    refreshDotazioneSelectInEditMode();
}

function refreshDotazioneSelectInEditMode() {
    if (editingMezzoId != null) {
        const block = document.querySelector(`.mezzo-block[data-mezzo-id="${editingMezzoId}"]`);
        if (block?.classList.contains('mode-editing')) {
            setupDotazioneField(block, true);
        }
    }

    if (nuovoMezzoModalOpen) {
        const form = document.getElementById('form-nuovo-mezzo');
        if (form) setupDotazioneField(form, true);
    }
}

function populateDotazioneSelect(select, currentValue) {
    const options = getDotazioniSelectOptions(currentValue);
    const parts = ['<option value="">— Scegli dotazione —</option>'];

    options.forEach((value) => {
        parts.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    });
    parts.push('<option value="__custom__">➕ Nuova dotazione…</option>');

    select.innerHTML = parts.join('');
}

function findDotazioneOptionValue(options, currentValue) {
    const current = normalizeFieldValue(currentValue);
    if (!current) return '';
    return options.find(
        (option) => option.localeCompare(current, 'it', { sensitivity: 'base' }) === 0
    ) || '';
}

function syncDotazioneSelectAndInput(select, input) {
    const options = getDotazioniSelectOptions(input.value);
    const current = normalizeFieldValue(input.value);
    const matchingOption = findDotazioneOptionValue(options, current);

    if (!current) {
        select.value = '';
        input.value = '';
        input.classList.add('dotazione-input-hidden');
        input.readOnly = true;
    } else if (matchingOption) {
        select.value = matchingOption;
        input.value = matchingOption;
        input.classList.add('dotazione-input-hidden');
        input.readOnly = true;
    } else {
        select.value = '__custom__';
        input.classList.remove('dotazione-input-hidden');
        input.readOnly = false;
    }
}

function teardownDotazioneEditControls(block) {
    const select = block?.querySelector('[data-dotazione-select]');
    const input = block?.querySelector('[data-field="dotazione"]');

    if (select) {
        select.onchange = null;
        select.remove();
    }

    if (input) {
        input.oninput = null;
        input.classList.remove('dotazione-input-hidden', 'dotazione-input-custom-visible');
        input.readOnly = true;
    }
}

async function ensureDotazioneInTable(dotazione, block = null) {
    const d = normalizeFieldValue(dotazione);
    if (!d) return;

    if (dotazioneGiaPresente(d)) return;

    if (isTauri() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('add_dotazione_mezzo', { dotazione: d });
            allDotazioni = sortDotazioni([...allDotazioni, d]);
            refreshDotazioneSelectInEditMode();
        } catch (error) {
            console.error('Errore aggiunta dotazione in Supabase:', error);
            if (block) {
                setBlockStatus(block, `Dotazione non salvata in elenco: ${error}`, true);
            }
        }
    } else {
        allDotazioni = sortDotazioni([...allDotazioni, d]);
        refreshDotazioneSelectInEditMode();
    }
}

function setupDotazioneField(block, editing) {
    const group = block?.querySelector('.mezzo-form-group-dotazione');
    const input = block?.querySelector('[data-field="dotazione"]');
    if (!group || !input) return;

    if (!editing) {
        teardownDotazioneEditControls(block);
        input.removeAttribute('placeholder');
        input.removeAttribute('title');
        return;
    }

    let select = block.querySelector('[data-dotazione-select]');
    if (!select) {
        select = document.createElement('select');
        select.className = 'dotazione-select';
        select.dataset.dotazioneSelect = '1';
        group.insertBefore(select, input);
    }

    populateDotazioneSelect(select, input.value);
    syncDotazioneSelectAndInput(select, input);

    select.onchange = () => {
        if (select.value === '__custom__') {
            input.classList.remove('dotazione-input-hidden');
            input.classList.add('dotazione-input-custom-visible');
            input.readOnly = false;
            if (findDotazioneOptionValue(getDotazioniSelectOptions(''), input.value)) {
                input.value = '';
            }
            input.focus();
            return;
        }

        input.classList.add('dotazione-input-hidden');
        input.classList.remove('dotazione-input-custom-visible');
        input.readOnly = true;
        input.value = select.value;
    };

    input.oninput = () => {
        if (select.value === '__custom__') {
            input.readOnly = false;
        }
    };
}

function updateMezziCount(count) {
    const el = document.getElementById('mezzi-count');
    if (el) el.textContent = `(${count})`;
}

function chiaveMezzoKm(mezzoOrId) {
    const raw = mezzoOrId && typeof mezzoOrId === 'object'
        ? (mezzoOrId.id ?? mezzoOrId.nr_automezzo ?? '')
        : mezzoOrId;
    const s = String(raw ?? '').trim();
    if (!s) return '';
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function formatUltimoKm(value) {
    if (value === null || value === undefined || value === '') return '';
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n));
}

function ultimoKmDiMezzo(mezzo) {
    const key = chiaveMezzoKm(mezzo);
    if (!key) return '';
    return formatUltimoKm(ultimiKmPerMezzo[key]);
}

async function loadUltimiKmMezzi() {
    ultimiKmPerMezzo = {};
    if (!isTauri() || !invoke) return;

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_ultimi_km_mezzi');
        if (!Array.isArray(list)) return;
        list.forEach((item) => {
            const key = chiaveMezzoKm(item?.mezzo);
            const km = Number(item?.km);
            if (key && Number.isFinite(km) && km > 0) {
                ultimiKmPerMezzo[key] = km;
            }
        });
    } catch (error) {
        console.error('Errore caricamento ultimi km mezzi:', error);
    }
}

async function loadManutenzioniAperteMezzi() {
    idMezziManutAperte = new Set();
    if (!isTauri() || !invoke) return;
    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const ids = await invoke('get_id_mezzi_manutenzioni_aperte');
        (Array.isArray(ids) ? ids : []).forEach((id) => {
            const n = Number(id);
            if (Number.isFinite(n) && n > 0) idMezziManutAperte.add(String(n));
        });
    } catch (error) {
        console.error('Errore caricamento manutenzioni aperte:', error);
    }
}

function mezzoHaManutenzioneAperta(mezzo) {
    const id = Number(mezzo?.id);
    if (!Number.isFinite(id) || id <= 0) return false;
    return idMezziManutAperte.has(String(id));
}

function htmlAvvisoManutAperta(mezzo) {
    if (!mezzoHaManutenzioneAperta(mezzo)) return '';
    return `
        <button type="button"
            class="btn-mezzo-icon mezzo-manut-alert"
            title="Manutenzioni aperte da completare — clicca per vedere"
            aria-label="Avviso: manutenzioni aperte da completare">
            <svg class="mezzo-btn-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 2L1 21h22L12 2z"/>
                <path fill="#fff" d="M11 10h2v6h-2zm0 7h2v2h-2z"/>
            </svg>
        </button>
    `;
}

/** Aggiorna solo le icone avviso senza rifare tutta la lista. */
async function refreshAvvisiManutenzioniAperte() {
    await loadManutenzioniAperteMezzi();
    document.querySelectorAll('.mezzo-block').forEach((block) => {
        const id = String(block.dataset.mezzoId || '');
        const ha = idMezziManutAperte.has(id);
        let btn = block.querySelector('.mezzo-manut-alert');
        const actions = block.querySelector('.mezzo-block-actions');
        if (ha && !btn && actions) {
            actions.insertAdjacentHTML('afterbegin', htmlAvvisoManutAperta({ id }));
        } else if (!ha && btn) {
            btn.remove();
        }
    });
}

function updateMezzoInCache(data) {
    const index = allMezzi.findIndex(m => String(m.id) === String(data.id));
    if (index >= 0) {
        allMezzi[index] = { ...allMezzi[index], ...data };
    }
}

function scadenzaFieldHtml(label, fieldName, value) {
    const scaduta = isScadenzaScaduta(value);
    return `
        <div class="mezzo-form-group mezzo-form-group-scadenza scadenza-field${scaduta ? ' scadenza-scaduta' : ''}" data-scadenza-group>
            <label>${label}</label>
            <input type="text" data-field="${fieldName}" value="${escapeHtml(value || '')}" readonly placeholder="gg/mm/aaaa">
            <span class="scadenza-warning">SCADUTA!</span>
        </div>
    `;
}

/** Icone SVG per azioni riga mezzo (più compatte dei pulsanti testo). */
function iconaMezzoSvg(nome) {
    const common = 'class="mezzo-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    if (nome === 'modifica') {
        return `<svg ${common}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
    }
    if (nome === 'nuova-manut') {
        return `<svg ${common}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    }
    if (nome === 'vedi-manut') {
        return `<svg ${common}><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`;
    }
    if (nome === 'salva') {
        return `<svg ${common}><path d="M20 6 9 17l-5-5"/></svg>`;
    }
    if (nome === 'elimina') {
        return `<svg ${common}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    }
    if (nome === 'annulla') {
        return `<svg ${common}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    }
    if (nome === 'fogli') {
        return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>`;
    }
    if (nome === 'rifornimenti') {
        return `<svg ${common}><path d="M3 22h12"/><path d="M4 22V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M14 10h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9l-3-3"/><path d="M7 8h4"/></svg>`;
    }
    return '';
}

function createMezzoBlock(mezzo) {
    const inServizio = isTruthyFlag(mezzo.in_servizio);
    const block = document.createElement('div');
    block.className = 'mezzo-block mode-readonly' + (inServizio ? '' : ' fuori-servizio');
    block.dataset.mezzoId = mezzo.id || '';

    block.innerHTML = `
        <div class="mezzo-form-sections">
            <div class="mezzo-form-row mezzo-form-row-principale">
                <div class="mezzo-form-group mezzo-form-group-nr">
                    <label>N. MEZZO</label>
                    <input type="text" data-field="id_display" value="${escapeHtml(numeroMezzoVisibile(mezzo))}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-nr-interno">
                    <label>N. INTERNO</label>
                    <input type="text" data-field="nr_automezzo" value="${escapeHtml(mezzo.nr_automezzo || '')}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-colore">
                    <label>COLORE</label>
                    <input type="text" data-field="colore_mezzo" value="${escapeHtml(mezzo.colore_mezzo || '')}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-marca">
                    <label>MARCA</label>
                    <input type="text" data-field="marca" value="${escapeHtml(mezzo.marca || '')}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-modello">
                    <label>MODELLO</label>
                    <input type="text" data-field="modello" value="${escapeHtml(mezzo.modello || '')}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-targa">
                    <label>TARGA</label>
                    <input type="text" data-field="targa" value="${escapeHtml(mezzo.targa || '')}" readonly>
                </div>
                <div class="mezzo-form-group mezzo-form-group-dotazione">
                    <label>DOTAZ.</label>
                    <input type="text" data-field="dotazione" value="${escapeHtml(mezzo.dotazione || '')}" readonly>
                </div>
                ${scadenzaFieldHtml('SCAD. ZTL', 'scadenza_ztl', mezzo.scadenza_ztl)}
                ${scadenzaFieldHtml('SCAD. ASSIC.', 'scadenza_assicurazione', mezzo.scadenza_assicurazione)}
                <div class="mezzo-form-group mezzo-form-group-inservizio">
                    <label>IN SERV.</label>
                    <div class="mezzo-checkbox-container">
                        <input type="checkbox" data-field="in_servizio" ${inServizio ? 'checked' : ''} disabled>
                    </div>
                </div>
                <div class="mezzo-form-group mezzo-form-group-ultimo-km">
                    <label>ULTIMO KM</label>
                    <input type="text" data-field="ultimo_km" value="${escapeHtml(ultimoKmDiMezzo(mezzo))}" readonly title="Chilometri di arrivo dell'ultimo servizio di questo mezzo">
                </div>
                <div class="mezzo-form-group mezzo-form-group-actions">
                    <div class="mezzo-block-actions">
                        ${htmlAvvisoManutAperta(mezzo)}
                        <button type="button" class="btn-mezzo-icon btn-mezzo-modifica" title="Modifica" aria-label="Modifica">${iconaMezzoSvg('modifica')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-manutenzione" title="Nuova manutenzione" aria-label="Nuova manutenzione">${iconaMezzoSvg('nuova-manut')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-vedi-manutenzioni" title="Vedi manutenzioni" aria-label="Vedi manutenzioni">${iconaMezzoSvg('vedi-manut')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-fogli" title="Fogli di viaggio" aria-label="Fogli di viaggio">${iconaMezzoSvg('fogli')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-rifornimenti" title="Rifornimenti" aria-label="Rifornimenti">${iconaMezzoSvg('rifornimenti')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-salva" title="Salva" aria-label="Salva" hidden>${iconaMezzoSvg('salva')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-elimina" title="Elimina" aria-label="Elimina" hidden>${iconaMezzoSvg('elimina')}</button>
                        <button type="button" class="btn-mezzo-icon btn-mezzo-annulla" title="Annulla" aria-label="Annulla" hidden>${iconaMezzoSvg('annulla')}</button>
                    </div>
                    <span class="mezzo-block-status" aria-live="polite"></span>
                </div>
            </div>
            <div class="mezzo-form-row mezzo-form-row-nota">
                <div class="mezzo-form-group mezzo-form-group-nota">
                    <label>NOTE</label>
                    <textarea data-field="note_mezzo" readonly>${escapeHtml(mezzo.note_mezzo || '')}</textarea>
                </div>
            </div>
        </div>
    `;

    return block;
}

function setFieldEditable(el, editable) {
    if (!el) return;
    if (el.type === 'checkbox') {
        el.disabled = !editable;
    } else if (el.tagName === 'TEXTAREA') {
        el.readOnly = !editable;
    } else {
        el.readOnly = !editable;
    }
}

function setMezzoBlockEditMode(block, editing) {
    if (!block) return;

    block.classList.toggle('mode-readonly', !editing);
    block.classList.toggle('mode-editing', editing);

    block.querySelectorAll('[data-field]').forEach((el) => {
        // N. MEZZO (IdAutomezzo) non si cambia: i servizi lo usano come riferimento.
        // ULTIMO KM arriva dai servizi: solo lettura.
        if (el.dataset.field === 'id_display' || el.dataset.field === 'ultimo_km') {
            setFieldEditable(el, false);
            return;
        }
        setFieldEditable(el, editing);
    });

    const btnModifica = block.querySelector('.btn-mezzo-modifica');
    const btnManut = block.querySelector('.btn-mezzo-manutenzione');
    const btnVediManut = block.querySelector('.btn-mezzo-vedi-manutenzioni');
    const btnFogli = block.querySelector('.btn-mezzo-fogli');
    const btnRifornimenti = block.querySelector('.btn-mezzo-rifornimenti');
    const btnSalva = block.querySelector('.btn-mezzo-salva');
    const btnElimina = block.querySelector('.btn-mezzo-elimina');
    const btnAnnulla = block.querySelector('.btn-mezzo-annulla');
    if (btnModifica) btnModifica.hidden = editing;
    if (btnManut) btnManut.hidden = editing;
    if (btnVediManut) btnVediManut.hidden = editing;
    if (btnFogli) btnFogli.hidden = editing;
    if (btnRifornimenti) btnRifornimenti.hidden = editing;
    if (btnSalva) btnSalva.hidden = !editing;
    if (btnElimina) btnElimina.hidden = !editing;
    if (btnAnnulla) btnAnnulla.hidden = !editing;

    setupDotazioneField(block, editing);

    if (editing) {
        block.querySelector('[data-field="nr_automezzo"]')?.focus();
    } else {
        const status = block.querySelector('.mezzo-block-status');
        if (status) status.textContent = '';
    }

    updateNuovoMezzoButtonState();
}

function collectMezzoFromRoot(root, id = 0) {
    const getVal = (name) => root.querySelector(`[data-field="${name}"]`)?.value?.trim() ?? '';
    const inServizioEl = root.querySelector('[data-field="in_servizio"]');
    const idDisplay = getVal('id_display');
    const idFromDisplay = parseInt(idDisplay, 10);
    const resolvedId = id > 0
        ? id
        : (!Number.isNaN(idFromDisplay) && idFromDisplay > 0 ? idFromDisplay : 0);

    return {
        id: resolvedId,
        nr_automezzo: getVal('nr_automezzo'),
        colore_mezzo: getVal('colore_mezzo'),
        marca: getVal('marca'),
        modello: getVal('modello'),
        targa: getVal('targa').toUpperCase(),
        dotazione: getVal('dotazione'),
        scadenza_ztl: getVal('scadenza_ztl'),
        scadenza_assicurazione: getVal('scadenza_assicurazione'),
        scadenza_bollo: getVal('scadenza_bollo'),
        in_servizio: inServizioEl?.checked ? 'true' : 'false',
        note_mezzo: root.querySelector('[data-field="note_mezzo"]')?.value?.trim() ?? ''
    };
}

function collectMezzoFromBlock(block) {
    const id = parseInt(block.dataset.mezzoId, 10) || 0;
    const data = collectMezzoFromRoot(block, id);
    const cached = allMezzi.find((m) => String(m.id) === String(id));
    if (cached) {
        // Scadenza bollo non è più in UI: non azzerarla in salvataggio.
        data.scadenza_bollo = cached.scadenza_bollo || '';
    }
    return data;
}

function applyFieldsToRoot(root, data) {
    Object.entries({
        id_display: data.id_display || numeroMezzoVisibile(data),
        nr_automezzo: data.nr_automezzo,
        colore_mezzo: data.colore_mezzo,
        marca: data.marca,
        modello: data.modello,
        targa: data.targa,
        dotazione: data.dotazione,
        scadenza_ztl: data.scadenza_ztl,
        scadenza_assicurazione: data.scadenza_assicurazione,
        scadenza_bollo: data.scadenza_bollo,
        note_mezzo: data.note_mezzo,
        ultimo_km: data.ultimo_km != null ? data.ultimo_km : ultimoKmDiMezzo(data)
    }).forEach(([field, value]) => {
        const el = root.querySelector(`[data-field="${field}"]`);
        if (el) el.value = value || '';
    });

    const chk = root.querySelector('[data-field="in_servizio"]');
    if (chk) chk.checked = isTruthyFlag(data.in_servizio);
}

function applyMezzoDataToBlock(block, data) {
    applyFieldsToRoot(block, data);

    block.classList.toggle('fuori-servizio', !isTruthyFlag(data.in_servizio));

    block.querySelectorAll('[data-scadenza-group]').forEach((group) => {
        const input = group.querySelector('input[data-field]');
        const scaduta = isScadenzaScaduta(input?.value || '');
        group.classList.toggle('scadenza-scaduta', scaduta);
    });
}

function setBlockStatus(block, message, isError = false) {
    const el = block.querySelector('.mezzo-block-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    if (message && !isError) {
        setTimeout(() => {
            if (el.textContent === message) el.textContent = '';
        }, 3000);
    }
}

function exitMezzoEditMode(restoreSnapshot = false) {
    if (editingMezzoId == null) return;

    const block = document.querySelector(`.mezzo-block[data-mezzo-id="${editingMezzoId}"]`);
    if (block && restoreSnapshot && mezzoEditSnapshot) {
        applyMezzoDataToBlock(block, mezzoEditSnapshot);
    }

    if (block) setMezzoBlockEditMode(block, false);

    editingMezzoId = null;
    mezzoEditSnapshot = null;
    updateNuovoMezzoButtonState();
}

function enableMezzoEdit(block) {
    if (!block) return;

    if (editingMezzoId != null && String(editingMezzoId) !== String(block.dataset.mezzoId)) {
        exitMezzoEditMode(true);
    }

    mezzoEditSnapshot = collectMezzoFromBlock(block);
    editingMezzoId = block.dataset.mezzoId;
    setMezzoBlockEditMode(block, true);
}

async function saveMezzoBlock(block) {
    if (!block || !block.classList.contains('mode-editing')) return;

    const payload = collectMezzoFromBlock(block);
    if (!payload.id) {
        setBlockStatus(block, 'N. mezzo non valido', true);
        return;
    }

    const btnSalva = block.querySelector('.btn-mezzo-salva');
    if (btnSalva) btnSalva.disabled = true;

    try {
        if (isTauri() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('save_automezzo', { automezzo: payload });
        }

        updateMezzoInCache(payload);
        allMezzi = sortByNumeroMezzo(allMezzi);
        await ensureDotazioneInTable(payload.dotazione, block);
        applyMezzoDataToBlock(block, payload);
        editingMezzoId = null;
        mezzoEditSnapshot = null;
        setMezzoBlockEditMode(block, false);
        setBlockStatus(block, 'Salvato');
    } catch (error) {
        console.error('Errore salvataggio mezzo:', error);
        setBlockStatus(block, `Errore: ${error}`, true);
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

function chiudiDialogEliminaMezzo() {
    const overlay = document.getElementById('mezzi-dialog-elimina');
    if (overlay) {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
    }
    mezzoDaEliminareId = null;
    const btnSi = document.getElementById('mezzi-dialog-elimina-si');
    const btnNo = document.getElementById('mezzi-dialog-elimina-no');
    if (btnSi) btnSi.disabled = false;
    if (btnNo) btnNo.disabled = false;
}

function apriDialogEliminaMezzo(block) {
    if (!block) return;
    const id = parseInt(block.dataset.mezzoId, 10) || 0;
    if (!id) {
        setBlockStatus(block, 'ID mezzo non valido', true);
        return;
    }

    const nr = block.querySelector('[data-field="id_display"]')?.value?.trim() || '';
    const nrInterno = block.querySelector('[data-field="nr_automezzo"]')?.value?.trim() || '';
    const colore = block.querySelector('[data-field="colore_mezzo"]')?.value?.trim() || '';
    const marca = block.querySelector('[data-field="marca"]')?.value?.trim() || '';
    const modello = block.querySelector('[data-field="modello"]')?.value?.trim() || '';
    const targa = block.querySelector('[data-field="targa"]')?.value?.trim() || '';
    const etichetta = [nr && `N. ${nr}`, nrInterno, colore, marca, modello, targa && `(${targa})`]
        .filter(Boolean)
        .join(' ');

    mezzoDaEliminareId = id;
    const msgEl = document.getElementById('mezzi-dialog-elimina-messaggio');
    if (msgEl) {
        msgEl.textContent = etichetta
            ? `Eliminare il mezzo ${etichetta}?\n\nL'operazione non si può annullare.`
            : 'Eliminare questo mezzo?\n\nL\'operazione non si può annullare.';
    }

    const overlay = document.getElementById('mezzi-dialog-elimina');
    if (!overlay) return;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('mezzi-dialog-elimina-no')?.focus();
}

async function confermaEliminaMezzo() {
    const id = mezzoDaEliminareId;
    if (!id) {
        chiudiDialogEliminaMezzo();
        return;
    }

    const block = document.querySelector(`.mezzo-block[data-mezzo-id="${id}"]`);
    const btnSi = document.getElementById('mezzi-dialog-elimina-si');
    const btnNo = document.getElementById('mezzi-dialog-elimina-no');
    if (btnSi) btnSi.disabled = true;
    if (btnNo) btnNo.disabled = true;

    try {
        if (isTauri() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('delete_automezzo', { idAutomezzo: id });
        }

        allMezzi = allMezzi.filter((m) => String(m.id) !== String(id));
        if (String(editingMezzoId) === String(id)) {
            editingMezzoId = null;
            mezzoEditSnapshot = null;
        }
        chiudiDialogEliminaMezzo();
        refreshMezziListView();
        updateNuovoMezzoButtonState();
    } catch (error) {
        console.error('Errore eliminazione mezzo:', error);
        chiudiDialogEliminaMezzo();
        if (block) {
            setBlockStatus(block, `Errore eliminazione: ${error}`, true);
        } else {
            window.alert(`Impossibile eliminare il mezzo:\n${error}`);
        }
    }
}

function bindDialogEliminaMezzoEvents() {
    document.getElementById('mezzi-dialog-elimina-si')?.addEventListener('click', confermaEliminaMezzo);
    document.getElementById('mezzi-dialog-elimina-no')?.addEventListener('click', chiudiDialogEliminaMezzo);

    const overlay = document.getElementById('mezzi-dialog-elimina');
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) chiudiDialogEliminaMezzo();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const dialog = document.getElementById('mezzi-dialog-elimina');
        if (dialog && !dialog.hidden) {
            e.preventDefault();
            e.stopImmediatePropagation();
            chiudiDialogEliminaMezzo();
        }
    }, true);
}

function setModalStatus(message, isError = false) {
    const el = document.getElementById('modal-nuovo-mezzo-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
}

function resetNuovoMezzoForm() {
    const form = document.getElementById('form-nuovo-mezzo');
    if (!form) return;

    teardownDotazioneEditControls(form);
    applyFieldsToRoot(form, createEmptyMezzoTemplate());
    setModalStatus('');
}

function openNuovoMezzoModal() {
    if (editingMezzoId != null) {
        window.alert('Termina la modifica in corso prima di aggiungere un nuovo mezzo.');
        return;
    }

    resetNuovoMezzoForm();

    const modal = document.getElementById('modal-nuovo-mezzo');
    if (!modal) return;

    nuovoMezzoModalOpen = true;
    modal.hidden = false;
    updateNuovoMezzoButtonState();
    setupDotazioneField(document.getElementById('form-nuovo-mezzo'), true);
    document.getElementById('modal-id-display')?.focus();
}

function closeNuovoMezzoModal() {
    const modal = document.getElementById('modal-nuovo-mezzo');
    const form = document.getElementById('form-nuovo-mezzo');
    if (!modal) return;

    modal.hidden = true;
    nuovoMezzoModalOpen = false;
    if (form) teardownDotazioneEditControls(form);
    setModalStatus('');
    updateNuovoMezzoButtonState();
}

function annullaNuovoMezzoModal() {
    if (!window.confirm('Confermi di annullare l\'inserimento del nuovo mezzo?')) {
        return;
    }
    closeNuovoMezzoModal();
}

function refreshMezziListView() {
    const containerBody = document.getElementById('mezzi-container-body');
    const searchInput = document.getElementById('search-input');
    if (!containerBody) return;

    const filtered = filterMezziBySearch(searchInput?.value || '');
    updateMezziCount(filtered.length);
    populateListaMezzi(filtered);

    if (filtered.length === 0 && searchInput?.value.trim()) {
        containerBody.innerHTML =
            `<div class="mezzi-lista-empty">Nessun mezzo trovato per: "${escapeHtml(searchInput.value.trim())}"</div>`;
    } else if (filtered.length === 0) {
        containerBody.innerHTML = '<div class="mezzi-lista-empty">Nessun mezzo trovato</div>';
    }
}

async function saveNuovoMezzoModal() {
    const form = document.getElementById('form-nuovo-mezzo');
    if (!form) return;

    const payload = collectMezzoFromRoot(form, 0);
    if (!payload.id || payload.id <= 0) {
        setModalStatus('N. mezzo: scrivi un numero intero maggiore di zero', true);
        return;
    }

    const btnSalva = document.getElementById('btn-modal-nuovo-salva');
    if (btnSalva) btnSalva.disabled = true;

    try {
        let saved = payload;

        if (isTauri() && invoke) {
            await invoke('init_supabase_from_config').catch(() => {});
            saved = await invoke('create_automezzo', { automezzo: payload });
        } else {
            saved = {
                ...payload,
                id: allMezzi.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1
            };
        }

        allMezzi.push(saved);
        allMezzi = sortByNumeroMezzo(allMezzi);
        await ensureDotazioneInTable(saved.dotazione);
        closeNuovoMezzoModal();
        refreshMezziListView();
    } catch (error) {
        console.error('Errore creazione mezzo:', error);
        setModalStatus(`Errore: ${error}`, true);
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

function bindNuovoMezzoModalEvents() {
    document.getElementById('btn-nuovo-mezzo')?.addEventListener('click', openNuovoMezzoModal);
    document.getElementById('btn-viaggi')?.addEventListener('click', () => {
        apriFogliDiViaggio(null);
    });
    document.getElementById('btn-rifornimenti')?.addEventListener('click', () => {
        apriRifornimenti(null);
    });
    document.getElementById('btn-modal-nuovo-salva')?.addEventListener('click', saveNuovoMezzoModal);
    document.getElementById('btn-modal-nuovo-annulla')?.addEventListener('click', annullaNuovoMezzoModal);
    document.getElementById('btn-modal-nuovo-close')?.addEventListener('click', annullaNuovoMezzoModal);

    const modal = document.getElementById('modal-nuovo-mezzo');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) annullaNuovoMezzoModal();
    });

    document.addEventListener('keydown', (e) => {
        if (!nuovoMezzoModalOpen || e.key !== 'Escape') return;
        e.preventDefault();
        annullaNuovoMezzoModal();
    });

    document.getElementById('form-nuovo-mezzo')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveNuovoMezzoModal();
    });
}

function populateListaMezzi(mezzi) {
    const containerBody = document.getElementById('mezzi-container-body');
    if (!containerBody) return;

    const previousEditingId = editingMezzoId;
    containerBody.innerHTML = '';

    if (!mezzi.length) {
        editingMezzoId = null;
        mezzoEditSnapshot = null;
        containerBody.innerHTML = '<div class="mezzi-lista-empty">Nessun mezzo trovato</div>';
        return;
    }

    mezzi.forEach((mezzo) => {
        containerBody.appendChild(createMezzoBlock(mezzo));
    });

    if (previousEditingId != null) {
        const block = containerBody.querySelector(`.mezzo-block[data-mezzo-id="${previousEditingId}"]`);
        if (block && mezzoEditSnapshot) {
            editingMezzoId = previousEditingId;
            applyMezzoDataToBlock(block, mezzoEditSnapshot);
            setMezzoBlockEditMode(block, true);
        } else {
            editingMezzoId = null;
            mezzoEditSnapshot = null;
        }
    }

    updateNuovoMezzoButtonState();
}

async function apriFogliDiViaggio(mezzo) {
    const id = String(mezzo?.id ?? '').trim();
    const haMezzo = Boolean(id) && id !== '0';
    let url = 'FOGLIDIVIAGGIO.html';
    let titolo = 'Fogli di viaggio';
    if (haMezzo) {
        const etichetta = etichettaMezzo(mezzo);
        const qs = new URLSearchParams({ mezzo: id });
        if (etichetta) qs.set('etichetta', etichetta);
        url = `FOGLIDIVIAGGIO.html?${qs.toString()}`;
        titolo = etichetta ? `Fogli di viaggio — ${etichetta}` : 'Fogli di viaggio';
    }

    if (isTauri()) {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const label = 'fogli-di-viaggio';
            const existing = WebviewWindow.getByLabel(label);
            if (existing) {
                try { await existing.close(); } catch (_) { /* finestra già chiusa */ }
                await new Promise((r) => setTimeout(r, 150));
            }
            const webview = new WebviewWindow(label, {
                url,
                title: titolo,
                width: 1280,
                height: 800,
                resizable: true,
                maximized: true,
                decorations: true,
                center: true
            });
            webview.once('tauri://created', () => {
                webview.maximize().catch((err) => console.warn('maximize fogli di viaggio:', err));
            });
            webview.setFocus().catch((err) => console.warn('setFocus fogli di viaggio:', err));
            return;
        } catch (error) {
            console.error('Errore apertura fogli di viaggio:', error);
        }
    }
    const larghezza = window.screen?.availWidth || 1280;
    const altezza = window.screen?.availHeight || 800;
    window.open(url, 'fogli-di-viaggio', `width=${larghezza},height=${altezza},left=0,top=0`);
}

async function apriFinestraElenco(url, titolo, label) {
    if (isTauri()) {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const existing = WebviewWindow.getByLabel(label);
            if (existing) {
                try { await existing.close(); } catch (_) { /* finestra già chiusa */ }
                await new Promise((r) => setTimeout(r, 150));
            }
            const webview = new WebviewWindow(label, {
                url,
                title: titolo,
                width: 1280,
                height: 800,
                resizable: true,
                maximized: true,
                decorations: true,
                center: true
            });
            webview.once('tauri://created', () => {
                webview.maximize().catch((err) => console.warn(`maximize ${label}:`, err));
            });
            webview.setFocus().catch((err) => console.warn(`setFocus ${label}:`, err));
            return;
        } catch (error) {
            console.error(`Errore apertura ${label}:`, error);
        }
    }
    const larghezza = window.screen?.availWidth || 1280;
    const altezza = window.screen?.availHeight || 800;
    window.open(url, label, `width=${larghezza},height=${altezza},left=0,top=0`);
}

async function apriRifornimenti(mezzo) {
    const id = String(mezzo?.id ?? '').trim();
    const haMezzo = Boolean(id) && id !== '0';
    let url = 'RIFORNIMENTI.html';
    let titolo = 'Rifornimenti';
    if (haMezzo) {
        const etichetta = etichettaMezzo(mezzo);
        const qs = new URLSearchParams({ mezzo: id });
        if (etichetta) qs.set('etichetta', etichetta);
        url = `RIFORNIMENTI.html?${qs.toString()}`;
        titolo = etichetta ? `Rifornimenti — ${etichetta}` : 'Rifornimenti';
    }
    await apriFinestraElenco(url, titolo, 'rifornimenti');
}

function bindMezzoContainerEvents() {
    const containerBody = document.getElementById('mezzi-container-body');
    if (!containerBody || containerBody.dataset.bound === '1') return;
    containerBody.dataset.bound = '1';

    containerBody.addEventListener('click', (e) => {
        const block = e.target.closest('.mezzo-block');
        if (!block) return;

        if (e.target.closest('.btn-mezzo-modifica')) {
            enableMezzoEdit(block);
        } else if (e.target.closest('.btn-mezzo-manutenzione')) {
            const id = parseInt(block.dataset.mezzoId, 10) || 0;
            const mezzo = allMezzi.find((m) => String(m.id) === String(id));
            if (mezzo) manutenzioneModal?.open(mezzo);
        } else if (e.target.closest('.btn-mezzo-vedi-manutenzioni') || e.target.closest('.mezzo-manut-alert')) {
            const id = parseInt(block.dataset.mezzoId, 10) || 0;
            const mezzo = allMezzi.find((m) => String(m.id) === String(id));
            if (mezzo) elencoManutenzioniModal?.open(mezzo);
        } else if (e.target.closest('.btn-mezzo-fogli')) {
            const id = parseInt(block.dataset.mezzoId, 10) || 0;
            const mezzo = allMezzi.find((m) => String(m.id) === String(id));
            if (mezzo) apriFogliDiViaggio(mezzo);
        } else if (e.target.closest('.btn-mezzo-rifornimenti')) {
            const id = parseInt(block.dataset.mezzoId, 10) || 0;
            const mezzo = allMezzi.find((m) => String(m.id) === String(id));
            if (mezzo) apriRifornimenti(mezzo);
        } else if (e.target.closest('.btn-mezzo-annulla')) {
            exitMezzoEditMode(true);
        } else if (e.target.closest('.btn-mezzo-salva')) {
            saveMezzoBlock(block);
        } else if (e.target.closest('.btn-mezzo-elimina')) {
            apriDialogEliminaMezzo(block);
        }
    });
}

async function loadAllMezzi() {
    const containerBody = document.getElementById('mezzi-container-body');
    if (!containerBody) return;

    editingMezzoId = null;
    mezzoEditSnapshot = null;

    if (!isTauri() || !invoke) {
        const demo = [
            {
                id: 1,
                nr_automezzo: '101',
                colore_mezzo: 'Bianco',
                marca: 'FIAT',
                modello: 'PANDA',
                targa: 'AB123CD',
                dotazione: 'Carrozzina',
                scadenza_ztl: '31/12/2025',
                scadenza_assicurazione: '15/06/2024',
                scadenza_bollo: '31/08/2026',
                in_servizio: 'true',
                note_mezzo: 'Mezzo demo'
            },
            {
                id: 2,
                nr_automezzo: '102',
                colore_mezzo: '',
                marca: 'FIAT',
                modello: 'DOBLO',
                targa: 'EF456GH',
                dotazione: '',
                scadenza_ztl: '',
                scadenza_assicurazione: '31/12/2026',
                scadenza_bollo: '',
                in_servizio: 'false',
                note_mezzo: ''
            }
        ];
        allMezzi = sortByNumeroMezzo(demo);
        ultimiKmPerMezzo = { '1': 45210, '2': 88102 };
        idMezziManutAperte = new Set(['1']);
        updateMezziCount(allMezzi.length);
        populateListaMezzi(allMezzi);
        await loadDotazioniMezzi();
        updateNuovoMezzoButtonState();
        return;
    }

    try {
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }

        const [mezzi] = await Promise.all([
            invoke('get_all_automezzi'),
            loadUltimiKmMezzi(),
            loadManutenzioniAperteMezzi()
        ]);
        allMezzi = Array.isArray(mezzi) ? sortByNumeroMezzo(mezzi) : [];

        if (!allMezzi.length) {
            containerBody.innerHTML = '<div class="mezzi-lista-empty">Nessun mezzo trovato</div>';
            updateMezziCount(0);
            await loadDotazioniMezzi();
            updateNuovoMezzoButtonState();
            return;
        }

        updateMezziCount(allMezzi.length);
        populateListaMezzi(allMezzi);
        await loadDotazioniMezzi();
    } catch (error) {
        console.error('Errore caricamento mezzi:', error);
        containerBody.innerHTML = `<div class="mezzi-lista-empty">Errore: ${escapeHtml(error.message || error)}</div>`;
    }
}

function filterMezziBySearch(searchTerm) {
    if (!searchTerm || !searchTerm.trim()) {
        return allMezzi;
    }

    const q = searchTerm.trim().toLowerCase();
    return sortByNumeroMezzo(
        allMezzi.filter((m) => {
            const haystack = [
                numeroMezzoVisibile(m),
                m.nr_automezzo,
                m.colore_mezzo,
                m.marca,
                m.modello,
                m.targa,
                m.dotazione,
                m.note_mezzo
            ].map(v => (v || '').toLowerCase()).join(' ');
            return haystack.includes(q);
        })
    );
}

function handleSearch() {
    const searchInput = document.getElementById('search-input');
    const containerBody = document.getElementById('mezzi-container-body');
    if (!searchInput || !containerBody) return;

    if (editingMezzoId != null) {
        exitMezzoEditMode(true);
    }

    const filtered = filterMezziBySearch(searchInput.value);
    updateMezziCount(filtered.length);
    populateListaMezzi(filtered);

    if (filtered.length === 0 && searchInput.value.trim()) {
        containerBody.innerHTML =
            `<div class="mezzi-lista-empty">Nessun mezzo trovato per: "${escapeHtml(searchInput.value.trim())}"</div>`;
    }
}

function showSearch() {
    const searchContainer = document.getElementById('search-container');
    const btnShowSearch = document.getElementById('btn-show-search');
    const searchInput = document.getElementById('search-input');

    if (searchContainer && btnShowSearch) {
        searchContainer.style.display = 'flex';
        btnShowSearch.style.display = 'none';
        setTimeout(() => searchInput?.focus(), 100);
    }
}

function hideSearch() {
    const searchContainer = document.getElementById('search-container');
    const btnShowSearch = document.getElementById('btn-show-search');
    const searchInput = document.getElementById('search-input');

    if (searchContainer && btnShowSearch) {
        searchContainer.style.display = 'none';
        btnShowSearch.style.display = 'flex';
        if (searchInput) searchInput.value = '';
        if (editingMezzoId != null) exitMezzoEditMode(true);
        updateMezziCount(allMezzi.length);
        populateListaMezzi(allMezzi);
    }
}

async function gestisciAperturaDaQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const idCompleta = params.get('completaManutenzione') || params.get('completa');
    const mostraScadute = params.get('mostraScadute') === '1' || params.get('scadute') === '1';

    if (idCompleta) {
        await completaManutenzioneModal?.openById(idCompleta);
        return;
    }

    if (!mostraScadute || !isTauri() || !invoke) return;

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const list = await invoke('get_manutenzioni_scadute');
        const scadute = Array.isArray(list) ? list : [];
        if (!scadute.length) return;
        if (scadute.length === 1) {
            await completaManutenzioneModal?.openById(scadute[0].id);
        } else {
            scaduteManutenzioniModal?.open(scadute);
        }
    } catch (err) {
        console.warn('Apertura manutenzioni scadute:', err);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    bindMezzoContainerEvents();
    bindNuovoMezzoModalEvents();
    bindDialogEliminaMezzoEvents();
    await initTauri();

    const etichettaMezzoFn = (mezzo) => {
        const n = numeroMezzoVisibile(mezzo);
        const nome = [mezzo.marca, mezzo.modello].filter(Boolean).join(' ');
        const targa = (mezzo.targa || '').trim();
        if (nome && targa) return `N.${n} — ${nome} (${targa})`;
        if (nome) return `N.${n} — ${nome}`;
        return `N. mezzo ${n}`;
    };

    completaManutenzioneModal = initCompletaManutenzioneModal({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        etichettaMezzo: etichettaMezzoFn,
        trovaMezzo: (idMezzo) => allMezzi.find((m) => String(m.id) === String(idMezzo)) || null,
        onSaved: async (saved) => {
            const mezzo = allMezzi.find((m) => String(m.id) === String(saved?.id_mezzo));
            if (mezzo) elencoManutenzioniModal?.refreshIfOpen?.(mezzo);
            await refreshAvvisiManutenzioniAperte();
        }
    });

    modificaManutenzioneModal = initModificaManutenzioneModal({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        etichettaMezzo: etichettaMezzoFn,
        trovaMezzo: (idMezzo) => allMezzi.find((m) => String(m.id) === String(idMezzo)) || null,
        onSaved: async (saved) => {
            const mezzo = allMezzi.find((m) => String(m.id) === String(saved?.id_mezzo));
            if (mezzo) elencoManutenzioniModal?.refreshIfOpen?.(mezzo);
            await refreshAvvisiManutenzioniAperte();
        }
    });

    scaduteManutenzioniModal = initScaduteManutenzioniModal({
        onScegli: (id) => completaManutenzioneModal?.openById(id)
    });

    elencoManutenzioniModal = initElencoManutenzioniModal({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        etichettaMezzo: etichettaMezzoFn,
        getUltimoKm: (mezzo) => ultimoKmDiMezzo(mezzo),
        onApriCompleta: (id, mezzo) => completaManutenzioneModal?.openById(id, mezzo),
        onApriModifica: (id, mezzo) => modificaManutenzioneModal?.openById(id, mezzo),
        onChanged: async () => {
            await refreshAvvisiManutenzioniAperte();
        }
    });

    manutenzioneModal = initManutenzioneMezzoModal({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        getUltimoKm: (mezzo) => ultimoKmDiMezzo(mezzo),
        etichettaMezzo: etichettaMezzoFn,
        onSaved: async (mezzo) => {
            // Se l'elenco è aperto sullo stesso mezzo, lo aggiorna
            elencoManutenzioniModal?.refreshIfOpen?.(mezzo);
            await refreshAvvisiManutenzioniAperte();
        }
    });

    await loadAllMezzi();
    await gestisciAperturaDaQuery();

    document.getElementById('btn-show-search')?.addEventListener('click', showSearch);
    document.getElementById('btn-hide-search')?.addEventListener('click', hideSearch);

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('paste', () => setTimeout(handleSearch, 10));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideSearch();
        });
    }

    document.getElementById('btn-chiudi')?.addEventListener('click', async () => {
        if (isTauri()) {
            try {
                const { getCurrent } = await import('@tauri-apps/api/window');
                const currentWindow = getCurrent();
                if (currentWindow?.label === 'elenco-mezzi') {
                    await currentWindow.close();
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
    });
});
