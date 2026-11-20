/**
 * Pagamento cumulativo da Elenco Servizi.
 * Spunta i servizi → PAGA TUTTI → modale → conferma.
 * Togliendo la spunta si azzera il pagamento (DA INCASSARE) e si esce dal gruppo.
 */

import { risolviAccountCollegato } from './auth-session.js';

const PCUM_START = '[[PCUM]]';
const PCUM_END = '[[/PCUM]]';

/** Id servizi selezionati (spunta attiva, anche su altre pagine). */
const selezionati = new Set();

let getInvoke = () => null;
let isTauriEnv = () => false;
let getServizioById = () => null;
let getTipiPagamento = () => [];
let onServiziAggiornati = async () => {};
let onSelezioneCambio = () => {};
let onFiltraGruppo = async (_numero) => {};

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Compatibilità: vecchio blocco [[PCUM]]...[[/PCUM]] nelle note. */
export function parsePagamentoCumulativoDaNote(noteFine) {
    const raw = String(noteFine || '');
    const i = raw.indexOf(PCUM_START);
    if (i < 0) return { info: null, notePulite: raw };
    const j = raw.indexOf(PCUM_END, i);
    if (j < 0) return { info: null, notePulite: raw };
    const json = raw.slice(i + PCUM_START.length, j).trim();
    let info = null;
    try {
        info = JSON.parse(json);
    } catch (_) {
        info = { gruppo: '', ref: '' };
    }
    const notePulite = `${raw.slice(0, i)}${raw.slice(j + PCUM_END.length)}`
        .replace(/^\s*\n/, '')
        .trim();
    return { info, notePulite };
}

function isTruthyFlag(value) {
    if (value === true || value === 1) return true;
    const s = String(value ?? '').trim().toUpperCase();
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' || s === 'YES' || s === 'Y';
}

/** Preferisce le colonne Supabase; se false/assenti, prova il vecchio marker nelle note. */
export function isPagamentoCumulativo(servizio) {
    if (!servizio) return false;
    if (isTruthyFlag(servizio.pagamento_cumulativo ?? servizio.PagamentoCumulativo)) {
        return true;
    }
    return Boolean(parsePagamentoCumulativoDaNote(servizio.note_fine_servizio).info);
}

function numeroGruppoDaServizio(servizio) {
    const n = Number(
        servizio?.pagamento_cumulativo_numero
        ?? servizio?.PagamentoCumulativo_Numero
        ?? 0
    );
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    const gruppo = String(
        servizio?.pagamento_cumulativo_gruppo
        ?? servizio?.PagamentoCumulativo_Gruppo
        ?? ''
    ).trim();
    if (/^\d+$/.test(gruppo)) return parseInt(gruppo, 10);
    return 0;
}

export function infoPagamentoCumulativo(servizio) {
    if (!servizio) return null;
    if (isTruthyFlag(servizio.pagamento_cumulativo ?? servizio.PagamentoCumulativo)) {
        return {
            ref: String(
                servizio.pagamento_cumulativo_rif
                ?? servizio.PagamentoCumulativo_Rif
                ?? ''
            ).trim(),
            gruppo: String(
                servizio.pagamento_cumulativo_gruppo
                ?? servizio.PagamentoCumulativo_Gruppo
                ?? ''
            ).trim(),
            numero: numeroGruppoDaServizio(servizio)
        };
    }
    const daNote = parsePagamentoCumulativoDaNote(servizio.note_fine_servizio).info;
    if (!daNote) return null;
    return {
        ...daNote,
        numero: numeroGruppoDaServizio({ pagamento_cumulativo_gruppo: daNote.gruppo })
    };
}

let confermaRimuoviResolver = null;

