/**
 * Totale KM dell'operatore nel mese della data di partenza.
 * Eseguiti = KM reali.
 * Da eseguire = KM della tratta fuori Asti (sia come PARTENZA sia come DESTINAZIONE)
 * oppure chilometraggio minimo.
 * Esclusi i servizi non rimborsabili (richiedente AUSER GRATIS) e gli annullati.
 */

import { parseTrattaDaNote, normalizzaPayloadTratta } from './tratta-riepilogo.js';

const MESI_IT = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const KM_MINIMO_DEFAULT = 15;
const KM_MASSIMI_DEFAULT = 500;

let kmMinimoCache = null;
let kmMassimiCache = null;
let tratteCache = null;
const serviziPerAnno = {};
const seqHint = new WeakMap();
const ultimoAvvisoKey = new WeakMap();

function parseKm(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let s = String(value).trim();
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s.replace(/[^\d.-]/g, ''));
    return Number.isNaN(n) ? 0 : n;
}

function formatKm(value) {
    const n = typeof value === 'number' ? value : parseKm(value);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace('.', ',');
}

function normalizzaNome(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function normalizzaChiaveImpostazione(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseDataPrelievo(value) {
    const s = String(value || '').trim();
    if (!s) return null;
    const it = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (it) {
        const d = new Date(parseInt(it[3], 10), parseInt(it[2], 10) - 1, parseInt(it[1], 10));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
        const date = new Date(y, mo - 1, d);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function isNonRimborsabile(servizio) {
    const r = String(servizio?.richiedente || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');
    return r.includes('GRATIS');
}

function isAnnullato(servizio) {
    return String(servizio?.stato_servizio || '').toUpperCase().includes('ANNULL');
}

function isEseguito(servizio) {
    return String(servizio?.stato_servizio || '').trim().toUpperCase() === 'ESEGUITO';
}

function servizioDellOperatore(servizio, nomeOperatore) {
    const target = normalizzaNome(nomeOperatore);
    if (!target) return false;
    return normalizzaNome(servizio?.operatore) === target
        || normalizzaNome(servizio?.operatore_2) === target;
}

function isComuneAsti(value) {
    const n = normalizzaNome(value);
    return n === 'ASTI' || n === 'ASTI AT' || n.startsWith('ASTI ');
}

function kmDaPayloadTratta(tratta) {
    const t = normalizzaPayloadTratta(tratta) || tratta || {};
    return parseKm(t.km) || parseKm(t.km_ar) || parseKm(t.KmAr);
}

/** Trova una tratta fuori Asti dal comune di destinazione (prima) o di prelievo. */
function trattaDaComuni(tratte, comuneDestinazione, comunePrelievo) {
    const lista = Array.isArray(tratte) ? tratte : [];
    if (!lista.length) return null;

    const trova = (comune) => {
        const nome = normalizzaNome(comune);
        if (!nome || isComuneAsti(nome)) return null;
        return lista.find((t) => normalizzaNome(t?.comune) === nome)
            || lista.find((t) => {
                const c = normalizzaNome(t?.comune);
                return c && (nome.includes(c) || c.includes(nome));
            })
            || null;
    };

    // Destinazione prima: la tratta fuori Asti è spesso l'arrivo
    return trova(comuneDestinazione) || trova(comunePrelievo) || null;
}

function trattaDelServizio(servizio, tratte = null) {
    const daNote = normalizzaPayloadTratta(servizio?.tratta_fuori_asti)
        || parseTrattaDaNote(servizio?.note_fine_servizio).tratta
        || parseTrattaDaNote(servizio?.note_prelievo).tratta
        || parseTrattaDaNote(servizio?.note_arrivo).tratta
        || null;
    if (kmDaPayloadTratta(daNote) > 0) return daNote;
    return trattaDaComuni(
        tratte ?? tratteCache,
        servizio?.comune_destinazione,
        servizio?.comune_prelievo
    );
}

function kmPrevistiDaEseguire(servizio, kmMinimo, tratte = null) {
    const trattaKm = kmDaPayloadTratta(trattaDelServizio(servizio, tratte));
    if (trattaKm > 0) return trattaKm;
    return Number(kmMinimo) > 0 ? Number(kmMinimo) : KM_MINIMO_DEFAULT;
}

function kmMinimoDaImpostazioni(rows) {
    if (!Array.isArray(rows)) return KM_MINIMO_DEFAULT;
    const alias = new Set([
        'chilometraggiominimo',
        'kmminimo',
        'minimokm',
        'chilometraggiomin'
    ]);
    for (const row of rows) {
        const chiave = normalizzaChiaveImpostazione(row?.impostazione);
        if (!alias.has(chiave) && !chiave.includes('chilometraggiominimo')) continue;
        const n = parseKm(row?.valore);
        if (n > 0) return n;
    }
    return KM_MINIMO_DEFAULT;
}

function kmMassimiDaImpostazioni(rows) {
    if (!Array.isArray(rows)) return KM_MASSIMI_DEFAULT;
    for (const row of rows) {
        const chiave = normalizzaChiaveImpostazione(row?.impostazione);
        const match =
            chiave === 'kmmassimioperatorepermese'
            || chiave === 'kmmassimioperatore'
            || chiave.includes('kmmassimioperatore')
            || (chiave.includes('kmmassimi') && chiave.includes('mese'));
        if (!match) continue;
        const n = parseKm(row?.valore);
        if (n > 0) return n;
    }
    return KM_MASSIMI_DEFAULT;
}

function applicaCacheImpostazioniKm(rows) {
    kmMinimoCache = kmMinimoDaImpostazioni(rows);
    kmMassimiCache = kmMassimiDaImpostazioni(rows);
}

function annoDaData(dataPrelievo) {
    const d = parseDataPrelievo(dataPrelievo);
    return d ? d.getFullYear() : new Date().getFullYear();
}

async function getInvokeSafe(getInvoke) {
    if (typeof getInvoke === 'function') return getInvoke();
    return getInvoke || null;
}

/** Carica (e tiene in cache) chilometraggio minimo + servizi dell'anno. */
export async function ensureDatiKmOperatoreMese({ getInvoke, isTauri, anno } = {}) {
    const tauriOk = typeof isTauri === 'function' ? isTauri() : Boolean(isTauri);
    const inv = await getInvokeSafe(getInvoke);
    if (!tauriOk || !inv) {
        return {
            kmMinimo: kmMinimoCache ?? KM_MINIMO_DEFAULT,
            kmMassimi: kmMassimiCache ?? KM_MASSIMI_DEFAULT,
            servizi: [],
            tratte: tratteCache || []
        };
    }

    const year = Number(anno) || new Date().getFullYear();

    try {
        await inv('init_supabase_from_config').catch(() => {});
        if (kmMinimoCache == null || kmMassimiCache == null) {
            const rows = await inv('get_all_impostazioni');
            applicaCacheImpostazioniKm(rows);
        }
        if (tratteCache == null) {
            try {
                const elenco = await inv('get_all_tratte');
                tratteCache = Array.isArray(elenco?.tratte) ? elenco.tratte : [];
            } catch (err) {
                console.warn('Caricamento tratte fuori Asti per KM:', err);
                tratteCache = [];
            }
        }
        if (!serviziPerAnno[year]) {
            const list = await inv('get_all_servizi_completi', { anno: year, tuttiAnni: false });
            serviziPerAnno[year] = Array.isArray(list) ? list : [];
        }
    } catch (err) {
        console.warn('Caricamento KM operatore:', err);
        if (kmMinimoCache == null) kmMinimoCache = KM_MINIMO_DEFAULT;
        if (kmMassimiCache == null) kmMassimiCache = KM_MASSIMI_DEFAULT;
        if (tratteCache == null) tratteCache = [];
        if (!serviziPerAnno[year]) serviziPerAnno[year] = [];
    }

    return {
        kmMinimo: kmMinimoCache ?? KM_MINIMO_DEFAULT,
        kmMassimi: kmMassimiCache ?? KM_MASSIMI_DEFAULT,
        servizi: serviziPerAnno[year] || [],
        tratte: tratteCache || []
    };
}

export function calcolaRiepilogoKmOperatore({
    servizi = [],
    operatore = '',
    dataPrelievo = '',
    kmMinimo = KM_MINIMO_DEFAULT,
    escludiId = '',
    tratte = null
} = {}) {
    const d = parseDataPrelievo(dataPrelievo);
    const vuoto = {
        meseLabel: '',
        anno: 0,
        eseguiti: 0,
        daEseguire: 0,
        totale: 0
    };
    if (!d || !normalizzaNome(operatore)) return vuoto;

    const anno = d.getFullYear();
    const mese = d.getMonth();
    const idDaEscludere = String(escludiId || '').trim();
    const elencoTratte = tratte ?? tratteCache;
    let eseguiti = 0;
    let daEseguire = 0;

    (servizi || []).forEach((s) => {
        if (idDaEscludere && String(s?.id || '').trim() === idDaEscludere) return;
        if (!servizioDellOperatore(s, operatore)) return;
        if (isAnnullato(s) || isNonRimborsabile(s)) return;
        const ds = parseDataPrelievo(s.data_prelievo);
        if (!ds || ds.getFullYear() !== anno || ds.getMonth() !== mese) return;
        if (isEseguito(s)) {
            eseguiti += parseKm(s.km);
        } else {
            daEseguire += kmPrevistiDaEseguire(s, kmMinimo, elencoTratte);
        }
    });

    return {
        meseLabel: MESI_IT[mese] || '',
        anno,
        eseguiti,
        daEseguire,
        totale: eseguiti + daEseguire
    };
}

/** KM che questo servizio aggiungerà (eseguito = KM reali, altrimenti tratta o minimo).
 * La tratta vale sia come PARTENZA sia come DESTINAZIONE. */
export function stimaKmServizioCorrente({
    tratta = null,
    statoServizio = '',
    kmReali = '',
    kmMinimo = KM_MINIMO_DEFAULT,
    comuneDestinazione = '',
    comunePrelievo = '',
    tratte = null
} = {}) {
    if (isEseguito({ stato_servizio: statoServizio })) {
        return parseKm(kmReali);
    }
    const trattaKm = kmDaPayloadTratta(tratta);
    if (trattaKm > 0) return trattaKm;
    const daComune = trattaDaComuni(
        tratte ?? tratteCache,
        comuneDestinazione,
        comunePrelievo
    );
    const kmComune = kmDaPayloadTratta(daComune);
    if (kmComune > 0) return kmComune;
    return Number(kmMinimo) > 0 ? Number(kmMinimo) : KM_MINIMO_DEFAULT;
}

function applicaKmCorrenteAlRiepilogo(riepilogo, {
    tratta = null,
    statoServizio = '',
    kmReali = '',
    kmMinimo = KM_MINIMO_DEFAULT,
    richiedente = '',
    comuneDestinazione = '',
    comunePrelievo = '',
    tratte = null
} = {}) {
    if (!riepilogo?.meseLabel) return riepilogo;
    if (isNonRimborsabile({ richiedente })) return { ...riepilogo };
    const km = stimaKmServizioCorrente({
        tratta,
        statoServizio,
        kmReali,
        kmMinimo,
        comuneDestinazione,
        comunePrelievo,
        tratte
    });
    const next = { ...riepilogo };
    if (isEseguito({ stato_servizio: statoServizio })) {
        next.eseguiti += km;
    } else {
        next.daEseguire += km;
    }
    next.totale = next.eseguiti + next.daEseguire;
    return next;
}

export function messaggioLimiteKmOperatore({
    totaleEsistente = 0,
    kmCorrente = 0,
    kmMassimi = KM_MASSIMI_DEFAULT
} = {}) {
    const max = Number(kmMassimi) > 0 ? Number(kmMassimi) : KM_MASSIMI_DEFAULT;
    const esistente = Number(totaleEsistente) || 0;
    const corrente = Number(kmCorrente) || 0;
    if (esistente >= max) {
        return `L'OPERATORE TRA ESEGUITI e DA ESEGUIRE HA GIA' RAGGIUNTO I ${formatKm(max)} KM SELEZIONALO SOLO SE STRETTAMENTE NECESSARIO`;
    }
    const totaleCon = esistente + corrente;
    if (totaleCon > max) {
        return `CON QUESTO SERVIZIO L'OPERATORE ARRIVA A KM ${formatKm(totaleCon)}. TIENI PRESENTE CHE IL MASSIMO MENSILE E' KM ${formatKm(max)}`;
    }
    return '';
}

export async function avvisaSeLimiteKmOperatore({
    getInvoke,
    isTauri,
    operatore,
    dataPrelievo,
    tratta = null,
    statoServizio = '',
    kmReali = '',
    escludiId = '',
    richiedente = '',
    comuneDestinazione = '',
    comunePrelievo = '',
    mostraAvviso,
    chiaveEl = null
} = {}) {
    const nome = String(operatore || '').trim();
    const data = String(dataPrelievo || '').trim();
    if (!nome || !data || typeof mostraAvviso !== 'function') {
        if (chiaveEl) ultimoAvvisoKey.delete(chiaveEl);
        return '';
    }

    const { kmMinimo, kmMassimi, servizi, tratte } = await ensureDatiKmOperatoreMese({
        getInvoke,
        isTauri,
        anno: annoDaData(data)
    });
    const esistente = calcolaRiepilogoKmOperatore({
        servizi,
        operatore: nome,
        dataPrelievo: data,
        kmMinimo,
        escludiId,
        tratte
    });
    const kmCorrente = isNonRimborsabile({ richiedente })
        ? 0
        : stimaKmServizioCorrente({
            tratta,
            statoServizio,
            kmReali,
            kmMinimo,
            comuneDestinazione,
            comunePrelievo,
            tratte
        });
    const msg = messaggioLimiteKmOperatore({
        totaleEsistente: esistente.totale,
        kmCorrente,
        kmMassimi
    });
    if (!msg) {
        if (chiaveEl) ultimoAvvisoKey.delete(chiaveEl);
        return '';
    }

    const d = parseDataPrelievo(data);
    const meseKey = d ? `${d.getFullYear()}-${d.getMonth()}` : data;
    const key = `${nome}|${meseKey}|${msg}`;
    if (chiaveEl && ultimoAvvisoKey.get(chiaveEl) === key) return '';
    if (chiaveEl) ultimoAvvisoKey.set(chiaveEl, key);

    await mostraAvviso(msg);
    return msg;
}

export function testoRiepilogoKm(riepilogo) {
    if (!riepilogo?.meseLabel) return '';
    const mese = `${riepilogo.meseLabel} ${riepilogo.anno}`;
    return `KM ${mese} — eseguiti ${formatKm(riepilogo.eseguiti)} · da eseguire ${formatKm(riepilogo.daEseguire)} · totale ${formatKm(riepilogo.totale)}`;
}

/** Aggiorna un elemento hint con il riepilogo KM (archivio + servizio corrente). */
export async function aggiornaHintKmOperatore({
    el,
    operatore,
    dataPrelievo,
    getInvoke,
    isTauri,
    tratta = null,
    statoServizio = '',
    kmReali = '',
    escludiId = '',
    richiedente = '',
    comuneDestinazione = '',
    comunePrelievo = ''
} = {}) {
    if (!el) return;
    const nome = String(operatore || '').trim();
    const data = String(dataPrelievo || '').trim();
    if (!nome || !data) {
        el.hidden = true;
        el.textContent = '';
        return;
    }

    const seq = (seqHint.get(el) || 0) + 1;
    seqHint.set(el, seq);
    el.hidden = false;
    const anno = annoDaData(data);
    const giaInCache = kmMinimoCache != null && Array.isArray(serviziPerAnno[anno]) && tratteCache != null;
    if (!giaInCache) {
        el.classList.add('is-loading');
        el.textContent = 'Caricamento KM…';
    }

    const { kmMinimo, servizi, tratte } = await ensureDatiKmOperatoreMese({
        getInvoke,
        isTauri,
        anno
    });
    if (seqHint.get(el) !== seq) return;

    const esistente = calcolaRiepilogoKmOperatore({
        servizi,
        operatore: nome,
        dataPrelievo: data,
        kmMinimo,
        escludiId,
        tratte
    });
    const riepilogo = applicaKmCorrenteAlRiepilogo(esistente, {
        tratta,
        statoServizio,
        kmReali,
        kmMinimo,
        richiedente,
        comuneDestinazione,
        comunePrelievo,
        tratte
    });
    el.classList.remove('is-loading');
    el.textContent = testoRiepilogoKm(riepilogo);
    el.title = el.textContent;
    el.hidden = !el.textContent;
}

/** Collega hint a select operatore + campo data. Restituisce la funzione refresh. */
export function collegaHintKmOperatore({
    hintId,
    operatoreId,
    dataId,
    getInvoke,
    isTauri,
    mostraAvviso = null,
    getTrattaCorrente = null,
    getStatoServizio = null,
    getKmReali = null,
    getEscludiId = null,
    getRichiedente = null
} = {}) {
    const hintEl = typeof hintId === 'string' ? document.getElementById(hintId) : hintId;
    const opEl = typeof operatoreId === 'string' ? document.getElementById(operatoreId) : operatoreId;
    const dataEl = typeof dataId === 'string' ? document.getElementById(dataId) : dataId;
    if (!hintEl) return async () => {};

    const idOp = typeof operatoreId === 'string' ? operatoreId : (opEl?.id || '');

    const contesto = () => {
        const prefix = String(idOp || '').replace(/-operatore$/, '');
        return {
            tratta: typeof getTrattaCorrente === 'function' ? getTrattaCorrente() : null,
            statoServizio: typeof getStatoServizio === 'function' ? getStatoServizio() : '',
            kmReali: typeof getKmReali === 'function' ? getKmReali() : '',
            escludiId: typeof getEscludiId === 'function' ? getEscludiId() : '',
            richiedente: typeof getRichiedente === 'function' ? getRichiedente() : '',
            comuneDestinazione: document.getElementById(`${prefix}-comune-destinazione`)?.value || '',
            comunePrelievo: document.getElementById(`${prefix}-comune-prelievo`)?.value || ''
        };
    };

    const refresh = (override = {}) => {
        const ctx = { ...contesto(), ...override };
        return aggiornaHintKmOperatore({
            el: hintEl,
            operatore: opEl?.value || '',
            dataPrelievo: dataEl?.value || '',
            getInvoke,
            isTauri,
            tratta: ctx.tratta,
            statoServizio: ctx.statoServizio,
            kmReali: ctx.kmReali,
            escludiId: ctx.escludiId,
            richiedente: ctx.richiedente,
            comuneDestinazione: ctx.comuneDestinazione,
            comunePrelievo: ctx.comunePrelievo
        });
    };

    const avvisa = () => {
        const ctx = contesto();
        return avvisaSeLimiteKmOperatore({
            getInvoke,
            isTauri,
            operatore: opEl?.value || '',
            dataPrelievo: dataEl?.value || '',
            tratta: ctx.tratta,
            statoServizio: ctx.statoServizio,
            kmReali: ctx.kmReali,
            escludiId: ctx.escludiId,
            richiedente: ctx.richiedente,
            comuneDestinazione: ctx.comuneDestinazione,
            comunePrelievo: ctx.comunePrelievo,
            mostraAvviso,
            chiaveEl: hintEl
        });
    };

    opEl?.addEventListener('change', async () => {
        await refresh();
        await avvisa();
    });
    dataEl?.addEventListener('change', async () => {
        await refresh();
        if (String(opEl?.value || '').trim()) await avvisa();
    });
    dataEl?.addEventListener('input', refresh);
    dataEl?.addEventListener('blur', async () => {
        await refresh();
        if (String(opEl?.value || '').trim()) await avvisa();
    });
    if (idOp) {
        const prefix = idOp.replace(/-operatore$/, '');
        document.getElementById(`${prefix}-stato-servizio`)
            ?.addEventListener('change', refresh);
        document.getElementById(`${prefix}-richiedente`)
            ?.addEventListener('change', refresh);
        ['comune-destinazione', 'comune-prelievo'].forEach((suffix) => {
            const elComune = document.getElementById(`${prefix}-${suffix}`);
            elComune?.addEventListener('change', refresh);
            elComune?.addEventListener('blur', refresh);
        });
    }
    refresh();
    return { refresh, avvisa };
}
