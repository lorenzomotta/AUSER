import {
    initModificaServizio,
    setupModaleModifica,
    apriModalModifica,
    caricaDatiModificaServizio
} from './modifica-servizio.js';
import {
    initCompletaServizio,
    setupModaleCompleta,
    apriModalCompleta
} from './completa-servizio.js';
import { testoNoteFineVisibile, parseTrattaDaNote, htmlContenutoRiepilogoTratta, normalizzaPayloadTratta } from './tratta-riepilogo.js';
import { parseTariffaDaNote, htmlContenutoRiepilogoTariffa } from './calcola-tariffa.js';
import { initStampaPdfElencoServizi } from './elencoservizi-pdf.js';
import { testoMezzoServizio } from './mezzo-etichetta.js';
import {
    initPagamentoCumulativo,
    setupPagamentoCumulativo,
    htmlCheckboxPagamentoCumulativo,
    collegaCheckboxPagamentoCumulativo,
    isPagamentoCumulativo
} from './pagamento-cumulativo.js';

function escapeHtmlElenco(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Icone SVG per i pulsanti compatti dell'elenco. */
const ICONA_FILTRO = `<svg class="es-icona" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>`;
const ICONA_FILTRO_ATTIVO = `<svg class="es-icona" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/><path fill="currentColor" d="M19.1 4.1 4.1 19.1l1.4 1.4L20.5 5.5z"/></svg>`;
const ICONA_STAMPANTE = `<svg class="es-icona" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`;
const ICONA_MATITA = `<img src="assets/icona-modifica.png?v=1" alt="">`;
const ICONA_COMPLETA = `<svg class="es-icona" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;

function htmlBtnFiltraIcona({ attrName, attrValue, attivo, disabled = false, titoloFiltra, titoloTutti }) {
    const valore = escapeHtmlElenco(attrValue || '');
    const title = attivo ? (titoloTutti || 'Mostra tutti') : (titoloFiltra || 'Filtra');
    const aria = attivo ? 'Mostra tutti' : 'Filtra';
    const icona = attivo ? ICONA_FILTRO_ATTIVO : ICONA_FILTRO;
    const classeAttivo = attivo ? ' is-attivo' : '';
    const disabledAttr = disabled ? ' disabled' : '';
    return `<button type="button" class="btn btn-filtra btn-icona${classeAttivo}" ${attrName}="${valore}" title="${escapeHtmlElenco(title)}" aria-label="${escapeHtmlElenco(aria)}"${disabledAttr}>${icona}</button>`;
}

// Import Tauri API
let invoke, appWindow;

// Funzione per inizializzare le API Tauri
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

async function apriSchedaServizioStampa(id) {
    const idNum = parseInt(id, 10);
    if (!Number.isFinite(idNum) || idNum <= 0) {
        alert('ID servizio non valido');
        return;
    }

    const url = `SCHEDASERVIZIO.html?id=${encodeURIComponent(idNum)}`;

    if (isTauri()) {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const label = `scheda-servizio-${idNum}`;

            const existing = WebviewWindow.getByLabel(label);
            if (existing) {
                try {
                    await existing.show();
                    await existing.setFocus();
                    return;
                } catch (err) {
                    console.warn('Finestra scheda non riutilizzabile:', err);
                    try { await existing.close(); } catch (_) { /* ignore */ }
                }
            }

            const webview = new WebviewWindow(label, {
                url,
                title: `Scheda servizio ${idNum}`,
                width: 900,
                height: 1100,
                resizable: true,
                maximized: false,
                decorations: true,
                center: true
            });

            webview.setFocus().catch((err) => console.warn('setFocus scheda:', err));
            return;
        } catch (error) {
            console.error('Errore apertura scheda servizio:', error);
        }
    }

    window.open(url, `scheda-servizio-${idNum}`, 'width=900,height=1100');
}

function getIdsocioFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('idsocio') || '').trim();
}

function getNominativoFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('nominativo') || '').trim();
}

function getOperatoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('operatore') || '').trim();
}

function normalizzaIdOperatore(value) {
    const s = String(value ?? '').trim();
    if (!s) return '';
    const noDec = s.endsWith('.0') ? s.slice(0, -2) : s;
    if (/^\d+$/.test(noDec)) return String(parseInt(noDec, 10));
    return noDec;
}

function nomeChiaveOperatore(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
}

function trovaOperatoreAnagrafica(valore) {
    const v = String(valore || '').trim();
    const lista = [
        ...(Array.isArray(allOperatori) ? allOperatori : []),
        ...(Array.isArray(allTesserati) ? allTesserati : [])
    ];
    if (!v || !lista.length) return null;
    const id = normalizzaIdOperatore(v);
    const nome = nomeChiaveOperatore(v);
    return lista.find((o) => {
        if (id && normalizzaIdOperatore(o.idsocio) === id) return true;
        if (id && normalizzaIdOperatore(o.id) === id) return true;
        return nome && nomeChiaveOperatore(o.nominativo) === nome;
    }) || null;
}

function raccogliIdsOperatore(valoreFiltro) {
    const v = String(valoreFiltro || '').trim();
    const ids = new Set();
    const sel = document.getElementById('ricerca-operatore');
    const opt = sel?.selectedOptions?.[0];
    [v, opt?.dataset?.id, opt?.dataset?.idsocio].forEach((x) => {
        const n = normalizzaIdOperatore(x);
        if (n) ids.add(n);
    });

    const nomeOpt = (opt?.dataset?.nominativo || opt?.textContent || '').trim();
    const t = trovaOperatoreAnagrafica(v) || (nomeOpt ? trovaOperatoreAnagrafica(nomeOpt) : null);
    const nomeTarget = t?.nominativo || nomeOpt || (/^\d+$/.test(v) ? '' : v);
    const nk = nomeChiaveOperatore(nomeTarget);

    const lista = Array.isArray(allTesserati) && allTesserati.length ? allTesserati : allOperatori;
    (lista || []).forEach((p) => {
        const stessoNome = nk && nomeChiaveOperatore(p.nominativo) === nk;
        const stessoId = ids.has(normalizzaIdOperatore(p.idsocio)) || ids.has(normalizzaIdOperatore(p.id));
        if (!stessoNome && !stessoId) return;
        [p.idsocio, p.id].forEach((x) => {
            const n = normalizzaIdOperatore(x);
            if (n) ids.add(n);
        });
    });

    return { ids: [...ids], nomeTarget, nk };
}

function servizioMatchaOperatore(servizio, valoreFiltro) {
    const v = String(valoreFiltro || '').trim();
    if (!v) return true;
    const { ids, nk, nomeTarget } = raccogliIdsOperatore(v);

    const idsServizio = [servizio.id_operatore, servizio.id_operatore_2]
        .concat(
            [servizio.operatore, servizio.operatore_2, servizio.operatore_testo].filter((x) =>
                /^\d+$/.test(normalizzaIdOperatore(x))
            )
        )
        .map(normalizzaIdOperatore)
        .filter(Boolean);
    if (ids.some((id) => idsServizio.includes(id))) return true;

    if (nk && [servizio.operatore, servizio.operatore_2, servizio.operatore_testo].some((ns) => nomeChiaveOperatore(ns) === nk)) {
        return true;
    }

    const parti = String(nomeTarget || '')
        .trim()
        .toUpperCase()
        .split(/\s+/)
        .filter((p) => p.length >= 3);
    if (parti.length >= 2) {
        return [servizio.operatore, servizio.operatore_2, servizio.operatore_testo].some((ns) => {
            const s = String(ns || '').toUpperCase();
            return parti.every((p) => s.includes(p));
        });
    }
    return false;
}

async function caricaTuttiAnniSeFiltroUrl() {
    if (filtroAnnoModo === 'tutti') return;
    applicaFiltroArchiviaIniziale = false;
    filtroAnnoModo = 'tutti';
    updateAnnoHeaderUI();
}

/** Filtro iniziale da URL (?idsocio= o ?operatore=). */
async function applicaFiltroInizialeDaUrl() {
    const idsocio = getIdsocioFromUrl();
    const operatore = getOperatoreFromUrl();
    if (!idsocio && !operatore) return;

    // Socio: storico completo (tutti gli anni). Operatore: di default anno corrente.
    if (idsocio) {
        await caricaTuttiAnniSeFiltroUrl();
    } else if (operatore) {
        filtroAnnoModo = 'corrente';
        updateAnnoHeaderUI();
    }

    const titleEl = document.getElementById('servizi-title-text');
    const nominativoSocio = getNominativoFromUrl();

    if (idsocio) {
        filtriRicerca.idsocio = idsocio;
        const inputIdsocio = document.getElementById('ricerca-idsocio');
        if (inputIdsocio) inputIdsocio.value = idsocio;
        if (titleEl) {
            titleEl.textContent = nominativoSocio
                ? `SERVIZI SOCIO ${idsocio} — ${nominativoSocio}`
                : `SERVIZI SOCIO ${idsocio}`;
        }
    }

    if (operatore) {
        filtriRicerca.operatore = operatore;
        const inputOperatore = document.getElementById('ricerca-operatore');
        if (inputOperatore) inputOperatore.value = operatore;
        if (titleEl && !idsocio) {
            titleEl.textContent = `SERVIZI OPERATORE — ${operatore}`;
        }
    }

    applyAllFilters();
    updateFilterWarning();
}

async function focusElencoSociWindow() {
    if (!isTauri()) return;
    try {
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        const elencoSoci = WebviewWindow.getByLabel('elenco-soci');
        if (elencoSoci) {
            await elencoSoci.show();
            await elencoSoci.setFocus();
        }
    } catch (err) {
        console.warn('Ripristino focus Elenco Soci:', err);
    }
}

async function focusElencoOperatoriWindow() {
    if (!isTauri()) return;
    try {
        const { WebviewWindow, getCurrent } = await import('@tauri-apps/api/window');
        const elencoOperatori = WebviewWindow.getByLabel('elenco-operatori');
        if (elencoOperatori) {
            await elencoOperatori.show();
            await elencoOperatori.setFocus();
            return;
        }
        const current = getCurrent();
        if (current && /elencooperatori\.html/i.test(window.location.pathname)) {
            await current.show();
            await current.setFocus();
        }
    } catch (err) {
        console.warn('Ripristino focus Elenco Operatori:', err);
    }
}

function isFinestraServiziDaElencoSocio(label = '') {
    return !!getIdsocioFromUrl() || String(label).startsWith('elenco-servizi-socio-');
}

function isFinestraServiziDaElencoOperatori(label = '') {
    return !!getOperatoreFromUrl() || String(label).startsWith('elenco-servizi-operatore-');
}

async function chiudiFinestraElencoServizi() {
    const daElencoSocio = isFinestraServiziDaElencoSocio();
    const daElencoOperatori = isFinestraServiziDaElencoOperatori();

    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = String(currentWindow?.label || '');

            const isElencoServizi =
                label === 'elenco-servizi'
                || label.startsWith('elenco-servizi-socio-')
                || label.startsWith('elenco-servizi-operatore-');

            const tornaAllaHome = async () => {
                try {
                    const mainWin = WebviewWindow.getByLabel('main');
                    if (mainWin) {
                        await mainWin.unminimize().catch(() => {});
                        await mainWin.show();
                        await mainWin.setFocus();
                    }
                } catch (_) { /* ignore */ }
            };

            // Chiudi solo la finestra popup di Elenco Servizi — mai la home
            if (isElencoServizi) {
                if (daElencoSocio) {
                    await focusElencoSociWindow();
                } else if (daElencoOperatori) {
                    await focusElencoOperatoriWindow();
                } else {
                    await tornaAllaHome();
                }
                await currentWindow.close();
                return;
            }

            // Se Elenco Servizi è finito sulla finestra principale: torna a index, non chiudere l'app
            await tornaAllaHome();
            window.location.href = 'index.html';
            return;
        } catch (error) {
            console.error('Errore nella chiusura finestra:', error);
            if (!daElencoSocio && !daElencoOperatori) {
                window.location.href = 'index.html';
            }
        }
        return;
    }

    if (window.opener) {
        window.close();
    } else if (!daElencoSocio && !daElencoOperatori) {
        window.location.href = 'index.html';
    }
}

async function setupChiusuraRitornoFinestraOrigine() {
    if (!isTauri()) return;
    const idsocio = getIdsocioFromUrl();
    const operatore = getOperatoreFromUrl();
    if (!idsocio && !operatore) return;

    try {
        const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
        const win = getCurrent();
        await win.listen('tauri://close-requested', async () => {
            if (idsocio) {
                const elencoSoci = WebviewWindow.getByLabel('elenco-soci');
                if (elencoSoci) {
                    await elencoSoci.show();
                    await elencoSoci.setFocus();
                }
            } else if (operatore) {
                const elencoOperatori = WebviewWindow.getByLabel('elenco-operatori');
                if (elencoOperatori) {
                    await elencoOperatori.show();
                    await elencoOperatori.setFocus();
                }
            }
        });
    } catch (err) {
        console.warn('Listener chiusura servizi filtrati:', err);
    }
}

// Carica i dati del servizio da SharePoint
async function loadServizioData(servizioId) {
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: caricamento dati di esempio');
        loadDemoData();
        return;
    }
    
    try {
        console.log('Caricamento servizio ID:', servizioId);
        const servizio = await invoke('get_servizio_completo', { servizioId: parseInt(servizioId, 10) });
        console.log('Servizio caricato:', servizio);
        populateForm(servizio);
    } catch (error) {
        console.error('Errore nel caricamento dati servizio:', error);
        // Fallback a dati di esempio in caso di errore
        loadDemoData();
    }
}

// Popola il form con i dati
function populateForm(servizio) {
    if (!servizio) {
        console.error('Servizio è null o undefined');
        return;
    }
    
    // Funzione helper per impostare il valore in modo sicuro
    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
        } else {
            console.warn(`Elemento con id "${id}" non trovato`);
        }
    };
    
    setValue('ids', servizio.id);
    setValue('data-prelievo', servizio.data_prelievo);
    setValue('idsocio', servizio.idsocio);
    setValue('socio-trasportato', servizio.socio_trasportato);
    setValue('ora-inizio', servizio.ora_inizio);
    setValue('comune-prelievo', servizio.comune_prelievo);
    setValue('luogo-prelievo', servizio.luogo_prelievo);
    setValue('tipo-servizio', servizio.tipo_servizio);
    setValue('carrozzina', servizio.carrozzina);
    setValue('richiedente', servizio.richiedente);
    setValue('motivazione', servizio.motivazione);
    setValue('ora-arrivo', servizio.ora_arrivo);
    setValue('comune-destinazione', servizio.comune_destinazione);
    setValue('luogo-destinazione', servizio.luogo_destinazione);
    setValue('pagamento', servizio.pagamento);
    setValue('stato-incasso', servizio.stato_incasso);
    setValue('operatore', servizio.operatore);
    setValue('mezzo-usato', costruisciStringaMezzo(servizio));
    setValue('tempo', servizio.tempo);
    setValue('km', servizio.km);
    setValue('tipo-pagamento', servizio.tipo_pagamento);
    setValue('data-bonifico', servizio.data_bonifico);
    setValue('stato-servizio', servizio.stato_servizio);
    setValue('note-fine-servizio', testoNoteFineVisibile(servizio.note_fine_servizio));
}

// Carica dati di esempio per demo
function loadDemoData() {
    const servizioDemo = {
        id: '159',
        data_prelievo: '02/09/2025',
        idsocio: '12345',
        socio_trasportato: 'ASTUTI GUIDO',
        ora_inizio: '08:00',
        comune_prelievo: 'ROMA',
        luogo_prelievo: 'VIA ROMA 123',
        tipo_servizio: 'STANDARD',
        carrozzina: '',
        richiedente: 'SOCIO',
        motivazione: 'Visita medica',
        ora_arrivo: '09:30',
        comune_destinazione: 'ROMA',
        luogo_destinazione: 'OSPEDALE SANTO SPIRITO',
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
        stato_servizio: 'ESEGUITO',
        note_fine_servizio: ''
    };
    populateForm(servizioDemo);
}

// Funzione per normalizzare un numero (rimuove .0 finale se presente)
// Gestisce sia stringhe che numeri
function normalizzaNumero(numStrOrNum) {
    if (numStrOrNum === null || numStrOrNum === undefined) return '';
    
    // Se è un numero, convertilo in stringa
    if (typeof numStrOrNum === 'number') {
        numStrOrNum = numStrOrNum.toString();
    }
    
    if (typeof numStrOrNum !== 'string') return '';
    
    const trimmed = numStrOrNum.trim();
    if (!trimmed) return '';
    
    // Rimuovi .0 finale se presente (es: "2.0" -> "2")
    if (trimmed.endsWith('.0')) {
        return trimmed.slice(0, -2);
    }
    
    // Se è un numero decimale senza parte frazionaria (es: "2.00"), converti in intero
    if (trimmed.includes('.')) {
        const num = parseFloat(trimmed);
        if (!isNaN(num) && num % 1 === 0) {
            return num.toString();
        }
    }
    
    return trimmed;
}

// Funzione per costruire la stringa del mezzo
function costruisciStringaMezzo(servizio) {
    return testoMezzoServizio(servizio, allAutomezzi);
}

// Carica tutti gli automezzi
async function caricaAutomezzi() {
    console.log('=== caricaAutomezzi chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio per automezzi');
        allAutomezzi = [
            { id: 1, nr_automezzo: "3", marca: "FIAT", modello: "PANDA" },
            { id: 2, nr_automezzo: "2", marca: "", modello: "" } // Esempio per test
        ];
        console.log(`✓ Caricati ${allAutomezzi.length} automezzi (demo):`, allAutomezzi);
        return;
    }
    
    try {
        console.log('Chiamata a invoke("get_all_automezzi") (Supabase)...');
        try {
            await invoke('init_supabase_from_config');
        } catch (initErr) {
            console.warn('Init Supabase:', initErr);
        }
        const automezzi = await invoke('get_all_automezzi');
        console.log('Risposta ricevuta da get_all_automezzi:', automezzi);
        console.log('Tipo risposta:', typeof automezzi, 'È array:', Array.isArray(automezzi));
        
        allAutomezzi = automezzi || [];
        console.log(`✓ Caricati ${allAutomezzi.length} automezzi da Supabase (Automezzi_Supa)`);
        
        // Log dettagliato per debug
        if (allAutomezzi.length > 0) {
            console.log('Prime 10 automezzi caricate:');
            allAutomezzi.slice(0, 10).forEach((a, idx) => {
                console.log(`  [${idx + 1}] ID: ${a.id}, NR_AUTOMEZZO: "${a.nr_automezzo}" (tipo: ${typeof a.nr_automezzo}), MARCA: "${a.marca}", MODELLO: "${a.modello}"`);
            });
        } else {
            console.warn('⚠️ ATTENZIONE: Nessun automezzo caricato! Verifica supabase.tables.automezzi e la anon_key in config.json.');
        }
    } catch (error) {
        console.error('✗ Errore nel caricamento automezzi:', error);
        console.error('Dettagli errore:', error.message, error.stack);
        allAutomezzi = [];
    }
    
    console.log('=== Fine caricaAutomezzi ===');
}

// Cache globale per i servizi
let serviziCache = [];
let serviziOriginali = []; // Cache per i servizi originali (prima del filtro)
const PAGE_SIZE = 50;
let currentPage = 1;
let totaleServiziRemoti = 0;
let elencoPaginatoSulServer = false;
let caricaListaToken = 0;
let filtroAnnoModo = 'corrente'; // corrente | precedente | tutti
const serviziAnnoCache = {
    corrente: null,
    precedente: null,
    tutti: null
};
let applicaFiltroArchiviaIniziale = true;
let filtroTrasportatoAttivo = false; // Stato del filtro TRASPORTATO
let valoreFiltroTrasportato = null; // Valore del filtro TRASPORTATO attualmente attivo
let filtroOperatoreAttivo = false; // Stato del filtro OPERATORE
let valoreFiltroOperatore = null; // Valore del filtro OPERATORE attualmente attivo
let filtroAccompagnatoreAttivo = false; // Stato del filtro ACCOMPAGNATORE
let valoreFiltroAccompagnatore = null; // Valore del filtro ACCOMPAGNATORE attualmente attivo
let filtroStatoAttivo = false; // Stato del filtro STATO DEL SERVIZIO
let valoreFiltroStato = null; // Valore del filtro STATO DEL SERVIZIO attualmente attivo ('DA ESEGUIRE', 'ESEGUITO', 'ANNULLATO')
let filtroRichiedenteAttivo = false; // Stato del filtro RICHIEDENTE
let valoreFiltroRichiedente = null; // Valore del filtro RICHIEDENTE attualmente attivo ('SOCIO', 'COMUNE', 'ALTRI')

// Filtri avanzati ricerca
let filtriRicerca = {
    idservizio: null,
    idsocio: null,
    nominativo: null,
    dataDa: null,
    dataA: null,
    statoIncasso: null,
    tipoPagamento: null,
    tipoServizio: null,
    carrozzina: null,
    richiedente: null,
    operatore: null,
    accompagnatore: null,
    pagamentoCumulativo: null,
    pagamentoCumulativoNumero: null
};

// Cache per tesserati e operatori
let allTesserati = [];
let allOperatori = [];

// Cache per automezzi
let allAutomezzi = [];

function getAnnoCorrente() {
    return new Date().getFullYear();
}

function getAnnoDaDataPrelievo(dataPrelievo) {
    if (!dataPrelievo || typeof dataPrelievo !== 'string') return null;
    const trimmed = dataPrelievo.trim();
    const slashParts = trimmed.split('/');
    if (slashParts.length === 3) {
        const year = parseInt(slashParts[2], 10);
        return Number.isNaN(year) ? null : year;
    }
    const isoParts = trimmed.split('-');
    if (isoParts.length === 3) {
        const year = parseInt(isoParts[0], 10);
        return Number.isNaN(year) ? null : year;
    }
    return null;
}

function getAnnoPrecedente() {
    return getAnnoCorrente() - 1;
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
    if (s === '' || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === 'S' || s === '1' ||
           s === 'YES' || s === 'Y' || s === 'ATTIVO';
}

function isServizioArchiviato(servizio) {
    return isTruthyFlag(servizio.archivia);
}

function getServiziListaBaseForModo(modo) {
    const raw = serviziAnnoCache[modo] || [];
    if (applicaFiltroArchiviaIniziale && modo === 'corrente') {
        return raw.filter(s => !isServizioArchiviato(s));
    }
    return [...raw];
}

async function fetchServiziFromBackend(modo, limite) {
    if (!isTauri() || !invoke) {
        return serviziOriginali.length ? [...serviziOriginali] : [];
    }

    const tetto = limite ? { limite } : {};

    if (modo === 'tutti') {
        return await invoke('get_all_servizi_completi', { anno: null, tuttiAnni: true, ...tetto });
    }
    if (modo === 'precedente') {
        return await invoke('get_all_servizi_completi', {
            anno: getAnnoPrecedente(),
            tuttiAnni: false,
            ...tetto
        });
    }
    return await invoke('get_all_servizi_completi', {
        anno: getAnnoCorrente(),
        tuttiAnni: false,
        escludiArchiviati: true,
        ...tetto
    });
}

async function getServiziForModo(modo) {
    if (serviziAnnoCache[modo]) {
        return [...serviziAnnoCache[modo]];
    }
    const servizi = await fetchServiziFromBackend(modo);
    serviziAnnoCache[modo] = Array.isArray(servizi) ? servizi : [];
    return [...serviziAnnoCache[modo]];
}

function updateAnnoHeaderUI() {
    const titleEl = document.getElementById('servizi-title-text');
    const btnCorrente = document.getElementById('btn-anno-corrente');
    const btnPrec = document.getElementById('btn-anno-precedente');
    const btnTutti = document.getElementById('btn-tutti-anni');

    let titleText = 'ELENCO SERVIZI ANNO CORRENTE';
    if (filtroAnnoModo === 'precedente') {
        titleText = `ELENCO SERVIZI ANNO ${getAnnoPrecedente()}`;
    } else if (filtroAnnoModo === 'tutti') {
        titleText = 'ELENCO SERVIZI TUTTI GLI ANNI';
    }

    if (titleEl) {
        // Se la finestra è aperta da Socio/Operatore, non sovrascrivere il titolo dedicato
        const operatore = getOperatoreFromUrl() || testoONull(filtriRicerca?.operatore);
        const idsocio = getIdsocioFromUrl() || testoONull(filtriRicerca?.idsocio);
        if (operatore && !idsocio) {
            titleEl.textContent = `SERVIZI OPERATORE — ${operatore}`;
        } else if (idsocio) {
            const nominativoSocio = getNominativoFromUrl() || testoONull(filtriRicerca?.nominativo);
            titleEl.textContent = nominativoSocio
                ? `SERVIZI SOCIO ${idsocio} — ${nominativoSocio}`
                : `SERVIZI SOCIO ${idsocio}`;
        } else {
            titleEl.textContent = titleText;
        }
    }
    if (btnCorrente) {
        btnCorrente.classList.toggle('active', filtroAnnoModo === 'corrente');
    }
    if (btnPrec) {
        btnPrec.classList.toggle('active', filtroAnnoModo === 'precedente');
    }
    if (btnTutti) {
        btnTutti.classList.toggle('active', filtroAnnoModo === 'tutti');
    }
}

function testoONull(valore) {
    const s = String(valore || '').trim();
    return s || null;
}

function operatoreRichiestaAttiva() {
    const daRicerca = testoONull(filtriRicerca.operatore);
    const daPulsante = filtroOperatoreAttivo ? testoONull(valoreFiltroOperatore) : null;
    const valore = daRicerca || daPulsante;
    if (!valore) return { ids: [], nome: null };
    const raccolti = raccogliIdsOperatore(valore);
    const nome = testoONull(raccolti.nomeTarget) || valore;
    return { ids: raccolti.ids || [], nome };
}

function costruisciRichiestaElenco(offset, limite) {
    const tutti = filtroAnnoModo === 'tutti';
    const anno = filtroAnnoModo === 'precedente' ? getAnnoPrecedente() : getAnnoCorrente();
    const operatore = operatoreRichiestaAttiva();
    const richiedente = testoONull(filtriRicerca.richiedente) || (filtroRichiedenteAttivo ? testoONull(valoreFiltroRichiedente) : null);
    const stato = filtroStatoAttivo ? testoONull(valoreFiltroStato) : null;
    return {
        anno: tutti ? null : anno,
        tuttiAnni: tutti,
        escludiArchiviati: filtroAnnoModo === 'corrente',
        offset,
        limite,
        idsocio: testoONull(filtriRicerca.idsocio),
        idservizio: testoONull(filtriRicerca.idservizio),
        trasportato: filtroTrasportatoAttivo ? testoONull(valoreFiltroTrasportato) : null,
        nominativo: testoONull(filtriRicerca.nominativo),
        dataDa: testoONull(filtriRicerca.dataDa),
        dataA: testoONull(filtriRicerca.dataA),
        statoServizio: stato,
        richiedente,
        statoIncasso: testoONull(filtriRicerca.statoIncasso),
        tipoPagamento: testoONull(filtriRicerca.tipoPagamento),
        tipoServizio: testoONull(filtriRicerca.tipoServizio),
        carrozzina: testoONull(filtriRicerca.carrozzina),
        operatoreIds: operatore.ids,
        operatoreNome: operatore.nome,
        accompagnatoreNome: testoONull(filtriRicerca.accompagnatore)
            || (filtroAccompagnatoreAttivo ? testoONull(valoreFiltroAccompagnatore) : null),
        pagamentoCumulativo: filtriRicerca.pagamentoCumulativo === 'SI'
            ? true
            : filtriRicerca.pagamentoCumulativo === 'NO'
                ? false
                : null,
        pagamentoCumulativoNumero: (() => {
            const n = Number(filtriRicerca.pagamentoCumulativoNumero || 0);
            return Number.isFinite(n) && n > 0 ? n : null;
        })()
    };
}

async function caricaLista(page) {
    const containerBody = document.getElementById('servizi-container-body');
    const pagina = Math.max(1, page || 1);
    if (!isTauri() || !invoke) {
        renderServiziView(false);
        return;
    }

    const token = ++caricaListaToken;
    if (containerBody) {
        containerBody.innerHTML = '<div class="servizi-lista-loading">Caricamento servizi...</div>';
    }

    try {
        await invoke('init_supabase_from_config').catch(() => {});
        const risposta = await invoke('get_servizi_elenco_pagina', costruisciRichiestaElenco((pagina - 1) * PAGE_SIZE, PAGE_SIZE));
        if (token !== caricaListaToken) return false;

        const servizi = Array.isArray(risposta?.servizi) ? risposta.servizi : [];
        totaleServiziRemoti = Number(risposta?.totale) || 0;
        elencoPaginatoSulServer = true;
        currentPage = pagina;
        serviziCache = servizi;
        serviziOriginali = servizi;
        if (totaleServiziRemoti === 0) {
            if (containerBody) {
                containerBody.innerHTML = '<div class="servizi-lista-empty">Nessun servizio trovato</div>';
            }
            updatePaginationBar(0, 1, 1);
            updateServiziCount();
            updateFiltroStatoButtons();
            return true;
        }
        renderServiziView(false);
        updateFiltroStatoButtons();
        if (containerBody) containerBody.scrollTop = 0;
        return true;
    } catch (error) {
        if (token !== caricaListaToken) return false;
        console.error('Errore nel caricamento servizi:', error);
        const errorMsg = error?.message || error || 'Errore sconosciuto';
        if (containerBody) {
            containerBody.innerHTML = `<div class="servizi-lista-empty">Errore: ${errorMsg}</div>`;
        }
        updatePaginationBar(0, 1, 1);
        return false;
    }
}

async function scaricaServiziFiltratiPerStampa() {
    if (!elencoPaginatoSulServer || !invoke) {
        return serviziCache || [];
    }
    const tutti = [];
    const blocco = 200;
    let offset = 0;
    const tetto = Math.min(totaleServiziRemoti || 0, 4000);
    while (offset < tetto) {
        const risposta = await invoke('get_servizi_elenco_pagina', costruisciRichiestaElenco(offset, blocco));
        const pezzo = Array.isArray(risposta?.servizi) ? risposta.servizi : [];
        tutti.push(...pezzo);
        if (pezzo.length < blocco) break;
        offset += blocco;
    }
    return tutti;
}

async function switchAnnoModo(modo) {
    if (modo === filtroAnnoModo) {
        return;
    }

    applicaFiltroArchiviaIniziale = false;
    filtroAnnoModo = modo;
    updateAnnoHeaderUI();
    updateFilterWarning();
    currentPage = 1;
    await caricaLista(1);
}

// Carica tutti i servizi e popola la lista
async function loadAllServizi() {
    console.log('=== loadAllServizi chiamato ===');
    console.log('isTauri():', isTauri());
    console.log('invoke disponibile:', !!invoke);
    
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        alert('Errore: Container servizi non trovato nel DOM');
        return;
    }
    
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio');
        const servizioDemo = {
            id: '159',
            data_prelievo: `02/09/${getAnnoCorrente()}`,
            idsocio: '12345',
            socio_trasportato: 'ASTUTI GUIDO',
            ora_inizio: '08:00',
            comune_prelievo: 'ROMA',
            luogo_prelievo: 'VIA ROMA 123',
            tipo_servizio: 'STANDARD',
            carrozzina: '',
            richiedente: 'SOCIO',
            motivazione: 'Visita medica',
            ora_arrivo: '09:30',
            comune_destinazione: 'ROMA',
            luogo_destinazione: 'OSPEDALE SANTO SPIRITO',
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
            stato_servizio: 'ESEGUITO',
            note_fine_servizio: '',
            archivia: 'false'
        };
        serviziAnnoCache.corrente = [servizioDemo];
        applicaFiltroArchiviaIniziale = true;
        serviziOriginali = getServiziListaBaseForModo('corrente');
        serviziCache = [...serviziOriginali];
        filtroAnnoModo = 'corrente';
        updateAnnoHeaderUI();
        populateListaServizi([...serviziOriginali]);
        populateForm(servizioDemo);
        updateFiltroStatoButtons();
        return;
    }

    elencoPaginatoSulServer = true;
    filtroAnnoModo = 'corrente';
    updateAnnoHeaderUI();
    await caricaLista(1);

    caricaAutomezzi()
        .then(() => {
            if (serviziCache.length) renderServiziView(false);
        })
        .catch((error) => console.error('Errore caricamento mezzi:', error));
}

// Crea il blocco HTML di un singolo servizio
function createServizioBlock(servizio) {
    const servizioBlock = document.createElement('div');
    servizioBlock.className = 'servizio-block';
    servizioBlock.dataset.servizioId = servizio.id || '';
    if (isPagamentoCumulativo(servizio)) {
        servizioBlock.classList.add('is-pcum-selezionato');
    }

    const pcumWrap = document.createElement('div');
    pcumWrap.className = 'pcum-check-wrap';
    pcumWrap.innerHTML = htmlCheckboxPagamentoCumulativo(servizio);
    servizioBlock.appendChild(pcumWrap);

    const formSections = document.createElement('div');
    formSections.className = 'form-sections';

    const formSection1 = document.createElement('div');
    formSection1.className = 'form-section';
    const formRow1 = document.createElement('div');
    formRow1.className = 'form-row';

    formRow1.innerHTML = `
        <div class="form-group form-group-small">
            <label>IDSERVIZIO</label>
            <input type="text" value="${servizio.id || ''}" readonly>
        </div>
        <div class="form-group form-group-small">
            <label>IDSOCIO</label>
            <input type="text" value="${servizio.idsocio || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>DATA PRELIEVO</label>
            <input type="text" value="${servizio.data_prelievo || ''}" readonly>
        </div>
        <div class="form-group form-group-ora">
            <label>O.S.C.</label>
            <input type="text" value="${servizio.ora_inizio || ''}" readonly>
        </div>
        <div class="form-group form-group-comune">
            <label>COMUNE DI PRELIEVO</label>
            <input type="text" value="${servizio.comune_prelievo || ''}" readonly>
        </div>
        <div class="form-group form-group-indirizzo">
            <label>LUOGO DI PRELIEVO</label>
            <input type="text" value="${servizio.luogo_prelievo || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>RICHIEDENTE</label>
            <input type="text" value="${servizio.richiedente || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>TIPO SERVIZIO</label>
            <input type="text" value="${servizio.tipo_servizio || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>CARROZZINA</label>
            <input type="text" value="${servizio.carrozzina || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>TIPO DI PAGAMENTO</label>
            <input type="text" value="${servizio.tipo_pagamento || ''}" readonly>
        </div>
    `;

    formSection1.appendChild(formRow1);

    const formSection2 = document.createElement('div');
    formSection2.className = 'form-section';
    const formRow2 = document.createElement('div');
    formRow2.className = 'form-row';

    const trasportatoValue = servizio.socio_trasportato || '';
    const isFiltroTrasportatoAttivoPerQuesto = filtroTrasportatoAttivo && valoreFiltroTrasportato === trasportatoValue.trim();
    const btnFiltraTrasportato = htmlBtnFiltraIcona({
        attrName: 'data-filtra-trasportato',
        attrValue: trasportatoValue,
        attivo: isFiltroTrasportatoAttivoPerQuesto,
        disabled: !String(trasportatoValue).trim(),
        titoloFiltra: 'Filtra per questo trasportato',
        titoloTutti: 'Mostra tutti i trasportati'
    });

    formRow2.innerHTML = `
        <div class="form-group form-group-name form-group-with-filtra">
            <label>TRASPORTATO</label>
            <div class="input-button-group">
                <input type="text" value="${escapeHtmlElenco(servizio.socio_trasportato || '')}" readonly>
                ${btnFiltraTrasportato}
            </div>
        </div>
        <div class="form-group form-group-ora">
            <label>O.A.D</label>
            <input type="text" value="${servizio.ora_destinazione || ''}" readonly>
        </div>
        <div class="form-group form-group-comune">
            <label>COMUNE DI DESTINAZIONE</label>
            <input type="text" value="${servizio.comune_destinazione || ''}" readonly>
        </div>
        <div class="form-group form-group-indirizzo">
            <label>LUOGO DI DESTINAZIONE</label>
            <input type="text" value="${servizio.luogo_destinazione || ''}" readonly>
        </div>
        <div class="form-group form-group-large form-group-motivazione">
            <label>MOTIVAZIONE DEL SERVIZIO</label>
            <input type="text" value="${servizio.motivazione || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>STATO INCASSO</label>
            <input type="text" value="${servizio.stato_incasso || ''}" readonly>
        </div>
    `;

    formSection2.appendChild(formRow2);

    const formSection3 = document.createElement('div');
    formSection3.className = 'form-section';
    const formRow3 = document.createElement('div');
    formRow3.className = 'form-row';

    const operatoreValue = servizio.operatore || '';
    const isFiltroOperatoreAttivoPerQuesto = filtroOperatoreAttivo && valoreFiltroOperatore === operatoreValue.trim();

    const accompagnatoreValue = String(servizio.operatore_2 || '').trim();
    const isFiltroAccompagnatoreAttivoPerQuesto = filtroAccompagnatoreAttivo
        && valoreFiltroAccompagnatore === accompagnatoreValue;

    const btnFiltraOperatore = htmlBtnFiltraIcona({
        attrName: 'data-filtra-operatore',
        attrValue: operatoreValue,
        attivo: isFiltroOperatoreAttivoPerQuesto,
        disabled: !String(operatoreValue).trim(),
        titoloFiltra: 'Filtra per questo operatore',
        titoloTutti: 'Mostra tutti gli operatori'
    });
    const btnFiltraAccompagnatore = htmlBtnFiltraIcona({
        attrName: 'data-filtra-accompagnatore',
        attrValue: accompagnatoreValue,
        attivo: isFiltroAccompagnatoreAttivoPerQuesto,
        disabled: !accompagnatoreValue,
        titoloFiltra: 'Filtra per questo accompagnatore',
        titoloTutti: 'Mostra tutti gli accompagnatori'
    });

    formRow3.className = 'form-row form-row-operatore-mezzo';
    formRow3.innerHTML = `
        <div class="form-group form-group-with-filtra form-group-operatore-filtra">
            <label>OPERATORE</label>
            <div class="input-button-group operatore-name">
                <input type="text" value="${escapeHtmlElenco(servizio.operatore || '')}" readonly>
                ${btnFiltraOperatore}
            </div>
        </div>
        <div class="form-group form-group-with-filtra form-group-accompagnatore">
            <label>ACCOMPAGNATORE</label>
            <div class="input-button-group">
                <input type="text" value="${escapeHtmlElenco(accompagnatoreValue)}" readonly>
                ${btnFiltraAccompagnatore}
            </div>
        </div>
        <div class="form-group form-group-mezzo">
            <label>MEZZO USATO</label>
            <input type="text" value="${escapeHtmlElenco(costruisciStringaMezzo(servizio))}" readonly>
        </div>
        <div class="form-group form-group-small">
            <label>TEMPO</label>
            <input type="text" value="${servizio.tempo || ''}" readonly>
        </div>
        <div class="form-group form-group-small">
            <label>KM</label>
            <input type="text" value="${servizio.km || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>DATA BONIFICO</label>
            <input type="text" value="${servizio.data_bonifico || ''}" readonly>
        </div>
        <div class="form-group form-group-small">
            <label>DONAZIONE</label>
            <input type="text" value="${servizio.pagamento || ''}" readonly>
        </div>
        <div class="form-group form-group-medium">
            <label>STATO DEL SERVIZIO</label>
            <input type="text" value="${servizio.stato_servizio || ''}" readonly>
        </div>
        <div class="form-actions-inline form-actions-icone">
            <button type="button" class="btn btn-stampa btn-icona" title="Stampa scheda servizio" aria-label="Stampa">${ICONA_STAMPANTE}</button>
            <button type="button" class="btn btn-modifica btn-icona" title="Modifica servizio" aria-label="Modifica">${ICONA_MATITA}</button>
            <button type="button" class="btn btn-completa btn-icona" title="Completa servizio" aria-label="Completa">${ICONA_COMPLETA}</button>
        </div>
    `;

    formSection3.appendChild(formRow3);

    const formSection4 = document.createElement('div');
    formSection4.className = 'form-section';
    const formRow4 = document.createElement('div');
    formRow4.className = 'form-row';

    formRow4.innerHTML = `
        <div class="form-group form-group-note">
            <label>NOTE PRELIEVO</label>
            <textarea readonly>${servizio.note_prelievo || ''}</textarea>
        </div>
        <div class="form-group form-group-note">
            <label>NOTE ARRIVO</label>
            <textarea readonly>${servizio.note_arrivo || ''}</textarea>
        </div>
        <div class="form-group form-group-note">
            <label>NOTE FINE SERVIZIO</label>
            <textarea readonly>${escapeHtmlElenco(testoNoteFineVisibile(servizio.note_fine_servizio))}</textarea>
        </div>
    `;

    formSection4.appendChild(formRow4);

    formSections.appendChild(formSection1);
    formSections.appendChild(formSection2);
    formSections.appendChild(formSection3);
    formSections.appendChild(formSection4);

    const trattaSalvata = normalizzaPayloadTratta(servizio.tratta_fuori_asti)
        || parseTrattaDaNote(servizio.note_fine_servizio).tratta;
    if (trattaSalvata && (trattaSalvata.comune || trattaSalvata.localita || trattaSalvata.id !== '' && trattaSalvata.id != null)) {
        const trattaSection = document.createElement('div');
        trattaSection.className = 'form-section es-tratta-riepilogo-section';
        trattaSection.innerHTML = `
            <div class="ns-tratta-selezionata es-tratta-riepilogo">
                ${htmlContenutoRiepilogoTratta(trattaSalvata)}
            </div>
        `;
        formSections.appendChild(trattaSection);
    }

    const tariffaSalvata = parseTariffaDaNote(servizio.note_fine_servizio).tariffa;
    if (tariffaSalvata && String(tariffaSalvata.totale || '').trim() !== '') {
        const tariffaSection = document.createElement('div');
        tariffaSection.className = 'form-section es-tratta-riepilogo-section';
        tariffaSection.innerHTML = `
            <div class="ns-tratta-selezionata ns-tariffa-calcolata es-tratta-riepilogo">
                ${htmlContenutoRiepilogoTariffa(tariffaSalvata)}
            </div>
        `;
        formSections.appendChild(tariffaSection);
    }

    servizioBlock.appendChild(formSections);

    return servizioBlock;
}

function getTotalPages(totalItems) {
    return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function updatePaginationBar(totalItems, page, totalPages) {
    const bar = document.getElementById('servizi-pagination-bar');
    if (!bar) return;

    if (totalItems === 0) {
        bar.innerHTML = '';
        return;
    }

    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalItems);

    bar.innerHTML = `
        <button type="button" class="btn-pagination btn-page-prev" id="btn-page-prev" title="Precedente" aria-label="Precedente" ${page <= 1 ? 'disabled' : ''}>
            <img src="assets/icona-precedente.png?v=1" alt="">
        </button>
        <span class="servizi-pagination-info">Pagina ${page} di ${totalPages} · servizi ${start}-${end} di ${totalItems}</span>
        <button type="button" class="btn-pagination btn-page-next" id="btn-page-next" title="Successiva" aria-label="Successiva" ${page >= totalPages ? 'disabled' : ''}>
            <img src="assets/icona-successiva.png?v=1" alt="">
        </button>
    `;

    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (btnPrev) btnPrev.addEventListener('click', () => goToPage(page - 1));
    if (btnNext) btnNext.addEventListener('click', () => goToPage(page + 1));
}

function goToPage(page) {
    const totalItems = elencoPaginatoSulServer ? totaleServiziRemoti : serviziCache.length;
    const totalPages = getTotalPages(totalItems);
    const nextPage = Math.min(Math.max(1, page), totalPages);
    if (nextPage === currentPage) return;
    if (elencoPaginatoSulServer) {
        caricaLista(nextPage);
        return;
    }
    currentPage = nextPage;
    renderServiziView(false);
    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.scrollTop = 0;
    }
}

function renderServiziView(resetPage = false) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) return;

    if (resetPage) {
        currentPage = 1;
    }

    const totalItems = elencoPaginatoSulServer ? totaleServiziRemoti : serviziCache.length;
    const totalPages = getTotalPages(totalItems);

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }
    if (currentPage < 1) {
        currentPage = 1;
    }

    updateServiziCount();

    if (totalItems === 0) {
        let msg = 'Nessun servizio trovato';
        if (filtriRicerca.operatore) {
            const opt = document.getElementById('ricerca-operatore')?.selectedOptions?.[0];
            const nome = opt?.dataset?.nominativo || opt?.textContent || filtriRicerca.operatore;
            msg = `Nessun servizio collegato a ${nome} (IdSocio ${opt?.dataset?.idsocio || filtriRicerca.operatore}, id ${opt?.dataset?.id || '—'}). In tabella i servizi hanno altri IdOperatore.`;
        }
        containerBody.innerHTML = `<div class="servizi-lista-empty">${msg}</div>`;
        updatePaginationBar(0, 1, 1);
        return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = elencoPaginatoSulServer
        ? serviziCache
        : serviziCache.slice(start, start + PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const servizio of pageItems) {
        fragment.appendChild(createServizioBlock(servizio));
    }
    containerBody.innerHTML = '';
    containerBody.appendChild(fragment);
    collegaCheckboxPagamentoCumulativo(containerBody);
    updatePaginationBar(totalItems, currentPage, totalPages);
}

// Aggiorna la lista servizi (con paginazione: max PAGE_SIZE per pagina)
function populateListaServizi(servizi) {
    serviziCache = servizi || [];
    renderServiziView(true);
}

// Funzione per aggiornare il conteggio dei servizi visualizzati
function updateServiziCount() {
    const countElement = document.getElementById('servizi-count');
    if (!countElement) return;
    
    const count = elencoPaginatoSulServer ? totaleServiziRemoti : serviziCache.length;
    countElement.textContent = `(${count})`;
}

/** Elenco leggibile dei filtri attivi (per l'etichetta di attenzione). */
function descrizioniFiltriAttivi() {
    const parti = [];

    const opRicerca = testoONull(filtriRicerca.operatore);
    const opBtn = filtroOperatoreAttivo ? testoONull(valoreFiltroOperatore) : null;
    const operatore = opRicerca || opBtn;
    if (operatore) {
        const opt = document.getElementById('ricerca-operatore')?.selectedOptions?.[0];
        const nome = (opt?.dataset?.nominativo || opt?.textContent || '').trim();
        parti.push(`Operatore: ${nome || operatore}`);
    }

    if (testoONull(filtriRicerca.idsocio)) {
        parti.push(`IdSocio: ${filtriRicerca.idsocio}`);
    }
    if (testoONull(filtriRicerca.nominativo)) {
        parti.push(`Nominativo: ${filtriRicerca.nominativo}`);
    }
    if (testoONull(filtriRicerca.idservizio)) {
        parti.push(`IdServizio: ${filtriRicerca.idservizio}`);
    }
    if (filtroTrasportatoAttivo && testoONull(valoreFiltroTrasportato)) {
        parti.push(`Trasportato: ${valoreFiltroTrasportato}`);
    }
    const accRicerca = testoONull(filtriRicerca.accompagnatore);
    const accBtn = filtroAccompagnatoreAttivo ? testoONull(valoreFiltroAccompagnatore) : null;
    const accompagnatore = accRicerca || accBtn;
    if (accompagnatore) {
        parti.push(`Accompagnatore: ${accompagnatore}`);
    }
    if (filtroStatoAttivo && testoONull(valoreFiltroStato)) {
        parti.push(`Stato: ${valoreFiltroStato}`);
    }
    const rich = testoONull(filtriRicerca.richiedente)
        || (filtroRichiedenteAttivo ? testoONull(valoreFiltroRichiedente) : null);
    if (rich) {
        parti.push(`Richiedente: ${rich}`);
    }
    if (testoONull(filtriRicerca.statoIncasso)) {
        parti.push(`Incasso: ${filtriRicerca.statoIncasso}`);
    }
    if (testoONull(filtriRicerca.tipoPagamento)) {
        parti.push(`Pagamento: ${filtriRicerca.tipoPagamento}`);
    }
    if (testoONull(filtriRicerca.tipoServizio)) {
        parti.push(`Tipo servizio: ${filtriRicerca.tipoServizio}`);
    }
    if (testoONull(filtriRicerca.carrozzina)) {
        parti.push(`Carrozzina: ${filtriRicerca.carrozzina}`);
    }
    if (filtriRicerca.pagamentoCumulativo === 'SI') {
        parti.push('Solo pagamento cumulativo');
    } else if (filtriRicerca.pagamentoCumulativo === 'NO') {
        parti.push('Senza pagamento cumulativo');
    }
    if (Number(filtriRicerca.pagamentoCumulativoNumero) > 0) {
        parti.push(`Pagamento cumulativo n. ${filtriRicerca.pagamentoCumulativoNumero}`);
    }
    if (testoONull(filtriRicerca.dataDa) || testoONull(filtriRicerca.dataA)) {
        const da = filtriRicerca.dataDa || '…';
        const a = filtriRicerca.dataA || '…';
        parti.push(`Date: ${da} → ${a}`);
    }

    if (filtroAnnoModo === 'precedente') {
        parti.push(`Anno ${getAnnoPrecedente()}`);
    } else if (filtroAnnoModo === 'tutti') {
        parti.push('Tutti gli anni');
    } else {
        parti.push(`Anno ${getAnnoCorrente()}`);
    }

    return parti;
}

// Funzione per aggiornare il messaggio di attenzione filtro
function updateFilterWarning() {
    const filterWarning = document.getElementById('filter-warning');
    if (!filterWarning) return;

    // Controlla se ci sono filtri ricerca attivi
    const hasRicercaFilters = Object.values(filtriRicerca).some(val => val !== null && val !== '');

    // Mostra il messaggio se almeno un filtro è attivo
    if (filtroTrasportatoAttivo || filtroOperatoreAttivo || filtroAccompagnatoreAttivo || filtroStatoAttivo || filtroRichiedenteAttivo || hasRicercaFilters) {
        const dettagli = descrizioniFiltriAttivi().join(' · ');
        filterWarning.textContent = dettagli
            ? `(Attenzione visualizzazione filtrata: ${dettagli})`
            : '(Attenzione visualizzazione filtrata)';
        filterWarning.style.display = 'inline';
    } else {
        filterWarning.style.display = 'none';
        filterWarning.textContent = '(Attenzione visualizzazione filtrata)';
    }
}

function haServiziStatoCompletato() {
    return serviziOriginali.some(s =>
        String(s.stato_servizio || '').trim().toUpperCase() === 'COMPLETATO'
    );
}

function normalizzaStatoServizio(stato) {
    return String(stato || '').trim().toUpperCase();
}

// Funzione per aggiornare lo stato visivo dei pulsanti filtro stato
function updateFiltroStatoButtons() {
    const btnDaEseguire = document.getElementById('btn-da-eseguire');
    const btnEseguiti = document.getElementById('btn-eseguiti');
    const btnAnnullati = document.getElementById('btn-annullati');
    const btnCompletato = document.getElementById('btn-completato');
    const btnTutti = document.getElementById('btn-tutti');
    if (btnCompletato) {
        btnCompletato.disabled = false;
    }

    // Rimuovi classe active da tutti i pulsanti
    [btnDaEseguire, btnEseguiti, btnAnnullati, btnCompletato, btnTutti].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    // Aggiungi classe active al pulsante corrispondente al filtro attivo
    if (filtroStatoAttivo && valoreFiltroStato) {
        const stato = normalizzaStatoServizio(valoreFiltroStato);
        if (stato === 'DA ESEGUIRE' && btnDaEseguire) {
            btnDaEseguire.classList.add('active');
        } else if (stato === 'ESEGUITO' && btnEseguiti) {
            btnEseguiti.classList.add('active');
        } else if (stato === 'ANNULLATO' && btnAnnullati) {
            btnAnnullati.classList.add('active');
        } else if (stato === 'COMPLETATO' && btnCompletato) {
            btnCompletato.classList.add('active');
        }
    }
}

// Funzione per aggiornare lo stato visivo dei pulsanti filtro richiedente
function updateFiltroRichiedenteButtons() {
    const btnSocio = document.getElementById('btn-socio');
    const btnComune = document.getElementById('btn-comune');
    const btnAltri = document.getElementById('btn-altri');
    
    // Rimuovi classe active da tutti i pulsanti
    [btnSocio, btnComune, btnAltri].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    
    // Aggiungi classe active al pulsante corrispondente al filtro attivo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente) {
        if (valoreFiltroRichiedente === 'SOCIO' && btnSocio) {
            btnSocio.classList.add('active');
        } else if (valoreFiltroRichiedente === 'COMUNE' && btnComune) {
            btnComune.classList.add('active');
        } else if (valoreFiltroRichiedente === 'ALTRI' && btnAltri) {
            btnAltri.classList.add('active');
        }
    }
}

// Funzione per filtrare i servizi per TRASPORTATO o rimuovere il filtro
function filtraPerTrasportato(trasportatoValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con questo valore, rimuovilo
    if (filtroTrasportatoAttivo && valoreFiltroTrasportato === trasportatoValue.trim()) {
        console.log('Rimozione filtro TRASPORTATO - mostro tutti i servizi');
        filtroTrasportatoAttivo = false;
        valoreFiltroTrasportato = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per TRASPORTATO: "${trasportatoValue}"`);
        filtroTrasportatoAttivo = true;
        valoreFiltroTrasportato = trasportatoValue.trim();
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    }
}