export function initPagamentoCumulativo(deps = {}) {
    getInvoke = deps.getInvoke || getInvoke;
    isTauriEnv = deps.isTauriEnv || isTauriEnv;
    getServizioById = deps.getServizioById || getServizioById;
    getTipiPagamento = deps.getTipiPagamento || getTipiPagamento;
    onServiziAggiornati = deps.onServiziAggiornati || onServiziAggiornati;
    onSelezioneCambio = deps.onSelezioneCambio || onSelezioneCambio;
    onFiltraGruppo = deps.onFiltraGruppo || onFiltraGruppo;
}

export function setupPagamentoCumulativo() {
    document.getElementById('btn-paga-tutti')?.addEventListener('click', apriModalePagaTutti);
    document.getElementById('btn-pcum-annulla')?.addEventListener('click', chiudiModalePagaTutti);
    document.getElementById('btn-pcum-chiudi')?.addEventListener('click', chiudiModalePagaTutti);
    document.getElementById('btn-pcum-conferma')?.addEventListener('click', confermaPagaTutti);

    document.getElementById('btn-pcum-rimuovi-annulla')?.addEventListener('click', () => chiudiModaleConfermaRimuovi(false));
    document.getElementById('btn-pcum-rimuovi-chiudi')?.addEventListener('click', () => chiudiModaleConfermaRimuovi(false));
    document.getElementById('btn-pcum-rimuovi-conferma')?.addEventListener('click', () => chiudiModaleConfermaRimuovi(true));

    const overlayPaga = document.getElementById('modal-pagamento-cumulativo');
    overlayPaga?.addEventListener('click', (e) => {
        if (e.target === overlayPaga) chiudiModalePagaTutti();
    });
    const overlayRimuovi = document.getElementById('modal-pcum-conferma-rimuovi');
    overlayRimuovi?.addEventListener('click', (e) => {
        if (e.target === overlayRimuovi) chiudiModaleConfermaRimuovi(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const rimuovi = document.getElementById('modal-pcum-conferma-rimuovi');
        if (rimuovi && rimuovi.style.display !== 'none') {
            chiudiModaleConfermaRimuovi(false);
            return;
        }
        const m = document.getElementById('modal-pagamento-cumulativo');
        if (m && m.style.display !== 'none') chiudiModalePagaTutti();
    });

    aggiornaBottonePagaTutti();
}

/** HTML casella + eventuale badge da mettere in ogni riga servizio. */
export function htmlCheckboxPagamentoCumulativo(servizio) {
    const id = String(servizio?.id || '').trim();
    if (!id) return '';
    const giaCumulativo = isPagamentoCumulativo(servizio);
    // I servizi già pagati in cumulativo restano spuntati a video,
    // ma NON entrano nella selezione per un nuovo "PAGA TUTTI".
    if (giaCumulativo) selezionati.delete(id);
    const checked = giaCumulativo || selezionati.has(id);
    const info = infoPagamentoCumulativo(servizio);
    const ref = String(info?.ref || '').trim();
    const numero = Number(info?.numero || 0);
    const titoloBadge = `Pagato con bonifico cumulativo${numero ? ` n. ${numero}` : ''}${ref ? ` — ${ref}` : ''}`;
    const badge = giaCumulativo
        ? `<span class="pcum-badge" title="${escapeHtml(titoloBadge)}">
                CUMULATIVO
                ${numero > 0
                    ? `<button type="button" class="pcum-gruppo-num" data-pcum-numero="${numero}" title="Filtra elenco: solo pagamento cumulativo n. ${numero}">n. ${numero}</button>`
                    : ''}
                ${ref ? `<span class="pcum-badge-rif">${escapeHtml(ref)}</span>` : ''}
           </span>`
        : '';
    return `
        <div class="pcum-check-inner${giaCumulativo ? ' is-pagato' : ''}">
            <label class="pcum-check-label">
                <input type="checkbox"
                    class="pcum-check"
                    data-servizio-id="${escapeHtml(id)}"
                    ${checked ? 'checked' : ''}
                    ${giaCumulativo ? 'data-gia-cumulativo="1"' : ''}
                    ${numero > 0 ? `data-pcum-numero="${numero}"` : ''}>
                <span>Pagamento cumulativo</span>
            </label>
            ${badge}
        </div>`;
}

/** Collegare dopo ogni render della lista. */
export function collegaCheckboxPagamentoCumulativo(container) {
    if (!container) return;
    container.querySelectorAll('.pcum-check').forEach((el) => {
        el.addEventListener('change', onChangeCheckbox);
    });
    container.querySelectorAll('.pcum-gruppo-num').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const numero = parseInt(btn.getAttribute('data-pcum-numero') || '0', 10);
            if (numero > 0) {
                try {
                    await onFiltraGruppo(numero);
                } catch (err) {
                    console.error(err);
                    alert('Errore nel filtro gruppo: ' + (err?.message || err));
                }
            }
        });
    });
    aggiornaBottonePagaTutti();
}

