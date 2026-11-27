// Tratte Fuori Asti — logica modulo (tabella Supabase Tratte_supa)
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

let allTratte = [];
let editMode = false;
let selectedTrattaId = null;
let statusTimer = null;
let costoAlKmGlobale = 0.70;

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showStatus(message, isError = false) {
    const el = document.getElementById('tratte-status');
    if (!el) return;
    el.textContent = message;
    el.style.background = isError ? 'rgba(200,0,0,0.9)' : 'rgba(0,0,0,0.75)';
    el.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

const MSG_COSTO_KM = 'Questo dato può essere modificato solo da impostazioni';
const MSG_CALCOLATO = 'Questo è un dato calcolato automaticamente non può essere modificato manualmente';

const CAMPI_PROTETTI_TRATTE = {
    costo_km: MSG_COSTO_KM,
    costo: MSG_CALCOLATO,
    totale: MSG_CALCOLATO
};

function showTratteAvvisoModal(message) {
    const modal = document.getElementById('modal-tratte-avviso');
    const msgEl = document.getElementById('modal-tratte-avviso-msg');
    if (!modal || !msgEl) return;
    msgEl.textContent = message;
    modal.hidden = false;
    document.getElementById('btn-modal-tratte-avviso-ok')?.focus();
}

function hideTratteAvvisoModal() {
    const modal = document.getElementById('modal-tratte-avviso');
    if (!modal) return;
    modal.hidden = true;
}

function setupCampiProtettiGuard() {
    const lista = document.getElementById('tratte-lista');
    if (!lista || lista.dataset.campiProtettiGuard === '1') return;
    lista.dataset.campiProtettiGuard = '1';

    const messaggioPerCampo = (target) => {
        const field = target?.getAttribute?.('data-field');
        return CAMPI_PROTETTI_TRATTE[field] || null;
    };

    const bloccaCampoProtetto = (event) => {
        const message = messaggioPerCampo(event.target);
        if (!message) return;
        event.preventDefault();
        event.target.blur();
        showTratteAvvisoModal(message);
    };

    lista.addEventListener('mousedown', bloccaCampoProtetto);
    lista.addEventListener('focusin', bloccaCampoProtetto);
    lista.addEventListener('keydown', (event) => {
        const message = messaggioPerCampo(event.target);
        if (!message) return;
        event.preventDefault();
        showTratteAvvisoModal(message);
    });
}

function setupTratteAvvisoModalEvents() {
    document.getElementById('btn-modal-tratte-avviso-ok')?.addEventListener('click', hideTratteAvvisoModal);
    const modal = document.getElementById('modal-tratte-avviso');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) hideTratteAvvisoModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.hidden) hideTratteAvvisoModal();
    });
}

function parseItalianNumber(value) {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value)
        .trim()
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? 0 : n;
}

function formatItalianNumber(value, decimals = 2, withEuro = false) {
    const n = typeof value === 'number' ? value : parseItalianNumber(value);
    const fixed = n.toFixed(decimals).replace('.', ',');
    return withEuro ? `${fixed} €` : fixed;
}

function normalizeTrattaFromApi(t) {
    return {
        id: t.id || 0,
        comune: t.comune || '',
        provincia: t.provincia || '',
        localita: t.localita || '',
        km: formatItalianNumber(t.km, 0),
        costo_km: formatItalianNumber(t.costo_km, 2, true),
        costo: formatItalianNumber(t.costo, 1),
        pedaggio: formatItalianNumber(t.pedaggio, 2, true),
        totale: formatItalianNumber(t.totale, 2),
        note_aggiuntive: t.note_aggiuntive || ''
    };
}

function getDemoTratte() {
    return [
        {
            id: 1,
            comune: 'ACQUITERME',
            provincia: '',
            localita: '',
            km: '86',
            costo_km: '0,70 €',
            costo: '60,2',
            pedaggio: '0,00 €',
            totale: '60,2',
            note_aggiuntive: ''
        },
        {
            id: 2,
            comune: 'ALBA',
            provincia: 'CN',
            localita: "CITTA'",
            km: '60',
            costo_km: '0,70 €',
            costo: '42',
            pedaggio: '5,46 €',
            totale: '47,46',
            note_aggiuntive: 'il costo è inteso per andata e ritorno autostrada compresa'
        }
    ];
}