// Funzione per filtrare i servizi per OPERATORE o rimuovere il filtro
function filtraPerOperatore(operatoreValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con questo valore, rimuovilo
    if (filtroOperatoreAttivo && valoreFiltroOperatore === operatoreValue.trim()) {
        console.log('Rimozione filtro OPERATORE - mostro tutti i servizi');
        filtroOperatoreAttivo = false;
        valoreFiltroOperatore = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    } else {
        // Applica il filtro
        console.log(`Filtro per OPERATORE: "${operatoreValue}"`);
        filtroOperatoreAttivo = true;
        valoreFiltroOperatore = operatoreValue.trim();
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione
        updateFilterWarning();
    }
}

// Filtra i servizi per ACCOMPAGNATORE o rimuove il filtro
function filtraPerAccompagnatore(accompagnatoreValue) {
    const valore = String(accompagnatoreValue || '').trim();
    if (!valore) return;

    if (filtroAccompagnatoreAttivo && valoreFiltroAccompagnatore === valore) {
        console.log('Rimozione filtro ACCOMPAGNATORE - mostro tutti i servizi');
        filtroAccompagnatoreAttivo = false;
        valoreFiltroAccompagnatore = null;
    } else {
        console.log(`Filtro per ACCOMPAGNATORE: "${valore}"`);
        filtroAccompagnatoreAttivo = true;
        valoreFiltroAccompagnatore = valore;
    }

    applyAllFilters();
    updateFilterWarning();
}

