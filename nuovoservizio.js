// Nuovo Servizio — form inserimento (salvataggio DB in fase successiva)

import {
    mergeTrattaInNote,
    applicaRiepilogoTrattaNelDom,
    leggiTrattaDalDom,
    apriFinestraSelezioneTratta,
    onTrattaFuoriAstiSelezionata,
    chiediPartenzaOArrivo,
    compilaCampiLocalitaDaTratta,
    rimuoviTrattaDalForm,
    messaggioAvvisoDopoRimozioneTratta
} from './tratta-riepilogo.js';
import { setupNuovoSocioTrasportato } from './nuovoservizio-nuovo-socio.js';

let invoke;

let allTesserati = [];
let allOperatori = [];
let allAutomezzi = [];
let allMotivazioni = [];
let allComuniPrelievo = [];
let allLuoghiPrelievo = [];
let allComuniDestinazione = [];
let allLuoghiDestinazione = [];
let allRichiedenti = [];
let allTipiPagamento = [];
let allStatiServizio = [];

const CAMPI_OBBLIGATORI = [
    { id: 'ns-trasportato', label: 'TRASPORTATO' },
    { id: 'ns-data-prelievo', label: 'DATA PRELIEVO' },
    { id: 'ns-ora-inizio', label: 'ORA SOTTO CASA' },
    { id: 'ns-comune-prelievo', label: 'COMUNE DI PRELIEVO' },
    { id: 'ns-luogo-prelievo', label: 'LUOGO DI PRELIEVO' },
    { id: 'ns-richiedente', label: 'RICHIEDENTE' },
    { id: 'ns-tipo-servizio', label: 'TIPO SERVIZIO' },
    { id: 'ns-comune-destinazione', label: 'COMUNE DI DESTINAZIONE' },
    { id: 'ns-luogo-destinazione', label: 'LUOGO DI DESTINAZIONE' },
    { id: 'ns-stato-servizio', label: 'STATO DEL SERVIZIO' }
];

async function initTauri() {
    try {
        const tauriModule = await import('@tauri-apps/api/tauri');
        invoke = tauriModule.invoke;
        return true;
    } catch (error) {
        console.error('Errore API Tauri:', error);
        return false;
    }
}

function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function oggiIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dataIsoToItaliana(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return '';
    const parts = isoStr.trim().split('-');
    if (parts.length !== 3) return '';
    const [year, month, day] = parts;
    if (!year || !month || !day) return '';
    return `${pad2(parseInt(day, 10))}/${pad2(parseInt(month, 10))}/${year}`;
}