function calcolaImportiTratta(km, costoKm, pedaggio) {
    const costo = km * costoKm;
    const totale = costo + pedaggio;
    return { costo, totale };
}

function applicaTariffaECalcoli(tratta) {
    const km = parseItalianNumber(tratta.km);
    const pedaggio = parseItalianNumber(tratta.pedaggio);
    const tariffa = costoAlKmGlobale > 0 ? costoAlKmGlobale : parseItalianNumber(tratta.costo_km);
    const { costo, totale } = calcolaImportiTratta(km, tariffa, pedaggio);
    return {
        ...tratta,
        costo_km: formatItalianNumber(tariffa, 2, true),
        costo: formatItalianNumber(costo, 1),
        totale: formatItalianNumber(totale, 2)
    };
}

function recalcRow(entryEl) {
    const km = parseItalianNumber(entryEl.querySelector('[data-field="km"]')?.value);
    const pedaggio = parseItalianNumber(entryEl.querySelector('[data-field="pedaggio"]')?.value);
    const costoKm = costoAlKmGlobale > 0
        ? costoAlKmGlobale
        : parseItalianNumber(entryEl.querySelector('[data-field="costo_km"]')?.value);
    const { costo, totale } = calcolaImportiTratta(km, costoKm, pedaggio);

    const costoKmInput = entryEl.querySelector('[data-field="costo_km"]');
    const costoInput = entryEl.querySelector('[data-field="costo"]');
    const totaleInput = entryEl.querySelector('[data-field="totale"]');
    if (costoKmInput) costoKmInput.value = formatItalianNumber(costoKm, 2, true);
    if (costoInput) costoInput.value = formatItalianNumber(costo, 1);
    if (totaleInput) totaleInput.value = formatItalianNumber(totale, 2);
}

function readTrattaFromEntry(entryEl) {
    const get = (field) => entryEl.querySelector(`[data-field="${field}"]`)?.value?.trim() || '';
    return {
        id: parseInt(entryEl.dataset.id, 10) || 0,
        comune: get('comune'),
        provincia: get('provincia'),
        localita: get('localita'),
        km: get('km'),
        costo_km: get('costo_km'),
        costo: get('costo'),
        pedaggio: get('pedaggio'),
        totale: get('totale'),
        note_aggiuntive: get('note_aggiuntive')
    };
}