// Funzione per filtrare i servizi per STATO DEL SERVIZIO o rimuovere il filtro
function filtraPerStato(statoValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con lo stesso valore, rimuovilo
    if (filtroStatoAttivo && valoreFiltroStato === statoValue) {
        console.log('Rimozione filtro STATO - mostro tutti i servizi');
        filtroStatoAttivo = false;
        valoreFiltroStato = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroStatoButtons();
    } else {
        // Applica il filtro
        console.log(`Filtro per STATO DEL SERVIZIO: "${statoValue}"`);
        filtroStatoAttivo = true;
        valoreFiltroStato = statoValue;
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroStatoButtons();
    }
}

// Funzione per filtrare i servizi per RICHIEDENTE o rimuovere il filtro
function filtraPerRichiedente(richiedenteValue) {
    const containerBody = document.getElementById('servizi-container-body');
    if (!containerBody) {
        console.error('Container servizi non trovato');
        return;
    }
    
    // Se il filtro è già attivo con lo stesso valore, rimuovilo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente === richiedenteValue) {
        console.log('Rimozione filtro RICHIEDENTE - mostro tutti i servizi');
        filtroRichiedenteAttivo = false;
        valoreFiltroRichiedente = null;
        
        // Applica i filtri rimanenti
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroRichiedenteButtons();
    } else {
        // Applica il filtro
        console.log(`Filtro per RICHIEDENTE: "${richiedenteValue}"`);
        filtroRichiedenteAttivo = true;
        valoreFiltroRichiedente = richiedenteValue;
        
        // Applica tutti i filtri
        applyAllFilters();
        
        // Aggiorna il messaggio di attenzione e i pulsanti
        updateFilterWarning();
        updateFiltroRichiedenteButtons();
    }
}