function apriModaleConfermaRimuovi(numero) {
    return new Promise((resolve) => {
        confermaRimuoviResolver = resolve;
        const testo = document.getElementById('pcum-rimuovi-testo');
        if (testo) {
            testo.innerHTML = numero > 0
                ? `Il servizio uscirà dal pagamento cumulativo <strong>n. ${numero}</strong>. Lo stato tornerà a <strong>DA INCASSARE</strong> e i dati di pagamento (tipo, date, ricevuta) verranno azzerati.`
                : 'Il servizio uscirà dal pagamento cumulativo. Lo stato tornerà a <strong>DA INCASSARE</strong> e i dati di pagamento (tipo, date, ricevuta) verranno azzerati.';
        }
        const modal = document.getElementById('modal-pcum-conferma-rimuovi');
        if (modal) {
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
        }
    });
}

function chiudiModaleConfermaRimuovi(confermato) {
    const modal = document.getElementById('modal-pcum-conferma-rimuovi');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    const resolve = confermaRimuoviResolver;
    confermaRimuoviResolver = null;
    if (typeof resolve === 'function') resolve(Boolean(confermato));
}

async function onChangeCheckbox(e) {
    const el = e.target;
    const id = String(el.getAttribute('data-servizio-id') || '').trim();
    if (!id) return;

    const giaCumulativo = el.getAttribute('data-gia-cumulativo') === '1'
        || isPagamentoCumulativo(getServizioById(id));

    if (el.checked) {
        // Solo i servizi NON ancora cumulativi entrano nella selezione "PAGA TUTTI"
        if (!giaCumulativo) selezionati.add(id);
        else selezionati.delete(id);
        aggiornaBottonePagaTutti();
        onSelezioneCambio();
        return;
    }

    // Tolto spunta
    selezionati.delete(id);

    if (!giaCumulativo) {
        aggiornaBottonePagaTutti();
        onSelezioneCambio();
        return;
    }

    const numero = parseInt(el.getAttribute('data-pcum-numero') || '0', 10)
        || numeroGruppoDaServizio(getServizioById(id));
    const ok = await apriModaleConfermaRimuovi(numero);
    if (!ok) {
        el.checked = true;
        selezionati.delete(id);
        aggiornaBottonePagaTutti();
        return;
    }

    el.disabled = true;
    try {
        await rimuoviServizioDaPagamentoCumulativo(id);
        selezionati.delete(id);
    } catch (err) {
        console.error(err);
        alert('Errore nell\'azzeramento: ' + (err?.message || err));
        el.checked = true;
        selezionati.delete(id);
    } finally {
        el.disabled = false;
        aggiornaBottonePagaTutti();
        onSelezioneCambio();
    }
}

function aggiornaBottonePagaTutti() {
    const btn = document.getElementById('btn-paga-tutti');
    const countEl = document.getElementById('pcum-selezione-count');
    const n = selezionati.size;
    if (countEl) countEl.textContent = String(n);
    if (btn) {
        btn.disabled = n < 2;
        btn.title = n < 2
            ? 'Seleziona almeno 2 servizi con la casella «Pagamento cumulativo»'
            : `Paga insieme ${n} servizi selezionati`;
    }
}