function createTrattaEntry(tratta) {
    const div = document.createElement('div');
    div.className = 'tratta-entry';
    div.dataset.id = String(tratta.id);
    if (selectedTrattaId === tratta.id) {
        div.classList.add('selected');
    }

    div.innerHTML = `
            <input type="text" class="tratta-id tratta-cell" value="${escapeHtml(tratta.id)}" readonly tabindex="-1">
            <input type="text" class="tratta-cell" data-field="comune" value="${escapeHtml(tratta.comune)}" readonly>
            <input type="text" class="tratta-cell" data-field="provincia" value="${escapeHtml(tratta.provincia)}" readonly>
            <input type="text" class="tratta-cell" data-field="localita" value="${escapeHtml(tratta.localita)}" readonly>
            <input type="text" class="tratta-cell" data-field="km" value="${escapeHtml(tratta.km)}" readonly>
            <input type="text" class="tratta-cell" data-field="costo_km" value="${escapeHtml(tratta.costo_km)}" readonly>
            <input type="text" class="tratta-cell" data-field="costo" value="${escapeHtml(tratta.costo)}" readonly>
            <input type="text" class="tratta-cell" data-field="pedaggio" value="${escapeHtml(tratta.pedaggio)}" readonly>
            <input type="text" class="tratta-cell" data-field="totale" value="${escapeHtml(tratta.totale)}" readonly>
            <button type="button" class="btn-seleziona">SELEZIONA</button>
            <label class="tratta-note-label" for="note-${tratta.id}">NOTE AGGIUNTIVE</label>
            <input type="text" class="tratta-note-input" id="note-${tratta.id}" data-field="note_aggiuntive" value="${escapeHtml(tratta.note_aggiuntive)}" readonly>
    `;

    div.dataset.ordine = String(tratta._ordine ?? tratta.id ?? 0);
    div.querySelector('.btn-seleziona')?.addEventListener('click', () => selezionaTratta(tratta.id));

    const bindRecalc = (field) => {
        const input = div.querySelector(`[data-field="${field}"]`);
        if (!input) return;
        const handler = () => {
            if (editMode) recalcRow(div);
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    };

    bindRecalc('km');
    bindRecalc('pedaggio');

    return div;
}

const VUOTO_COMUNE = '(vuoto)';
let filtroComune = { testo: '', esclusi: new Set() };
let ordinamentoComune = '';
let menuComuneAperto = false;

function etichettaComune(valore) {
    const testo = String(valore || '').trim();
    return testo || VUOTO_COMUNE;
}

function leggiComuneEntry(entry) {
    return etichettaComune(entry.querySelector('[data-field="comune"]')?.value);
}

function filtroComuneAttivo() {
    return Boolean(filtroComune.testo || filtroComune.esclusi.size > 0);
}

function entryPassaFiltro(entry) {
    const nome = leggiComuneEntry(entry);
    if (filtroComune.testo && !nome.toLocaleLowerCase('it').includes(filtroComune.testo)) return false;
    if (filtroComune.esclusi.has(nome)) return false;
    return true;
}

function aggiornaBottoneFiltro() {
    const btn = document.getElementById('btn-filtro-comune');
    if (!btn) return;
    const filtrato = filtroComuneAttivo();
    btn.classList.toggle('is-filtrato', filtrato);
    btn.classList.toggle('is-ordinato', Boolean(ordinamentoComune));
    btn.classList.toggle('is-aperto', menuComuneAperto);
    btn.setAttribute('aria-expanded', menuComuneAperto ? 'true' : 'false');
    if (ordinamentoComune === 'asc') btn.textContent = '▲';
    else if (ordinamentoComune === 'desc') btn.textContent = '▼';
    else btn.textContent = '▾';
}

function applicaVistaTratte() {
    const container = document.getElementById('tratte-lista');
    if (!container) return;

    container.querySelector('.tratte-filtro-vuoto')?.remove();
    const entries = [...container.querySelectorAll('.tratta-entry')];
    entries.sort((a, b) => {
        if (ordinamentoComune) {
            const cmp = leggiComuneEntry(a).localeCompare(leggiComuneEntry(b), 'it', { sensitivity: 'base' });
            if (cmp !== 0) return ordinamentoComune === 'desc' ? -cmp : cmp;
        }
        return (parseInt(a.dataset.ordine, 10) || 0) - (parseInt(b.dataset.ordine, 10) || 0);
    });
    entries.forEach((entry) => container.appendChild(entry));

    let visibili = 0;
    entries.forEach((entry) => {
        const ok = entryPassaFiltro(entry);
        entry.hidden = !ok;
        if (ok) visibili += 1;
    });

    if (entries.length && visibili === 0) {
        const vuoto = document.createElement('div');
        vuoto.className = 'tratte-empty tratte-filtro-vuoto';
        vuoto.textContent = 'Nessuna tratta con questo filtro. Apri COMUNE e premi «Azzera filtro».';
        container.appendChild(vuoto);
    }

    aggiornaBottoneFiltro();
}

function valoriComune() {
    const unici = new Set();
    document.querySelectorAll('.tratta-entry').forEach((entry) => {
        unici.add(leggiComuneEntry(entry));
    });
    return [...unici].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

function chiudiMenuComune() {
    menuComuneAperto = false;
    const menu = document.getElementById('tratte-menu');
    if (menu) menu.hidden = true;
    aggiornaBottoneFiltro();
}

function posizionaMenuComune() {
    const btn = document.getElementById('btn-filtro-comune');
    const menu = document.getElementById('tratte-menu');
    if (!btn || !menu) return;
    const riquadro = btn.getBoundingClientRect();
    const larghezza = menu.offsetWidth || 260;
    let sinistra = Math.min(riquadro.left, window.innerWidth - larghezza - 8);
    sinistra = Math.max(8, sinistra);
    let alto = riquadro.bottom + 4;
    menu.style.left = `${sinistra}px`;
    menu.style.top = `${alto}px`;
    const altezza = menu.offsetHeight;
    if (alto + altezza > window.innerHeight - 8) {
        menu.style.top = `${Math.max(8, riquadro.top - altezza - 4)}px`;
    }
}

function aggiornaCasellaTutti(mostrati) {
    const tutti = document.getElementById('tratte-menu-tutti');
    if (!tutti) return;
    const inclusi = mostrati.filter((valore) => !filtroComune.esclusi.has(valore));
    tutti.checked = mostrati.length > 0 && inclusi.length === mostrati.length;
    tutti.indeterminate = inclusi.length > 0 && inclusi.length < mostrati.length;
}

function disegnaListaComuni() {
    const lista = document.getElementById('tratte-menu-lista');
    if (!lista) return;
    lista.innerHTML = '';

    const cerca = filtroComune.testo;
    const mostrati = valoriComune().filter((valore) => !cerca || valore.toLocaleLowerCase('it').includes(cerca));

    if (!mostrati.length) {
        const vuoto = document.createElement('p');
        vuoto.className = 'tratte-menu-vuoto';
        vuoto.textContent = 'Nessun comune';
        lista.appendChild(vuoto);
        aggiornaCasellaTutti([]);
        return;
    }

    mostrati.slice(0, 300).forEach((valore) => {
        const label = document.createElement('label');
        label.className = 'tratte-menu-valore';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !filtroComune.esclusi.has(valore);
        input.addEventListener('change', () => {
            if (input.checked) filtroComune.esclusi.delete(valore);
            else filtroComune.esclusi.add(valore);
            applicaVistaTratte();
            aggiornaCasellaTutti(mostrati);
        });
        const testo = document.createElement('span');
        testo.textContent = valore;
        label.appendChild(input);
        label.appendChild(testo);
        lista.appendChild(label);
    });

    aggiornaCasellaTutti(mostrati);
}

function apriMenuComune() {
    const menu = document.getElementById('tratte-menu');
    const cerca = document.getElementById('tratte-menu-cerca');
    if (!menu) return;
    menuComuneAperto = true;
    menu.hidden = false;
    if (cerca) cerca.value = filtroComune.testo;
    document.getElementById('tratte-ordina-asc')?.classList.toggle('is-scelto', ordinamentoComune === 'asc');
    document.getElementById('tratte-ordina-desc')?.classList.toggle('is-scelto', ordinamentoComune === 'desc');
    disegnaListaComuni();
    posizionaMenuComune();
    aggiornaBottoneFiltro();
    cerca?.focus();
}

function impostaOrdineComune(direzione) {
    ordinamentoComune = ordinamentoComune === direzione ? '' : direzione;
    document.getElementById('tratte-ordina-asc')?.classList.toggle('is-scelto', ordinamentoComune === 'asc');
    document.getElementById('tratte-ordina-desc')?.classList.toggle('is-scelto', ordinamentoComune === 'desc');
    applicaVistaTratte();
}

function azzeraFiltroComune() {
    filtroComune = { testo: '', esclusi: new Set() };
    ordinamentoComune = '';
    const cerca = document.getElementById('tratte-menu-cerca');
    if (cerca) cerca.value = '';
    document.getElementById('tratte-ordina-asc')?.classList.remove('is-scelto');
    document.getElementById('tratte-ordina-desc')?.classList.remove('is-scelto');
    applicaVistaTratte();
    if (menuComuneAperto) disegnaListaComuni();
}

function preparaFiltroComune() {
    const btn = document.getElementById('btn-filtro-comune');
    btn?.addEventListener('click', (event) => {
        event.stopPropagation();
        if (menuComuneAperto) chiudiMenuComune();
        else apriMenuComune();
    });

    document.getElementById('tratte-ordina-asc')?.addEventListener('click', () => impostaOrdineComune('asc'));
    document.getElementById('tratte-ordina-desc')?.addEventListener('click', () => impostaOrdineComune('desc'));
    document.getElementById('tratte-menu-azzera')?.addEventListener('click', azzeraFiltroComune);

    document.getElementById('tratte-menu-cerca')?.addEventListener('input', (event) => {
        filtroComune.testo = event.target.value.trim().toLocaleLowerCase('it');
        disegnaListaComuni();
        applicaVistaTratte();
    });

    document.getElementById('tratte-menu-tutti')?.addEventListener('change', (event) => {
        const includi = event.target.checked;
        const cerca = filtroComune.testo;
        valoriComune()
            .filter((valore) => !cerca || valore.toLocaleLowerCase('it').includes(cerca))
            .forEach((valore) => {
                if (includi) filtroComune.esclusi.delete(valore);
                else filtroComune.esclusi.add(valore);
            });
        disegnaListaComuni();
        applicaVistaTratte();
    });

    document.addEventListener('click', (event) => {
        if (!menuComuneAperto) return;
        const menu = document.getElementById('tratte-menu');
        if (menu?.contains(event.target) || btn?.contains(event.target)) return;
        chiudiMenuComune();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menuComuneAperto) chiudiMenuComune();
    });

    document.getElementById('tratte-lista')?.addEventListener('scroll', () => {
        if (menuComuneAperto) chiudiMenuComune();
    });
}

function renderTratteList(tratte) {
    const container = document.getElementById('tratte-lista');
    if (!container) return;

    container.innerHTML = '';

    if (!tratte.length) {
        container.innerHTML = '<div class="tratte-empty">Nessuna tratta trovata</div>';
        aggiornaBottoneFiltro();
        return;
    }

    tratte.forEach((t, indice) => {
        container.appendChild(createTrattaEntry({ ...t, _ordine: indice }));
    });

    applyEditModeToDom();
    applicaVistaTratte();
}

function applyEditModeToDom() {
    document.querySelectorAll('.tratta-entry').forEach((entry) => {
        entry.classList.toggle('in-edit', editMode);
        entry.querySelectorAll('input:not(.tratta-id)').forEach((input) => {
            const field = input.getAttribute('data-field');
            const isCalcolato = field === 'costo' || field === 'totale' || field === 'costo_km';
            input.readOnly = !editMode || isCalcolato;
        });
    });

    const btnModifica = document.getElementById('btn-modifica');
    if (btnModifica) {
        btnModifica.textContent = editMode ? 'SALVA' : 'MODIFICA';
        btnModifica.classList.toggle('is-saving', editMode);
    }
}

async function loadTratte() {
    const container = document.getElementById('tratte-lista');
    if (!container) return;

    try {
        if (!invoke) {
            costoAlKmGlobale = 0.70;
            allTratte = getDemoTratte().map(applicaTariffaECalcoli);
            renderTratteList(allTratte);
            showStatus('Modalità demo — tariffa km 0,70 €');
            return;
        }

        const result = await invoke('get_all_tratte');
        costoAlKmGlobale = typeof result?.costo_al_km === 'number' ? result.costo_al_km : 0.70;
        const rows = Array.isArray(result?.tratte) ? result.tratte : (Array.isArray(result) ? result : []);
        allTratte = rows.map((t) => applicaTariffaECalcoli(normalizeTrattaFromApi(t)));
        renderTratteList(allTratte);
        if (costoAlKmGlobale > 0) {
            showStatus(`Tariffa km aggiornata da impostazioni: ${formatItalianNumber(costoAlKmGlobale, 2, true)}`);
        }
    } catch (error) {
        console.error('Errore caricamento tratte:', error);
        container.innerHTML = `<div class="tratte-errore">Errore nel caricamento: ${escapeHtml(error.message || error)}</div>`;
    }
}

async function salvaModifiche() {
    if (!invoke) {
        showStatus('Salvataggio non disponibile in modalità demo');
        editMode = false;
        applyEditModeToDom();
        return;
    }

    const entries = document.querySelectorAll('.tratta-entry');
    let salvate = 0;
    let errori = 0;

    for (const entry of entries) {
        const tratta = readTrattaFromEntry(entry);
        if (!tratta.id) continue;

        try {
            await invoke('save_tratta', { tratta });
            salvate++;
        } catch (err) {
            console.error(`Errore salvataggio tratta ${tratta.id}:`, err);
            errori++;
        }
    }

    editMode = false;
    applyEditModeToDom();
    await loadTratte();

    if (errori > 0) {
        showStatus(`Salvate ${salvate} tratte, ${errori} errori`, true);
    } else {
        showStatus(`Salvate ${salvate} tratte`);
    }
}

function toggleModifica() {
    if (editMode) {
        salvaModifiche();
    } else {
        editMode = true;
        applyEditModeToDom();
        document.querySelectorAll('.tratta-entry').forEach((entry) => recalcRow(entry));
        showStatus(`Modifica attiva — tariffa km ${formatItalianNumber(costoAlKmGlobale, 2, true)}`);
    }
}

function selezionaTratta(id) {
    selectedTrattaId = id;
    document.querySelectorAll('.tratta-entry').forEach((el) => {
        el.classList.toggle('selected', parseInt(el.dataset.id, 10) === id);
    });

    const entryEl = document.querySelector(`.tratta-entry[data-id="${id}"]`);
    const tratta = entryEl
        ? readTrattaFromEntry(entryEl)
        : allTratte.find((t) => t.id === id);
    if (!tratta) return;

    try {
        sessionStorage.setItem('tratta_selezionata', JSON.stringify(tratta));
    } catch (_) { /* ignore */ }

    showStatus(`Selezionata: ${tratta.comune || id}`);

    const params = new URLSearchParams(window.location.search);
    if (params.get('select') === '1') {
        const payload = {
            id: tratta.id,
            comune: tratta.comune || '',
            provincia: tratta.provincia || '',
            localita: tratta.localita || '',
            km: tratta.km || '',
            costo_km: tratta.costo_km || '',
            costo: tratta.costo || '',
            pedaggio: tratta.pedaggio || '',
            totale: tratta.totale || '',
            note_aggiuntive: tratta.note_aggiuntive || ''
        };

        // Comunicazione verso Nuovo Servizio (Tauri event + fallback browser)
        (async () => {
            try {
                if (isTauri()) {
                    const { emit } = await import('@tauri-apps/api/event');
                    await emit('tratta-fuori-asti-selezionata', payload);
                }
            } catch (err) {
                console.warn('Emit tratta selezionata:', err);
            }

            try {
                localStorage.setItem(
                    'tratta_fuori_asti_selezionata',
                    JSON.stringify({ ...payload, ts: Date.now() })
                );
            } catch (_) { /* ignore */ }

            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage(
                        { type: 'tratta-fuori-asti-selezionata', payload },
                        '*'
                    );
                } catch (_) { /* ignore */ }
            }

            setTimeout(async () => {
                if (isTauri()) {
                    try {
                        const { getCurrent } = await import('@tauri-apps/api/window');
                        await getCurrent().close();
                    } catch (err) {
                        console.warn('Chiusura finestra:', err);
                    }
                } else if (window.opener) {
                    window.close();
                }
            }, 250);
        })();
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            if (currentWindow?.label === 'tratte-fuori-asti') {
                await currentWindow.close();
                return;
            }
            await currentWindow.close();
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

document.addEventListener('DOMContentLoaded', async () => {
    setupCampiProtettiGuard();
    setupTratteAvvisoModalEvents();
    preparaFiltroComune();
    await initTauri();
    await loadTratte();

    document.getElementById('btn-modifica')?.addEventListener('click', toggleModifica);
    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
});
