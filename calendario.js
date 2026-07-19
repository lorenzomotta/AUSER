// Calendario Servizi — dati da Supabase via backend Tauri
import {
    testoNoteFineVisibile,
    parseTrattaDaNote,
    normalizzaPayloadTratta,
    htmlContenutoRiepilogoTratta
} from './tratta-riepilogo.js';

let invoke, appWindow;

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

async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        const windowModule = await import('@tauri-apps/api/window');
        invoke = tauriModule.invoke;
        appWindow = windowModule.appWindow;
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

let calendar = null;
let allAutomezzi = [];
const serviziPerAnnoCache = {};
const serviziById = new Map();
let vistaCorrente = 'dayGridMonth';
let loadRequestId = 0;

function getAnnoCorrente() {
    return new Date().getFullYear();
}

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
    const iso = trimmed.split('-');
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

/** Minuti da mezzanotte per ordinare i servizi nel giorno */
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
        data.setHours(ora.h, ora.m, 0, 0);
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

function costruisciStringaMezzo(servizio) {
    const nrAutomezzo = normalizzaNumero(servizio.mezzo);
    if (!nrAutomezzo) return servizio.mezzo_usato || '';
    if (!allAutomezzi.length) return servizio.mezzo_usato || '';
    const automezzo = allAutomezzi.find(a => normalizzaNumero(a.nr_automezzo) === nrAutomezzo);
    if (!automezzo) return servizio.mezzo_usato || '';
    const parti = [];
    if (automezzo.marca) parti.push(automezzo.marca.trim());
    if (automezzo.modello) parti.push(automezzo.modello.trim());
    if (nrAutomezzo) parti.push(`(${nrAutomezzo})`);
    return parti.join(' - ') || servizio.mezzo_usato || '';
}

async function caricaAutomezzi() {
    if (!isTauri() || !invoke) {
        allAutomezzi = [];
        return;
    }
    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const automezzi = await invoke('get_all_automezzi');
        allAutomezzi = Array.isArray(automezzi) ? automezzi : [];
    } catch (error) {
        console.warn('Automezzi non caricati:', error);
        allAutomezzi = [];
    }
}

async function fetchServiziAnno(anno) {
    if (serviziPerAnnoCache[anno]) {
        return serviziPerAnnoCache[anno];
    }
    if (!isTauri() || !invoke) {
        return getServiziDemo();
    }
    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const servizi = await invoke('get_all_servizi_completi', {
            anno,
            tuttiAnni: false
        });
        serviziPerAnnoCache[anno] = Array.isArray(servizi) ? servizi : [];
        return serviziPerAnnoCache[anno];
    } catch (error) {
        console.error(`Errore caricamento servizi anno ${anno}:`, error);
        throw error;
    }
}

function getServiziDemo() {
    const anno = getAnnoCorrente();
    const demo = [{
        id: '159',
        data_prelievo: `15/07/${anno}`,
        idsocio: '12345',
        socio_trasportato: 'ASTUTI GUIDO',
        ora_inizio: '08:00',
        comune_prelievo: 'ASTI',
        luogo_prelievo: 'VIA ROMA 123',
        tipo_servizio: 'Visita medica',
        carrozzina: '',
        richiedente: 'SOCIO',
        motivazione: 'Visita medica',
        ora_arrivo: '09:30',
        comune_destinazione: 'ASTI',
        luogo_destinazione: 'OSPEDALE',
        pagamento: '0,00 €',
        stato_incasso: 'DA INCASSARE',
        operatore: 'ANDREAZZA MARIA',
        operatore_2: '',
        mezzo_usato: 'FIAT PANDA (3)',
        mezzo: '3',
        tempo: '0',
        km: '15',
        tipo_pagamento: 'CONTANTI',
        data_bonifico: '',
        data_ricevuta: '',
        stato_servizio: 'DA ESEGUIRE',
        note_prelievo: '',
        note_arrivo: '',
        note_fine_servizio: '',
        archivia: 'false'
    }];
    serviziPerAnnoCache[anno] = demo;
    return demo;
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

function renderEventContent(arg) {
    const s = arg.event.extendedProps.servizio || {};
    const parti = [
        s.ora_inizio || '',
        s.socio_trasportato || '',
        s.operatore || ''
    ].filter(p => p.trim() !== '');
    const riga = parti.length ? parti.map(p => escapeHtml(p)).join(' · ') : '—';
    return {
        html: `<div class="cal-event" title="${riga}">${riga}</div>`
    };
}

function aggiornaContatore(num) {
    const el = document.getElementById('calendario-count');
    if (el) {
        el.textContent = `(${num} servizi nel periodo)`;
    }
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
        const start = view.activeStart;
        const end = view.activeEnd;
        const servizi = await caricaServiziPerRange(start, end);
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

    const mezzo = costruisciStringaMezzo(servizio);
    if (title) {
        title.textContent = `SERVIZIO ${servizio.id || ''} — ${servizio.socio_trasportato || ''}`;
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
                ${creaCampoDettaglio('STATO SERVIZIO', servizio.stato_servizio)}
            </div>
            ${htmlRigaTrattaSePresente(servizio)}
            <div class="dettaglio-row">
                ${creaNotaDettaglio('NOTE FINE SERVIZIO', testoNoteFineVisibile(servizio.note_fine_servizio))}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function chiudiModalServizio() {
    const modal = document.getElementById('modal-servizio');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function initCalendario() {
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
        moreLinkClick: 'popover',
        views: {
            dayGridMonth: { dayMaxEvents: 8 },
            dayGridWeek: { dayMaxEvents: 8 },
            dayGridDay: { dayMaxEvents: false, dayMaxEventRows: false }
        },
        eventOrder: 'order',
        headerToolbar: {
            left: '',
            center: 'title',
            right: 'prev,next today'
        },
        buttonText: {
            today: 'Oggi'
        },
        nowIndicator: false,
        eventContent: renderEventContent,
        eventDidMount: applicaColoriEventoCalendario,
        eventClick(info) {
            info.jsEvent.preventDefault();
            const servizio = info.event.extendedProps.servizio;
            if (servizio) apriModalServizio(servizio);
        },
        datesSet() {
            aggiornaEventiCalendario();
        }
    });

    calendar.render();
}

function impostaVista(nomeVista) {
    vistaCorrente = nomeVista;
    document.querySelectorAll('.btn-vista').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.vista === nomeVista);
    });
    if (calendar) {
        calendar.changeView(nomeVista);
    }
}

function setupEventListeners() {
    document.querySelectorAll('.btn-vista').forEach(btn => {
        btn.addEventListener('click', () => {
            impostaVista(btn.dataset.vista);
        });
    });

    const btnChiudi = document.getElementById('btn-chiudi');
    if (btnChiudi) {
        btnChiudi.addEventListener('click', async () => {
            if (isTauri()) {
                try {
                    const { getCurrent } = await import('@tauri-apps/api/window');
                    const currentWindow = getCurrent();
                    if (currentWindow?.label === 'calendario-servizi') {
                        await currentWindow.close();
                        return;
                    }
                } catch (error) {
                    console.warn('Chiusura finestra:', error);
                }
            }
            if (window.opener) {
                window.close();
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnChiudiModal = document.getElementById('btn-chiudi-modal');
    const modal = document.getElementById('modal-servizio');

    if (btnCloseModal) btnCloseModal.addEventListener('click', chiudiModalServizio);
    if (btnChiudiModal) btnChiudiModal.addEventListener('click', chiudiModalServizio);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) chiudiModalServizio();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') chiudiModalServizio();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTauri();
    setupEventListeners();
    initCalendario();
    await caricaAutomezzi();
});