// Funzione per rimuovere tutti i filtri e mostrare tutti i servizi
function rimuoviTuttiFiltri() {
    console.log('Rimozione di tutti i filtri - mostro tutti i servizi');
    
    // Rimuovi tutti i filtri
    filtroTrasportatoAttivo = false;
    valoreFiltroTrasportato = null;
    filtroOperatoreAttivo = false;
    valoreFiltroOperatore = null;
    filtroAccompagnatoreAttivo = false;
    valoreFiltroAccompagnatore = null;
    filtroStatoAttivo = false;
    valoreFiltroStato = null;
    filtroRichiedenteAttivo = false;
    valoreFiltroRichiedente = null;
    
    // Rimuovi filtri ricerca
    filtriRicerca = {
        idservizio: null,
        idsocio: null,
        nominativo: null,
        dataDa: null,
        dataA: null,
        statoIncasso: null,
        tipoPagamento: null,
        tipoServizio: null,
        carrozzina: null,
        richiedente: null,
        operatore: null,
        accompagnatore: null,
        pagamentoCumulativo: null,
        pagamentoCumulativoNumero: null
    };
    
    // Reset form modale
    resetFormRicerca();
    currentPage = 1;
    if (elencoPaginatoSulServer) {
        caricaLista(1);
    } else {
        populateListaServizi([...serviziOriginali]);
    }
    
    // Aggiorna lo stato visivo di tutti i pulsanti
    updateFilterWarning();
    updateFiltroStatoButtons();
    updateFiltroRichiedenteButtons();
    updateServiziCount();
    
    console.log('✓ Tutti i filtri rimossi');
}

