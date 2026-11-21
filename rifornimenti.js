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
            <td>${bottoneElimina(row)}</td>
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

let idDaEliminare = null;
let salvataggioInCorso = false;

function escapeAttr(testo) {
    return escapeHtml(testo).replace(/"/g, '&quot;');
}

function isTruthyFlag(valore) {
    const s = String(valore ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'si' || s === 'sì' || s === 'yes' || s === 'y';
}

function oggiIso() {
    const d = new Date();
    const mese = String(d.getMonth() + 1).padStart(2, '0');
    const giorno = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mese}-${giorno}`;
}

function riempiSelect(select, opzioni, voceVuota) {
    if (!select) return;
    const pezzi = [`<option value="">${voceVuota}</option>`];
    opzioni.forEach((op) => {
        const value = String(op.value ?? '').trim();
        const label = String(op.label ?? value).trim();
        if (!value || !label) return;
        pezzi.push(`<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = pezzi.join('');
}

function bottoneElimina(row) {
    const id = String(campo(row, 'id') ?? '').trim();
    const descrizione = [
        formatData(campo(row, 'Data_Rifornimento')),
        testoMezzo(row),
        String(campo(row, 'Distributore') ?? '').trim()
    ].filter(Boolean).join(' — ');
    return `<button type="button" class="rif-x" data-id="${escapeAttr(id)}" data-desc="${escapeAttr(descrizione)}" title="Elimina" aria-label="Elimina rifornimento">X</button>`;
}

function mostraErroreNuovo(testo) {
    const el = document.getElementById('rif-errore');
    if (!el) return;
    el.textContent = testo || '';
    el.hidden = !testo;
}

function aggiornaNuovoDistributore() {
    const scelta = document.getElementById('rif-distributore-scelta');
    const wrap = document.getElementById('rif-nuovo-wrap');
    wrap.hidden = scelta?.value !== '__nuovo__';
}

function opzioniMezzi() {
    return automezzi
        .map((mezzo) => {
            const value = chiave(mezzo.id);
            if (!value) return null;
            return { value, label: etichettaMezzo(mezzo) || `Mezzo ${value}` };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

async function opzioniOperatori() {
    const lista = await invoke('get_all_tesserati');
    return (Array.isArray(lista) ? lista : [])
        .filter((persona) => isTruthyFlag(persona?.operatore))
        .map((persona) => {
            const label = String(persona?.nominativo || '').trim();
            if (!label) return null;
            return { value: label, label };
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label, 'it'));
}

async function opzioniDistributori() {
    const tutti = await invoke('get_rifornimenti');
    const visti = new Set();
    const nomi = [];
    (Array.isArray(tutti) ? tutti : []).forEach((row) => {
        const nome = String(campo(row, 'Distributore') ?? '').trim();
        const chiaveNome = nome.toLocaleLowerCase('it');
        if (!nome || visti.has(chiaveNome)) return;
        visti.add(chiaveNome);
        nomi.push(nome);
    });
    nomi.sort((a, b) => a.localeCompare(b, 'it'));
    return nomi.map((nome) => ({ value: nome, label: nome }));
}

async function apriNuovo() {
    const overlay = document.getElementById('rif-nuovo-overlay');
    if (!overlay || !invoke) return;
    mostraErroreNuovo('');
    const data = document.getElementById('rif-data');
    if (data) data.value = oggiIso();
    ['rif-km', 'rif-litri', 'rif-costo', 'rif-note', 'rif-distributore-nuovo'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    riempiSelect(document.getElementById('rif-mezzo'), opzioniMezzi(), 'Scegli il mezzo…');
    if (filtroMezzo) {
        const mezzo = document.getElementById('rif-mezzo');
        if (mezzo) mezzo.value = filtroMezzo;
    }
    try {
        riempiSelect(document.getElementById('rif-operatore'), await opzioniOperatori(), 'Scegli l’operatore…');
        const distributori = await opzioniDistributori();
        distributori.push({ value: '__nuovo__', label: 'Aggiungi nuovo…' });
        const select = document.getElementById('rif-distributore-scelta');
        riempiSelect(select, distributori, 'Scegli…');
        if (distributori.length === 1) select.value = '__nuovo__';
        aggiornaNuovoDistributore();
    } catch (err) {
        console.error(err);
        mostraErroreNuovo('Non riesco a caricare mezzi o operatori.');
    }
    overlay.hidden = false;
}

function chiudiNuovo() {
    const overlay = document.getElementById('rif-nuovo-overlay');
    if (overlay) overlay.hidden = true;
    mostraErroreNuovo('');
}

function numeroOppureVuoto(raw) {
    const testo = String(raw ?? '').trim().replace(',', '.');
    if (!testo) return { ok: true, valore: null };
    const n = Number(testo);
    if (!Number.isFinite(n) || n < 0) return { ok: false, valore: null };
    return { ok: true, valore: n };
}

function distributoreScelto() {
    const scelta = String(document.getElementById('rif-distributore-scelta')?.value || '').trim();
    if (scelta === '__nuovo__') {
        return String(document.getElementById('rif-distributore-nuovo')?.value || '').trim();
    }
    return scelta;
}

async function salvaNuovo() {
    if (salvataggioInCorso || !invoke) return;
    mostraErroreNuovo('');
    const data = String(document.getElementById('rif-data')?.value || '').trim();
    const mezzo = String(document.getElementById('rif-mezzo')?.value || '').trim();
    const operatore = String(document.getElementById('rif-operatore')?.value || '').trim();
    const distributore = distributoreScelto();
    const km = numeroOppureVuoto(document.getElementById('rif-km')?.value);
    const litri = numeroOppureVuoto(document.getElementById('rif-litri')?.value);
    const costo = numeroOppureVuoto(document.getElementById('rif-costo')?.value);
    const note = String(document.getElementById('rif-note')?.value || '').trim();

    if (!data) return mostraErroreNuovo('Indica la data.');
    if (!mezzo) return mostraErroreNuovo('Scegli il mezzo.');
    if (!operatore) return mostraErroreNuovo('Scegli l’operatore.');
    if (!distributore) return mostraErroreNuovo('Scegli un distributore, oppure scrivine uno nuovo.');
    if (!km.ok || !litri.ok || !costo.ok) {
        return mostraErroreNuovo('Km, litri e costo devono essere numeri, oppure lascia la casella vuota.');
    }

    const btn = document.getElementById('rif-btn-salva');
    salvataggioInCorso = true;
    if (btn) btn.disabled = true;
    try {
        await invoke('create_rifornimento', {
            payload: {
                data,
                mezzo,
                operatore,
                distributore,
                km: km.valore,
                litri: litri.valore,
                costo: costo.valore,
                note: note || null
            }
        });
        chiudiNuovo();
        await carica();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Rifornimento salvato';
    } catch (err) {
        console.error(err);
        mostraErroreNuovo(String(err?.message || err || 'Non riesco a salvare.'));
    } finally {
        salvataggioInCorso = false;
        if (btn) btn.disabled = false;
    }
}

function chiediEliminazione(id, descrizione) {
    idDaEliminare = id;
    const testo = document.getElementById('rif-conferma-testo');
    if (testo) testo.textContent = descrizione || 'Questa riga verrà tolta dall’elenco.';
    const overlay = document.getElementById('rif-conferma-overlay');
    if (overlay) overlay.hidden = false;
}

function chiudiConferma() {
    idDaEliminare = null;
    const overlay = document.getElementById('rif-conferma-overlay');
    if (overlay) overlay.hidden = true;
}

async function confermaEliminazione() {
    if (!invoke || idDaEliminare == null) return;
    const id = Number(idDaEliminare);
    const btn = document.getElementById('rif-conferma-ok');
    if (btn) btn.disabled = true;
    try {
        await invoke('delete_rifornimento', { id });
        chiudiConferma();
        await carica();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Rifornimento eliminato';
    } catch (err) {
        console.error(err);
        chiudiConferma();
        const stato = document.getElementById('rif-stato');
        if (stato) stato.textContent = 'Non riesco a eliminare il rifornimento.';
    } finally {
        if (btn) btn.disabled = false;
    }
}

document.getElementById('btn-nuovo-rifornimento')?.addEventListener('click', () => {
    apriNuovo();
});
document.getElementById('rif-nuovo-chiudi')?.addEventListener('click', chiudiNuovo);
document.getElementById('rif-btn-annulla')?.addEventListener('click', chiudiNuovo);
document.getElementById('rif-btn-salva')?.addEventListener('click', salvaNuovo);
document.getElementById('rif-distributore-scelta')?.addEventListener('change', aggiornaNuovoDistributore);
document.getElementById('rif-nuovo-overlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'rif-nuovo-overlay') chiudiNuovo();
});
document.getElementById('rif-conferma-annulla')?.addEventListener('click', chiudiConferma);
document.getElementById('rif-conferma-ok')?.addEventListener('click', confermaEliminazione);
document.getElementById('rif-conferma-overlay')?.addEventListener('click', (event) => {
    if (event.target?.id === 'rif-conferma-overlay') chiudiConferma();
});
document.getElementById('rif-corpo')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.rif-x');
    if (!btn) return;
    const id = String(btn.dataset.id || '').trim();
    if (!id) return;
    chiediEliminazione(id, btn.dataset.desc || '');
});

document.getElementById('btn-mostra-tutti')?.addEventListener('click', mostraTutti);
document.getElementById('btn-torna')?.addEventListener('click', () => {
    tornaElencoMezzi();
});

leggiFiltroDaUrl();
initTauri().then(() => carica());