export function getSelezionePagamentoCumulativoCount() {
    return selezionati.size;
}

function idsSelezionatiOrdinati() {
    return [...selezionati]
        .map((id) => parseInt(id, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
}

async function apriModalePagaTutti() {
    const ids = idsSelezionatiOrdinati();
    if (ids.length < 2) {
        alert('Seleziona almeno 2 servizi con la casella «Pagamento cumulativo».');
        return;
    }

    const lista = document.getElementById('pcum-lista-servizi');
    const selectTipo = document.getElementById('pcum-tipo-pagamento');
    const errEl = document.getElementById('pcum-errore');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }

    let totale = 0;
    const righe = ids.map((id) => {
        const s = getServizioById(id) || {};
        const importo = parseImportoEuro(s.pagamento);
        if (importo != null) totale += importo;
        const info = infoPagamentoCumulativo(s);
        const badge = info ? ' <em>(già cumulativo)</em>' : '';
        return `<li><strong>n. ${id}</strong> — ${escapeHtml(s.socio_trasportato || '')} — ${escapeHtml(s.data_prelievo || '')} — ${escapeHtml(s.pagamento || '—')}${badge}</li>`;
    });
    if (lista) {
        lista.innerHTML = `${righe.join('')}<li class="pcum-totale">Totale donazioni servizi: <strong>${formatEuro(totale)}</strong> (informativo)</li>`;
    }

    if (selectTipo) {
        const set = new Set(
            (getTipiPagamento() || []).map((t) => String(t).trim()).filter(Boolean)
        );
        try {
            const invoke = getInvoke();
            if (isTauriEnv() && invoke) {
                const tipiDb = await invoke('get_all_tipi_pagamento').catch(() => []);
                (tipiDb || []).forEach((t) => {
                    const nome = String(t || '').trim();
                    if (nome) set.add(nome);
                });
            }
        } catch (_) { /* ignora */ }
        if (!set.has('BONIFICO')) set.add('BONIFICO');

        const corrente = selectTipo.value;
        selectTipo.innerHTML = '<option value="">— Seleziona —</option>';
        [...set].sort((a, b) => a.localeCompare(b, 'it')).forEach((tipo) => {
            const opt = document.createElement('option');
            opt.value = tipo;
            opt.textContent = tipo;
            selectTipo.appendChild(opt);
        });
        selectTipo.value = corrente && set.has(corrente) ? corrente : 'BONIFICO';
    }

    const stato = document.getElementById('pcum-stato-incasso');
    if (stato) stato.value = 'INCASSATO';

    const oggi = new Date();
    const iso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`;
    const dataBonifico = document.getElementById('pcum-data-bonifico');
    if (dataBonifico && !dataBonifico.value) dataBonifico.value = iso;

    const modal = document.getElementById('modal-pagamento-cumulativo');
    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }
}

function chiudiModalePagaTutti() {
    const modal = document.getElementById('modal-pagamento-cumulativo');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
}

function mostraErrorePcum(msg) {
    const errEl = document.getElementById('pcum-errore');
    if (!errEl) {
        alert(msg);
        return;
    }
    errEl.textContent = msg;
    errEl.hidden = false;
}

async function confermaPagaTutti() {
    const ids = idsSelezionatiOrdinati();
    if (ids.length < 2) {
        mostraErrorePcum('Seleziona almeno 2 servizi.');
        return;
    }

    const stato = String(document.getElementById('pcum-stato-incasso')?.value || '').trim();
    const tipo = String(document.getElementById('pcum-tipo-pagamento')?.value || '').trim();
    const dataBonifico = String(document.getElementById('pcum-data-bonifico')?.value || '').trim();
    const dataRicevuta = String(document.getElementById('pcum-data-ricevuta')?.value || '').trim();
    const numeroRicevuta = String(document.getElementById('pcum-numero-ricevuta')?.value || '').trim();
    const riferimento = String(document.getElementById('pcum-riferimento')?.value || '').trim();

    if (!stato) {
        mostraErrorePcum('Scegli lo stato incasso.');
        return;
    }
    if (!tipo) {
        mostraErrorePcum('Scegli il tipo di pagamento.');
        return;
    }
    if (!dataBonifico) {
        mostraErrorePcum('Inserisci la data incasso / bonifico.');
        return;
    }

    const btn = document.getElementById('btn-pcum-conferma');
    if (btn) btn.disabled = true;

    try {
        if (!isTauriEnv()) {
            throw new Error('Funzione disponibile solo nell\'app desktop.');
        }
        const invoke = getInvoke();
        if (!invoke) throw new Error('Connessione non disponibile.');

        await invoke('init_supabase_from_config').catch(() => {});
        const account = await risolviAccountCollegato(invoke);

        const aggiornati = await invoke('applica_pagamento_cumulativo', {
            input: {
                ids,
                statoIncasso: stato,
                tipoPagamento: tipo,
                dataBonifico: dataIsoToItaliana(dataBonifico),
                dataRicevuta: dataRicevuta ? dataIsoToItaliana(dataRicevuta) : '',
                numeroRicevuta,
                riferimento,
                modificatoDa: account || null
            }
        });

        // Ricarica i servizi aggiornati in cache
        const aggiornatiList = [];
        for (const id of ids) {
            try {
                const s = await invoke('get_servizio_completo', { servizioId: id });
                if (s) aggiornatiList.push(s);
            } catch (err) {
                console.warn('Ricarica servizio', id, err);
            }
        }
        // Escono dalla selezione: ora sono già pagati in cumulativo
        ids.forEach((id) => selezionati.delete(String(id)));
        await onServiziAggiornati(aggiornatiList);
        chiudiModalePagaTutti();
        alert(`Pagamento cumulativo applicato a ${aggiornati} servizi.`);
    } catch (err) {
        console.error(err);
        mostraErrorePcum('Errore: ' + (err?.message || err));
    } finally {
        if (btn) btn.disabled = false;
        aggiornaBottonePagaTutti();
    }
}

async function rimuoviServizioDaPagamentoCumulativo(id) {
    if (!isTauriEnv()) {
        throw new Error('Funzione disponibile solo nell\'app desktop.');
    }
    const invoke = getInvoke();
    if (!invoke) throw new Error('Connessione non disponibile.');

    await invoke('init_supabase_from_config').catch(() => {});
    const account = await risolviAccountCollegato(invoke);
    const idNum = parseInt(id, 10);
    await invoke('rimuovi_pagamento_cumulativo', {
        id: idNum,
        modificatoDa: account || null
    });

    let aggiornato = null;
    try {
        aggiornato = await invoke('get_servizio_completo', { servizioId: idNum });
    } catch (_) {
        const locale = getServizioById(id);
        if (locale) {
            const { notePulite } = parsePagamentoCumulativoDaNote(locale.note_fine_servizio);
            aggiornato = {
                ...locale,
                stato_incasso: 'DA INCASSARE',
                tipo_pagamento: '',
                data_bonifico: '',
                data_ricevuta: '',
                numero_ricevuta: '',
                pagamento_cumulativo: false,
                pagamento_cumulativo_rif: '',
                pagamento_cumulativo_gruppo: '',
                pagamento_cumulativo_numero: 0,
                note_fine_servizio: notePulite
            };
        }
    }
    if (aggiornato) {
        await onServiziAggiornati([aggiornato]);
    }
}

function dataIsoToItaliana(iso) {
    const s = String(iso || '').trim().slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseImportoEuro(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const cleaned = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

function formatEuro(n) {
    try {
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
    } catch (_) {
        return `${(n || 0).toFixed(2)} €`;
    }
}
