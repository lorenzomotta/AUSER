/**
 * Calendario web per GitHub Pages — accesso operatori con Supabase Auth.
 *
 * Setup:
 * 1. Copia config.public.example.json → config.public.json (con url e anon_key)
 * 2. Su Supabase: abilita Auth email/password e crea account operatori
 * 3. Tabella user_permissions: user_id + Calendario = true (o is_admin = true)
 * 4. Esegui supabase-calendario-web.sql per le policy RLS
 * 5. Pubblica su GitHub Pages i file: CALENDARIO_WEB.html, calendario-web.css,
 *    calendario-web.js, calendario.css, tratta-riepilogo.js, config.public.json
 */

import {
    testoNoteFineVisibile,
    parseTrattaDaNote,
    normalizzaPayloadTratta,
    htmlContenutoRiepilogoTratta,
    mergeTrattaInNote
} from './tratta-riepilogo.js';
import {
    isUtenteAdmin,
    htmlDettaglioServizioEditabile,
    valorizzaNoteFineEditabili,
    raccogliDatiModaleAdmin,
    buildPayloadUpdateServizio,
    OPZIONI_DEFAULT
} from './calendario-web-edit.js';

let supabaseClient = null;
let publicConfig = null;
let nominativiMap = {};
let allOperatori = [];
let calendar = null;
let allAutomezzi = [];
const serviziPerRangeCache = new Map();
const serviziById = new Map();
let vistaCorrente = 'dayGridMonth';
let permessiCorrenti = null;

/** Rimette il blocco tratta nascosto dopo la modifica delle note utente */
function mergeNoteFineConTratta(noteUtente, noteOriginali) {
    const parsed = parseTrattaDaNote(noteOriginali);
    if (!parsed.tratta) return String(noteUtente || '').trim();
    return mergeTrattaInNote(noteUtente, parsed.tratta);
}

/** Riga riepilogo tratta (come in elenco servizi), solo se la donazione deriva da una tratta */
function htmlRigaTrattaSePresente(servizio) {
    const trattaSalvata = normalizzaPayloadTratta(servizio?.tratta_fuori_asti)
        || parseTrattaDaNote(servizio?.note_fine_servizio).tratta;
    if (!trattaSalvata) return '';
    const has = !!(trattaSalvata.comune || trattaSalvata.localita
        || (trattaSalvata.id !== '' && trattaSalvata.id != null));
    if (!has) return '';
    return `
            <div class="dettaglio-row dettaglio-row-tratta">
                <div class="ns-tratta-selezionata cal-tratta-riepilogo">
                    ${htmlContenutoRiepilogoTratta(trattaSalvata)}
                </div>
            </div>`;
}

function isVistaMobileCalendario() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function vistaCalendarioEffettiva(nomeVista) {
    if (!isVistaMobileCalendario()) return nomeVista;
    if (nomeVista === 'dayGridWeek') return 'listWeek';
    return nomeVista;
}

function isVistaListaMobile(viewType) {
    return viewType === 'listWeek';
}

function configuraVistaInizialeMobile() {
    if (isVistaMobileCalendario()) {
        vistaCorrente = 'dayGridDay';
    }
}
let loadRequestId = 0;
let calendarioInizializzato = false;
let servizioCorrente = null;

// ─── Utility ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isTruthyFlag(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return v === 'si' || v === 'sì' || v === 'true' || v === '1' || v === 'yes';
}

function getFieldAny(row, names) {
    if (!row || typeof row !== 'object') return '';
    for (const name of names) {
        if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
            return String(row[name]).trim();
        }
    }
    const keys = Object.keys(row);
    for (const name of names) {
        const found = keys.find(k => k.toLowerCase() === name.toLowerCase());
        if (found != null && row[found] != null && String(row[found]).trim() !== '') {
            return String(row[found]).trim();
        }
    }
    return '';
}

function valoreCampoRow(row, key) {
    if (!row || key == null || row[key] === undefined || row[key] === null) return '';
    return String(row[key]).trim();
}

function trovaChiaveRow(row, predicates) {
    if (!row || typeof row !== 'object') return null;
    const keys = Object.keys(row);
    for (const p of predicates) {
        const exact = keys.find(k => k.toLowerCase() === p.toLowerCase());
        if (exact) return exact;
    }
    for (const p of predicates) {
        const partial = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (partial) return partial;
    }
    return null;
}

function buildTempoDaRow(row) {
    const tempo = formatTimeIso(getFieldAny(row, ['Tempo', 'TEMPO', 'TEMPO_ORE', 'Tempo_Ore']));
    if (tempo) return tempo;
    const ore = getFieldAny(row, ['Tempo_Ore', 'TEMPO_ORE']);
    const minuti = getFieldAny(row, ['Tempo_Minuti', 'TEMPO_MINUTI']);
    const oreNum = parseInt(ore, 10) || 0;
    const minNum = parseInt(minuti, 10) || 0;
    if (oreNum > 0 || minNum > 0) {
        return `${String(oreNum).padStart(2, '0')}:${String(minNum).padStart(2, '0')}`;
    }
    return '';
}

function formatKmDaRow(row) {
    const key = trovaChiaveRow(row, ['km']) || 'Km';
    const v = row?.[key];
    if (v === undefined || v === null || v === '') return '';
    const n = Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) {
        return String(Number.isInteger(n) ? n : n);
    }
    return String(v).trim();
}

function formatTempoDaRow(row) {
    const key = trovaChiaveRow(row, ['tempo']) || 'Tempo';
    const v = row?.[key];
    if (v === undefined || v === null || v === '') return buildTempoDaRow(row);
    return formatTimeIso(v);
}

function leggiCampiFineServizioDaRow(row) {
    const kNote = trovaChiaveRow(row, [
        'notefineservizio', 'note_fine_servizio', 'notafineservizio'
    ]);
    const kUscita = trovaChiaveRow(row, ['km_uscita', 'kmuscita']) || 'Km_uscita';
    const kRientro = trovaChiaveRow(row, ['km_rientro', 'kmrientro']) || 'Km_rientro';
    return {
        km: formatKmDaRow(row),
        km_uscita: valoreCampoRow(row, kUscita),
        km_rientro: valoreCampoRow(row, kRientro),
        tempo: formatTempoDaRow(row),
        note_fine_servizio: kNote ? valoreCampoRow(row, kNote) : '',
        _colKm: trovaChiaveRow(row, ['km']) || 'Km',
        _colKmUscita: kUscita,
        _colKmRientro: kRientro,
        _colTempo: trovaChiaveRow(row, ['tempo']) || 'Tempo',
        _colNote: kNote || 'NoteFineServizio'
    };
}

function formatDateItalian(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.includes('/')) return s;
    const iso = s.split('T')[0];
    const parts = iso.split('-');
    if (parts.length !== 3) return s;
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
}

function formatTimeIso(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^\d{1,2}:\d{2}$/.test(s)) return s;
    if (/^\d{1,2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
    if (s.includes('T')) {
        const t = s.split('T')[1];
        if (t) return t.slice(0, 5);
    }
    return s;
}

function formatEuroItaliano(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.includes('€')) return s;
    const n = parseFloat(s.replace(',', '.'));
    if (Number.isNaN(n)) return s;
    return n.toFixed(2).replace('.', ',') + ' €';
}