/** Filtra l'elenco per numero gruppo pagamento cumulativo (toggle se già attivo). */
async function filtraPerPagamentoCumulativoNumero(numero) {
    const n = Number(numero || 0);
    if (!Number.isFinite(n) || n <= 0) return;

    if (Number(filtriRicerca.pagamentoCumulativoNumero) === n) {
        filtriRicerca.pagamentoCumulativoNumero = null;
    } else {
        filtriRicerca.pagamentoCumulativoNumero = n;
    }

    currentPage = 1;
    applyAllFilters();
    updateFilterWarning();
    updateServiziCount();
}

// Funzione helper per applicare tutti i filtri attivi
function applyAllFilters() {
    updateFilterWarning();
    if (elencoPaginatoSulServer || (isTauri() && invoke)) {
        caricaLista(1);
        return;
    }

    if (filtroStatoAttivo && normalizzaStatoServizio(valoreFiltroStato) === 'COMPLETATO' && !haServiziStatoCompletato()) {
        filtroStatoAttivo = false;
        valoreFiltroStato = null;
    }

    let serviziFiltrati = [...serviziOriginali];
    
    // Applica filtro TRASPORTATO se attivo
    if (filtroTrasportatoAttivo && valoreFiltroTrasportato) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const trasportato = servizio.socio_trasportato || '';
            return trasportato.trim() === valoreFiltroTrasportato.trim();
        });
    }
    
    // Applica filtro OPERATORE se attivo
    if (filtroOperatoreAttivo && valoreFiltroOperatore) {
        serviziFiltrati = serviziFiltrati.filter(servizio =>
            servizioMatchaOperatore(servizio, valoreFiltroOperatore)
        );
    }

    // Applica filtro ACCOMPAGNATORE (ricerca avanzata o pulsante riga)
    const accFiltro = testoONull(filtriRicerca.accompagnatore)
        || (filtroAccompagnatoreAttivo ? testoONull(valoreFiltroAccompagnatore) : null);
    if (accFiltro) {
        const target = accFiltro.trim().toUpperCase();
        serviziFiltrati = serviziFiltrati.filter((servizio) => {
            const nome = String(servizio.operatore_2 || '').trim().toUpperCase();
            return nome === target;
        });
    }
    
    // Applica filtro STATO DEL SERVIZIO se attivo
    if (filtroStatoAttivo && valoreFiltroStato) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const stato = normalizzaStatoServizio(servizio.stato_servizio);
            return stato === normalizzaStatoServizio(valoreFiltroStato);
        });
    }
    
    // Applica filtro RICHIEDENTE se attivo
    if (filtroRichiedenteAttivo && valoreFiltroRichiedente) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const richiedente = (servizio.richiedente || '').trim().toUpperCase();
            
            if (valoreFiltroRichiedente === 'SOCIO') {
                return richiedente === 'SOCIO';
            } else if (valoreFiltroRichiedente === 'COMUNE') {
                return richiedente === 'COMUNE';
            } else if (valoreFiltroRichiedente === 'ALTRI') {
                // ALTRI = tutto ciò che non è SOCIO né COMUNE
                return richiedente !== 'SOCIO' && richiedente !== 'COMUNE' && richiedente !== '';
            }
            
            return false;
        });
    }
    
    // Applica filtri ricerca avanzata
    if (filtriRicerca.idservizio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const id = String(servizio.id || '').trim();
            return id === filtriRicerca.idservizio.trim();
        });
    }
    
    if (filtriRicerca.idsocio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const idsocio = (servizio.idsocio || '').trim();
            return idsocio === filtriRicerca.idsocio.trim();
        });
    }
    
    if (filtriRicerca.nominativo) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const nominativo = (servizio.socio_trasportato || '').trim().toUpperCase();
            return nominativo.includes(filtriRicerca.nominativo.trim().toUpperCase());
        });
    }
    
    if (filtriRicerca.dataDa) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const dataPrelievo = servizio.data_prelievo || '';
            if (!dataPrelievo) return false;
            // Converti data da formato DD/MM/YYYY a Date per confronto
            const parts = dataPrelievo.split('/');
            if (parts.length === 3) {
                const servizioDate = new Date(parts[2], parts[1] - 1, parts[0]);
                const dataDa = new Date(filtriRicerca.dataDa);
                return servizioDate >= dataDa;
            }
            return false;
        });
    }
    
    if (filtriRicerca.dataA) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const dataPrelievo = servizio.data_prelievo || '';
            if (!dataPrelievo) return false;
            const parts = dataPrelievo.split('/');
            if (parts.length === 3) {
                const servizioDate = new Date(parts[2], parts[1] - 1, parts[0]);
                const dataA = new Date(filtriRicerca.dataA);
                dataA.setHours(23, 59, 59, 999); // Fine giornata
                return servizioDate <= dataA;
            }
            return false;
        });
    }
    
    if (filtriRicerca.statoIncasso) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const stato = (servizio.stato_incasso || '').trim().toUpperCase();
            const filtroValore = filtriRicerca.statoIncasso.trim().toUpperCase();
            
            // Il campo stato_incasso viene costruito dal backend in base ai campi INCASSATO, GRATIS, etc.
            // Quindi possiamo filtrare direttamente sul valore di stato_incasso
            return stato === filtroValore;
        });
    }
    
    if (filtriRicerca.tipoPagamento) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const tipo = (servizio.tipo_pagamento || '').trim().toUpperCase();
            return tipo === filtriRicerca.tipoPagamento.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.tipoServizio) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const tipo = (servizio.tipo_servizio || '').trim().toUpperCase();
            return tipo === filtriRicerca.tipoServizio.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.carrozzina) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const carr = (servizio.carrozzina || '').trim().toUpperCase();
            return carr === filtriRicerca.carrozzina.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.richiedente) {
        serviziFiltrati = serviziFiltrati.filter(servizio => {
            const richiedente = (servizio.richiedente || '').trim().toUpperCase();
            if (filtriRicerca.richiedente === 'ALTRI') {
                return richiedente !== 'SOCIO' && richiedente !== 'COMUNE' && richiedente !== '';
            }
            return richiedente === filtriRicerca.richiedente.trim().toUpperCase();
        });
    }
    
    if (filtriRicerca.operatore) {
        serviziFiltrati = serviziFiltrati.filter(servizio =>
            servizioMatchaOperatore(servizio, filtriRicerca.operatore)
        );
    }

    if (filtriRicerca.pagamentoCumulativo === 'SI') {
        serviziFiltrati = serviziFiltrati.filter((servizio) => isPagamentoCumulativo(servizio));
    } else if (filtriRicerca.pagamentoCumulativo === 'NO') {
        serviziFiltrati = serviziFiltrati.filter((servizio) => !isPagamentoCumulativo(servizio));
    }

    const numGruppo = Number(filtriRicerca.pagamentoCumulativoNumero || 0);
    if (Number.isFinite(numGruppo) && numGruppo > 0) {
        serviziFiltrati = serviziFiltrati.filter((servizio) => {
            const n = Number(servizio.pagamento_cumulativo_numero || 0);
            if (n === numGruppo) return true;
            const g = String(servizio.pagamento_cumulativo_gruppo || '').trim();
            return g === String(numGruppo);
        });
    }
    
    console.log(`✓ Servizi filtrati: ${serviziFiltrati.length} di ${serviziOriginali.length}`);
    
    // Aggiorna la cache con i servizi filtrati
    serviziCache = serviziFiltrati;

    // Ripopola la lista con i servizi filtrati (pagina 1)
    populateListaServizi(serviziFiltrati);
    updateFiltroStatoButtons();
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== ELENCOSERVIZI.html caricato ===');
    
    // Inizializza Tauri
    await initTauri();

    // Chiusura con X → torna a Elenco Soci / Operatori (finestra aperta da pulsante SERVIZI)
    await setupChiusuraRitornoFinestraOrigine();
    
    const filtroUrl = getIdsocioFromUrl() || getOperatoreFromUrl();
    if (!filtroUrl) {
        await loadAllServizi();
    }
    popolaDropdownOperatori();

    // Filtro da URL (apertura da Elenco Soci → SERVIZI)
    await applicaFiltroInizialeDaUrl();
    
    // Inizializza lo stato dei pulsanti filtro stato
    updateFiltroStatoButtons();
    updateFiltroRichiedenteButtons();
    
    // Event listener per i pulsanti filtro stato
    const btnDaEseguire = document.getElementById('btn-da-eseguire');
    const btnEseguiti = document.getElementById('btn-eseguiti');
    const btnAnnullati = document.getElementById('btn-annullati');
    const btnCompletato = document.getElementById('btn-completato');
    const btnTutti = document.getElementById('btn-tutti');
    
    if (btnDaEseguire) {
        btnDaEseguire.addEventListener('click', () => filtraPerStato('DA ESEGUIRE'));
    }
    if (btnEseguiti) {
        btnEseguiti.addEventListener('click', () => filtraPerStato('ESEGUITO'));
    }
    if (btnAnnullati) {
        btnAnnullati.addEventListener('click', () => filtraPerStato('ANNULLATO'));
    }
    if (btnCompletato) {
        btnCompletato.addEventListener('click', () => {
            if (!btnCompletato.disabled) {
                filtraPerStato('COMPLETATO');
            }
        });
    }
    if (btnTutti) {
        btnTutti.addEventListener('click', () => rimuoviTuttiFiltri());
    }

    const btnAnnoCorrente = document.getElementById('btn-anno-corrente');
    const btnAnnoPrecedente = document.getElementById('btn-anno-precedente');
    const btnTuttiAnni = document.getElementById('btn-tutti-anni');
    if (btnAnnoCorrente) {
        btnAnnoCorrente.addEventListener('click', () => switchAnnoModo('corrente'));
    }
    if (btnAnnoPrecedente) {
        btnAnnoPrecedente.addEventListener('click', () => switchAnnoModo('precedente'));
    }
    if (btnTuttiAnni) {
        btnTuttiAnni.addEventListener('click', () => switchAnnoModo('tutti'));
    }
    
    // Event listener per i pulsanti filtro richiedente
    const btnSocio = document.getElementById('btn-socio');
    const btnComune = document.getElementById('btn-comune');
    const btnAltri = document.getElementById('btn-altri');
    
    if (btnSocio) {
        btnSocio.addEventListener('click', () => {
            console.log('Pulsante SOCIO cliccato');
            filtraPerRichiedente('SOCIO');
        });
    }
    if (btnComune) {
        btnComune.addEventListener('click', () => {
            console.log('Pulsante COMUNE cliccato');
            filtraPerRichiedente('COMUNE');
        });
    }
    if (btnAltri) {
        btnAltri.addEventListener('click', () => {
            console.log('Pulsante ALTRI cliccato');
            filtraPerRichiedente('ALTRI');
        });
    }
    
    // Pulsante RICERCA - Apri modale
    const btnRicerca = document.getElementById('btn-ricerca');
    if (btnRicerca) {
        btnRicerca.addEventListener('click', () => {
            apriModaleRicerca();
        });
    }

    initCompletaServizio({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        trovaServizioLocal: trovaServizioById,
        onSaveSuccess: async (servizioAggiornato) => {
            aggiornaServizioInCache(servizioAggiornato);
            renderServiziView(false);
        }
    });
    setupModaleCompleta();

    initModificaServizio({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        getTipiPagamentoExtra: getTipiPagamentoUnici,
        trovaServizioLocal: trovaServizioById,
        onSaveSuccess: async (servizioAggiornato) => {
            aggiornaServizioInCache(servizioAggiornato);
            renderServiziView(false);
        },
        onDeleteSuccess: async (servizioId) => {
            rimuoviServizioDaCache(servizioId);
            renderServiziView(false);
        }
    });
    setupModaleModifica();

    initPagamentoCumulativo({
        getInvoke: () => invoke,
        isTauriEnv: isTauri,
        getServizioById: trovaServizioById,
        getTipiPagamento: getTipiPagamentoUnici,
        onServiziAggiornati: async (lista) => {
            (lista || []).forEach((s) => aggiornaServizioInCache(s));
            renderServiziView(false);
        },
        onFiltraGruppo: async (numero) => {
            await filtraPerPagamentoCumulativoNumero(numero);
        }
    });
    setupPagamentoCumulativo();

    // Soci, telefoni e tendine dei popup: dopo che la lista è già visibile, una volta sola.
    caricaDatiPerDropdown()
        .then(() => {
            popolaDropdownOperatori();
            return caricaDatiModificaServizio();
        })
        .catch((err) => console.error('Dati elenco in sottofondo:', err));
    
    // Setup modale ricerca
    setupModaleRicerca();

    initStampaPdfElencoServizi({
        getServiziFiltrati: () => serviziCache,
        getServiziPagina: () => {
            if (elencoPaginatoSulServer) return [...serviziCache];
            const start = (currentPage - 1) * PAGE_SIZE;
            return serviziCache.slice(start, start + PAGE_SIZE);
        },
        getTotaleFiltrato: () => elencoPaginatoSulServer ? totaleServiziRemoti : serviziCache.length,
        scaricaServiziFiltrati: scaricaServiziFiltratiPerStampa,
        getTitolo: () => {
            const el = document.getElementById('servizi-title-text');
            return (el && el.textContent.trim()) || 'ELENCO SERVIZI';
        },
        formatMezzo: costruisciStringaMezzo
    });
    
    // Event listener per i pulsanti FILTRA usando event delegation
    const containerBody = document.getElementById('servizi-container-body');
    if (containerBody) {
        containerBody.addEventListener('click', (e) => {
            const btnStampaRiga = e.target.closest?.('.btn-stampa');
            if (btnStampaRiga && containerBody.contains(btnStampaRiga)) {
                e.stopPropagation();
                const servizioId = btnStampaRiga.closest('.servizio-block')?.dataset?.servizioId;
                if (servizioId) apriSchedaServizioStampa(servizioId);
                return;
            }

            const btnModificaRiga = e.target.closest?.('.btn-modifica');
            if (btnModificaRiga && containerBody.contains(btnModificaRiga)) {
                e.stopPropagation();
                const servizioId = btnModificaRiga.closest('.servizio-block')?.dataset?.servizioId;
                if (servizioId) apriModalModifica(servizioId);
                return;
            }

            const btnCompletaRiga = e.target.closest?.('.btn-completa');
            if (btnCompletaRiga && containerBody.contains(btnCompletaRiga)) {
                e.stopPropagation();
                const servizioId = btnCompletaRiga.closest('.servizio-block')?.dataset?.servizioId;
                if (servizioId) apriModalCompleta(servizioId);
                return;
            }

            const btnFiltra = e.target.closest?.('.btn-filtra');
            if (btnFiltra && containerBody.contains(btnFiltra)) {
                e.stopPropagation();
                if (btnFiltra.hasAttribute('data-filtra-trasportato')) {
                    const trasportatoValue = btnFiltra.getAttribute('data-filtra-trasportato');
                    if (trasportatoValue !== null && trasportatoValue !== undefined) {
                        filtraPerTrasportato(trasportatoValue);
                    }
                } else if (btnFiltra.hasAttribute('data-filtra-operatore')) {
                    const operatoreValue = btnFiltra.getAttribute('data-filtra-operatore');
                    if (operatoreValue !== null && operatoreValue !== undefined) {
                        filtraPerOperatore(operatoreValue);
                    }
                } else if (btnFiltra.hasAttribute('data-filtra-accompagnatore')) {
                    const accompagnatoreValue = btnFiltra.getAttribute('data-filtra-accompagnatore');
                    if (accompagnatoreValue !== null && accompagnatoreValue !== undefined) {
                        filtraPerAccompagnatore(accompagnatoreValue);
                    }
                }
            }
        });
    }
    
    // Pulsante STAMPA
    const btnStampa = document.getElementById('btn-stampa');
    if (btnStampa) {
        btnStampa.addEventListener('click', async () => {
            const servizioId = document.getElementById('ids')?.value?.trim();
            if (!servizioId) {
                alert('Seleziona o indica un ID servizio da stampare');
                return;
            }
            await apriSchedaServizioStampa(servizioId);
        });
    }
    
    // Pulsante CHIUDI
    const btnChiudi = document.getElementById('btn-chiudi');
    if (btnChiudi) {
        btnChiudi.addEventListener('click', async () => {
            console.log('CHIUDI cliccato');
            await chiudiFinestraElencoServizi();
        });
    }
});

