/**
 * Calendario web per GitHub Pages — accesso operatori con Supabase Auth.
 *
 * Setup:
 * 1. Copia config.public.example.json → config.public.json (con url e anon_key)
 * 2. Su Supabase: abilita Auth email/password e crea account operatori
 * 3. Tabella user_permissions: user_id + Calendario = true (o is_admin = true)
 * 4. Esegui supabase-calendario-web.sql per le policy RLS
 * 5. Pubblica su GitHub Pages i file: CALENDARIO_WEB.html, calendario-web.css,
 *    calendario-web.js, calendario.css, config.public.json
 */

let supabaseClient = null;
let publicConfig = null;
let nominativiMap = {};
let calendar = null;
let allAutomezzi = [];
const serviziPerAnnoCache = {};
const serviziById = new Map();
let vistaCorrente = 'dayGridMonth';

function isVistaMobileCalendario() {
    return window.matchMedia('(max-width: 768px)').matches;
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
    return {
        km: formatKmDaRow(row),
        tempo: formatTempoDaRow(row),
        note_fine_servizio: kNote ? valoreCampoRow(row, kNote) : '',
        _colKm: trovaChiaveRow(row, ['km']) || 'Km',
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

function getAnnoCorrente() {
    return new Date().getFullYear();
}

function anniNelRange(start, end) {
    const anni = new Set();
    const cur = new Date(start);
    cur.setDate(1);
    const fine = new Date(end);
    while (cur <= fine) {
        anni.add(cur.getFullYear());
        cur.setMonth(cur.getMonth() + 1);
    }
    anni.add(fine.getFullYear());
    return [...anni].sort((a, b) => a - b);
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
    const risposta = await fetch('config.public.json', { cache: 'no-store' });
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
    Object.keys(serviziPerAnnoCache).forEach(k => delete serviziPerAnnoCache[k]);
    serviziById.clear();
    nominativiMap = {};
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
    (data || []).forEach(row => {
        const id = getFieldAny(row, ['IdSocio', 'IDSOCIO', 'idsocio']);
        const nom = getFieldAny(row, ['NominativoSocio', 'NOMINATIVO', 'Nominativo', 'nominativo']);
        if (id && nom) nominativiMap[id] = nom;
    });
}

function resolveOperatoreNome(row) {
    const idOp = getFieldAny(row, ['Operatore', 'OPERATORE', 'IdOperatore']);
    if (idOp && nominativiMap[idOp]) return nominativiMap[idOp];
    return idOp;
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
        tipo_servizio: getFieldAny(row, ['Motivazione', 'MOTIVAZIONE']),
        carrozzina: getFieldAny(row, ['Carrozzina', 'CARROZZINA']),
        richiedente: getFieldAny(row, ['Richiedente', 'RICHIEDENTE']),
        motivazione: getFieldAny(row, ['Motivazione', 'MOTIVAZIONE']),
        ora_arrivo: formatDateItalian(getFieldAny(row, ['Destinazione_Data', 'DATA_DESTINAZIONE'])),
        comune_destinazione: getFieldAny(row, ['Destinazione_Comune', 'DESTINAZIONE_COMUNE']),
        luogo_destinazione: getFieldAny(row, ['Destinazione_Indirizzo', 'DESTINAZIONE_INDIRIZZO']),
        pagamento: formatEuroItaliano(donazioni),
        stato_incasso: incassato || 'DA INCASSARE',
        operatore: resolveOperatoreNome(row),
        operatore_2: getFieldAny(row, ['Oper2', 'OPER2']),
        mezzo_usato: '',
        mezzo: getFieldAny(row, ['Mezzo', 'MEZZO']),
        tempo: formatTempoDaRow(row),
        km: formatKmDaRow(row),
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
        tempo: fine.tempo || base.tempo,
        note_fine_servizio: fine.note_fine_servizio || base.note_fine_servizio,
        _colKm: fine._colKm || base._colKm,
        _colTempo: fine._colTempo || base._colTempo,
        _colNote: fine._colNote || base._colNote
    };
}

async function fetchServiziAnno(anno, forceRefresh = false) {
    if (!forceRefresh && serviziPerAnnoCache[anno]) return serviziPerAnnoCache[anno];

    const serviziTable = tabella('servizi');
    const inizio = `${anno}-01-01`;
    const fine = `${anno}-12-31`;

    let { data, error } = await supabaseClient
        .from(serviziTable)
        .select('*')
        .gte('Prelievo_Data', inizio)
        .lte('Prelievo_Data', fine);

    if (error) {
        console.warn('Filtro anno fallito, scarico tutti i servizi:', error.message);
        const res = await supabaseClient.from(serviziTable).select('*');
        if (res.error) throw new Error(res.error.message);
        data = res.data;
    }

    const servizi = (data || [])
        .map(rowToServizioCompleto)
        .filter(Boolean)
        .filter(s => {
            const d = parseDataItaliana(s.data_prelievo);
            return d && d.getFullYear() === anno;
        });

    serviziPerAnnoCache[anno] = servizi;
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

async function caricaServiziPerRange(start, end) {
    const anni = anniNelRange(start, end);
    const risultati = await Promise.all(anni.map(a => fetchServiziAnno(a)));
    const tutti = [];
    risultati.forEach(lista => {
        lista.forEach(s => {
            if (s.id) serviziById.set(String(s.id), s);
            tutti.push(s);
        });
    });
    return tutti;
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

function classeStatoServizioCalendario(stato) {
    const s = String(stato || 'DA ESEGUIRE').trim().toUpperCase();
    if (s === 'ESEGUITO') return 'cal-stato-eseguito';
    if (s === 'ANNULLATO') return 'cal-stato-annullato';
    return 'cal-stato-da-eseguire';
}

function servizioToEvent(servizio) {
    const start = dataOraToIso(servizio.data_prelievo, null);
    if (!start) return null;
    return {
        id: String(servizio.id || `tmp-${Math.random()}`),
        title: servizio.socio_trasportato || 'Servizio',
        start,
        allDay: true,
        order: minutiDaOra(servizio.ora_inizio),
        classNames: [classeStatoServizioCalendario(servizio.stato_servizio)],
        extendedProps: { servizio }
    };
}

function renderEventContent(arg) {
    const s = arg.event.extendedProps.servizio || {};
    const ora = s.ora_inizio || '';
    const socio = s.socio_trasportato || '';
    const op = s.operatore || '';

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

function invalidaCacheAnnoServizio(servizio) {
    if (!servizio?.data_prelievo) return;
    const data = parseDataItaliana(servizio.data_prelievo);
    if (data) delete serviziPerAnnoCache[data.getFullYear()];
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

    const dataPrelievo = parseDataItaliana(servizio.data_prelievo);
    if (dataPrelievo) {
        const anno = dataPrelievo.getFullYear();
        delete serviziPerAnnoCache[anno];
        const lista = await fetchServiziAnno(anno, true);
        const trovato = lista.find(s => String(s.id) === id);
        if (trovato) {
            aggiornaServizioInCache(trovato);
            return trovato;
        }
    }

    console.warn('Servizio non ricaricato da Supabase, id=', id, errOr?.message || '');
    return servizio;
}

function buildPayloadFineServizio(servizio, km, tempoRaw, note) {
    const payload = {};
    payload[servizio._colKm || 'Km'] = km;
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

async function patchFineServizioSupabase(servizio, km, tempoRaw, note) {
    const table = tabella('servizi');
    const payload = buildPayloadFineServizio(servizio, km, tempoRaw, note);
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
    Object.keys(serviziPerAnnoCache).forEach(anno => {
        const lista = serviziPerAnnoCache[anno];
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

function apriModalServizio(servizio) {
    const modal = document.getElementById('modal-servizio');
    const body = document.getElementById('modal-servizio-body');
    const title = document.getElementById('modal-servizio-title');
    if (!modal || !body) return;

    servizioCorrente = servizio;
    if (title) title.textContent = `SERVIZIO ${servizio.id || ''} — ${servizio.socio_trasportato || ''}`;

    body.innerHTML = '<p class="modal-caricamento">Caricamento dati servizio...</p>';
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

    body.innerHTML = `
        <div class="dettaglio-section">
            <div class="dettaglio-row">
                ${creaCampoDettaglio('IDSERVIZIO', servizio.id, 'field-small')}
                ${creaCampoDettaglio('IDSOCIO', servizio.idsocio, 'field-small')}
                ${creaCampoDettaglio('DATA PRELIEVO', servizio.data_prelievo, 'field-medium')}
                ${creaCampoDettaglio('ORA PRELIEVO (O.S.C.)', servizio.ora_inizio, 'field-small')}
                ${creaCampoDettaglio('COMUNE PRELIEVO', servizio.comune_prelievo)}
                ${creaCampoDettaglio('LUOGO PRELIEVO', servizio.luogo_prelievo, 'field-large')}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('TRASPORTATO', servizio.socio_trasportato, 'field-large')}
                ${creaCampoDettaglio('RICHIEDENTE', servizio.richiedente)}
                ${creaCampoDettaglio('TIPO SERVIZIO', servizio.tipo_servizio)}
                ${creaCampoDettaglio('CARROZZINA', servizio.carrozzina)}
                ${creaCampoDettaglio('MOTIVAZIONE', servizio.motivazione, 'field-large')}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('ORA ARRIVO (O.A.D.)', servizio.ora_arrivo, 'field-small')}
                ${creaCampoDettaglio('COMUNE DESTINAZIONE', servizio.comune_destinazione)}
                ${creaCampoDettaglio('LUOGO DESTINAZIONE', servizio.luogo_destinazione, 'field-large')}
                ${creaCampoDettaglio('STATO INCASSO', servizio.stato_incasso)}
                ${creaCampoDettaglio('TIPO PAGAMENTO', servizio.tipo_pagamento)}
            </div>
            <div class="dettaglio-row">
                ${creaCampoDettaglio('OPERATORE', servizio.operatore, 'field-large')}
                ${creaCampoDettaglio('OPERATORE 2', servizio.operatore_2)}
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
                ${creaCampoDettaglio('ARCHIVIA', servizio.archivia)}
            </div>
            <div class="dettaglio-row">
                ${creaNotaDettaglio('NOTE PRELIEVO', servizio.note_prelievo)}
                ${creaNotaDettaglio('NOTE ARRIVO', servizio.note_arrivo)}
                ${creaNotaDettaglio('NOTE FINE SERVIZIO', servizio.note_fine_servizio)}
            </div>
        </div>
    `;
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
    const tempoInput = document.getElementById('compila-tempo');
    const noteInput = document.getElementById('compila-note');
    if (!modal || !kmInput || !tempoInput || !noteInput) return;

    const s = servizioCorrente;
    if (info) {
        info.textContent = `Servizio ${s.id} — ${s.socio_trasportato || ''} del ${s.data_prelievo || ''}`;
    }
    kmInput.value = s.km || '';
    tempoInput.value = formatTimeIso(s.tempo) || '';
    noteInput.value = s.note_fine_servizio || '';
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
    const km = document.getElementById('compila-km')?.value.trim() ?? '';
    const tempoRaw = document.getElementById('compila-tempo')?.value.trim() ?? '';
    const note = document.getElementById('compila-note')?.value.trim() ?? '';

    if (tempoRaw && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(tempoRaw)) {
        mostraErroreCompila('Formato TEMPO non valido. Usa ore:minuti, es. 01:30');
        return;
    }

    mostraErroreCompila('');
    if (btn) btn.disabled = true;

    try {
        const aggiornato = await patchFineServizioSupabase(servizioCorrente, km, tempoRaw, note);

        servizioCorrente = aggiornato;
        aggiornaServizioInCache(aggiornato);
        invalidaCacheAnnoServizio(aggiornato);
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
        initialView: vistaCorrente,
        firstDay: 1,
        height: 'auto',
        dayMinHeight: 118,
        dayMaxEvents: 8,
        moreLinkClick: 'popover',
        eventOrder: 'order',
        headerToolbar: isVistaMobileCalendario()
            ? { left: 'prev today next', center: 'title', right: '' }
            : { left: 'prev,next today', center: 'title', right: '' },
        buttonText: { today: 'Oggi' },
        nowIndicator: false,
        eventContent: renderEventContent,
        eventClick(info) {
            info.jsEvent.preventDefault();
            const id = info.event.id;
            const servizio = (id && serviziById.get(String(id))) || info.event.extendedProps.servizio;
            if (servizio) apriModalServizioConRefresh(servizio);
        },
        datesSet() {
            aggiornaEventiCalendario();
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
    if (calendar) calendar.changeView(nomeVista);
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
    document.getElementById('btn-close-compila')?.addEventListener('click', chiudiModalCompila);
    document.getElementById('btn-annulla-compila')?.addEventListener('click', chiudiModalCompila);
    document.getElementById('btn-salva-compila')?.addEventListener('click', salvaDatiFineServizio);

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