function dataItalianaToIso(dateStr) {
    const date = parseItalianDate(dateStr);
    if (!date) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
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

function parseEuroItaliano(valore) {
    if (valore === undefined || valore === null) return 0;
    const pulito = String(valore)
        .replace(/€/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    if (!pulito) return 0;
    const numero = parseFloat(pulito);
    return Number.isNaN(numero) ? 0 : numero;
}

function formatEuroItaliano(valore) {
    const numero = Number(valore);
    const sicuro = Number.isNaN(numero) ? 0 : numero;
    const parti = sicuro.toFixed(2).split('.');
    parti[0] = parti[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${parti[0]},${parti[1]} €`;
}

function impostaPagamentoEuro(valore) {
    setValore('ns-pagamento', formatEuroItaliano(valore));
}

function formattaCampoPagamento() {
    const campo = document.getElementById('ns-pagamento');
    if (!campo) return;
    const testo = campo.value.trim();
    if (!testo) {
        campo.value = '';
        return;
    }
    campo.value = formatEuroItaliano(parseEuroItaliano(testo));
}

function preparaCampoPagamentoPerModifica() {
    const campo = document.getElementById('ns-pagamento');
    if (!campo) return;
    const testo = campo.value.trim();
    if (!testo) return;
    const numero = parseEuroItaliano(testo);
    campo.value = numero.toFixed(2).replace('.', ',');
    if (typeof campo.select === 'function') {
        campo.select();
    }
}

function isTesseraScaduta(scadenzatessera) {
    const scadenza = parseItalianDate(scadenzatessera);
    if (!scadenza) return false;
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    return scadenza < oggi;
}

function normalizzaNumero(val) {
    if (val === null || val === undefined) return '';
    const s = String(val).trim();
    if (!s) return '';
    if (s.endsWith('.0')) return s.slice(0, -2);
    return s;
}

function isTruthyFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value ?? '').trim().toUpperCase();
    if (!s || s === 'FALSE' || s === 'NO' || s === '0') return false;
    return s === 'TRUE' || s === 'SI' || s === 'SÌ' || s === '1' ||
        s === 'YES' || s === 'Y' || s === 'ATTIVO';
}

function isArchiviato(tesserato) {
    return isTruthyFlag(tesserato.archivia);
}

function normalizzaTestoRicerca(testo) {
    return String(testo || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function normalizzaMotivazione(testo) {
    return String(testo || '').trim().replace(/\s+/g, ' ');
}

function deduplicaMotivazioni(lista) {
    const viste = new Set();
    const uniche = [];

    (Array.isArray(lista) ? lista : []).forEach(item => {
        const motivazione = normalizzaMotivazione(item);
        if (!motivazione) return;

        const chiave = normalizzaTestoRicerca(motivazione);
        if (viste.has(chiave)) return;

        viste.add(chiave);
        uniche.push(motivazione);
    });

    return uniche.sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

function deduplicaComuni(lista) {
    return deduplicaMotivazioni(lista);
}

function isNonArchiviato(tesserato) {
    return !isArchiviato(tesserato);
}

function getSociTrasportabili() {
    // Come Elenco Soci: tutti i non archiviati con nominativo (senza filtro "attivo")
    return allTesserati
        .filter(t => isNonArchiviato(t) && normalizzaTestoRicerca(t.nominativo))
        .sort((a, b) => (a.nominativo || '').localeCompare(b.nominativo || '', 'it'));
}

function getValore(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.value.trim();
}

function setValore(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function setLoading(visible) {
    const el = document.getElementById('ns-loading');
    const form = document.getElementById('form-nuovo-servizio');
    if (el) el.style.display = visible ? 'block' : 'none';
    if (form) form.style.display = visible ? 'none' : 'block';
}

function nascondiErrori() {
    const box = document.getElementById('ns-errori');
    const lista = document.getElementById('ns-errori-lista');
    if (box) box.style.display = 'none';
    if (lista) lista.innerHTML = '';
    document.querySelectorAll('.ns-campo-errore').forEach(el => {
        el.classList.remove('ns-campo-errore');
    });
}

function mostraErrori(mancanti) {
    const box = document.getElementById('ns-errori');
    const lista = document.getElementById('ns-errori-lista');
    if (!box || !lista) return;

    lista.innerHTML = mancanti.map(m => `<li>${m.label}</li>`).join('');
    box.style.display = 'block';

    mancanti.forEach(m => {
        const el = document.getElementById(m.id);
        if (el) el.classList.add('ns-campo-errore');
    });

    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validaCampiObbligatori() {
    nascondiErrori();
    const mancanti = [];

    CAMPI_OBBLIGATORI.forEach(c => {
        if (c.id === 'ns-trasportato') {
            const testo = getValore('ns-trasportato');
            const idsocio = getValore('ns-idsocio');
            if (!testo || !idsocio) {
                mancanti.push({
                    id: 'ns-trasportato',
                    label: testo && !idsocio
                        ? 'TRASPORTATO (seleziona un socio dalla lista dei suggerimenti)'
                        : 'TRASPORTATO'
                });
            }
            return;
        }
        if (!getValore(c.id)) {
            mancanti.push(c);
        }
    });

    if (mancanti.length > 0) {
        mostraErrori(mancanti);
        return false;
    }
    return true;
}

let dettaglioRichiestaId = 0;

const MSG_DETTAGLIO_VUOTO = 'Seleziona un trasportato dalla lista per caricare residenza e tesseramento.';

let ultimoTrasportatoCaricatoId = null;
let anagraficaTrasportatoCorrente = null;
let notaAggiuntivaInModifica = false;
let automezzoSelezionatoCorrente = null;
let noteMezzoInModifica = false;

function svuotaDettaglioTrasportato() {
    ['ns-res-indirizzo', 'ns-res-civico', 'ns-res-cap', 'ns-res-comune', 'ns-res-provincia', 'ns-res-telefono', 'ns-nota-aggiuntiva']
        .forEach(id => setValore(id, ''));

    anagraficaTrasportatoCorrente = null;
    disabilitaModificaNotaAggiuntiva();
    const badge = document.getElementById('ns-tessera-badge');
    if (badge) {
        badge.style.display = 'none';
        badge.textContent = '';
        badge.className = 'ns-tessera-badge';
    }

    const info = document.getElementById('ns-tesseramento-info');
    if (info) {
        info.textContent = MSG_DETTAGLIO_VUOTO;
    }
}

function trovaTesseratoSelezionato() {
    const testo = getValore('ns-trasportato');
    if (!testo) return null;

    const idsocio = getValore('ns-idsocio');
    if (idsocio) {
        const daId = allTesserati.find(t => String(t.idsocio || '').trim() === idsocio);
        if (daId) return daId;
    }

    return getSociTrasportabili().find(
        t => normalizzaTestoRicerca(t.nominativo) === normalizzaTestoRicerca(testo)
    ) || null;
}

function impostaSoloSelezioneTrasportato(tesserato) {
    const input = document.getElementById('ns-trasportato');
    if (input) {
        input.value = tesserato.nominativo || '';
        input.classList.remove('ns-campo-errore');
    }
    setValore('ns-idsocio', tesserato.idsocio || '');
    const suggestionsDiv = document.getElementById('ns-trasportato-suggestions');
    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
}

function impostaResidenzaDaAnagrafica(anagrafica, tesseratoFallback) {
    const a = anagrafica || {};
    const t = tesseratoFallback || {};
    setValore('ns-res-indirizzo', a.residenza_indirizzo || '');
    setValore('ns-res-civico', a.residenza_civico || '');
    setValore('ns-res-cap', a.residenza_cap || '');
    setValore('ns-res-comune', a.residenza_comune || '');
    setValore('ns-res-provincia', a.residenza_provincia || '');
    setValore('ns-res-telefono', a.telefono || t.telefono || '');
    setValore('ns-nota-aggiuntiva', a.notaaggiuntiva || t.notaaggiuntiva || '');
    aggiornaStatoPulsanteNotaAggiuntiva();
}

function impostaIconaPulsanteModifica(btn, modalitaSalva) {
    if (!btn) return;
    btn.classList.toggle('ns-btn-salva', modalitaSalva);
}

function aggiornaStatoPulsanteNotaAggiuntiva() {
    const btn = document.getElementById('btn-modifica-nota-aggiuntiva');
    if (!btn || notaAggiuntivaInModifica) return;
    const abilitato = Boolean(getValore('ns-idsocio') && anagraficaTrasportatoCorrente);
    btn.disabled = !abilitato;
    if (abilitato) {
        impostaIconaPulsanteModifica(btn, false);
    }
}

function disabilitaModificaNotaAggiuntiva() {
    const textarea = document.getElementById('ns-nota-aggiuntiva');
    const btn = document.getElementById('btn-modifica-nota-aggiuntiva');
    notaAggiuntivaInModifica = false;

    if (textarea) {
        textarea.readOnly = true;
        textarea.tabIndex = -1;
        textarea.classList.remove('ns-nota-aggiuntiva-modifica');
    }

    if (btn) {
        impostaIconaPulsanteModifica(btn, false);
        btn.title = 'Modifica note aggiuntive';
        btn.setAttribute('aria-label', 'Modifica note aggiuntive');
        btn.disabled = true;
    }
}

function abilitaModificaNotaAggiuntiva() {
    const textarea = document.getElementById('ns-nota-aggiuntiva');
    const btn = document.getElementById('btn-modifica-nota-aggiuntiva');
    if (!textarea || !btn) return;

    notaAggiuntivaInModifica = true;
    textarea.readOnly = false;
    textarea.tabIndex = 0;
    textarea.classList.add('ns-nota-aggiuntiva-modifica');
    impostaIconaPulsanteModifica(btn, true);
    btn.disabled = false;
    btn.title = 'Salva note aggiuntive';
    btn.setAttribute('aria-label', 'Salva note aggiuntive');
    textarea.focus();
}

async function salvaNotaAggiuntivaTrasportato() {
    const textarea = document.getElementById('ns-nota-aggiuntiva');
    const idsocio = getValore('ns-idsocio');
    if (!textarea || !idsocio || !anagraficaTrasportatoCorrente) return;

    const nuovaNota = textarea.value.trim();
    const payload = {
        ...anagraficaTrasportatoCorrente,
        notaaggiuntiva: nuovaNota
    };

    if (isTauri() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('save_socio_anagrafica', { anagrafica: payload });
            anagraficaTrasportatoCorrente = { ...anagraficaTrasportatoCorrente, notaaggiuntiva: nuovaNota };

            const idx = allTesserati.findIndex(t => String(t.idsocio || '').trim() === idsocio);
            if (idx >= 0) {
                allTesserati[idx].notaaggiuntiva = nuovaNota;
            }
        } catch (error) {
            console.error('Salvataggio note aggiuntive:', error);
            alert('Errore nel salvataggio delle note aggiuntive sul database.');
            return;
        }
    } else {
        anagraficaTrasportatoCorrente = { ...anagraficaTrasportatoCorrente, notaaggiuntiva: nuovaNota };
    }

    disabilitaModificaNotaAggiuntiva();
    aggiornaStatoPulsanteNotaAggiuntiva();
}

async function toggleModificaNotaAggiuntiva() {
    const textarea = document.getElementById('ns-nota-aggiuntiva');
    if (!textarea || !getValore('ns-idsocio') || !anagraficaTrasportatoCorrente) return;

    if (textarea.readOnly) {
        abilitaModificaNotaAggiuntiva();
        return;
    }

    await salvaNotaAggiuntivaTrasportato();
}

function aggiornaBadgeTessera(scadenza, tesseramento) {
    const badge = document.getElementById('ns-tessera-badge');
    const info = document.getElementById('ns-tesseramento-info');
    if (!badge) return;

    if (!scadenza) {
        badge.style.display = 'none';
        badge.textContent = '';
        if (info && tesseramento) info.textContent = 'Nessuna data di scadenza tessera disponibile.';
        return;
    }

    const scaduta = isTesseraScaduta(scadenza);
    badge.style.display = 'inline-block';
    badge.textContent = scaduta ? 'TESSERA SCADUTA' : 'TESSERA VALIDA';
    badge.className = scaduta ? 'ns-tessera-badge scaduta' : 'ns-tessera-badge valida';

    if (info) {
        const parti = [];
        if (tesseramento?.anno) parti.push(`Anno tesseramento: ${tesseramento.anno}`);
        if (tesseramento?.numero) parti.push(`N° tessera: ${tesseramento.numero}`);
        parti.push(`Scadenza: ${scadenza}`);
        info.textContent = parti.join(' · ');
    }
}

async function aggiornaDettaglioTrasportato(tesserato, richiestaId) {
    if (!tesserato?.idsocio) {
        svuotaDettaglioTrasportato();
        return;
    }

    const info = document.getElementById('ns-tesseramento-info');
    if (info) info.textContent = 'Caricamento residenza e tesseramento...';

    let anagrafica = null;
    let tesseramenti = [];

    if (isTauri() && invoke) {
        try {
            const completa = await invoke('get_socio_anagrafica', { idsocio: String(tesserato.idsocio) });
            if (richiestaId !== dettaglioRichiestaId) return;
            anagrafica = completa?.anagrafica || null;
            tesseramenti = Array.isArray(completa?.tesseramenti) ? completa.tesseramenti : [];
        } catch (error) {
            if (richiestaId !== dettaglioRichiestaId) return;
            ultimoTrasportatoCaricatoId = null;
            console.warn('Caricamento anagrafica trasportato:', error);
            if (info) info.textContent = 'Errore nel caricamento dei dati.';
        }
    } else if (tesserato.idsocio === '101') {
        anagrafica = {
            residenza_indirizzo: 'VIA ROMA',
            residenza_civico: '123',
            residenza_cap: '14100',
            residenza_comune: 'ASTI',
            residenza_provincia: 'AT',
            telefono: '0141 000000',
            notaaggiuntiva: 'Socio con difficoltà motorie. Preferire accompagnamento fino al piano.'
        };
        tesseramenti = [{ anno: '2025', numero: '1001', scadenza: '31/12/2025' }];
    }

    if (richiestaId !== dettaglioRichiestaId) return;

    anagraficaTrasportatoCorrente = anagrafica;
    impostaResidenzaDaAnagrafica(anagrafica, tesserato);

    const ultimoTesseramento = tesseramenti.length > 0 ? tesseramenti[0] : null;
    const scadenza = ultimoTesseramento?.scadenza || tesserato.scadenzatessera || '';
    aggiornaBadgeTessera(scadenza, ultimoTesseramento);
}

async function caricaDettaglioTrasportato(tesserato) {
    if (!tesserato?.idsocio) {
        ultimoTrasportatoCaricatoId = null;
        setValore('ns-idsocio', '');
        svuotaDettaglioTrasportato();
        return;
    }

    impostaSoloSelezioneTrasportato(tesserato);

    const idsocio = String(tesserato.idsocio);
    if (ultimoTrasportatoCaricatoId === idsocio) return;

    ultimoTrasportatoCaricatoId = idsocio;
    const richiestaId = ++dettaglioRichiestaId;
    await aggiornaDettaglioTrasportato(tesserato, richiestaId);
}

async function caricaDettaglioTrasportatoOnBlur() {
    const tesserato = trovaTesseratoSelezionato();
    await caricaDettaglioTrasportato(tesserato);
}

async function selezionaTrasportato(tesserato) {
    await caricaDettaglioTrasportato(tesserato);
}

function setupAutocompleteTrasportato() {
    const input = document.getElementById('ns-trasportato');
    const suggestionsDiv = document.getElementById('ns-trasportato-suggestions');
    if (!input || !suggestionsDiv) return;

    let selectedIndex = -1;
    let filteredSuggestions = [];

    function renderSuggestions() {
        suggestionsDiv.innerHTML = '';
        filteredSuggestions.forEach((tesserato, index) => {
            const div = document.createElement('div');
            div.className = 'autocomplete-suggestion ns-autocomplete-suggestion';
            div.dataset.index = String(index);
            const nom = tesserato.nominativo || '';
            const id = tesserato.idsocio || '';
            div.innerHTML = `${nom}<span class="suggestion-idsocio">ID ${id}</span>`;
            div.addEventListener('mousedown', async (e) => {
                e.preventDefault();
                await selezionaTrasportato(tesserato);
            });
            suggestionsDiv.appendChild(div);
        });
        suggestionsDiv.style.display = filteredSuggestions.length > 0 ? 'block' : 'none';
        selectedIndex = -1;
    }

    function updateSelectedSuggestion() {
        const suggestions = suggestionsDiv.querySelectorAll('.ns-autocomplete-suggestion');
        suggestions.forEach((sug, idx) => {
            sug.classList.toggle('selected', idx === selectedIndex);
        });
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    input.addEventListener('input', (e) => {
        const searchTerm = normalizzaTestoRicerca(e.target.value);
        setValore('ns-idsocio', '');
        ultimoTrasportatoCaricatoId = null;
        dettaglioRichiestaId += 1;
        svuotaDettaglioTrasportato();

        if (searchTerm.length === 0) {
            suggestionsDiv.style.display = 'none';
            filteredSuggestions = [];
            return;
        }

        filteredSuggestions = getSociTrasportabili()
            .filter(t => normalizzaTestoRicerca(t.nominativo).includes(searchTerm))
            .slice(0, 20);

        renderSuggestions();
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
            caricaDettaglioTrasportatoOnBlur();
        }, 200);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredSuggestions.length === 0) return;
            selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
            updateSelectedSuggestion();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            selezionaTrasportato(filteredSuggestions[selectedIndex]);
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
        }
    });
}

function setupAutocompleteMotivazione() {
    const input = document.getElementById('ns-motivazione');
    const suggestionsDiv = document.getElementById('ns-motivazione-suggestions');
    if (!input || !suggestionsDiv) return;

    let selectedIndex = -1;
    let filteredSuggestions = [];

    function renderSuggestions() {
        suggestionsDiv.innerHTML = '';
        filteredSuggestions.forEach((motivazione, index) => {
            const div = document.createElement('div');
            div.className = 'autocomplete-suggestion ns-autocomplete-suggestion';
            div.dataset.index = String(index);
            div.textContent = motivazione;
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = motivazione;
                suggestionsDiv.style.display = 'none';
                filteredSuggestions = [];
                selectedIndex = -1;
            });
            suggestionsDiv.appendChild(div);
        });
        suggestionsDiv.style.display = filteredSuggestions.length > 0 ? 'block' : 'none';
        selectedIndex = -1;
    }

    function updateSelectedSuggestion() {
        const suggestions = suggestionsDiv.querySelectorAll('.ns-autocomplete-suggestion');
        suggestions.forEach((sug, idx) => {
            sug.classList.toggle('selected', idx === selectedIndex);
        });
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    input.addEventListener('input', (e) => {
        const searchTerm = normalizzaTestoRicerca(e.target.value);
        if (searchTerm.length === 0) {
            suggestionsDiv.style.display = 'none';
            filteredSuggestions = [];
            return;
        }

        filteredSuggestions = deduplicaMotivazioni(
            allMotivazioni.filter(m => normalizzaTestoRicerca(m).includes(searchTerm))
        ).slice(0, 20);

        renderSuggestions();
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 200);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredSuggestions.length === 0) return;
            selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
            updateSelectedSuggestion();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            input.value = filteredSuggestions[selectedIndex];
            suggestionsDiv.style.display = 'none';
            filteredSuggestions = [];
            selectedIndex = -1;
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
        }
    });
}

function setupAutocompleteComunePrelievo() {
    setupAutocompleteDaLista(
        'ns-comune-prelievo',
        'ns-comune-prelievo-suggestions',
        () => allComuniPrelievo
    );
}

function setupAutocompleteLuogoPrelievo() {
    setupAutocompleteDaLista(
        'ns-luogo-prelievo',
        'ns-luogo-prelievo-suggestions',
        () => allLuoghiPrelievo
    );
}

function setupAutocompleteComuneDestinazione() {
    setupAutocompleteDaLista(
        'ns-comune-destinazione',
        'ns-comune-destinazione-suggestions',
        () => allComuniDestinazione
    );
}

function setupAutocompleteLuogoDestinazione() {
    setupAutocompleteDaLista(
        'ns-luogo-destinazione',
        'ns-luogo-destinazione-suggestions',
        () => allLuoghiDestinazione
    );
}

/** Autocomplete generico: lista unica, filtro digitando */
function setupAutocompleteDaLista(inputId, suggestionsId, getLista) {
    const input = document.getElementById(inputId);
    const suggestionsDiv = document.getElementById(suggestionsId);
    if (!input || !suggestionsDiv) return;

    let selectedIndex = -1;
    let filteredSuggestions = [];

    function renderSuggestions() {
        suggestionsDiv.innerHTML = '';
        filteredSuggestions.forEach((valore, index) => {
            const div = document.createElement('div');
            div.className = 'autocomplete-suggestion ns-autocomplete-suggestion';
            div.dataset.index = String(index);
            div.textContent = valore;
            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = valore;
                input.classList.remove('ns-campo-errore');
                suggestionsDiv.style.display = 'none';
                filteredSuggestions = [];
                selectedIndex = -1;
            });
            suggestionsDiv.appendChild(div);
        });
        suggestionsDiv.style.display = filteredSuggestions.length > 0 ? 'block' : 'none';
        selectedIndex = -1;
    }

    function updateSelectedSuggestion() {
        const suggestions = suggestionsDiv.querySelectorAll('.ns-autocomplete-suggestion');
        suggestions.forEach((sug, idx) => {
            sug.classList.toggle('selected', idx === selectedIndex);
        });
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    input.addEventListener('input', (e) => {
        const searchTerm = normalizzaTestoRicerca(e.target.value);
        if (searchTerm.length === 0) {
            suggestionsDiv.style.display = 'none';
            filteredSuggestions = [];
            return;
        }

        const lista = Array.isArray(getLista()) ? getLista() : [];
        filteredSuggestions = deduplicaComuni(
            lista.filter(c => normalizzaTestoRicerca(c).includes(searchTerm))
        ).slice(0, 20);

        renderSuggestions();
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 200);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredSuggestions.length === 0) return;
            selectedIndex = Math.min(selectedIndex + 1, filteredSuggestions.length - 1);
            updateSelectedSuggestion();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            input.value = filteredSuggestions[selectedIndex];
            input.classList.remove('ns-campo-errore');
            suggestionsDiv.style.display = 'none';
            filteredSuggestions = [];
            selectedIndex = -1;
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
        }
    });
}

function popolaSelectRichiedenti() {
    const select = document.getElementById('ns-richiedente');
    if (!select) return;

    select.innerHTML = '<option value="">— Seleziona —</option>';
    allRichiedenti.forEach(richiedente => {
        const opt = document.createElement('option');
        opt.value = richiedente;
        opt.textContent = richiedente;
        select.appendChild(opt);
    });
}

function popolaSelectTipiPagamento() {
    const select = document.getElementById('ns-tipo-pagamento');
    if (!select) return;

    select.innerHTML = '<option value="">— Nessuno —</option>';
    allTipiPagamento.forEach(tipo => {
        const opt = document.createElement('option');
        opt.value = tipo;
        opt.textContent = tipo;
        select.appendChild(opt);
    });
}

function getStatiServizioOptions() {
    return allStatiServizio.length ? [...allStatiServizio] : [];
}

function resolveStatoServizioSelezionato(valoreCorrente = '') {
    const opzioni = getStatiServizioOptions();
    const corrente = String(valoreCorrente || '').trim();
    if (!corrente || !opzioni.length) return opzioni[0] || '';
    const match = opzioni.find(s => s.toUpperCase() === corrente.toUpperCase());
    return match || opzioni[0] || '';
}

/** Stato predefinito per un nuovo servizio: DA ESEGUIRE (da tabella Supabase) */
function statoDefaultNuovoServizio() {
    const opzioni = getStatiServizioOptions();
    if (!opzioni.length) return '';
    return opzioni.find(s => s.toUpperCase() === 'DA ESEGUIRE')
        || opzioni[0]
        || '';
}

function popolaSelectStatiServizio(valoreSelezionato = '') {
    const select = document.getElementById('ns-stato-servizio');
    if (!select) return;

    const opzioni = getStatiServizioOptions();
    select.innerHTML = '';
    if (!opzioni.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— Nessuno stato da Supabase —';
        select.appendChild(opt);
        return;
    }

    opzioni.forEach(stato => {
        const opt = document.createElement('option');
        opt.value = stato;
        opt.textContent = stato;
        select.appendChild(opt);
    });

    const selezionato = valoreSelezionato
        ? resolveStatoServizioSelezionato(valoreSelezionato)
        : statoDefaultNuovoServizio();
    if (selezionato) select.value = selezionato;
}

function popolaSelectOperatori() {
    const select = document.getElementById('ns-operatore');
    if (!select) return;

    allOperatori
        .sort((a, b) => (a.nominativo || '').localeCompare(b.nominativo || '', 'it'))
        .forEach(op => {
            const opt = document.createElement('option');
            opt.value = op.nominativo || '';
            opt.textContent = op.nominativo || '';
            select.appendChild(opt);
        });
}

function popolaSelectMezzi() {
    const select = document.getElementById('ns-mezzo');
    if (!select) return;

    allAutomezzi.forEach(m => {
        const nr = normalizzaNumero(m.nr_automezzo);
        const label = [m.marca, m.modello].filter(Boolean).join(' - ') + (nr ? ` (${nr})` : '');
        const opt = document.createElement('option');
        opt.value = nr;
        opt.textContent = label || nr || 'Mezzo';
        select.appendChild(opt);
    });
}

function trovaAutomezzoSelezionato() {
    const nr = normalizzaNumero(getValore('ns-mezzo'));
    if (!nr) return null;
    return allAutomezzi.find(m => normalizzaNumero(m.nr_automezzo) === nr) || null;
}

function parseDataScadenzaMezzo(dateStr) {
    if (!dateStr || !String(dateStr).trim()) return null;
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [year, month, day] = s.slice(0, 10).split('-').map(v => parseInt(v, 10));
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
            return date;
        }
        return null;
    }
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
}

function classeStatoScadenza(dateStr) {
    const scadenza = parseDataScadenzaMezzo(dateStr);
    if (!scadenza) return '';
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    scadenza.setHours(0, 0, 0, 0);
    if (scadenza < oggi) return 'mod-scadenza-scaduta';
    const diffGiorni = (scadenza - oggi) / (1000 * 60 * 60 * 24);
    if (diffGiorni < 60) return 'mod-scadenza-prossima';
    return '';
}

function valoreScadenzaDisplay(valueIso) {
    if (!valueIso) return '';
    const s = String(valueIso).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dataIsoToItaliana(s.slice(0, 10));
    return s;
}

function applicaStileScadenzaCampo(id, valueIso) {
    const input = document.getElementById(id);
    if (!input) return;
    const field = input.closest('.mod-field-scadenza');
    if (!field) return;
    field.classList.remove('mod-scadenza-prossima', 'mod-scadenza-scaduta');
    input.value = valoreScadenzaDisplay(valueIso);
    const classe = classeStatoScadenza(valueIso || input.value);
    if (classe) field.classList.add(classe);
}

function aggiornaDettaglioDaMezzo() {
    const automezzo = trovaAutomezzoSelezionato();
    automezzoSelezionatoCorrente = automezzo;

    if (noteMezzoInModifica) {
        disabilitaModificaNoteMezzo();
    }

    setValore('ns-dotazioni', automezzo?.dotazione || '');
    setValore('ns-note-mezzo', automezzo?.note_mezzo || '');
    applicaStileScadenzaCampo('ns-scadenza-ztl', automezzo?.scadenza_ztl || '');
    applicaStileScadenzaCampo('ns-scadenza-assicurazione', automezzo?.scadenza_assicurazione || '');
    aggiornaStatoPulsanteNoteMezzo();
}

function escapeHtmlMezzo(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function chiudiModaleMezzoOccupato() {
    const overlay = document.getElementById('ns-dialog-mezzo-occupato');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
}

function mostraModaleMezzoOccupato(lista, mezzo, dataIso) {
    const overlay = document.getElementById('ns-dialog-mezzo-occupato');
    const sottotitolo = document.getElementById('ns-dialog-mezzo-occupato-sottotitolo');
    const tbody = document.getElementById('ns-dialog-mezzo-occupato-body');
    const btnChiudi = document.getElementById('ns-dialog-mezzo-occupato-chiudi');
    if (!overlay || !tbody) return;

    const dataIt = dataIsoToItaliana(dataIso) || dataIso;
    if (sottotitolo) {
        sottotitolo.textContent =
            `Il mezzo ${mezzo || ''} è già usato in questi servizi del ${dataIt}:`;
    }

    tbody.innerHTML = lista.map((s) => {
        const ora = escapeHtmlMezzo(s.ora || '—');
        const operatore = escapeHtmlMezzo(s.operatore || '—');
        const trasportato = escapeHtmlMezzo(s.trasportato || '—');
        const comuneDest = escapeHtmlMezzo(s.comune_destinazione || '—');
        const luogoDest = escapeHtmlMezzo(s.luogo_destinazione || '—');
        return `<tr>
            <td>${ora}</td>
            <td>${operatore}</td>
            <td>${trasportato}</td>
            <td>${comuneDest}</td>
            <td>${luogoDest}</td>
        </tr>`;
    }).join('');

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    btnChiudi?.focus();
}

async function controllaMezzoGiaUsatoNellaData() {
    const mezzo = getValore('ns-mezzo');
    const dataPrelievo = getValore('ns-data-prelievo');
    if (!mezzo || !dataPrelievo) return;
    if (!isTauri() || typeof invoke !== 'function') return;

    try {
        const lista = await invoke('get_servizi_mezzo_nella_data', {
            mezzo,
            dataPrelievo,
            escludiIdServizio: null
        });
        if (Array.isArray(lista) && lista.length > 0) {
            mostraModaleMezzoOccupato(lista, mezzo, dataPrelievo);
        }
    } catch (err) {
        console.warn('Controllo mezzo già usato:', err);
    }
}

function setupModaleMezzoOccupato() {
    document.getElementById('ns-dialog-mezzo-occupato-chiudi')
        ?.addEventListener('click', chiudiModaleMezzoOccupato);
}

function aggiornaStatoPulsanteNoteMezzo() {
    const btn = document.getElementById('btn-modifica-note-mezzo');
    if (!btn || noteMezzoInModifica) return;
    const abilitato = Boolean(automezzoSelezionatoCorrente?.id);
    btn.disabled = !abilitato;
    if (abilitato) {
        impostaIconaPulsanteModifica(btn, false);
    }
}

function disabilitaModificaNoteMezzo() {
    const textarea = document.getElementById('ns-note-mezzo');
    const btn = document.getElementById('btn-modifica-note-mezzo');
    noteMezzoInModifica = false;

    if (textarea) {
        textarea.readOnly = true;
        textarea.tabIndex = -1;
        textarea.classList.remove('ns-nota-aggiuntiva-modifica');
    }

    if (btn) {
        impostaIconaPulsanteModifica(btn, false);
        btn.title = 'Modifica note mezzo';
        btn.setAttribute('aria-label', 'Modifica note mezzo');
        btn.disabled = true;
    }
}

function abilitaModificaNoteMezzo() {
    const textarea = document.getElementById('ns-note-mezzo');
    const btn = document.getElementById('btn-modifica-note-mezzo');
    if (!textarea || !btn) return;

    noteMezzoInModifica = true;
    textarea.readOnly = false;
    textarea.tabIndex = 0;
    textarea.classList.add('ns-nota-aggiuntiva-modifica');
    impostaIconaPulsanteModifica(btn, true);
    btn.disabled = false;
    btn.title = 'Salva note mezzo';
    btn.setAttribute('aria-label', 'Salva note mezzo');
    textarea.focus();
}

async function salvaNoteMezzo() {
    const textarea = document.getElementById('ns-note-mezzo');
    const automezzo = automezzoSelezionatoCorrente;
    if (!textarea || !automezzo?.id) return;

    const nuovaNota = textarea.value.trim();
    const payload = {
        ...automezzo,
        note_mezzo: nuovaNota
    };

    if (isTauri() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('save_automezzo', { automezzo: payload });
            automezzoSelezionatoCorrente = { ...automezzo, note_mezzo: nuovaNota };

            const idx = allAutomezzi.findIndex(m => m.id === automezzo.id);
            if (idx >= 0) {
                allAutomezzi[idx].note_mezzo = nuovaNota;
            }
        } catch (error) {
            console.error('Salvataggio note mezzo:', error);
            alert('Errore nel salvataggio delle note mezzo sul database.');
            return;
        }
    } else {
        automezzoSelezionatoCorrente = { ...automezzo, note_mezzo: nuovaNota };
        const idx = allAutomezzi.findIndex(m => normalizzaNumero(m.nr_automezzo) === normalizzaNumero(automezzo.nr_automezzo));
        if (idx >= 0) {
            allAutomezzi[idx].note_mezzo = nuovaNota;
        }
    }

    disabilitaModificaNoteMezzo();
    aggiornaStatoPulsanteNoteMezzo();
}

async function toggleModificaNoteMezzo() {
    const textarea = document.getElementById('ns-note-mezzo');
    if (!textarea || !automezzoSelezionatoCorrente?.id) return;

    if (textarea.readOnly) {
        abilitaModificaNoteMezzo();
        return;
    }

    await salvaNoteMezzo();
}

function setupMezzoListener() {
    document.getElementById('ns-mezzo')?.addEventListener('change', async () => {
        aggiornaDettaglioDaMezzo();
        await controllaMezzoGiaUsatoNellaData();
    });
}

function assicuraOpzioneSelect(selectId, valore) {
    const select = document.getElementById(selectId);
    const target = String(valore || '').trim();
    if (!select || !target) return;

    const esistente = Array.from(select.options).find(
        opt => String(opt.value).trim().toLowerCase() === target.toLowerCase()
    );
    if (!esistente) {
        const opt = document.createElement('option');
        opt.value = target;
        opt.textContent = target;
        select.appendChild(opt);
    }
}

function impostaSelectValore(selectId, valore) {
    const target = String(valore || '').trim();
    if (!target) {
        setValore(selectId, '');
        return;
    }
    assicuraOpzioneSelect(selectId, target);
    const select = document.getElementById(selectId);
    if (!select) return;
    const opzione = Array.from(select.options).find(
        opt => String(opt.value).trim().toLowerCase() === target.toLowerCase()
    );
    setValore(selectId, opzione ? opzione.value : target);
}

function mostraAvviso(messaggio) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('ns-dialog-avviso');
        const msgEl = document.getElementById('ns-dialog-avviso-messaggio');
        const btnOk = document.getElementById('ns-dialog-avviso-ok');

        if (!overlay || !msgEl || !btnOk) {
            window.alert(messaggio);
            resolve();
            return;
        }

        msgEl.textContent = messaggio;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = () => {
            btnOk.disabled = true;
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            btnOk.removeEventListener('click', onOk);
            window.setTimeout(() => {
                btnOk.disabled = false;
                resolve();
            }, 150);
        };

        const onOk = (event) => {
            event.preventDefault();
            event.stopPropagation();
            chiudi();
        };

        btnOk.addEventListener('click', onOk);
    });
}

function chiediSiNo(messaggio) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('ns-dialog-sino');
        const msgEl = document.getElementById('ns-dialog-sino-messaggio');
        const btnSi = document.getElementById('ns-dialog-sino-si');
        const btnNo = document.getElementById('ns-dialog-sino-no');

        if (!overlay || !msgEl || !btnSi || !btnNo) {
            resolve(window.confirm(messaggio));
            return;
        }

        msgEl.textContent = messaggio;
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');

        const chiudi = (risposta) => {
            btnSi.disabled = true;
            btnNo.disabled = true;
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');

            // Breve pausa: evita che il clic "passi" al pulsante sotto e interrompa il flusso.
            window.setTimeout(() => {
                btnSi.disabled = false;
                btnNo.disabled = false;
                resolve(risposta);
            }, 150);
        };

        const onSi = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            chiudi(true);
        };

        const onNo = (event) => {
            event.preventDefault();
            event.stopPropagation();
            btnSi.removeEventListener('click', onSi);
            btnNo.removeEventListener('click', onNo);
            chiudi(false);
        };

        btnSi.addEventListener('click', onSi);
        btnNo.addEventListener('click', onNo);
    });
}

function avvisaSeTrattaRimossa(trattaRimossa) {
    if (!trattaRimossa) return;
    mostraAvviso(messaggioAvvisoDopoRimozioneTratta(trattaRimossa)).catch(() => {});
}

// Pulsanti importo rapido
function onPagamentoGratis() {
    avvisaSeTrattaRimossa(rimuoviTrattaDalForm('ns-tratta-fuori-asti'));
    impostaPagamentoEuro(0);
    setValore('ns-stato-incasso', 'GRATIS');
    impostaSelectValore('ns-tipo-pagamento', 'GRATIS');
}

let pagamentoRapidoInCorso = false;
/** Evita di cancellare la tratta mentre la stiamo applicando al campo donazione */
let ignoraCambioPagamentoPerTratta = false;

function attivaCampoDonazionePagamento() {
    const campo = document.getElementById('ns-pagamento');
    if (!campo) return;
    campo.focus();
    if (typeof campo.select === 'function') {
        campo.select();
    }
}

async function applicaPagamentoConDomande(importo) {
    if (pagamentoRapidoInCorso) return;
    pagamentoRapidoInCorso = true;

    try {
        // Qualsiasi importo rapido cambia la donazione → togli tratta
        avvisaSeTrattaRimossa(rimuoviTrattaDalForm('ns-tratta-fuori-asti'));

        if (importo != null) {
            impostaPagamentoEuro(importo);
        }

        const haPagato = await chiediSiNo('HA PAGATO?');
        setValore('ns-stato-incasso', haPagato ? 'INCASSATO' : 'DA INCASSARE');

        const pagaInContanti = await chiediSiNo('PAGA IN CONTANTI?');
        impostaSelectValore('ns-tipo-pagamento', pagaInContanti ? 'CONTANTI' : 'BONIFICO');

        if (importo == null) {
            await mostraAvviso('INSERISCI CIFRA PAGAMENTO');
            attivaCampoDonazionePagamento();
        }
    } finally {
        pagamentoRapidoInCorso = false;
    }
}

async function onPagamento10() {
    await applicaPagamentoConDomande(10);
}

async function onPagamento15() {
    await applicaPagamentoConDomande(15);
}

async function onPagamentoLibero() {
    await applicaPagamentoConDomande(null);
}

function setupPagamentoQuickButtons() {
    document.getElementById('btn-pagamento-gratis')?.addEventListener('click', onPagamentoGratis);
    document.getElementById('btn-pagamento-10')?.addEventListener('click', onPagamento10);
    document.getElementById('btn-pagamento-15')?.addEventListener('click', onPagamento15);
    document.getElementById('btn-pagamento-libero')?.addEventListener('click', onPagamentoLibero);
    document.getElementById('btn-tratta-fuori-asti')?.addEventListener('click', () => {
        apriFinestraSelezioneTratta();
    });

    const campoPagamento = document.getElementById('ns-pagamento');
    campoPagamento?.addEventListener('focus', preparaCampoPagamentoPerModifica);
    campoPagamento?.addEventListener('blur', () => {
        formattaCampoPagamento();
    });
    campoPagamento?.addEventListener('input', () => {
        if (ignoraCambioPagamentoPerTratta) return;
        avvisaSeTrattaRimossa(rimuoviTrattaDalForm('ns-tratta-fuori-asti'));
    });
    campoPagamento?.addEventListener('change', () => {
        if (ignoraCambioPagamentoPerTratta) return;
        avvisaSeTrattaRimossa(rimuoviTrattaDalForm('ns-tratta-fuori-asti'));
    });
}

async function applicaTotaleTrattaFuoriAsti(payload) {
    if (!payload) return;
    const totaleNum = parseEuroItaliano(payload.totale);

    ignoraCambioPagamentoPerTratta = true;
    try {
        impostaPagamentoEuro(totaleNum);
        attivaCampoDonazionePagamento();

        const dove = await chiediPartenzaOArrivo();
        const conRuolo = { ...payload, ruolo: dove };
        applicaRiepilogoTrattaNelDom(conRuolo, { hiddenId: 'ns-tratta-fuori-asti' });
        if (dove === 'partenza' || dove === 'arrivo') {
            compilaCampiLocalitaDaTratta(conRuolo, dove, 'ns');
        }
    } catch (err) {
        console.warn('Scelta partenza/arrivo tratta:', err);
        applicaRiepilogoTrattaNelDom(payload, { hiddenId: 'ns-tratta-fuori-asti' });
    } finally {
        window.setTimeout(() => {
            ignoraCambioPagamentoPerTratta = false;
        }, 300);
    }
}

async function setupListenerTrattaFuoriAsti() {
    await onTrattaFuoriAstiSelezionata((payload) => {
        applicaTotaleTrattaFuoriAsti(payload);
    });
}

function impostaValoriPredefiniti() {
    const oggi = oggiIso();
    setValore('ns-data-prelievo', oggi);
    setValore('ns-ora-arrivo', oggi);
    const richiedenteDefault = allRichiedenti.find(r => String(r).toUpperCase() === 'SOCIO')
        || allRichiedenti[0]
        || '';
    if (richiedenteDefault) {
        setValore('ns-richiedente', richiedenteDefault);
    }
    setValore('ns-stato-servizio', statoDefaultNuovoServizio());
    setValore('ns-stato-incasso', 'DA INCASSARE');
}

/** Quando cambia DATA PRELIEVO, copia lo stesso valore in DATA DESTINAZIONE */
function setupCopiaDataPrelievoSuDestinazione() {
    const dataPrelievo = document.getElementById('ns-data-prelievo');
    const dataDestinazione = document.getElementById('ns-ora-arrivo');
    if (!dataPrelievo || !dataDestinazione) return;

    dataPrelievo.addEventListener('change', async () => {
        dataDestinazione.value = dataPrelievo.value;
        dataDestinazione.classList.remove('ns-campo-errore');
        // Se un mezzo è già scelto, ricontrolla se è usato in questa nuova data
        if (getValore('ns-mezzo')) {
            await controllaMezzoGiaUsatoNellaData();
        }
    });
}

function unisciIndirizzoECivico(indirizzo, civico) {
    const via = String(indirizzo || '').trim();
    const num = String(civico || '').trim();
    if (!via) return num;
    if (!num) return via;
    if (via.toUpperCase().includes(num.toUpperCase())) return via;
    return `${via} ${num}`;
}

function compilaDaResidenzaTrasportato(comuneFieldId, luogoFieldId) {
    const comune = getValore('ns-res-comune');
    const indirizzo = getValore('ns-res-indirizzo');
    const civico = getValore('ns-res-civico');
    const luogo = unisciIndirizzoECivico(indirizzo, civico);

    if (!comune && !luogo) {
        alert('Seleziona prima un trasportato per caricare i dati di residenza.');
        return;
    }

    if (comune) {
        setValore(comuneFieldId, comune);
        document.getElementById(comuneFieldId)?.classList.remove('ns-campo-errore');
    }

    if (luogo) {
        setValore(luogoFieldId, luogo);
        document.getElementById(luogoFieldId)?.classList.remove('ns-campo-errore');
    }

    if (!comune || !luogo) {
        alert(
            'Dati residenza incompleti.\n\n' +
            (!comune ? '- Comune non disponibile\n' : '') +
            (!luogo ? '- Indirizzo non disponibile\n' : '') +
            '\nSono stati compilati solo i campi disponibili.'
        );
    }
}

function compilaPrelievoDaCasaTrasportato() {
    compilaDaResidenzaTrasportato('ns-comune-prelievo', 'ns-luogo-prelievo');
}

function compilaDestinazioneCasaTrasportato() {
    compilaDaResidenzaTrasportato('ns-comune-destinazione', 'ns-luogo-destinazione');
}

function raccogliDatiForm() {
    return {
        idsocio: getValore('ns-idsocio'),
        socio_trasportato: getValore('ns-trasportato'),
        data_prelievo: dataIsoToItaliana(getValore('ns-data-prelievo')),
        ora_inizio: getValore('ns-ora-inizio'),
        comune_prelievo: getValore('ns-comune-prelievo'),
        luogo_prelievo: getValore('ns-luogo-prelievo'),
        note_prelievo: document.getElementById('ns-note-prelievo')?.value || '',
        richiedente: getValore('ns-richiedente'),
        tipo_servizio: getValore('ns-tipo-servizio'),
        carrozzina: getValore('ns-carrozzina'),
        motivazione: getValore('ns-motivazione'),
        stato_servizio: getValore('ns-stato-servizio'),
        ora_arrivo: dataIsoToItaliana(getValore('ns-ora-arrivo')),
        comune_destinazione: getValore('ns-comune-destinazione'),
        luogo_destinazione: getValore('ns-luogo-destinazione'),
        note_arrivo: document.getElementById('ns-note-arrivo')?.value || '',
        operatore: getValore('ns-operatore'),
        operatore_2: '',
        mezzo: getValore('ns-mezzo'),
        dotazioni: getValore('ns-dotazioni'),
        note_mezzo: document.getElementById('ns-note-mezzo')?.value || '',
        tempo: '',
        km: '',
        stato_incasso: getValore('ns-stato-incasso'),
        tipo_pagamento: getValore('ns-tipo-pagamento'),
        pagamento: (() => {
            const testo = getValore('ns-pagamento').trim();
            if (!testo) return '';
            return formatEuroItaliano(parseEuroItaliano(testo));
        })(),
        data_bonifico: dataIsoToItaliana(getValore('ns-data-bonifico')),
        data_ricevuta: dataIsoToItaliana(getValore('ns-data-ricevuta')),
        numero_ricevuta: getValore('ns-numero-ricevuta'),
        note_fine_servizio: mergeTrattaInNote('', leggiTrattaDalDom('ns-tratta-fuori-asti')),
        archivia: 'NO'
    };
}

async function salvaNuovoServizio() {
    if (!validaCampiObbligatori()) {
        return;
    }

    formattaCampoPagamento();

    const dati = raccogliDatiForm();
    const payload = {
        id: 0,
        data_prelievo: dati.data_prelievo || null,
        idsocio: dati.idsocio || null,
        socio_trasportato: dati.socio_trasportato || null,
        ora_inizio: dati.ora_inizio || null,
        comune_prelievo: dati.comune_prelievo || null,
        luogo_prelievo: dati.luogo_prelievo || null,
        tipo_servizio: dati.tipo_servizio || null,
        carrozzina: dati.carrozzina || null,
        richiedente: dati.richiedente || null,
        motivazione: dati.motivazione || null,
        ora_arrivo: dati.ora_arrivo || null,
        comune_destinazione: dati.comune_destinazione || null,
        luogo_destinazione: dati.luogo_destinazione || null,
        pagamento: dati.pagamento || null,
        stato_incasso: dati.stato_incasso || null,
        operatore: dati.operatore || null,
        operatore_2: dati.operatore_2 || null,
        mezzo: dati.mezzo || null,
        tempo: dati.tempo || null,
        km: dati.km || null,
        km_uscita: null,
        km_rientro: null,
        tipo_pagamento: dati.tipo_pagamento || null,
        data_bonifico: dati.data_bonifico || null,
        data_ricevuta: dati.data_ricevuta || null,
        numero_ricevuta: dati.numero_ricevuta || null,
        stato_servizio: dati.stato_servizio || null,
        note_prelievo: dati.note_prelievo || null,
        note_arrivo: dati.note_arrivo || null,
        note_fine_servizio: dati.note_fine_servizio || null,
        archivia: dati.archivia || 'NO'
    };

    const btnSalva = document.getElementById('btn-salva');
    if (btnSalva) btnSalva.disabled = true;

    try {
        if (!isTauri() || !invoke) {
            await mostraAvviso(
                'Salvataggio disponibile solo nell\'app desktop.\n\n' +
                'Apri AUSER con Tauri (npm run tauri dev) per salvare sul database.'
            );
            return;
        }

        await invoke('init_supabase_from_config').catch(() => {});
        const nuovoId = await invoke('create_servizio', { payload });
        await mostraAvviso(`Servizio n. ${nuovoId} salvato correttamente.`);
        await chiudiPagina();
    } catch (error) {
        console.error('Errore salvataggio nuovo servizio:', error);
        const msg = error?.message || error || 'Errore sconosciuto';
        await mostraAvviso('Errore nel salvataggio del servizio:\n\n' + msg);
    } finally {
        if (btnSalva) btnSalva.disabled = false;
    }
}

function resetForm() {
    const form = document.getElementById('form-nuovo-servizio');
    if (form) form.reset();
    nascondiErrori();
    svuotaDettaglioTrasportato();
    impostaValoriPredefiniti();
    setValore('ns-idsocio', '');
    aggiornaDettaglioDaMezzo();
    applicaRiepilogoTrattaNelDom(null, { hiddenId: 'ns-tratta-fuori-asti' });
}

async function chiudiPagina() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            const win = getCurrent();
            if (win?.label === 'nuovo-servizio') {
                await win.close();
                return;
            }
        } catch (e) {
            console.warn(e);
        }
    }
    window.location.href = 'index.html';
}

function annulla() {
    const compilato = CAMPI_OBBLIGATORI.some(c => getValore(c.id));
    if (compilato && !confirm('Vuoi annullare? Le modifiche non salvate andranno perse.')) {
        return;
    }
    chiudiPagina();
}

async function caricaDatiIniziali() {
    setLoading(true);

    if (isTauri() && invoke) {
        try {
            await invoke('init_supabase_from_config').catch(() => {});
            const [tesserati, automezzi, motivazioni, localitaAuto, richiedenti, tipiPagamento, statiServizio] = await Promise.all([
                invoke('get_all_tesserati'),
                invoke('get_all_automezzi'),
                invoke('get_motivazioni_servizi').catch(() => []),
                invoke('get_localita_autocomplete_servizi').catch(() => ({})),
                invoke('get_all_richiedenti').catch(() => []),
                invoke('get_all_tipi_pagamento').catch(() => []),
                invoke('get_all_stati_servizio').catch(err => {
                    console.warn('Errore caricamento stati servizio da Supabase:', err);
                    return [];
                })
            ]);
            allTesserati = Array.isArray(tesserati) ? tesserati : [];
            console.log(`Nuovo servizio: caricati ${allTesserati.length} tesserati da Supabase`);
            const trasportabili = allTesserati.filter(t => isNonArchiviato(t) && normalizzaTestoRicerca(t.nominativo));
            console.log(`Nuovo servizio: ${trasportabili.length} soci cercabili (non archiviati)`);
            allAutomezzi = Array.isArray(automezzi) ? automezzi : [];
            allMotivazioni = deduplicaMotivazioni(motivazioni);
            console.log(`Nuovo servizio: ${allMotivazioni.length} motivazioni caricate da Supabase`);
            const loc = localitaAuto && typeof localitaAuto === 'object' ? localitaAuto : {};
            allComuniPrelievo = deduplicaComuni(loc.comuni_prelievo || loc.comuniPrelievo || []);
            allLuoghiPrelievo = deduplicaComuni(loc.luoghi_prelievo || loc.luoghiPrelievo || []);
            allComuniDestinazione = deduplicaComuni(loc.comuni_destinazione || loc.comuniDestinazione || []);
            allLuoghiDestinazione = deduplicaComuni(loc.luoghi_destinazione || loc.luoghiDestinazione || []);
            console.log(
                `Nuovo servizio: autocomplete località — comuni_prelievo=${allComuniPrelievo.length}, luoghi_prelievo=${allLuoghiPrelievo.length}, comuni_dest=${allComuniDestinazione.length}, luoghi_dest=${allLuoghiDestinazione.length}`
            );
            allRichiedenti = Array.isArray(richiedenti)
                ? richiedenti.filter(r => String(r || '').trim())
                : [];
            console.log(`Nuovo servizio: ${allRichiedenti.length} richiedenti caricati da Supabase`);
            allTipiPagamento = Array.isArray(tipiPagamento)
                ? tipiPagamento.filter(t => String(t || '').trim())
                : [];
            console.log(`Nuovo servizio: ${allTipiPagamento.length} tipi pagamento caricati da Supabase`);
            allStatiServizio = Array.isArray(statiServizio)
                ? statiServizio.filter(s => String(s || '').trim())
                : [];
            console.log(`Nuovo servizio: ${allStatiServizio.length} stati servizio caricati da Supabase`);
            if (!allStatiServizio.length) {
                console.warn('Stati servizio: nessun valore da Supabase (StatoDelServizio_supa).');
            }
        } catch (error) {
            console.error('Errore caricamento dati:', error);
        }
    } else {
        allTesserati = [
            { idsocio: '101', nominativo: 'ASTUTI GUIDO', attivo: 'SI', archivia: 'false', operatore: 'NO' },
            { idsocio: '102', nominativo: 'ROSSI MARIA', attivo: 'SI', archivia: 'false', operatore: 'SI' }
        ];
        allAutomezzi = [
            {
                id: 1,
                nr_automezzo: '3',
                marca: 'FIAT',
                modello: 'PANDA',
                targa: 'AB123CD',
                dotazione: 'Standard',
                note_mezzo: 'Controllare livello olio prima dell\'uscita.',
                scadenza_ztl: '',
                scadenza_assicurazione: '',
                scadenza_bollo: '',
                in_servizio: 'true'
            }
        ];
        allMotivazioni = [
            'Visita medica',
            'Controllo ambulatoriale',
            'Dialisi',
            'Fisioterapia'
        ];
        allRichiedenti = ['SOCIO', 'COMUNE', 'ALTRI'];
        allTipiPagamento = ['CONTANTI', 'BONIFICO', 'ASSEGNO'];
        allStatiServizio = [];
    }

    allOperatori = allTesserati.filter(t => {
        const op = String(t.operatore || '').trim().toUpperCase();
        return op === 'SI' || op === 'TRUE' || op === '1';
    });

    popolaSelectRichiedenti();
    popolaSelectTipiPagamento();
    popolaSelectStatiServizio();
    popolaSelectOperatori();
    popolaSelectMezzi();
    setupAutocompleteTrasportato();
    setupAutocompleteMotivazione();
    setupAutocompleteComunePrelievo();
    setupAutocompleteLuogoPrelievo();
    setupAutocompleteComuneDestinazione();
    setupAutocompleteLuogoDestinazione();
    setupMezzoListener();
    setupPagamentoQuickButtons();
    impostaValoriPredefiniti();
    svuotaDettaglioTrasportato();
    setLoading(false);
}

function setupEventListeners() {
    document.getElementById('btn-salva')?.addEventListener('click', salvaNuovoServizio);
    document.getElementById('btn-annulla')?.addEventListener('click', annulla);

    document.getElementById('btn-prelievo-da-casa')?.addEventListener('click', compilaPrelievoDaCasaTrasportato);
    document.getElementById('btn-destinazione-casa-trasportato')?.addEventListener('click', compilaDestinazioneCasaTrasportato);
    document.getElementById('btn-modifica-nota-aggiuntiva')?.addEventListener('click', toggleModificaNotaAggiuntiva);
    document.getElementById('btn-modifica-note-mezzo')?.addEventListener('click', toggleModificaNoteMezzo);

    setupCopiaDataPrelievoSuDestinazione();
    setupModaleMezzoOccupato();
    setupNuovoSocioTrasportato({
        getInvoke: () => invoke,
        isTauri,
        onSocioCreato: async (tesserato) => {
            if (!tesserato?.idsocio) return;
            const idx = allTesserati.findIndex(
                (t) => String(t.idsocio || '').trim() === String(tesserato.idsocio).trim()
            );
            if (idx >= 0) {
                allTesserati[idx] = { ...allTesserati[idx], ...tesserato };
            } else {
                allTesserati.push(tesserato);
            }
            // Forza ricaricamento dettaglio anche se stesso ID (improbabile)
            ultimoTrasportatoCaricatoId = null;
            await selezionaTrasportato(tesserato);
        }
    });

    document.getElementById('form-nuovo-servizio')?.addEventListener('submit', (e) => {
        e.preventDefault();
        salvaNuovoServizio();
    });

    CAMPI_OBBLIGATORI.forEach(c => {
        const el = document.getElementById(c.id);
        el?.addEventListener('input', () => el.classList.remove('ns-campo-errore'));
        el?.addEventListener('change', () => el.classList.remove('ns-campo-errore'));
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTauri();
    await setupListenerTrattaFuoriAsti();
    setupEventListeners();
    await caricaDatiIniziali();
});