function parseDataItaliana(dataStr) {
    if (!dataStr || typeof dataStr !== 'string') return null;
    const trimmed = dataStr.trim();
    const slash = trimmed.split('/');
    if (slash.length === 3) {
        const day = parseInt(slash[0], 10);
        const month = parseInt(slash[1], 10) - 1;
        const year = parseInt(slash[2], 10);
        if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
        return new Date(year, month, day);
    }
    const iso = trimmed.split('T')[0].split('-');
    if (iso.length === 3) {
        const year = parseInt(iso[0], 10);
        const month = parseInt(iso[1], 10) - 1;
        const day = parseInt(iso[2], 10);
        if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
        return new Date(year, month, day);
    }
    return null;
}

function parseOra(oraStr) {
    if (!oraStr || typeof oraStr !== 'string') return null;
    const parts = oraStr.trim().split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return { h, m };
}

function minutiDaOra(oraStr) {
    const ora = parseOra(oraStr);
    if (!ora) return 0;
    return ora.h * 60 + ora.m;
}

function dataOraToIso(dataPrelievo, oraInizio) {
    const data = parseDataItaliana(dataPrelievo);
    if (!data) return null;
    const ora = parseOra(oraInizio);
    if (ora) {
        const y = data.getFullYear();
        const mo = String(data.getMonth() + 1).padStart(2, '0');
        const d = String(data.getDate()).padStart(2, '0');
        const hh = String(ora.h).padStart(2, '0');
        const mm = String(ora.m).padStart(2, '0');
        return `${y}-${mo}-${d}T${hh}:${mm}:00`;
    }
    const y = data.getFullYear();
    const mo = String(data.getMonth() + 1).padStart(2, '0');
    const d = String(data.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
}

function normalizzaNumero(val) {
    if (val === undefined || val === null) return '';
    const s = String(val).trim();
    if (s === '') return '';
    const n = parseFloat(s.replace(',', '.'));
    if (!Number.isNaN(n) && Number.isFinite(n)) {
        return String(Math.trunc(n) === n ? Math.trunc(n) : n);
    }
    return s;
}

function dateToIsoGiorno(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** FullCalendar usa activeEnd esclusivo: ultimo giorno visibile = end - 1 ms */
function fineRangeInclusive(endEsclusivo) {
    const d = new Date(endEsclusivo);
    d.setMilliseconds(d.getMilliseconds() - 1);
    return dateToIsoGiorno(d);
}

function chiaveRangeCache(start, endEsclusivo) {
    return `${dateToIsoGiorno(start)}_${dateToIsoGiorno(endEsclusivo)}`;
}

function servizioNelRange(servizio, start, endEsclusivo) {
    const d = parseDataItaliana(servizio.data_prelievo);
    if (!d) return false;
    const giorno = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const startT = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endT = new Date(endEsclusivo.getFullYear(), endEsclusivo.getMonth(), endEsclusivo.getDate()).getTime();
    return giorno >= startT && giorno < endT;
}

function invalidaCacheServizi() {
    serviziPerRangeCache.clear();
}

// ─── Config e Supabase ─────────────────────────────────────────────────────

/** Chiavi sb_publishable_ vanno solo nell'header apikey, non in Authorization Bearer. */
function creaFetchSupabase(apiKey) {
    const isLegacyJwt = apiKey.startsWith('eyJ');
    return (input, init = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set('apikey', apiKey);
        if (isLegacyJwt) {
            if (!headers.has('Authorization')) {
                headers.set('Authorization', `Bearer ${apiKey}`);
            }
        } else {
            const auth = headers.get('Authorization');
            if (auth === `Bearer ${apiKey}`) {
                headers.delete('Authorization');
            }
        }
        return fetch(input, { ...init, headers });
    };
}

async function caricaConfigPubblica() {
    // Percorso relativo: funziona sia in GitHub Pages sia nell'app Tauri installata
    const risposta = await fetch('./config.public.json', { cache: 'no-store' });
    if (!risposta.ok) {
        throw new Error(
            'File config.public.json non trovato. Copia config.public.example.json e inserisci url e anon_key Supabase.'
        );
    }
    publicConfig = await risposta.json();
    const url = publicConfig?.supabase?.url?.trim();
    const key = (
        publicConfig?.supabase?.publishable_key ||
        publicConfig?.supabase?.anon_key ||
        ''
    ).trim();
    if (!url || !key) {
        throw new Error(
            'config.public.json incompleto: servono supabase.url e publishable_key (sb_publishable_...)'
        );
    }
    if (typeof window.supabase?.createClient !== 'function') {
        throw new Error('Libreria Supabase non caricata');
    }
    supabaseClient = window.supabase.createClient(url, key, {
        global: { fetch: creaFetchSupabase(key) },
    });
}

function tabella(nome) {
    return publicConfig?.supabase?.tables?.[nome] || nome;
}

// ─── Autenticazione operatori ──────────────────────────────────────────────

function mostraErroreLogin(msg) {
    const el = document.getElementById('web-login-errore');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

function mostraSchermataLogin() {
    document.getElementById('web-login-screen')?.removeAttribute('hidden');
    document.getElementById('web-calendario-app')?.setAttribute('hidden', 'hidden');
}

function mostraCalendario(email) {
    document.getElementById('web-login-screen')?.setAttribute('hidden', 'hidden');
    const app = document.getElementById('web-calendario-app');
    app?.removeAttribute('hidden');
    const label = document.getElementById('web-user-label');
    if (label && email) label.textContent = email;
}

async function verificaOperatore(user) {
    if (!user?.id) return false;

    const { data: perm, error } = await supabaseClient
        .from(tabella('user_permissions'))
        .select('Calendario, is_admin, username')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) {
        console.warn('Errore lettura permessi:', error.message);
        return false;
    }
    if (!perm) return false;

    if (perm.is_admin === true) return true;
    if (perm.Calendario === true) return true;

    return false;
}

function etichettaUtente(user, perm) {
    if (perm?.username) return perm.username;
    return user?.email || '';
}

async function caricaPermessiUtente(user) {
    const { data: perm } = await supabaseClient
        .from(tabella('user_permissions'))
        .select('Calendario, is_admin, username')
        .eq('user_id', user.id)
        .maybeSingle();
    return perm;
}

async function gestisciLogin(event) {
    event.preventDefault();
    const btn = document.getElementById('web-login-submit');
    const email = document.getElementById('web-login-email')?.value.trim();
    const password = document.getElementById('web-login-password')?.value;
    if (!email || !password) return;

    mostraErroreLogin('');
    if (btn) btn.disabled = true;

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const ok = await verificaOperatore(data.user);
        if (!ok) {
            await supabaseClient.auth.signOut();
            throw new Error('Accesso negato: non hai il permesso Calendario. Contatta l\'amministratore.');
        }

        const perm = await caricaPermessiUtente(data.user);
        await avviaCalendario(data.user, perm);
    } catch (err) {
        mostraErroreLogin(err.message || 'Errore di accesso. Verifica email e password.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function gestisciLogout() {
    await supabaseClient.auth.signOut();
    invalidaCacheServizi();
    serviziById.clear();
    nominativiMap = {};
    allOperatori = [];
    permessiCorrenti = null;
    mostraSchermataLogin();
    mostraErroreLogin('');
}

async function controllaSessioneEsistente() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) return false;

    const ok = await verificaOperatore(session.user);
    if (!ok) {
        await supabaseClient.auth.signOut();
        mostraErroreLogin('Il tuo account non ha più i permessi operatore.');
        return false;
    }

    await avviaCalendario(session.user, await caricaPermessiUtente(session.user));
    return true;
}

// ─── Dati Supabase ───────────────────────────────────────────────────────────

async function caricaNominativi() {
    if (Object.keys(nominativiMap).length) return;
    const { data } = await supabaseClient.from(tabella('tesserati')).select('*').limit(5000);
    const operatori = [];
    (data || []).forEach(row => {
        const id = getFieldAny(row, ['IdSocio', 'IDSOCIO', 'idsocio']);
        const nom = getFieldAny(row, ['NominativoSocio', 'NOMINATIVO', 'Nominativo', 'nominativo']);
        if (id && nom) nominativiMap[id] = nom;
        const opFlag = getFieldAny(row, ['Operatore', 'OPERATORE', 'operatore']);
        if (id && nom && isTruthyFlag(opFlag)) {
            operatori.push({ value: String(id), label: nom });
        }
    });
    allOperatori = operatori.sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

function resolveOperatoreNome(row) {
    const idOp = getFieldAny(row, ['IdOperatore', 'IDOPERATORE', 'Id_Operatore', 'Operatore', 'OPERATORE']);
    if (idOp && nominativiMap[idOp]) return nominativiMap[idOp];
    return idOp;
}

function resolveOperatoreId(row) {
    return getFieldAny(row, ['IdOperatore', 'IDOPERATORE', 'Id_Operatore', 'Operatore', 'OPERATORE']);
}

function buildTipoServizioDaRow(row) {
    if (isTruthyFlag(getFieldAny(row, ['Sollevatore', 'SOLLEVATORE']))) return 'SOLLEVATORE';
    if (isTruthyFlag(getFieldAny(row, ['Standard', 'STANDARD']))) return 'STANDARD';
    return getFieldAny(row, ['Tipo_Servizio', 'TIPO_SERVIZIO', 'TipoServizio']);
}

function trovaColonnaRow(row, candidates) {
    if (!row || typeof row !== 'object') return candidates[0];
    for (const name of candidates) {
        if (Object.prototype.hasOwnProperty.call(row, name)) return name;
    }
    const keys = Object.keys(row);
    for (const name of candidates) {
        const found = keys.find(k => k.toLowerCase() === name.toLowerCase());
        if (found) return found;
    }
    return candidates[0];
}

function colonneIdServizio() {
    return ['idservizio', 'IdServizio', 'Id_Servizio', 'IDSERVIZIO', 'id_servizio'];
}

function valoriIdPerFiltro(id) {
    const vals = [String(id).trim()];
    const n = parseInt(String(id), 10);
    if (!Number.isNaN(n)) vals.push(n);
    return [...new Set(vals)];
}

function rowToServizioCompleto(row) {
    const id = getFieldAny(row, colonneIdServizio());
    if (!id) return null;

    const incassato = getFieldAny(row, ['Incassato', 'INCASSATO']);
    const donazioni = getFieldAny(row, ['Donazioni', 'DONAZIONI']);

    const base = {
        id: String(id),
        idColonna: trovaColonnaRow(row, colonneIdServizio()),
        _colKm: trovaColonnaRow(row, ['Km', 'KM']),
        _colTempo: trovaColonnaRow(row, ['Tempo', 'TEMPO', 'TEMPO_ORE']),
        _colNote: trovaColonnaRow(row, ['NoteFineServizio', 'NOTAFINESERVIZIO', 'NOTE_FINE_SERVIZIO']),
        data_prelievo: formatDateItalian(getFieldAny(row, ['Prelievo_Data', 'DATA_PRELIEVO', 'Data_Prelievo'])),
        idsocio: getFieldAny(row, ['IdSocio', 'IDSOCIO']),
        socio_trasportato: getFieldAny(row, ['Trasportato', 'TRASP', 'Trasp']),
        ora_inizio: formatTimeIso(getFieldAny(row, ['Prelievo_Ora', 'ORA_PRELIEVO', 'OraPrelievo'])),
        comune_prelievo: getFieldAny(row, ['Prelievo_Comune', 'PRELIEVO_COMUNE']),
        luogo_prelievo: getFieldAny(row, ['Prelievo_Indirizzo', 'PRELIEVO_INDIRIZZO']),
        tipo_servizio: buildTipoServizioDaRow(row),
        carrozzina: getFieldAny(row, ['Carrozzina', 'CARROZZINA']),
        richiedente: getFieldAny(row, ['Richiedente', 'RICHIEDENTE']),
        motivazione: getFieldAny(row, ['Motivazione', 'MOTIVAZIONE']),
        ora_arrivo: formatDateItalian(getFieldAny(row, ['Destinazione_Data', 'DATA_DESTINAZIONE'])),
        comune_destinazione: getFieldAny(row, ['Destinazione_Comune', 'DESTINAZIONE_COMUNE']),
        luogo_destinazione: getFieldAny(row, ['Destinazione_Indirizzo', 'DESTINAZIONE_INDIRIZZO']),
        pagamento: formatEuroItaliano(donazioni),
        stato_incasso: incassato || 'DA INCASSARE',
        operatore: resolveOperatoreNome(row),
        operatore_id: resolveOperatoreId(row),
        operatore_2: getFieldAny(row, ['Oper2', 'OPER2']),
        mezzo_usato: '',
        mezzo: getFieldAny(row, ['Mezzo', 'MEZZO']),
        tempo: formatTempoDaRow(row),
        km: formatKmDaRow(row),
        km_uscita: getFieldAny(row, ['Km_uscita', 'KM_USCITA', 'km_uscita']),
        km_rientro: getFieldAny(row, ['Km_rientro', 'KM_RIENTRO', 'km_rientro']),
        tipo_pagamento: getFieldAny(row, ['TipoPagamento', 'TIPOPAGAMENTO']),
        data_bonifico: formatDateItalian(getFieldAny(row, ['Bonifico_Data', 'DATABONIFICO'])),
        data_ricevuta: formatDateItalian(getFieldAny(row, ['Ricevuta_Data', 'DATARICEVUTA'])),
        numero_ricevuta: getFieldAny(row, ['Ricevuta_numero', 'Ricevuta_Numero']),
        stato_servizio: getFieldAny(row, ['StatoServizio', 'STATOSERVIZIO']),
        note_prelievo: getFieldAny(row, ['Prelievo_Note', 'PRELIEVO_NOTE']),
        note_arrivo: getFieldAny(row, ['Destinazione_Note', 'DESTINAZIONE_NOTE']),
        note_fine_servizio: getFieldAny(row, [
            'NoteFineServizio', 'NOTAFINESERVIZIO', 'NOTE_FINE_SERVIZIO', 'NotaFineServizio'
        ]),
        archivia: getFieldAny(row, ['Archiviazione', 'ARCHIVIAZIONE'])
    };
    const fine = leggiCampiFineServizioDaRow(row);
    return {
        ...base,
        km: fine.km || base.km,
        km_uscita: fine.km_uscita || base.km_uscita,
        km_rientro: fine.km_rientro || base.km_rientro,
        tempo: fine.tempo || base.tempo,
        note_fine_servizio: fine.note_fine_servizio || base.note_fine_servizio,
        _colKm: fine._colKm || base._colKm,
        _colKmUscita: fine._colKmUscita || 'Km_uscita',
        _colKmRientro: fine._colKmRientro || 'Km_rientro',
        _colTempo: fine._colTempo || base._colTempo,
        _colNote: fine._colNote || base._colNote
    };
}

const SUPABASE_PAGE_SIZE = 1000;
const SUPABASE_MAX_PAGES = 100;

async function scaricaRighePaginate(buildQuery) {
    const tutte = [];
    for (let page = 0; page < SUPABASE_MAX_PAGES; page++) {
        const from = page * SUPABASE_PAGE_SIZE;
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await buildQuery(from, to);
        if (error) throw error;
        const batch = data || [];
        tutte.push(...batch);
        if (batch.length < SUPABASE_PAGE_SIZE) break;
    }
    if (tutte.length >= SUPABASE_PAGE_SIZE * SUPABASE_MAX_PAGES) {
        console.warn('Supabase: raggiunto limite massimo righe scaricate per tabella servizi');
    }
    return tutte;
}

async function fetchServiziRange(start, endEsclusivo, forceRefresh = false) {
    const key = chiaveRangeCache(start, endEsclusivo);
    if (!forceRefresh && serviziPerRangeCache.has(key)) {
        return serviziPerRangeCache.get(key);
    }

    const serviziTable = tabella('servizi');
    const inizio = dateToIsoGiorno(start);
    const fine = fineRangeInclusive(endEsclusivo);

    let data;
    try {
        data = await scaricaRighePaginate((from, to) =>
            supabaseClient
                .from(serviziTable)
                .select('*')
                .gte('Prelievo_Data', inizio)
                .lte('Prelievo_Data', fine)
                .order('Prelievo_Data', { ascending: true })
                .range(from, to)
        );
    } catch (error) {
        console.warn('Filtro periodo fallito, scarico con paginazione:', error.message);
        data = await scaricaRighePaginate((from, to) =>
            supabaseClient
                .from(serviziTable)
                .select('*')
                .order('Prelievo_Data', { ascending: true })
                .range(from, to)
        );
    }

    const servizi = (data || [])
        .map(rowToServizioCompleto)
        .filter(Boolean)
        .filter(s => servizioNelRange(s, start, endEsclusivo));

    serviziPerRangeCache.set(key, servizi);
    return servizi;
}

async function caricaAutomezzi() {
    const { data, error } = await supabaseClient.from(tabella('automezzi')).select('*');
    if (error) {
        console.warn('Automezzi non caricati:', error.message);
        allAutomezzi = [];
        return;
    }
    allAutomezzi = (data || []).map(row => ({
        nr_automezzo: getFieldAny(row, ['Numero_Mezzo', 'NR_AUTOMEZZO', 'NumeroAutomezzo']),
        marca: getFieldAny(row, ['Marca', 'MARCA']),
        modello: getFieldAny(row, ['Modello', 'MODELLO'])
    }));
}

async function caricaServiziPerRange(start, endEsclusivo) {
    const servizi = await fetchServiziRange(start, endEsclusivo);
    servizi.forEach(s => {
        if (s.id) serviziById.set(String(s.id), s);
    });
    return servizi;
}

function costruisciStringaMezzo(servizio) {
    const nrAutomezzo = normalizzaNumero(servizio.mezzo);
    if (!nrAutomezzo || !allAutomezzi.length) return servizio.mezzo_usato || '';
    const automezzo = allAutomezzi.find(a => normalizzaNumero(a.nr_automezzo) === nrAutomezzo);
    if (!automezzo) return servizio.mezzo_usato || '';
    const parti = [];
    if (automezzo.marca) parti.push(automezzo.marca.trim());
    if (automezzo.modello) parti.push(automezzo.modello.trim());
    if (nrAutomezzo) parti.push(`(${nrAutomezzo})`);
    return parti.join(' - ') || servizio.mezzo_usato || '';
}

// ─── UI Calendario ───────────────────────────────────────────────────────────

function coloriStatoServizioCalendario(stato) {
    const s = String(stato || 'DA ESEGUIRE').trim().toUpperCase();
    if (s === 'ESEGUITO') {
        return { backgroundColor: '#5cb85c', borderColor: '#449d44', textColor: '#1a1a1a' };
    }
    if (s === 'ANNULLATO') {
        return { backgroundColor: '#bdbdbd', borderColor: '#9e9e9e', textColor: '#424242' };
    }
    return { backgroundColor: '#ffd966', borderColor: '#d4a800', textColor: '#1a1a1a' };
}

function classeStatoServizioCalendario(stato) {
    const s = String(stato || 'DA ESEGUIRE').trim().toUpperCase();
    if (s === 'ESEGUITO') return 'cal-stato-eseguito';
    if (s === 'ANNULLATO') return 'cal-stato-annullato';
    return 'cal-stato-da-eseguire';
}

function applicaColoriEventoCalendario(info) {
    const servizio = info.event.extendedProps?.servizio;
    const colori = coloriStatoServizioCalendario(servizio?.stato_servizio);
    const el = info.el;
    el.style.setProperty('--fc-event-bg-color', colori.backgroundColor);
    el.style.setProperty('--fc-event-border-color', colori.borderColor);
    el.style.backgroundColor = colori.backgroundColor;
    el.style.borderColor = colori.borderColor;
    el.style.color = colori.textColor;
    el.classList.add(classeStatoServizioCalendario(servizio?.stato_servizio));
}

function servizioToEvent(servizio) {
    const start = dataOraToIso(servizio.data_prelievo, null);
    if (!start) return null;
    const colori = coloriStatoServizioCalendario(servizio.stato_servizio);
    return {
        id: String(servizio.id || `tmp-${Math.random()}`),
        title: servizio.socio_trasportato || 'Servizio',
        start,
        allDay: true,
        order: minutiDaOra(servizio.ora_inizio),
        backgroundColor: colori.backgroundColor,
        borderColor: colori.borderColor,
        textColor: colori.textColor,
        classNames: [classeStatoServizioCalendario(servizio.stato_servizio)],
        extendedProps: { servizio }
    };
}

const MESI_ITALIANI = [
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];
const GIORNI_SETTIMANA = [
    'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'
];

function formattaGiornoMobile(date) {
    const d = date instanceof Date ? date : new Date(date);
    return {
        data: `${d.getDate()} ${MESI_ITALIANI[d.getMonth()]} ${d.getFullYear()}`,
        giorno: GIORNI_SETTIMANA[d.getDay()]
    };
}

function htmlIntestazioneGiornoMobile(date) {
    const { data, giorno } = formattaGiornoMobile(date);
    return `<div class="cal-week-day-header">
        <div class="cal-week-day-data">${escapeHtml(data)}</div>
        <div class="cal-week-day-nome">${escapeHtml(giorno)}</div>
    </div>`;
}

function dayHeaderDidMountListaMobile(arg) {
    if (!isVistaMobileCalendario() || !isVistaListaMobile(arg.view?.type)) return;
    if (arg.el) arg.el.innerHTML = htmlIntestazioneGiornoMobile(arg.date);
}

function dataDaElementoGiornoList(el) {
    if (!el?.classList) return null;
    const cls = [...el.classList].find(c => /^fc-day-\d{4}-\d{2}-\d{2}$/.test(c));
    if (!cls) return null;
    const [y, m, d] = cls.replace('fc-day-', '').split('-').map(Number);
    return new Date(y, m - 1, d);
}

function applicaIntestazioniGiornoListaMobile() {
    if (!isVistaMobileCalendario() || !calendar || !isVistaListaMobile(calendar.view?.type)) return;
    const mount = document.getElementById('calendario-mount');
    if (!mount) return;
    mount.querySelectorAll('.fc-listWeek-view .fc-list-day').forEach((dayEl) => {
        const data = dataDaElementoGiornoList(dayEl);
        const cushion = dayEl.querySelector('.fc-list-day-cushion');
        if (!data || !cushion) return;
        cushion.innerHTML = htmlIntestazioneGiornoMobile(data);
    });
}

function renderEventContent(arg) {
    const s = arg.event.extendedProps.servizio || {};
    const ora = s.ora_inizio || '';
    const socio = s.socio_trasportato || '';
    const op = s.operatore || '';

    if (isVistaMobileCalendario() && isVistaListaMobile(arg.view?.type)) {
        const parti = [ora, socio, op].filter(p => p.trim() !== '');
        const riga = parti.length ? parti.map(p => escapeHtml(p)).join(' · ') : '—';
        return { html: `<div class="cal-event cal-event-week-row" title="${riga}">${riga}</div>` };
    }

    if (isVistaMobileCalendario() && arg.view?.type === 'dayGridDay') {
        const righe = [
            ora ? `<span class="cal-event-ora">${escapeHtml(ora)}</span>` : '',
            socio ? `<span class="cal-event-socio">${escapeHtml(socio)}</span>` : '',
            op ? `<span class="cal-event-op">${escapeHtml(op)}</span>` : ''
        ].filter(Boolean);
        const html = righe.length
            ? `<div class="cal-event cal-event-mobile">${righe.join('')}</div>`
            : '<div class="cal-event cal-event-mobile">—</div>';
        return { html };
    }

    const parti = [ora, socio, op].filter(p => p.trim() !== '');
    const riga = parti.length ? parti.map(p => escapeHtml(p)).join(' · ') : '—';
    return { html: `<div class="cal-event" title="${riga}">${riga}</div>` };
}

function aggiornaContatore(num) {
    const el = document.getElementById('calendario-count');
    if (el) el.textContent = `(${num} servizi nel periodo)`;
}

function setLoading(visible, messaggio) {
    const el = document.getElementById('calendario-loading');
    if (!el) return;
    if (visible) {
        el.textContent = messaggio || 'Caricamento servizi...';
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

async function aggiornaEventiCalendario() {
    if (!calendar) return;
    const reqId = ++loadRequestId;
    setLoading(true);
    try {
        const view = calendar.view;
        const servizi = await caricaServiziPerRange(view.activeStart, view.activeEnd);
        if (reqId !== loadRequestId) return;
        const eventi = servizi.map(servizioToEvent).filter(Boolean);
        calendar.removeAllEvents();
        calendar.addEventSource(eventi);
        aggiornaContatore(eventi.length);
        setLoading(false);
        requestAnimationFrame(() => applicaIntestazioniGiornoListaMobile());
    } catch (error) {
        if (reqId !== loadRequestId) return;
        console.error('Errore aggiornamento calendario:', error);
        setLoading(true, `Errore: ${error.message || error}`);
    }
}

function normalizzaTempoPerSupabase(tempoStr) {
    const s = String(tempoStr || '').trim();
    if (!s) return null;
    const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return s;
    const h = String(parseInt(match[1], 10)).padStart(2, '0');
    const m = match[2];
    const sec = match[3] || '00';
    return `${h}:${m}:${sec}`;
}

function invalidaCachePeriodoServizio() {
    invalidaCacheServizi();
}

async function ricaricaServizioDaSupabase(servizio) {
    if (!servizio?.id || !supabaseClient) return servizio;

    const table = tabella('servizi');
    const id = String(servizio.id).trim();
    const idNum = parseInt(id, 10);

    // idservizio è numerico in Supabase — prova prima con numero
    if (!Number.isNaN(idNum)) {
        const { data, error } = await supabaseClient
            .from(table)
            .select('*')
            .eq('idservizio', idNum)
            .limit(1);

        if (!error && data?.length) {
            const completo = rowToServizioCompleto(data[0]);
            if (completo) {
                aggiornaServizioInCache(completo);
                if (calendar) {
                    const ev = calendar.getEventById(String(completo.id));
                    if (ev) ev.setExtendedProp('servizio', completo);
                }
                return completo;
            }
        }
        if (error) console.warn('Ricarica idservizio numerico:', error.message);
    }

    const filtriOr = [
        `idservizio.eq.${id}`,
        `IdServizio.eq.${id}`
    ];
    if (!Number.isNaN(idNum)) {
        filtriOr.push(`idservizio.eq.${idNum}`, `IdServizio.eq.${idNum}`);
    }

    const { data: righeOr, error: errOr } = await supabaseClient
        .from(table)
        .select('*')
        .or([...new Set(filtriOr)].join(','))
        .limit(1);

    if (!errOr && righeOr?.length) {
        const completo = rowToServizioCompleto(righeOr[0]);
        if (completo) {
            aggiornaServizioInCache(completo);
            if (calendar) {
                const ev = calendar.getEventById(String(completo.id));
                if (ev) ev.setExtendedProp('servizio', completo);
            }
            return completo;
        }
    }

    const idCols = [...new Set([
        servizio.idColonna,
        ...colonneIdServizio()
    ].filter(Boolean))];

    for (const idCol of idCols) {
        for (const idVal of valoriIdPerFiltro(servizio.id)) {
            const { data, error } = await supabaseClient
                .from(table)
                .select('*')
                .eq(idCol, idVal)
                .limit(1);

            if (error) {
                console.warn('Ricarica servizio fallita:', idCol, error.message);
                continue;
            }
            if (data?.length) {
                const completo = rowToServizioCompleto(data[0]);
                if (completo) {
                    aggiornaServizioInCache(completo);
                    if (calendar) {
                        const ev = calendar.getEventById(String(completo.id));
                        if (ev) ev.setExtendedProp('servizio', completo);
                    }
                    return completo;
                }
            }
        }
    }

    console.warn('Servizio non ricaricato da Supabase, id=', id, errOr?.message || '');
    return servizio;
}

function buildPayloadFineServizio(servizio, km, kmUscita, kmRientro, tempoRaw, note) {
    const payload = {};
    payload[servizio._colKm || 'Km'] = km;
    payload[servizio._colKmUscita || 'Km_uscita'] = kmUscita;
    payload[servizio._colKmRientro || 'Km_rientro'] = kmRientro;
    payload[servizio._colNote || 'NoteFineServizio'] = note;
    const colTempo = servizio._colTempo || 'Tempo';
    const tempoNorm = normalizzaTempoPerSupabase(tempoRaw);
    if (tempoNorm !== null) payload[colTempo] = tempoNorm;
    return payload;
}

function messaggioErroreSalvataggio(error) {
    const msg = error?.message || String(error);
    if (/policy|permission|42501|403|JWT/i.test(msg)) {
        return `${msg}\n\nVerifica di aver eseguito su Supabase la policy UPDATE (file supabase-calendario-web.sql).`;
    }
    return msg;
}

async function patchFineServizioSupabase(servizio, km, kmUscita, kmRientro, tempoRaw, note) {
    const table = tabella('servizi');
    const payload = buildPayloadFineServizio(servizio, km, kmUscita, kmRientro, tempoRaw, note);
    const idCols = [
        servizio.idColonna,
        ...colonneIdServizio().filter(c => c !== servizio.idColonna)
    ].filter(Boolean);

    let ultimoErrore = null;

    for (const idCol of idCols) {
        for (const idVal of valoriIdPerFiltro(servizio.id)) {
            const { data, error } = await supabaseClient
                .from(table)
                .update(payload)
                .eq(idCol, idVal)
                .select('*');

            if (error) {
                ultimoErrore = error;
                continue;
            }
            if (data && data.length > 0) {
                const aggiornato = rowToServizioCompleto(data[0]);
                if (aggiornato) return aggiornato;
            }
        }
    }

    if (ultimoErrore) throw ultimoErrore;
    throw new Error(
        'Nessuna riga aggiornata su Supabase. Controlla permessi UPDATE (SQL operatori_aggiornano_servizi) e idservizio.'
    );
}

function aggiornaServizioInCache(servizioAggiornato) {
    if (!servizioAggiornato?.id) return;
    serviziById.set(String(servizioAggiornato.id), servizioAggiornato);
    serviziPerRangeCache.forEach((lista) => {
        if (!Array.isArray(lista)) return;
        const idx = lista.findIndex(s => String(s.id) === String(servizioAggiornato.id));
        if (idx >= 0) lista[idx] = { ...lista[idx], ...servizioAggiornato };
    });
}

function creaCampoDettaglio(label, value, classe = '') {
    return `<div class="dettaglio-field ${classe}">
        <label>${escapeHtml(label)}</label>
        <input type="text" value="${escapeHtml(value)}" readonly>
    </div>`;
}

function creaNotaDettaglio(label, value) {
    return `<div class="dettaglio-field field-note">
        <label>${escapeHtml(label)}</label>
        <textarea readonly>${escapeHtml(value)}</textarea>
    </div>`;
}

function getOpzioniModificaAdmin() {
    const mezzi = (allAutomezzi || [])
        .filter((a) => a.nr_automezzo)
        .map((a) => {
            const nr = String(a.nr_automezzo).trim();
            const parti = [];
            if (a.marca) parti.push(a.marca.trim());
            if (a.modello) parti.push(a.modello.trim());
            if (nr) parti.push(`(${nr})`);
            return { value: nr, label: parti.join(' - ') || nr };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'it'));

    return {
        ...OPZIONI_DEFAULT,
        operatori: allOperatori.length ? allOperatori : [],
        mezzi
    };
}

function aggiornaPulsantiFooterModale() {
    const btnSalva = document.getElementById('btn-salva-modifiche-servizio');
    const admin = isUtenteAdmin(permessiCorrenti);
    if (btnSalva) btnSalva.hidden = !admin;
}

function apriModalServizio(servizio) {
    const modal = document.getElementById('modal-servizio');
    const body = document.getElementById('modal-servizio-body');
    const title = document.getElementById('modal-servizio-title');
    if (!modal || !body) return;

    servizioCorrente = servizio;
    if (title) title.textContent = `SERVIZIO ${servizio.id || ''} — ${servizio.socio_trasportato || ''}`;

    body.innerHTML = '<p class="modal-caricamento">Caricamento dati servizio...</p>';
    aggiornaPulsantiFooterModale();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function renderModalServizio(servizio) {
    const body = document.getElementById('modal-servizio-body');
    const title = document.getElementById('modal-servizio-title');
    if (!body) return;

    servizioCorrente = servizio;
    const mezzo = costruisciStringaMezzo(servizio);
    if (title) title.textContent = `SERVIZIO ${servizio.id || ''} — ${servizio.socio_trasportato || ''}`;
    aggiornaPulsantiFooterModale();

    if (isUtenteAdmin(permessiCorrenti)) {
        body.innerHTML = htmlDettaglioServizioEditabile(servizio, getOpzioniModificaAdmin())
            + htmlRigaTrattaSePresente(servizio);
        valorizzaNoteFineEditabili(body, testoNoteFineVisibile(servizio.note_fine_servizio));
        return;
    }

    body.innerHTML = `
        <div class="dettaglio-section">
            <div class="dettaglio-row">
                ${creaCampoDettaglio('IDSERVIZIO', servizio.id, 'field-small')}
                ${creaCampoDettaglio('IDSOCIO', servizio.idsocio, 'field-small')}
                ${creaCampoDettaglio('DATA PRELIEVO', servizio.data_prelievo, 'field-medium')}
                ${creaCampoDettaglio('ORA SOTTOCASA', servizio.ora_inizio, 'field-small')}
                ${creaCampoDettaglio('COMUNE PRELIEVO', servizio.comune_prelievo)}
                ${creaCampoDettaglio('LUOGO PRELIEVO', servizio.luogo_prelievo, 'field-large')}
            </div>
            <div class="dettaglio-row">
                ${creaNotaDettaglio('NOTE PRELIEVO', servizio.note_prelievo)}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('TRASPORTATO', servizio.socio_trasportato, 'field-trasportato')}
                ${creaCampoDettaglio('RICHIEDENTE', servizio.richiedente)}
                ${creaCampoDettaglio('TIPO SERVIZIO', servizio.tipo_servizio, 'field-tipo-servizio')}
                ${creaCampoDettaglio('CARROZZINA', servizio.carrozzina, 'field-carrozzina')}
                ${creaCampoDettaglio('MOTIVAZIONE', servizio.motivazione, 'field-large')}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('ORA ARRIVO', servizio.ora_arrivo, 'field-small')}
                ${creaCampoDettaglio('COMUNE DESTINAZIONE', servizio.comune_destinazione)}
                ${creaCampoDettaglio('LUOGO DESTINAZIONE', servizio.luogo_destinazione, 'field-large')}
                ${creaCampoDettaglio('STATO INCASSO', servizio.stato_incasso)}
                ${creaCampoDettaglio('TIPO PAGAMENTO', servizio.tipo_pagamento)}
            </div>
            <div class="dettaglio-row">
                ${creaNotaDettaglio('NOTE ARRIVO', servizio.note_arrivo)}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('OPERATORE', servizio.operatore, 'field-large')}
                ${creaCampoDettaglio('MEZZO USATO', mezzo, 'field-large')}
                ${creaCampoDettaglio('TEMPO', servizio.tempo, 'field-small')}
                ${creaCampoDettaglio('KM', servizio.km, 'field-small')}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('PAGAMENTO', servizio.pagamento)}
                ${creaCampoDettaglio('DATA BONIFICO', servizio.data_bonifico)}
                ${creaCampoDettaglio('DATA RICEVUTA', servizio.data_ricevuta)}
                ${creaCampoDettaglio('NUMERO RICEVUTA', servizio.numero_ricevuta)}
                ${creaCampoDettaglio('STATO SERVIZIO', servizio.stato_servizio)}
            </div>
            ${htmlRigaTrattaSePresente(servizio)}
            <div class="dettaglio-row">
                ${creaNotaDettaglio('NOTE FINE SERVIZIO', testoNoteFineVisibile(servizio.note_fine_servizio))}
            </div>
        </div>
    `;
}

async function patchServizioCompletoSupabase(servizio, payload) {
    const table = tabella('servizi');
    const idCols = [...new Set([servizio.idColonna, ...colonneIdServizio()].filter(Boolean))];
    let ultimoErrore = null;

    for (const idCol of idCols) {
        for (const idVal of valoriIdPerFiltro(servizio.id)) {
            const { data, error } = await supabaseClient
                .from(table)
                .update(payload)
                .eq(idCol, idVal)
                .select('*');

            if (error) {
                ultimoErrore = error;
                continue;
            }
            if (data && data.length > 0) {
                const aggiornato = rowToServizioCompleto(data[0]);
                if (aggiornato) return aggiornato;
            }
        }
    }

    if (ultimoErrore) throw ultimoErrore;
    throw new Error(
        'Nessuna riga aggiornata su Supabase. Controlla permessi UPDATE e idservizio.'
    );
}

function mostraErroreModaleServizio(msg) {
    const body = document.getElementById('modal-servizio-body');
    if (!body) return;
    let el = document.getElementById('modal-servizio-errore-edit');
    if (!msg) {
        el?.remove();
        return;
    }
    if (!el) {
        el = document.createElement('p');
        el.id = 'modal-servizio-errore-edit';
        el.className = 'modal-servizio-errore-edit';
        el.setAttribute('role', 'alert');
        body.prepend(el);
    }
    el.textContent = msg;
}

async function salvaModificheServizioAdmin() {
    if (!isUtenteAdmin(permessiCorrenti) || !servizioCorrente?.id) return;

    const body = document.getElementById('modal-servizio-body');
    const btn = document.getElementById('btn-salva-modifiche-servizio');
    const dati = raccogliDatiModaleAdmin(body);

    if (dati.tempo && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(dati.tempo)) {
        mostraErroreModaleServizio('Formato TEMPO non valido. Usa ore:minuti, es. 01:30');
        return;
    }

    mostraErroreModaleServizio('');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'SALVATAGGIO...';
    }

    try {
        const payload = buildPayloadUpdateServizio(
            servizioCorrente,
            dati,
            mergeNoteFineConTratta
        );
        const aggiornato = await patchServizioCompletoSupabase(servizioCorrente, payload);
        servizioCorrente = aggiornato;
        aggiornaServizioInCache(aggiornato);
        invalidaCachePeriodoServizio();
        if (calendar) {
            const ev = calendar.getEventById(String(aggiornato.id));
            if (ev) {
                ev.setExtendedProp('servizio', aggiornato);
                const colori = coloriStatoServizioCalendario(aggiornato.stato_servizio);
                ev.setProp('backgroundColor', colori.backgroundColor);
                ev.setProp('borderColor', colori.borderColor);
                ev.setProp('textColor', colori.textColor);
            }
            await aggiornaEventiCalendario();
        }
        renderModalServizio(aggiornato);
    } catch (err) {
        console.error('Errore salvataggio modifiche servizio:', err);
        mostraErroreModaleServizio(messaggioErroreSalvataggio(err));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'SALVA MODIFICHE';
        }
    }
}

async function apriModalServizioConRefresh(servizio) {
    apriModalServizio(servizio);
    try {
        const fresco = await ricaricaServizioDaSupabase(servizio);
        renderModalServizio(fresco);
    } catch (err) {
        console.error('Errore ricarica servizio:', err);
        renderModalServizio(servizio);
    }
}

function chiudiModalServizio() {
    chiudiModalCompila();
    const modal = document.getElementById('modal-servizio');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    servizioCorrente = null;
}

function parseNumeroKm(val) {
    const s = String(val || '').trim().replace(',', '.');
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function formattaKmCalcolato(n) {
    return String(Math.trunc(n) === n ? Math.trunc(n) : n);
}

/** Se uscita e rientro sono entrambi compilati, imposta KM = rientro - uscita */
function aggiornaKmCalcolatoDaUscitaRientro() {
    const uscitaEl = document.getElementById('compila-km-uscita');
    const rientroEl = document.getElementById('compila-km-rientro');
    const kmEl = document.getElementById('compila-km');
    if (!uscitaEl || !rientroEl || !kmEl) return;

    const uscitaRaw = uscitaEl.value.trim();
    const rientroRaw = rientroEl.value.trim();
    if (!uscitaRaw || !rientroRaw) return;

    const uscita = parseNumeroKm(uscitaRaw);
    const rientro = parseNumeroKm(rientroRaw);
    if (uscita === null || rientro === null) return;

    kmEl.value = formattaKmCalcolato(rientro - uscita);
}

function mostraErroreCompila(msg) {
    const el = document.getElementById('modal-compila-errore');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

function apriModalCompila() {
    if (!servizioCorrente?.id) return;

    const modal = document.getElementById('modal-compila-servizio');
    const info = document.getElementById('modal-compila-info');
    const kmInput = document.getElementById('compila-km');
    const kmUscitaInput = document.getElementById('compila-km-uscita');
    const kmRientroInput = document.getElementById('compila-km-rientro');
    const tempoInput = document.getElementById('compila-tempo');
    const noteInput = document.getElementById('compila-note');
    if (!modal || !kmInput || !tempoInput || !noteInput) return;

    const s = servizioCorrente;
    if (info) {
        info.textContent = `Servizio ${s.id} — ${s.socio_trasportato || ''} del ${s.data_prelievo || ''}`;
    }
    if (kmUscitaInput) kmUscitaInput.value = s.km_uscita || '';
    if (kmRientroInput) kmRientroInput.value = s.km_rientro || '';
    kmInput.value = s.km || '';
    tempoInput.value = formatTimeIso(s.tempo) || '';
    noteInput.value = testoNoteFineVisibile(s.note_fine_servizio);
    mostraErroreCompila('');

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    kmInput.focus();
}

function chiudiModalCompila() {
    const modal = document.getElementById('modal-compila-servizio');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    mostraErroreCompila('');
}

async function salvaDatiFineServizio() {
    if (!servizioCorrente?.id) return;

    const btn = document.getElementById('btn-salva-compila');
    const tempoRaw = document.getElementById('compila-tempo')?.value.trim() ?? '';
    const note = mergeNoteFineConTratta(
        document.getElementById('compila-note')?.value ?? '',
        servizioCorrente?.note_fine_servizio || ''
    );

    if (tempoRaw && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(tempoRaw)) {
        mostraErroreCompila('Formato TEMPO non valido. Usa ore:minuti, es. 01:30');
        return;
    }

    mostraErroreCompila('');
    if (btn) btn.disabled = true;

    try {
        aggiornaKmCalcolatoDaUscitaRientro();
        const km = document.getElementById('compila-km')?.value.trim() ?? '';
        const kmUscita = document.getElementById('compila-km-uscita')?.value.trim() ?? '';
        const kmRientro = document.getElementById('compila-km-rientro')?.value.trim() ?? '';
        const aggiornato = await patchFineServizioSupabase(servizioCorrente, km, kmUscita, kmRientro, tempoRaw, note);

        servizioCorrente = aggiornato;
        aggiornaServizioInCache(aggiornato);
        invalidaCachePeriodoServizio();
        if (calendar) {
            const ev = calendar.getEventById(String(aggiornato.id));
            if (ev) ev.setExtendedProp('servizio', aggiornato);
        }

        chiudiModalCompila();
        renderModalServizio(aggiornato);
    } catch (err) {
        console.error('Errore salvataggio fine servizio:', err);
        mostraErroreCompila(messaggioErroreSalvataggio(err));
    } finally {
        if (btn) btn.disabled = false;
    }
}

function initCalendario() {
    if (calendarioInizializzato) return;
    const mount = document.getElementById('calendario-mount');
    if (!mount || typeof FullCalendar === 'undefined') {
        setLoading(true, 'Errore: libreria calendario non caricata');
        return;
    }

    calendar = new FullCalendar.Calendar(mount, {
        locale: 'it',
        initialView: vistaCalendarioEffettiva(vistaCorrente),
        firstDay: 1,
        height: 'auto',
        dayMinHeight: 118,
        moreLinkClick: 'popover',
        views: {
            dayGridMonth: { dayMaxEvents: 8 },
            dayGridWeek: { dayMaxEvents: 8 },
            dayGridDay: { dayMaxEvents: false, dayMaxEventRows: false },
            listWeek: {
                type: 'list',
                duration: { weeks: 1 },
                listDayFormat: false,
                listDaySideFormat: false
            }
        },
        eventOrder: 'order',
        headerToolbar: isVistaMobileCalendario()
            ? { left: 'prev today next', center: 'title', right: '' }
            : { left: '', center: 'title', right: 'prev,next today' },
        buttonText: { today: 'Oggi' },
        nowIndicator: false,
        eventContent: renderEventContent,
        eventDidMount: applicaColoriEventoCalendario,
        dayHeaderDidMount: dayHeaderDidMountListaMobile,
        eventClick(info) {
            info.jsEvent.preventDefault();
            const id = info.event.id;
            const servizio = (id && serviziById.get(String(id))) || info.event.extendedProps.servizio;
            if (servizio) apriModalServizioConRefresh(servizio);
        },
        datesSet() {
            aggiornaEventiCalendario();
            requestAnimationFrame(() => applicaIntestazioniGiornoListaMobile());
        }
    });

    calendar.render();
    calendarioInizializzato = true;
}

function impostaVista(nomeVista) {
    vistaCorrente = nomeVista;
    document.querySelectorAll('.btn-vista').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.vista === nomeVista);
    });
    if (calendar) {
        calendar.changeView(vistaCalendarioEffettiva(nomeVista));
        requestAnimationFrame(() => applicaIntestazioniGiornoListaMobile());
    }
}

let listenersCalendarioOk = false;

function setupEventListenersCalendario() {
    if (listenersCalendarioOk) return;
    listenersCalendarioOk = true;
    document.querySelectorAll('.btn-vista').forEach(btn => {
        btn.addEventListener('click', () => impostaVista(btn.dataset.vista));
    });

    document.getElementById('btn-logout')?.addEventListener('click', gestisciLogout);
    document.getElementById('btn-close-modal')?.addEventListener('click', chiudiModalServizio);
    document.getElementById('btn-chiudi-modal')?.addEventListener('click', chiudiModalServizio);
    document.getElementById('btn-compila-fine-servizio')?.addEventListener('click', apriModalCompila);
    document.getElementById('btn-salva-modifiche-servizio')?.addEventListener('click', salvaModificheServizioAdmin);
    document.getElementById('btn-close-compila')?.addEventListener('click', chiudiModalCompila);
    document.getElementById('btn-annulla-compila')?.addEventListener('click', chiudiModalCompila);
    document.getElementById('btn-salva-compila')?.addEventListener('click', salvaDatiFineServizio);

    document.getElementById('compila-km-uscita')?.addEventListener('input', aggiornaKmCalcolatoDaUscitaRientro);
    document.getElementById('compila-km-rientro')?.addEventListener('input', aggiornaKmCalcolatoDaUscitaRientro);

    const modal = document.getElementById('modal-servizio');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) chiudiModalServizio();
    });

    const modalCompila = document.getElementById('modal-compila-servizio');
    modalCompila?.addEventListener('click', (e) => {
        if (e.target === modalCompila) chiudiModalCompila();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const compilaAperto = document.getElementById('modal-compila-servizio');
        if (compilaAperto && compilaAperto.style.display === 'flex') {
            chiudiModalCompila();
            return;
        }
        chiudiModalServizio();
    });
}

async function avviaCalendario(user, perm) {
    permessiCorrenti = perm || null;
    mostraCalendario(etichettaUtente(user, perm));
    configuraVistaInizialeMobile();
    initCalendario();
    setupEventListenersCalendario();
    if (isVistaMobileCalendario() && calendar) {
        impostaVista('dayGridDay');
        calendar.today();
    }
    setLoading(true);
    await caricaNominativi();
    await caricaAutomezzi();
    if (calendar) await aggiornaEventiCalendario();
}

// ─── Avvio ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await caricaConfigPubblica();
        document.getElementById('web-login-form')?.addEventListener('submit', gestisciLogin);

        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_OUT') mostraSchermataLogin();
        });

        const giaLoggato = await controllaSessioneEsistente();
        if (!giaLoggato) mostraSchermataLogin();
    } catch (err) {
        mostraSchermataLogin();
        mostraErroreLogin(err.message || 'Errore di inizializzazione.');
        console.error(err);
    }
});