// ========== MODALE MODIFICA SERVIZIO (modifica-servizio.js) ==========

function trovaServizioById(id) {
    const sid = String(id);
    return serviziOriginali.find(s => String(s.id) === sid)
        || serviziCache.find(s => String(s.id) === sid);
}

function aggiornaServizioInCache(servizio) {
    const id = String(servizio.id);
    const replaceIn = (arr) => {
        if (!Array.isArray(arr)) return;
        const idx = arr.findIndex(s => String(s.id) === id);
        if (idx >= 0) arr[idx] = servizio;
        else arr.push(servizio);
    };
    replaceIn(serviziOriginali);
    replaceIn(serviziCache);
    Object.keys(serviziAnnoCache).forEach(key => replaceIn(serviziAnnoCache[key]));
}

function rimuoviServizioDaCache(servizioId) {
    const id = String(servizioId);
    const removeFrom = (arr) => {
        if (!Array.isArray(arr)) return;
        const idx = arr.findIndex(s => String(s.id) === id);
        if (idx >= 0) arr.splice(idx, 1);
    };
    removeFrom(serviziOriginali);
    removeFrom(serviziCache);
    Object.keys(serviziAnnoCache).forEach(key => removeFrom(serviziAnnoCache[key]));
}

function getTipiPagamentoUnici() {
    const tipi = new Set();
    serviziOriginali.forEach(s => {
        if (s.tipo_pagamento) tipi.add(s.tipo_pagamento.trim());
    });
    return Array.from(tipi).sort();
}

