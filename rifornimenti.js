// Rifornimenti — legge la tabella Supabase Rifornimenti.
import { etichettaMezzo, trovaAutomezzo } from './mezzo-etichetta.js';

let invoke = null;
let automezzi = [];
let filtroMezzo = '';
let etichettaFiltro = '';

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

function leggiFiltroDaUrl() {
    const params = new URLSearchParams(window.location.search);
    filtroMezzo = String(params.get('mezzo') || '').trim();
    etichettaFiltro = String(params.get('etichetta') || '').trim();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function chiave(val) {
    const s = String(val ?? '').trim();
    if (!s) return '';
    return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function campo(row, nome) {
    if (!row || typeof row !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(row, nome) && row[nome] != null) {
        return row[nome];
    }
    const key = Object.keys(row).find((k) => k.toLowerCase() === nome.toLowerCase());
    if (!key || row[key] == null) return '';
    return row[key];
}

function formatData(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const iso = s.slice(0, 10);
    const matchIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (matchIso) return `${matchIso[3]}/${matchIso[2]}/${matchIso[1]}`;
    return s;
}

function chiaveData(raw) {
    const s = String(raw ?? '').trim();
    const iso = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const it = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
    if (it) return `${it[3]}-${it[2]}-${it[1]}`;
    return '';
}

function numero(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function formatNumero(raw, decimali) {
    const n = numero(raw);
    if (n == null) return '';
    const rounded = Math.round(n * 10 ** decimali) / 10 ** decimali;
    if (decimali === 0 || Number.isInteger(rounded)) return String(rounded);
    return rounded.toLocaleString('it-IT', {
        minimumFractionDigits: decimali,
        maximumFractionDigits: decimali
    });
}

function formatEuro(raw) {
    const testo = formatNumero(raw, 2);
    return testo ? `${testo} €` : '';
}

function stessoMezzo(valoreRiga, idMezzo) {
    const salvato = chiave(valoreRiga);
    const cercato = chiave(idMezzo);
    if (!salvato || !cercato) return false;
    if (salvato === cercato) return true;
    const auto = trovaAutomezzo(automezzi, cercato);
    if (!auto) return false;
    return salvato === chiave(auto.nr_automezzo) || salvato === chiave(auto.id);
}

function testoMezzo(row) {
    const salvato = campo(row, 'Mezzo');
    const auto = trovaAutomezzo(automezzi, salvato);
    if (auto) return etichettaMezzo(auto);
    return String(salvato ?? '').trim();
}

function aggiornaIntestazione() {
    const sotto = document.getElementById('rif-sottotitolo');
    const btnTutti = document.getElementById('btn-mostra-tutti');
    if (filtroMezzo) {
        const nome = etichettaFiltro || testoMezzo({ Mezzo: filtroMezzo }) || `Mezzo ${filtroMezzo}`;
        if (sotto) sotto.textContent = `Mezzo: ${nome}`;
        if (btnTutti) btnTutti.disabled = false;
    } else {
        if (sotto) sotto.textContent = 'Tutti i mezzi';
        if (btnTutti) btnTutti.disabled = true;
    }
}

function mostraMessaggio(testo, errore) {
    const el = document.getElementById('rif-messaggio');
    const wrap = document.getElementById('rif-tabella-wrap');
    const footer = document.getElementById('rif-footer');
    if (wrap) wrap.hidden = true;
    if (footer) footer.hidden = true;
    if (!el) return;
    el.hidden = false;
    el.textContent = testo;
    el.classList.toggle('rif-errore', Boolean(errore));
}

function messaggioErrore(err) {
    const testo = String(err?.message || err || '');
    if (/rifornimenti|schema cache|PGRST205|does not exist|42P01/i.test(testo)) {
        return 'La tabella Rifornimenti non è leggibile. Controlla che esista in Supabase e che l\'app possa leggerla.';
    }
    return `Non riesco a caricare i rifornimenti. ${testo}`;
}

function ordina(righe) {
    return righe.slice().sort((a, b) => {
        const da = chiaveData(campo(a, 'Data_Rifornimento'));
        const db = chiaveData(campo(b, 'Data_Rifornimento'));
        if (da !== db) {
            if (!da) return 1;
            if (!db) return -1;
            return db.localeCompare(da);
        }
        return (Number(campo(b, 'id')) || 0) - (Number(campo(a, 'id')) || 0);
    });
}

function aggiornaFooter(righe) {
    const footer = document.getElementById('rif-footer');
    if (footer) footer.hidden = false;
    let litri = 0;
    let costo = 0;
    righe.forEach((row) => {
        const l = numero(campo(row, 'Litri'));
        const c = numero(campo(row, 'Costo_Rifornimento'));
        if (l != null) litri += l;
        if (c != null) costo += c;
    });
    const n = document.getElementById('rif-totale-n');
    const elLitri = document.getElementById('rif-totale-litri');
    const elCosto = document.getElementById('rif-totale-costo');
    if (n) n.textContent = String(righe.length);
    if (elLitri) elLitri.textContent = formatNumero(litri, 2) || '0';
    if (elCosto) elCosto.textContent = formatEuro(costo) || '0,00 €';
}

function disegnaRighe(righe) {
    const corpo = document.getElementById('rif-corpo');
    const wrap = document.getElementById('rif-tabella-wrap');
    const messaggio = document.getElementById('rif-messaggio');
    const stato = document.getElementById('rif-stato');
    if (!corpo) return;

    if (!righe.length) {
        mostraMessaggio(filtroMezzo
            ? 'Nessun rifornimento per questo mezzo.'
            : 'Nessun rifornimento.');
        if (stato) stato.textContent = '0 rifornimenti';
        return;
    }

    corpo.innerHTML = righe.map((row) => `
        <tr>
            <td class="rif-data">${escapeHtml(formatData(campo(row, 'Data_Rifornimento')))}</td>
            <td>${escapeHtml(testoMezzo(row))}</td>
            <td>${escapeHtml(campo(row, 'Operatore'))}</td>
            <td>${escapeHtml(campo(row, 'Distributore'))}</td>
            <td class="rif-num">${escapeHtml(formatNumero(campo(row, 'KM_Rifornimento'), 0))}</td>
            <td class="rif-num">${escapeHtml(formatNumero(campo(row, 'Litri'), 2))}</td>
            <td class="rif-num">${escapeHtml(formatEuro(campo(row, 'Costo_Rifornimento')))}</td>
            <td class="rif-note">${escapeHtml(campo(row, 'Note_Rifornimento'))}</td>
        </tr>
    `).join('');

    if (messaggio) messaggio.hidden = true;
    if (wrap) wrap.hidden = false;
    aggiornaFooter(righe);
    if (stato) {
        stato.textContent = righe.length === 1 ? '1 rifornimento' : `${righe.length} rifornimenti`;
    }
}

async function caricaAutomezzi() {
    automezzi = [];
    if (!invoke) return;
    try {
        const list = await invoke('get_all_automezzi');
        automezzi = Array.isArray(list) ? list : [];
    } catch (err) {
        console.warn('Elenco mezzi non disponibile per le etichette:', err);
    }
}

async function scaricaRighe() {
    await invoke('init_supabase_from_config').catch(() => {});
    if (filtroMezzo) {
        const filtrate = await invoke('get_rifornimenti', { mezzo: filtroMezzo });
        if (Array.isArray(filtrate) && filtrate.length) return filtrate;
        const tutti = await invoke('get_rifornimenti');
        return (Array.isArray(tutti) ? tutti : []).filter((row) => stessoMezzo(campo(row, 'Mezzo'), filtroMezzo));
    }
    const tutti = await invoke('get_rifornimenti');
    return Array.isArray(tutti) ? tutti : [];
}

async function carica() {
    aggiornaIntestazione();
    mostraMessaggio('Caricamento rifornimenti…');
    if (!isTauri() || !invoke) {
        mostraMessaggio('Apri questa pagina dall\'elenco mezzi, dentro l\'app.');
        return;
    }
    try {
        await caricaAutomezzi();
        aggiornaIntestazione();
        disegnaRighe(ordina(await scaricaRighe()));
    } catch (err) {
        console.error(err);
        mostraMessaggio(messaggioErrore(err), true);
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = '';
    }
}

function mostraTutti() {
    filtroMezzo = '';
    etichettaFiltro = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('mezzo');
    url.searchParams.delete('etichetta');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    carica();
}

async function tornaElencoMezzi() {
    if (isTauri()) {
        try {
            const { WebviewWindow, getCurrent } = await import('@tauri-apps/api/window');
            const elenco = WebviewWindow.getByLabel('elenco-mezzi');
            if (elenco) {
                await elenco.show();
                await elenco.setFocus();
            }
            await getCurrent().close();
            return;
        } catch (err) {
            console.warn('Chiusura finestra rifornimenti:', err);
        }
    }
    if (window.opener) {
        window.close();
        return;
    }
    window.location.href = 'ELENCOMEZZI.html';
}

document.getElementById('btn-mostra-tutti')?.addEventListener('click', mostraTutti);
document.getElementById('btn-torna')?.addEventListener('click', () => {
    tornaElencoMezzi();
});

leggiFiltroDaUrl();
initTauri().then(() => carica());
