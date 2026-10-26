/**
 * Modale Nuova manutenzione — usato da Elenco mezzi.
 * Tipologia Km: salva km attuale + delta → alert a soglia.
 * Tipologia Giorni: data + delta giorni → alert alla data prevista.
 */

function oggiIt() {
    const d = new Date();
    const gg = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${gg}/${mm}/${d.getFullYear()}`;
}

function escapeHtmlManut(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatValoreManut(v) {
    if (v === null || v === undefined) return '—';
    const s = String(v).trim();
    return s || '—';
}

function statoLabel(stato) {
    const s = String(stato || 'aperta').trim().toLowerCase();
    if (s === 'eseguita') return 'Eseguita';
    if (s === 'annullata') return 'Annullata';
    return 'Aperta';
}

function statoClass(stato) {
    const s = String(stato || 'aperta').trim().toLowerCase();
    if (s === 'eseguita') return 'stato-eseguita';
    if (s === 'annullata') return 'stato-annullata';
    return 'stato-aperta';
}

/** Elenco manutenzioni di un mezzo (modale). */
export function initElencoManutenzioniModal(options = {}) {
    const getInvoke = options.getInvoke || (() => null);
    const isTauriEnv = options.isTauriEnv || (() => false);
    const etichettaMezzo = options.etichettaMezzo || (() => 'Mezzo');
    const getUltimoKm = options.getUltimoKm || (() => '');
    const onApriCompleta = options.onApriCompleta || null;

    let mezzoCorrente = null;

    const overlay = document.getElementById('modal-elenco-manutenzioni');
    const listaEl = document.getElementById('modal-elenco-manut-lista');
    const titoloMezzo = document.getElementById('modal-elenco-manut-mezzo');
    const kmEl = document.getElementById('modal-elenco-manut-km');
    const statusEl = document.getElementById('modal-elenco-manut-status');

    if (!overlay || !listaEl) {
        console.warn('Modale elenco manutenzioni non trovato nell\'HTML');
        return { open: () => {}, close: () => {}, refreshIfOpen: () => {} };
    }

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('error', !!isError);
    }

    function close() {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        mezzoCorrente = null;
        setStatus('');
    }

    function renderLista(rows) {
        if (!Array.isArray(rows) || !rows.length) {
            listaEl.innerHTML = '<div class="manut-elenco-empty">Nessuna manutenzione per questo mezzo</div>';
            return;
        }

        const parts = rows.map((m) => {
            const id = m.id ?? m.IdManutenzione ?? '';
            const tip = formatValoreManut(m.tipologia);
            const stato = String(m.stato || 'aperta').toLowerCase();
            const motivazione = formatValoreManut(m.motivazione);
            const data = formatValoreManut(m.data);
            const deltaKm = formatValoreManut(m.delta_chilometri);
            const deltaGiorni = formatValoreManut(m.delta_giorni);
            const kmRif = formatValoreManut(m.km_riferimento);
            const kmPrev = formatValoreManut(m.km_previsto);
            const dataPrev = formatValoreManut(m.data_prevista);
            const presso = formatValoreManut(m.eseguita_presso);
            const operatore = formatValoreManut(m.operatore);
            const pagato = formatValoreManut(m.pagato);
            const note = String(m.note_manutenzione || '').trim();

            let sogliaHtml = '';
            if (String(tip).toLowerCase() === 'km') {
                sogliaHtml = `
                    <div><span>Km rif.</span>${escapeHtmlManut(kmRif)}</div>
                    <div><span>Delta km</span>${escapeHtmlManut(deltaKm)}</div>
                    <div><span>Km previsti</span>${escapeHtmlManut(kmPrev)}</div>
                `;
            } else {
                sogliaHtml = `
                    <div><span>Delta giorni</span>${escapeHtmlManut(deltaGiorni)}</div>
                    <div><span>Data prevista</span>${escapeHtmlManut(dataPrev)}</div>
                `;
            }

            const azioni = stato === 'aperta'
                ? `
                    <button type="button" class="manut-btn-completa" data-completa-id="${escapeHtmlManut(id)}">COMPLETA</button>
                    <button type="button" class="manut-btn-eseguita" data-azione="eseguita" data-id="${escapeHtmlManut(id)}">SEGNA ESEGUITA</button>
                    <button type="button" class="manut-btn-annulla-manut" data-azione="annullata" data-id="${escapeHtmlManut(id)}">ANNULLA</button>
                `
                : `
                    <button type="button" class="manut-btn-completa" data-completa-id="${escapeHtmlManut(id)}">APRI SCHEDA</button>
                    <button type="button" class="manut-btn-riapri" data-azione="aperta" data-id="${escapeHtmlManut(id)}">RIAPRI</button>
                `;

            return `
                <article class="manut-card ${statoClass(stato)}" data-manut-id="${escapeHtmlManut(id)}">
                    <div class="manut-card-top">
                        <div class="manut-card-titolo">${escapeHtmlManut(motivazione !== '—' ? motivazione : `Manutenzione ${tip}`)}</div>
                        <span class="manut-card-stato ${statoClass(stato)}">${escapeHtmlManut(statoLabel(stato))}</span>
                    </div>
                    <div class="manut-card-grid">
                        <div><span>Data esecuzione</span>${escapeHtmlManut(data)}</div>
                        <div><span>Tipologia</span>${escapeHtmlManut(tip)}</div>
                        ${sogliaHtml}
                        <div><span>Presso</span>${escapeHtmlManut(presso)}</div>
                        <div><span>Operatore</span>${escapeHtmlManut(operatore)}</div>
                        <div><span>Pagato</span>${escapeHtmlManut(pagato)}</div>
                    </div>
                    ${note ? `<div class="manut-card-note">${escapeHtmlManut(note)}</div>` : ''}
                    <div class="manut-card-actions">${azioni}</div>
                </article>
            `;
        });

        listaEl.innerHTML = parts.join('');
    }

    async function caricaLista() {
        if (!mezzoCorrente) return;
        listaEl.innerHTML = '<div class="manut-elenco-loading">Caricamento…</div>';
        setStatus('');

        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            listaEl.innerHTML = '<div class="manut-elenco-empty">Elenco disponibile solo nell\'app desktop</div>';
            return;
        }

        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const rows = await invoke('get_manutenzioni_mezzo', {
                idMezzo: Number(mezzoCorrente.id) || 0,
                id_mezzo: Number(mezzoCorrente.id) || 0
            });
            renderLista(Array.isArray(rows) ? rows : []);
        } catch (error) {
            console.error('Errore caricamento manutenzioni:', error);
            listaEl.innerHTML = `<div class="manut-elenco-empty">Errore: ${escapeHtmlManut(error?.message || error)}</div>`;
        }
    }

    async function open(mezzo) {
        if (!mezzo || !mezzo.id) return;
        mezzoCorrente = mezzo;
        if (titoloMezzo) titoloMezzo.textContent = etichettaMezzo(mezzo);
        if (kmEl) {
            const km = getUltimoKm(mezzo);
            kmEl.textContent = km
                ? `Ultimo chilometraggio mezzo: ${km}`
                : 'Ultimo chilometraggio mezzo: non disponibile';
        }
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        await caricaLista();
    }

    async function aggiornaStato(id, stato) {
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke || !id) return;
        setStatus('Aggiornamento…');
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('aggiorna_stato_manutenzione', { id: Number(id), stato });
            setStatus('Aggiornato');
            await caricaLista();
            setTimeout(() => setStatus(''), 1500);
        } catch (error) {
            console.error('Errore aggiornamento stato manutenzione:', error);
            setStatus(`Errore: ${error?.message || error}`, true);
        }
    }

    listaEl.addEventListener('click', (e) => {
        const btnCompleta = e.target.closest('button[data-completa-id]');
        if (btnCompleta) {
            const id = Number(btnCompleta.dataset.completaId) || 0;
            if (id && typeof onApriCompleta === 'function') {
                onApriCompleta(id, mezzoCorrente);
            }
            return;
        }
        const btn = e.target.closest('button[data-azione][data-id]');
        if (!btn) return;
        aggiornaStato(btn.dataset.id, btn.dataset.azione);
    });

    document.getElementById('btn-modal-elenco-manut-close')?.addEventListener('click', close);
    document.getElementById('btn-modal-elenco-manut-chiudi')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) close();
    });

    return {
        open,
        close,
        refreshIfOpen(mezzo) {
            if (!mezzoCorrente || overlay.hidden) return;
            if (mezzo && String(mezzo.id) !== String(mezzoCorrente.id)) return;
            caricaLista();
        }
    };
}

function setupOperatoreCombo(inputEl, listaEl, getNomi, ensureLoaded) {
    let activeIndex = -1;

    function hide() {
        if (!listaEl) return;
        listaEl.hidden = true;
        listaEl.innerHTML = '';
        activeIndex = -1;
    }

    function filtra(query) {
        const nomi = typeof getNomi === 'function' ? getNomi() : [];
        const q = String(query || '').trim().toLowerCase();
        if (!q) return nomi.slice(0, 40);
        return nomi.filter((n) => n.toLowerCase().includes(q)).slice(0, 40);
    }

    function render(query) {
        if (!listaEl) return;
        const items = filtra(query);
        if (!items.length) {
            listaEl.innerHTML = '<li class="manut-combo-empty">Nessun operatore trovato</li>';
            listaEl.hidden = false;
            activeIndex = -1;
            return;
        }
        listaEl.innerHTML = items
            .map((nome, idx) => `
                <li class="manut-combo-item${idx === 0 ? ' active' : ''}" role="option"
                    data-index="${idx}" data-value="${escapeHtmlManut(nome)}">${escapeHtmlManut(nome)}</li>
            `)
            .join('');
        listaEl.hidden = false;
        activeIndex = 0;
    }

    function scegli(nome) {
        if (inputEl) inputEl.value = nome || '';
        hide();
    }

    inputEl?.addEventListener('focus', async () => {
        if (typeof ensureLoaded === 'function') await ensureLoaded();
        render(inputEl.value);
    });
    inputEl?.addEventListener('input', () => render(inputEl.value));
    inputEl?.addEventListener('keydown', (e) => {
        if (listaEl?.hidden) {
            if (e.key === 'ArrowDown') {
                render(inputEl.value);
                e.preventDefault();
            }
            return;
        }
        const items = [...listaEl.querySelectorAll('.manut-combo-item')];
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(items.length - 1, activeIndex + 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
            items[activeIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(0, activeIndex - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
            items[activeIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = items[activeIndex] || items[0];
            if (chosen) scegli(chosen.dataset.value || chosen.textContent);
        } else if (e.key === 'Escape') {
            hide();
        }
    });
    listaEl?.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.manut-combo-item');
        if (!item) return;
        e.preventDefault();
        scegli(item.dataset.value || item.textContent);
    });
    inputEl?.addEventListener('blur', () => setTimeout(hide, 150));

    return { hide, render };
}

/** Scheda per completare i campi e segnare eseguita. */
export function initCompletaManutenzioneModal(options = {}) {
    const getInvoke = options.getInvoke || (() => null);
    const isTauriEnv = options.isTauriEnv || (() => false);
    const etichettaMezzo = options.etichettaMezzo || (() => 'Mezzo');
    const trovaMezzo = options.trovaMezzo || (() => null);

    let operatoriNominativi = [];
    let operatoriCaricati = false;

    const overlay = document.getElementById('modal-completa-manutenzione');
    const form = document.getElementById('form-completa-manutenzione');
    const statusEl = document.getElementById('modal-completa-manut-status');
    const titoloMezzo = document.getElementById('modal-completa-manut-mezzo');
    const idEl = document.getElementById('completa-manut-id');
    const operatoreEl = document.getElementById('completa-manut-operatore');
    const operatoreListaEl = document.getElementById('completa-manut-operatore-lista');

    if (!overlay || !form) {
        console.warn('Modale completa manutenzione non trovato');
        return { openById: async () => {}, close: () => {} };
    }

    async function caricaOperatoriSeServe() {
        if (operatoriCaricati) return;
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            operatoriCaricati = true;
            return;
        }
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const tesserati = await invoke('get_all_tesserati');
            const nomi = (Array.isArray(tesserati) ? tesserati : [])
                .filter((t) => isTruthyOperatoreFlag(t?.operatore))
                .map(nominativoOperatore)
                .filter(Boolean);
            operatoriNominativi = [...new Set(nomi)].sort((a, b) =>
                a.localeCompare(b, 'it', { sensitivity: 'base' })
            );
        } catch (err) {
            console.error('Errore operatori completa manutenzione:', err);
            operatoriNominativi = [];
        }
        operatoriCaricati = true;
    }

    const operatoreCombo = setupOperatoreCombo(
        operatoreEl,
        operatoreListaEl,
        () => operatoriNominativi,
        caricaOperatoriSeServe
    );

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('error', !!isError);
    }

    function close() {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        operatoreCombo.hide();
        setStatus('');
    }

    function fillForm(m, mezzo) {
        if (idEl) idEl.value = String(m.id || '');
        if (titoloMezzo) {
            titoloMezzo.textContent = mezzo
                ? etichettaMezzo(mezzo)
                : `Mezzo ${m.id_mezzo || ''}`;
        }
        const tip = String(m.tipologia || '').trim();
        let soglia = '';
        if (tip.toLowerCase() === 'km') {
            soglia = `Km previsti: ${m.km_previsto || '—'} (rif. ${m.km_riferimento || '—'} + ${m.delta_chilometri || '—'})`;
        } else {
            soglia = `Data prevista: ${m.data_prevista || '—'} (delta ${m.delta_giorni || '—'} giorni)`;
        }
        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.value = v == null ? '' : String(v);
        };
        // Data = esecuzione: se ancora vuota, proponi oggi
        setVal('completa-manut-data', m.data || oggiIt());
        setVal('completa-manut-tipologia', tip);
        setVal('completa-manut-soglia', soglia);
        setVal('completa-manut-stato', statoLabel(m.stato));
        setVal('completa-manut-motivazione', m.motivazione || '');
        setVal('completa-manut-operatore', m.operatore || '');
        setVal('completa-manut-presso', m.eseguita_presso || '');
        setVal('completa-manut-pagato', m.pagato || '');
        setVal('completa-manut-note', m.note_manutenzione || '');
        const riepilogo = document.getElementById('completa-manut-riepilogo');
        if (riepilogo) {
            riepilogo.textContent =
                'Inserisci la data in cui è stata fatta la manutenzione, completa i campi e segna come eseguita.';
        }
    }

    async function openById(idManutenzione, mezzoHint = null) {
        const id = Number(idManutenzione) || 0;
        if (!id) return;
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            setStatus('Disponibile solo nell\'app desktop', true);
            overlay.hidden = false;
            return;
        }
        setStatus('Caricamento…');
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const m = await invoke('get_manutenzione', { id });
            const mezzo = mezzoHint
                || (typeof trovaMezzo === 'function' ? trovaMezzo(m.id_mezzo) : null);
            fillForm(m, mezzo);
            setStatus('');
            await caricaOperatoriSeServe();
            document.getElementById('completa-manut-data')?.focus();
        } catch (error) {
            console.error('Errore apertura scheda manutenzione:', error);
            setStatus(`Errore: ${error?.message || error}`, true);
        }
    }

    function collectPayload(stato = null) {
        const id = Number(idEl?.value) || 0;
        const payload = {
            id,
            data: document.getElementById('completa-manut-data')?.value?.trim() || '',
            motivazione: document.getElementById('completa-manut-motivazione')?.value?.trim() || '',
            eseguita_presso: document.getElementById('completa-manut-presso')?.value?.trim() || '',
            pagato: document.getElementById('completa-manut-pagato')?.value?.trim() || '',
            note_manutenzione: document.getElementById('completa-manut-note')?.value?.trim() || '',
            operatore: document.getElementById('completa-manut-operatore')?.value?.trim() || ''
        };
        if (stato) payload.stato = stato;
        return payload;
    }

    async function salva(segnaEseguita) {
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            setStatus('Salvataggio solo nell\'app desktop', true);
            return;
        }
        const payload = collectPayload(segnaEseguita ? 'eseguita' : null);
        if (!payload.id) {
            setStatus('Scheda non valida', true);
            return;
        }
        if (segnaEseguita && !payload.data) {
            payload.data = oggiIt();
            const dataEl = document.getElementById('completa-manut-data');
            if (dataEl) dataEl.value = payload.data;
        }
        if (segnaEseguita && !payload.data) {
            setStatus('Inserisci la data di esecuzione', true);
            document.getElementById('completa-manut-data')?.focus();
            return;
        }
        const btnSalva = document.getElementById('btn-modal-completa-manut-salva');
        const btnEseg = document.getElementById('btn-modal-completa-manut-eseguita');
        if (btnSalva) btnSalva.disabled = true;
        if (btnEseg) btnEseg.disabled = true;
        setStatus(segnaEseguita ? 'Segno come eseguita…' : 'Salvataggio…');
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const saved = await invoke('salva_manutenzione', { input: payload });
            fillForm(saved, typeof trovaMezzo === 'function' ? trovaMezzo(saved.id_mezzo) : null);
            setStatus(segnaEseguita ? 'Manutenzione segnata come eseguita' : 'Salvato');
            if (typeof options.onSaved === 'function') {
                options.onSaved(saved);
            }
            if (segnaEseguita) {
                setTimeout(close, 700);
            }
        } catch (error) {
            console.error('Errore salvataggio scheda manutenzione:', error);
            setStatus(`Errore: ${error?.message || error}`, true);
        } finally {
            if (btnSalva) btnSalva.disabled = false;
            if (btnEseg) btnEseg.disabled = false;
        }
    }

    document.getElementById('btn-modal-completa-manut-close')?.addEventListener('click', close);
    document.getElementById('btn-modal-completa-manut-annulla')?.addEventListener('click', close);
    document.getElementById('btn-modal-completa-manut-salva')?.addEventListener('click', (e) => {
        e.preventDefault();
        salva(false);
    });
    document.getElementById('btn-modal-completa-manut-eseguita')?.addEventListener('click', (e) => {
        e.preventDefault();
        salva(true);
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        salva(false);
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) close();
    });

    return { openById, close };
}

/** Elenco manutenzioni scadute (scelta se ce ne sono più di una). */
export function initScaduteManutenzioniModal(options = {}) {
    const onScegli = options.onScegli || (() => {});
    const overlay = document.getElementById('modal-scadute-manutenzioni');
    const listaEl = document.getElementById('modal-scadute-manut-lista');

    if (!overlay || !listaEl) {
        return { open: () => {}, close: () => {} };
    }

    function close() {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
    }

    function open(scadute) {
        const list = Array.isArray(scadute) ? scadute : [];
        if (!list.length) {
            listaEl.innerHTML = '<div class="manut-elenco-empty">Nessuna manutenzione in scadenza</div>';
        } else {
            listaEl.innerHTML = list.map((s) => {
                const id = s.id ?? '';
                const mezzo = s.etichetta_mezzo || s.etichettaMezzo || `Mezzo ${s.id_mezzo || ''}`;
                const motiv = s.motivazione || 'Manutenzione';
                const tip = s.tipologia || '';
                const dettaglio = tip.toLowerCase() === 'km'
                    ? `Km previsti: ${s.km_previsto || '—'} (attuale ${s.ultimo_km || s.ultimoKm || '—'})`
                    : `Data prevista: ${s.data_prevista || s.dataPrevista || '—'}`;
                return `
                    <div class="manut-scaduta-item">
                        <div class="manut-scaduta-item-testo">
                            <strong>${escapeHtmlManut(mezzo)}</strong>
                            <span>${escapeHtmlManut(motiv)} — ${escapeHtmlManut(dettaglio)}</span>
                        </div>
                        <button type="button" data-scegli-id="${escapeHtmlManut(id)}">APRI SCHEDA</button>
                    </div>
                `;
            }).join('');
        }
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
    }

    listaEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-scegli-id]');
        if (!btn) return;
        const id = Number(btn.dataset.scegliId) || 0;
        if (!id) return;
        close();
        onScegli(id);
    });

    document.getElementById('btn-modal-scadute-manut-close')?.addEventListener('click', close);
    document.getElementById('btn-modal-scadute-manut-chiudi')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    return { open, close };
}

function isTruthyOperatoreFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value ?? '').trim().toUpperCase();
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' || s === 'YES' || s === 'Y';
}

function nominativoOperatore(t) {
    return String(
        t?.nominativo
        || t?.NominativoSocio
        || t?.nominativosocio
        || ''
    ).trim();
}

export function initManutenzioneMezzoModal(options = {}) {
    const getInvoke = options.getInvoke || (() => null);
    const isTauriEnv = options.isTauriEnv || (() => false);
    const getUltimoKm = options.getUltimoKm || (() => '');
    const etichettaMezzo = options.etichettaMezzo || (() => 'Mezzo');

    let mezzoCorrente = null;
    let operatoriNominativi = [];
    let operatoriCaricati = false;
    let operatoreActiveIndex = -1;

    const overlay = document.getElementById('modal-manutenzione');
    const form = document.getElementById('form-manutenzione');
    const statusEl = document.getElementById('modal-manutenzione-status');
    const titoloMezzo = document.getElementById('modal-manutenzione-mezzo');
    const tipologiaEl = document.getElementById('manut-tipologia');
    const deltaKmEl = document.getElementById('manut-delta-km');
    const deltaGiorniEl = document.getElementById('manut-delta-giorni');
    const kmRifEl = document.getElementById('manut-km-riferimento');
    const hintEl = document.getElementById('manut-hint');
    const operatoreEl = document.getElementById('manut-operatore');
    const operatoreListaEl = document.getElementById('manut-operatore-lista');

    if (!overlay || !form) {
        console.warn('Modale manutenzione non trovato nell\'HTML');
        return { open: () => {}, close: () => {} };
    }

    function setStatus(msg, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('error', !!isError);
    }

    function syncTipologiaUi() {
        const tip = (tipologiaEl?.value || 'Km').trim();
        const isKm = tip === 'Km';
        if (deltaKmEl) {
            deltaKmEl.disabled = !isKm;
            if (!isKm) deltaKmEl.value = '';
            else deltaKmEl.focus({ preventScroll: true });
        }
        if (deltaGiorniEl) {
            deltaGiorniEl.disabled = isKm;
            if (isKm) deltaGiorniEl.value = '';
        }
        if (hintEl) {
            hintEl.textContent = isKm
                ? 'Con Tipologia Km: l\'alert scatta a (km attuale + delta). La data di esecuzione si inserisce quando completi la manutenzione.'
                : 'Con Tipologia Giorni: l\'alert scatta tra N giorni da oggi. La data di esecuzione si inserisce quando completi la manutenzione.';
        }
    }

    function nascondiListaOperatori() {
        if (!operatoreListaEl) return;
        operatoreListaEl.hidden = true;
        operatoreListaEl.innerHTML = '';
        operatoreActiveIndex = -1;
    }

    function filtraOperatori(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return operatoriNominativi.slice(0, 40);
        return operatoriNominativi
            .filter((nome) => nome.toLowerCase().includes(q))
            .slice(0, 40);
    }

    function renderListaOperatori(query) {
        if (!operatoreListaEl) return;
        const items = filtraOperatori(query);
        if (!items.length) {
            operatoreListaEl.innerHTML = '<li class="manut-combo-empty">Nessun operatore trovato</li>';
            operatoreListaEl.hidden = false;
            operatoreActiveIndex = -1;
            return;
        }
        operatoreListaEl.innerHTML = items
            .map((nome, idx) => `
                <li class="manut-combo-item${idx === 0 ? ' active' : ''}"
                    role="option"
                    data-index="${idx}"
                    data-value="${escapeHtmlManut(nome)}">${escapeHtmlManut(nome)}</li>
            `)
            .join('');
        operatoreListaEl.hidden = false;
        operatoreActiveIndex = 0;
    }

    function scegliOperatore(nome) {
        if (operatoreEl) operatoreEl.value = nome || '';
        nascondiListaOperatori();
    }

    async function caricaOperatoriSeServe() {
        if (operatoriCaricati) return;
        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            operatoriNominativi = [];
            operatoriCaricati = true;
            return;
        }
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const tesserati = await invoke('get_all_tesserati');
            const nomi = (Array.isArray(tesserati) ? tesserati : [])
                .filter((t) => isTruthyOperatoreFlag(t?.operatore))
                .map(nominativoOperatore)
                .filter(Boolean);
            operatoriNominativi = [...new Set(nomi)].sort((a, b) =>
                a.localeCompare(b, 'it', { sensitivity: 'base' })
            );
            operatoriCaricati = true;
        } catch (error) {
            console.error('Errore caricamento operatori:', error);
            operatoriNominativi = [];
            operatoriCaricati = true;
        }
    }

    function close() {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        mezzoCorrente = null;
        nascondiListaOperatori();
        setStatus('');
    }

    async function open(mezzo) {
        if (!mezzo || !mezzo.id) return;
        mezzoCorrente = mezzo;
        form.reset();

        if (tipologiaEl) tipologiaEl.value = 'Km';
        if (operatoreEl) operatoreEl.value = '';
        nascondiListaOperatori();

        const km = getUltimoKm(mezzo);
        if (kmRifEl) kmRifEl.value = km || '';

        if (titoloMezzo) {
            titoloMezzo.textContent = etichettaMezzo(mezzo);
        }

        // Default: Km attivo, Delta giorni spento
        // (Data esecuzione si inserisce solo a completamento)
        syncTipologiaUi();
        setStatus('');
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        document.getElementById('manut-delta-km')?.focus();

        await caricaOperatoriSeServe();
    }

    async function save() {
        if (!mezzoCorrente) return;
        const tip = (tipologiaEl?.value || 'Km').trim();
        const payload = {
            id_mezzo: Number(mezzoCorrente.id) || 0,
            tipologia: tip,
            motivazione: document.getElementById('manut-motivazione')?.value?.trim() || '',
            eseguita_presso: document.getElementById('manut-eseguita-presso')?.value?.trim() || '',
            pagato: document.getElementById('manut-pagato')?.value?.trim() || '',
            note_manutenzione: document.getElementById('manut-note')?.value?.trim() || '',
            operatore: operatoreEl?.value?.trim() || '',
            delta_giorni: tip === 'Giorni' ? (deltaGiorniEl?.value?.trim() || '') : '',
            delta_chilometri: tip === 'Km' ? (deltaKmEl?.value?.trim() || '') : '',
            km_riferimento: document.getElementById('manut-km-riferimento')?.value?.trim() || ''
        };

        if (!payload.id_mezzo) {
            setStatus('Mezzo non valido', true);
            return;
        }
        if (tip === 'Km' && !payload.delta_chilometri) {
            setStatus('Inserisci i km (DeltaChilometri)', true);
            deltaKmEl?.focus();
            return;
        }
        if (tip === 'Giorni' && !payload.delta_giorni) {
            setStatus('Inserisci i giorni (DeltaGiorni)', true);
            deltaGiorniEl?.focus();
            return;
        }

        const invoke = getInvoke();
        if (!isTauriEnv() || !invoke) {
            setStatus('Salvataggio disponibile solo nell\'app desktop', true);
            return;
        }

        const btn = document.getElementById('btn-modal-manut-salva');
        if (btn) btn.disabled = true;
        setStatus('Salvataggio…');

        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('create_manutenzione', { input: payload });
            setStatus('Manutenzione programmata');
            setTimeout(close, 500);
            if (typeof options.onSaved === 'function') {
                options.onSaved(mezzoCorrente);
            }
        } catch (error) {
            console.error('Errore salvataggio manutenzione:', error);
            setStatus(`Errore: ${error?.message || error}`, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    tipologiaEl?.addEventListener('change', () => {
        syncTipologiaUi();
        if ((tipologiaEl.value || '') === 'Giorni') {
            deltaGiorniEl?.focus();
        } else {
            deltaKmEl?.focus();
        }
    });

    operatoreEl?.addEventListener('focus', async () => {
        await caricaOperatoriSeServe();
        renderListaOperatori(operatoreEl.value);
    });
    operatoreEl?.addEventListener('input', () => {
        renderListaOperatori(operatoreEl.value);
    });
    operatoreEl?.addEventListener('keydown', (e) => {
        if (operatoreListaEl?.hidden) {
            if (e.key === 'ArrowDown') {
                renderListaOperatori(operatoreEl.value);
                e.preventDefault();
            }
            return;
        }
        const items = [...operatoreListaEl.querySelectorAll('.manut-combo-item')];
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            operatoreActiveIndex = Math.min(items.length - 1, operatoreActiveIndex + 1);
            items.forEach((el, i) => el.classList.toggle('active', i === operatoreActiveIndex));
            items[operatoreActiveIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            operatoreActiveIndex = Math.max(0, operatoreActiveIndex - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === operatoreActiveIndex));
            items[operatoreActiveIndex]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = items[operatoreActiveIndex] || items[0];
            if (chosen) scegliOperatore(chosen.dataset.value || chosen.textContent);
        } else if (e.key === 'Escape') {
            nascondiListaOperatori();
        }
    });
    operatoreListaEl?.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.manut-combo-item');
        if (!item) return;
        e.preventDefault();
        scegliOperatore(item.dataset.value || item.textContent);
    });
    operatoreEl?.addEventListener('blur', () => {
        setTimeout(nascondiListaOperatori, 150);
    });

    document.getElementById('btn-modal-manut-close')?.addEventListener('click', close);
    document.getElementById('btn-modal-manut-annulla')?.addEventListener('click', close);
    document.getElementById('btn-modal-manut-salva')?.addEventListener('click', (e) => {
        e.preventDefault();
        save();
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        save();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.hidden) {
            if (!operatoreListaEl?.hidden) {
                nascondiListaOperatori();
                return;
            }
            close();
        }
    });

    return { open, close };
}

export { escapeHtmlManut };