// ========== FUNZIONI MODALE RICERCA ==========

// Carica dati per popolare i dropdown
async function caricaDatiPerDropdown() {
    if (!isTauri() || !invoke) {
        console.log('Modalità demo: uso dati di esempio per dropdown');
        return;
    }
    
    try {
        await invoke('init_supabase_from_config').catch(() => {});

        const tesserati = await invoke('get_all_tesserati');

        allTesserati = tesserati || [];
        
        // Filtra solo gli operatori
        allOperatori = allTesserati.filter(t => {
            const op = (t.operatore || '').toString().trim().toUpperCase();
            return op === 'SI' || op === 'SÌ' || op === 'TRUE' || op === '1' || op === 'S' || op === 'YES';
        });
        allOperatori.sort((a, b) =>
            (a.nominativo || '').localeCompare(b.nominativo || '', 'it', { sensitivity: 'base' })
        );
        
        console.log(`✓ Caricati ${allTesserati.length} tesserati, ${allOperatori.length} operatori`);

        try {
            const tipi = await invoke('get_all_tipi_pagamento');
            const selectTipo = document.getElementById('ricerca-tipo-pagamento');
            if (selectTipo && Array.isArray(tipi)) {
                const corrente = selectTipo.value;
                while (selectTipo.options.length > 1) selectTipo.remove(1);
                tipi.forEach((tipo) => {
                    const nome = String(tipo || '').trim();
                    if (!nome) return;
                    const option = document.createElement('option');
                    option.value = nome;
                    option.textContent = nome;
                    selectTipo.appendChild(option);
                });
                if (corrente) selectTipo.value = corrente;
            }
        } catch (errTipi) {
            console.warn('Tipi pagamento:', errTipi);
            popolaDropdownDaServizi();
        }
        
        // Popola dropdown operatori
        popolaDropdownOperatori();
        
        // Setup autocomplete nominativo
        setupAutocompleteNominativo();
    } catch (error) {
        console.error('Errore nel caricamento dati per dropdown:', error);
    }
}

