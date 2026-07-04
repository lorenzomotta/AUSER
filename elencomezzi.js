// Elenco Mezzi — logica modulo (tabella Supabase Automezzi_Supa)
let invoke;

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

function suggestNextNumeroMezzo() {
    const numbers = allMezzi
        .map((m) => parseInt(m.nr_automezzo, 10))
        .filter((n) => !Number.isNaN(n));
    if (!numbers.length) return '1';
    return String(Math.max(...numbers) + 1);
}

function createEmptyMezzoTemplate() {
    return {
        id: 0,
        nr_automezzo: suggestNextNumeroMezzo(),
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
        const na = parseInt(a.nr_automezzo, 10);
        const nb = parseInt(b.nr_automezzo, 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
            return na - nb;
        }
        return (a.nr_automezzo || '').localeCompare(b.nr_automezzo || '', 'it', { numeric: true });
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
                    <input type="text" data-field="nr_automezzo" value="${escapeHtml(mezzo.nr_automezzo || '')}" readonly>
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
                ${scadenzaFieldHtml('SCAD. BOLLO', 'scadenza_bollo', mezzo.scadenza_bollo)}
                <div class="mezzo-form-group mezzo-form-group-inservizio">
                    <label>IN SERV.</label>
                    <div class="mezzo-checkbox-container">
                        <input type="checkbox" data-field="in_servizio" ${inServizio ? 'checked' : ''} disabled>
                    </div>
                </div>
                <div class="mezzo-form-group mezzo-form-group-actions">
                    <div class="mezzo-block-actions">
                        <button type="button" class="btn-mezzo-modifica">MODIFICA</button>
                        <button type="button" class="btn-mezzo-salva" hidden>SALVA</button>
                        <button type="button" class="btn-mezzo-annulla" hidden>ANNULLA</button>
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
        setFieldEditable(el, editing);
    });

    const btnModifica = block.querySelector('.btn-mezzo-modifica');
    const btnSalva = block.querySelector('.btn-mezzo-salva');
    const btnAnnulla = block.querySelector('.btn-mezzo-annulla');
    if (btnModifica) btnModifica.hidden = editing;
    if (btnSalva) btnSalva.hidden = !editing;
    if (btnAnnulla) btnAnnulla.hidden = !editing;

    setupDotazioneField(block, editing);

    if (editing) {
        block.querySelector('[data-field="marca"]')?.focus();
    } else {
        const status = block.querySelector('.mezzo-block-status');
        if (status) status.textContent = '';
    }

    updateNuovoMezzoButtonState();
}

function collectMezzoFromRoot(root, id = 0) {
    const getVal = (name) => root.querySelector(`[data-field="${name}"]`)?.value?.trim() ?? '';
    const inServizioEl = root.querySelector('[data-field="in_servizio"]');

    return {
        id,
        nr_automezzo: getVal('nr_automezzo'),
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
    return collectMezzoFromRoot(block, id);
}

function applyFieldsToRoot(root, data) {
    Object.entries({
        nr_automezzo: data.nr_automezzo,
        marca: data.marca,
        modello: data.modello,
        targa: data.targa,
        dotazione: data.dotazione,
        scadenza_ztl: data.scadenza_ztl,
        scadenza_assicurazione: data.scadenza_assicurazione,
        scadenza_bollo: data.scadenza_bollo,
        note_mezzo: data.note_mezzo
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
    if (!payload.nr_automezzo) {
        setBlockStatus(block, 'N. mezzo obbligatorio', true);
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
    document.getElementById('modal-nr-automezzo')?.focus();
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
    if (!payload.nr_automezzo) {
        setModalStatus('N. mezzo obbligatorio', true);
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

function bindMezzoContainerEvents() {
    const containerBody = document.getElementById('mezzi-container-body');
    if (!containerBody || containerBody.dataset.bound === '1') return;
    containerBody.dataset.bound = '1';

    containerBody.addEventListener('click', (e) => {
        const block = e.target.closest('.mezzo-block');
        if (!block) return;

        if (e.target.classList.contains('btn-mezzo-modifica')) {
            enableMezzoEdit(block);
        } else if (e.target.classList.contains('btn-mezzo-annulla')) {
            exitMezzoEditMode(true);
        } else if (e.target.classList.contains('btn-mezzo-salva')) {
            saveMezzoBlock(block);
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
                nr_automezzo: '1',
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
                nr_automezzo: '2',
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

        const mezzi = await invoke('get_all_automezzi');
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
                m.nr_automezzo,
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

document.addEventListener('DOMContentLoaded', async () => {
    bindMezzoContainerEvents();
    bindNuovoMezzoModalEvents();
    await initTauri();
    await loadAllMezzi();

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