// Popola dropdown tipo pagamento dai servizi esistenti
// (STATO INCASSO ha valori fissi nell'HTML)
function popolaDropdownDaServizi() {
    const tipiPagamento = new Set();
    
    serviziOriginali.forEach(servizio => {
        if (servizio.tipo_pagamento) {
            tipiPagamento.add(servizio.tipo_pagamento.trim());
        }
    });
    
    // Popola dropdown tipo pagamento
    const selectTipoPagamento = document.getElementById('ricerca-tipo-pagamento');
    if (selectTipoPagamento) {
        const currentValue = selectTipoPagamento.value;
        tipiPagamento.forEach(tipo => {
            const option = document.createElement('option');
            option.value = tipo;
            option.textContent = tipo;
            selectTipoPagamento.appendChild(option);
        });
        if (currentValue) selectTipoPagamento.value = currentValue;
    }
}

function nomiOperatoreSoloSuiServizi() {
    const inElenco = new Set(
        (allOperatori || []).map((o) => nomeChiaveOperatore(o.nominativo)).filter(Boolean)
    );
    const extra = new Map();
    (serviziOriginali || []).forEach((s) => {
        [s.operatore, s.operatore_2, s.operatore_testo].forEach((n) => {
            const t = String(n || '').trim();
            if (!t || /^\d+$/.test(t)) return;
            const k = nomeChiaveOperatore(t);
            if (!k || inElenco.has(k)) return;
            if (!extra.has(k)) extra.set(k, t);
        });
    });
    return [...extra.values()].sort((a, b) =>
        a.localeCompare(b, 'it', { sensitivity: 'base' })
    );
}

// Popola dropdown operatori
function popolaDropdownOperatori() {
    const selectOperatore = document.getElementById('ricerca-operatore');
    if (!selectOperatore) return;
    
    const currentValue = selectOperatore.value;
    selectOperatore.innerHTML = '<option value="">Tutti</option>';
    
    allOperatori.forEach(operatore => {
        const option = document.createElement('option');
        option.value = operatore.idsocio || String(operatore.id || '') || operatore.nominativo || '';
        option.textContent = operatore.nominativo || option.value;
        option.dataset.idsocio = operatore.idsocio == null ? '' : String(operatore.idsocio);
        option.dataset.id = operatore.id == null ? '' : String(operatore.id);
        option.dataset.nominativo = operatore.nominativo || '';
        selectOperatore.appendChild(option);
    });

    nomiOperatoreSoloSuiServizi().forEach((nome) => {
        const option = document.createElement('option');
        option.value = nome;
        option.textContent = `${nome} (da servizi)`;
        option.dataset.idsocio = '';
        option.dataset.id = '';
        option.dataset.nominativo = nome;
        selectOperatore.appendChild(option);
    });
    
    if (currentValue) selectOperatore.value = currentValue;
    popolaDropdownAccompagnatori();
}

/** Nomi accompagnatore presenti sui servizi (campo operatore_2). */
function popolaDropdownAccompagnatori() {
    const select = document.getElementById('ricerca-accompagnatore');
    if (!select) return;

    const currentValue = select.value;
    const nomi = new Set();
    (serviziOriginali || []).forEach((s) => {
        const nome = String(s.operatore_2 || '').trim();
        if (nome) nomi.add(nome);
    });
    (serviziCache || []).forEach((s) => {
        const nome = String(s.operatore_2 || '').trim();
        if (nome) nomi.add(nome);
    });

    select.innerHTML = '<option value="">Tutti</option>';
    [...nomi].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' })).forEach((nome) => {
        const option = document.createElement('option');
        option.value = nome;
        option.textContent = nome;
        select.appendChild(option);
    });
    if (currentValue && [...select.options].some((o) => o.value === currentValue)) {
        select.value = currentValue;
    }
}

// Setup autocomplete per nominativo
function setupAutocompleteNominativo() {
    const inputNominativo = document.getElementById('ricerca-nominativo');
    const suggestionsDiv = document.getElementById('ricerca-nominativo-suggestions');
    
    if (!inputNominativo || !suggestionsDiv) return;
    
    let selectedIndex = -1;
    let filteredSuggestions = [];
    
    inputNominativo.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim().toUpperCase();
        
        if (searchTerm.length === 0) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        filteredSuggestions = allTesserati.filter(t => {
            const nominativo = (t.nominativo || '').toUpperCase();
            return nominativo.includes(searchTerm);
        }).slice(0, 10); // Massimo 10 suggerimenti
        
        if (filteredSuggestions.length > 0) {
            suggestionsDiv.innerHTML = '';
            filteredSuggestions.forEach((tesserato, index) => {
                const div = document.createElement('div');
                div.className = 'autocomplete-suggestion';
                div.textContent = tesserato.nominativo || '';
                div.dataset.index = index;
                div.addEventListener('click', () => {
                    inputNominativo.value = tesserato.nominativo || '';
                    suggestionsDiv.style.display = 'none';
                });
                suggestionsDiv.appendChild(div);
            });
            suggestionsDiv.style.display = 'block';
            selectedIndex = -1;
        } else {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    inputNominativo.addEventListener('blur', () => {
        // Delay per permettere il click sul suggerimento
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 200);
    });
    
    inputNominativo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
            updateSelectedSuggestion();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            const tesserato = filteredSuggestions[selectedIndex];
            inputNominativo.value = tesserato.nominativo || '';
            suggestionsDiv.style.display = 'none';
        }
    });
    
    function updateSelectedSuggestion() {
        const suggestions = suggestionsDiv.querySelectorAll('.autocomplete-suggestion');
        suggestions.forEach((sug, idx) => {
            sug.classList.toggle('selected', idx === selectedIndex);
        });
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }
}

// Apri modale ricerca
function apriModaleRicerca() {
    const modal = document.getElementById('modal-ricerca');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Chiudi modale ricerca
function chiudiModaleRicerca() {
    const modal = document.getElementById('modal-ricerca');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Reset form ricerca
function resetFormRicerca() {
    document.getElementById('ricerca-idservizio').value = '';
    document.getElementById('ricerca-idsocio').value = '';
    const pcum = document.getElementById('ricerca-pagamento-cumulativo');
    if (pcum) pcum.value = '';
    document.getElementById('ricerca-nominativo').value = '';
    document.getElementById('ricerca-data-da').value = '';
    document.getElementById('ricerca-data-a').value = '';
    document.getElementById('ricerca-stato-incasso').value = '';
    document.getElementById('ricerca-tipo-pagamento').value = '';
    document.getElementById('ricerca-tipo-servizio').value = '';
    document.getElementById('ricerca-carrozzina').value = '';
    document.getElementById('ricerca-richiedente').value = '';
    document.getElementById('ricerca-operatore').value = '';
    const acc = document.getElementById('ricerca-accompagnatore');
    if (acc) acc.value = '';
}

// Applica filtri ricerca
async function applicaFiltriRicerca() {
    // Leggi valori dal form
    filtriRicerca = {
        idservizio: document.getElementById('ricerca-idservizio').value.trim() || null,
        idsocio: document.getElementById('ricerca-idsocio').value.trim() || null,
        nominativo: document.getElementById('ricerca-nominativo').value.trim() || null,
        dataDa: document.getElementById('ricerca-data-da').value || null,
        dataA: document.getElementById('ricerca-data-a').value || null,
        statoIncasso: document.getElementById('ricerca-stato-incasso').value || null,
        tipoPagamento: document.getElementById('ricerca-tipo-pagamento').value || null,
        tipoServizio: document.getElementById('ricerca-tipo-servizio').value || null,
        carrozzina: document.getElementById('ricerca-carrozzina').value || null,
        richiedente: document.getElementById('ricerca-richiedente').value || null,
        operatore: document.getElementById('ricerca-operatore').value || null,
        accompagnatore: document.getElementById('ricerca-accompagnatore')?.value || null,
        pagamentoCumulativo: document.getElementById('ricerca-pagamento-cumulativo')?.value || null,
        // Il filtro per numero gruppo resta se attivo (si toglie con TUTTI o cliccando di nuovo il n.)
        pagamentoCumulativoNumero: filtriRicerca.pagamentoCumulativoNumero || null
    };
    
    console.log('Applicazione filtri ricerca:', JSON.stringify(filtriRicerca));
    if (filtriRicerca.operatore) {
        const sel = document.getElementById('ricerca-operatore');
        const opt = sel?.selectedOptions?.[0];
        const raccolti = raccogliIdsOperatore(filtriRicerca.operatore);
        const t555 = (allTesserati || []).find((t) =>
            normalizzaIdOperatore(t.idsocio) === normalizzaIdOperatore(filtriRicerca.operatore)
            || normalizzaIdOperatore(t.id) === normalizzaIdOperatore(filtriRicerca.operatore)
        );
        const nomiConti = [...new Set(
            (serviziOriginali || [])
                .filter((s) =>
                    /CONTI/i.test(String(s.operatore || ''))
                    || /CONTI/i.test(String(s.operatore_2 || ''))
                    || /CONTI/i.test(String(s.operatore_testo || ''))
                )
                .map((s) => `${s.operatore || ''} | testo:${s.operatore_testo || ''} | id:${s.id_operatore || ''}`)
        )].slice(0, 15);
        const matchId = (serviziOriginali || []).filter((s) =>
            raccolti.ids.includes(normalizzaIdOperatore(s.id_operatore))
            || raccolti.ids.includes(normalizzaIdOperatore(s.id_operatore_2))
        ).length;
        console.log('Filtro operatore:', JSON.stringify({
            value: filtriRicerca.operatore,
            testo: opt?.textContent || '',
            idRiga: opt?.dataset?.id || '',
            idsocio: opt?.dataset?.idsocio || '',
            idsCollegati: raccolti.ids,
            nome: raccolti.nomeTarget,
            tesserato: t555 ? { id: t555.id, idsocio: t555.idsocio, nominativo: t555.nominativo } : null,
            primoServizio: serviziOriginali[0] ? {
                operatore: serviziOriginali[0].operatore,
                id_operatore: serviziOriginali[0].id_operatore
            } : null,
            serviziConQuegliId: matchId,
            nomiConCONTI: nomiConti,
            primoOperTesto: serviziOriginali[0] ? serviziOriginali[0].operatore_testo : null
        }));
    }

    let ok = true;
    if (isTauri() && invoke) {
        ok = await caricaLista(1);
    } else {
        applyAllFilters();
    }

    if (ok && filtriRicerca.operatore && (elencoPaginatoSulServer ? totaleServiziRemoti === 0 : serviziCache.length === 0) && filtroAnnoModo !== 'tutti') {
        console.log('Nessun servizio nell\'anno corrente: riprovo su TUTTI GLI ANNI');
        await switchAnnoModo('tutti');
    }
    
    // Aggiorna warning e conteggio
    updateFilterWarning();
    updateServiziCount();
    
    // Chiudi modale
    chiudiModaleRicerca();
}

// Setup event listener modale
function setupModaleRicerca() {
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnAnnullaModal = document.getElementById('btn-annulla-modal');
    const btnRicercaModal = document.getElementById('btn-ricerca-modal');
    const modal = document.getElementById('modal-ricerca');
    
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            chiudiModaleRicerca();
        });
    }
    
    if (btnAnnullaModal) {
        btnAnnullaModal.addEventListener('click', () => {
            chiudiModaleRicerca();
        });
    }
    
    if (btnRicercaModal) {
        btnRicercaModal.addEventListener('click', () => {
            applicaFiltriRicerca();
        });
    }
    
    // Chiudi modale cliccando fuori
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                chiudiModaleRicerca();
            }
        });
    }
}

