// Elenco manutenzioni stampabile — tabella suddivisa per anno

let invoke = null;
/** @type {Array<object>} */
let tutteManutenzioni = [];
let etichettaMezzoCorrente = '';

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

function getIdMezzoFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('idMezzo') || params.get('id_mezzo') || params.get('mezzoId') || '').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function getMezzoFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return String(params.get('mezzo') || '').trim();
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatValore(v) {
    if (v === null || v === undefined) return '—';
    const s = String(v).trim();
    return s || '—';
}

function etichettaDaAutomezzo(m) {
    if (!m) return '';
    const n = m.numero_mezzo ?? m.NumeroMezzo ?? m.id ?? '';
    const nome = [m.marca, m.modello].filter(Boolean).join(' ');
    const targa = String(m.targa || '').trim();
    if (nome && targa) return `N.${n} — ${nome} (${targa})`;
    if (nome) return `N.${n} — ${nome}`;
    if (targa) return `N.${n} — ${targa}`;
    return n ? `N. mezzo ${n}` : '';
}

async function risolviEtichettaMezzo(idMezzo, fallback) {
    if (fallback) return fallback;
    if (!invoke || !idMezzo) return idMezzo ? `Mezzo id ${idMezzo}` : '—';
    try {
        const list = await invoke('get_all_automezzi');
        const trovato = (Array.isArray(list) ? list : []).find(
            (m) => String(m.id) === String(idMezzo)
        );
        return etichettaDaAutomezzo(trovato) || `Mezzo id ${idMezzo}`;
    } catch (err) {
        console.warn('Risoluzione mezzo:', err);
        return `Mezzo id ${idMezzo}`;
    }
}

/** Data da usare in elenco: esecuzione se c'è, altrimenti data prevista. */
function dataElenco(m) {
    const data = String(m?.data || '').trim();
    if (data) return data;
    return String(m?.data_prevista || '').trim();
}

/** Estrae anno da gg/mm/aaaa oppure yyyy-mm-dd. */
function annoDaData(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})-\d{2}-\d{2}/);
    if (iso) return Number(iso[1]);
    const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (it) return Number(it[3]);
    return null;
}

function parseDataSortKey(raw) {
    const s = String(raw || '').trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
    const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (it) {
        const gg = it[1].padStart(2, '0');
        const mm = it[2].padStart(2, '0');
        return `${it[3]}${mm}${gg}`;
    }
    return '00000000';
}

function raggruppaPerAnno(rows) {
    const map = new Map();
    for (const m of rows) {
        const anno = annoDaData(dataElenco(m));
        const key = anno || 'senza-anno';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(m);
    }
    for (const list of map.values()) {
        list.sort((a, b) => parseDataSortKey(dataElenco(a)).localeCompare(parseDataSortKey(dataElenco(b))));
    }
    const keys = [...map.keys()].sort((a, b) => {
        if (a === 'senza-anno') return 1;
        if (b === 'senza-anno') return -1;
        return Number(b) - Number(a);
    });
    return keys.map((k) => ({ anno: k, rows: map.get(k) }));
}

function anniDisponibili(rows) {
    const set = new Set();
    for (const m of rows) {
        const a = annoDaData(dataElenco(m));
        if (a) set.add(a);
    }
    return [...set].sort((a, b) => b - a);
}

function popolaFiltroAnno(anni) {
    const sel = document.getElementById('filtro-anno');
    if (!sel) return;
    const corrente = sel.value || 'tutti';
    sel.innerHTML = '<option value="tutti">Tutti</option>';
    for (const a of anni) {
        const opt = document.createElement('option');
        opt.value = String(a);
        opt.textContent = String(a);
        sel.appendChild(opt);
    }
    if ([...sel.options].some((o) => o.value === corrente)) {
        sel.value = corrente;
    } else {
        sel.value = 'tutti';
    }
}

function rigaTabella(m) {
    const id = m.id ?? m.IdManutenzione ?? '';
    const tip = formatValore(m.tipologia);
    const data = formatValore(dataElenco(m));
    const kmPrev = String(tip).toLowerCase() === 'km'
        ? formatValore(m.km_previsto)
        : '—';
    const presso = formatValore(m.eseguita_presso);
    const pagato = formatValore(m.pagato);
    const motiv = formatValore(m.motivazione);
    const note = formatValore(m.note_manutenzione);

    return `
        <tr>
            <td>${escapeHtml(id)}</td>
            <td>${escapeHtml(data)}</td>
            <td>${escapeHtml(tip)}</td>
            <td>${escapeHtml(kmPrev)}</td>
            <td>${escapeHtml(presso)}</td>
            <td>${escapeHtml(pagato)}</td>
            <td>${escapeHtml(motiv)}</td>
            <td>${escapeHtml(note)}</td>
        </tr>
    `;
}

function tabellaHtml(rows) {
    const body = rows.map(rigaTabella).join('');
    return `
        <table class="em-tabella">
            <thead>
                <tr>
                    <th class="em-col-n">N. manut.</th>
                    <th class="em-col-data">Data</th>
                    <th class="em-col-tipo">Tipo</th>
                    <th class="em-col-km">Km previsti</th>
                    <th class="em-col-presso">Eseguita presso</th>
                    <th class="em-col-pagato">Pagato</th>
                    <th class="em-col-motiv">Motivazione</th>
                    <th class="em-col-note">Note</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        </table>
    `;
}

function renderElenco() {
    const contenuto = document.getElementById('em-contenuto');
    const meta = document.getElementById('em-meta');
    const status = document.getElementById('em-status');
    const filtro = document.getElementById('filtro-anno')?.value || 'tutti';

    let rows = Array.isArray(tutteManutenzioni) ? [...tutteManutenzioni] : [];
    if (filtro !== 'tutti') {
        const annoFiltro = Number(filtro);
        rows = rows.filter((m) => annoDaData(dataElenco(m)) === annoFiltro);
    }

    const gruppi = raggruppaPerAnno(rows);
    if (meta) {
        const etichettaFiltro = filtro === 'tutti' ? 'tutti gli anni' : `anno ${filtro}`;
        meta.textContent = `${rows.length} manutenzion${rows.length === 1 ? 'e' : 'i'} — ${etichettaFiltro}`;
    }
    if (status) {
        status.textContent = `${rows.length} righe`;
    }

    if (!contenuto) return;
    if (!rows.length) {
        contenuto.innerHTML = '<div class="em-vuoto">Nessuna manutenzione completata da mostrare per questo filtro.</div>';
        return;
    }

    contenuto.innerHTML = gruppi.map((g) => {
        const titolo = g.anno === 'senza-anno' ? 'Senza anno' : `Anno ${g.anno}`;
        return `
            <section class="em-anno-blocco">
                <h2 class="em-anno-titolo">${escapeHtml(titolo)} (${g.rows.length})</h2>
                ${tabellaHtml(g.rows)}
            </section>
        `;
    }).join('');
}

async function caricaElenco() {
    const loading = document.getElementById('em-loading');
    const errore = document.getElementById('em-errore');
    const page = document.getElementById('em-page');
    const status = document.getElementById('em-status');
    const mezzoEl = document.getElementById('em-mezzo');

    const idMezzo = getIdMezzoFromUrl();
    if (!idMezzo) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'ID mezzo mancante o non valido.';
        }
        return;
    }

    try {
        if (!invoke) await initTauri();
        if (!invoke || !isTauri()) {
            throw new Error('Apri questa pagina dall\'app AUSER');
        }

        await invoke('init_supabase_from_config').catch(() => {});
        etichettaMezzoCorrente = await risolviEtichettaMezzo(idMezzo, getMezzoFromUrl());
        if (mezzoEl) mezzoEl.textContent = etichettaMezzoCorrente;

        const rows = await invoke('get_manutenzioni_mezzo', {
            idMezzo,
            id_mezzo: idMezzo
        });
        // Solo manutenzioni completate (eseguite)
        tutteManutenzioni = (Array.isArray(rows) ? rows : []).filter((m) => {
            const stato = String(m?.stato || '').trim().toLowerCase();
            return stato === 'eseguita';
        });
        popolaFiltroAnno(anniDisponibili(tutteManutenzioni));
        renderElenco();

        if (loading) loading.hidden = true;
        if (errore) errore.hidden = true;
        if (page) page.hidden = false;
        document.title = `Manutenzioni — ${etichettaMezzoCorrente}`;
        if (status) status.textContent = `${tutteManutenzioni.length} manutenzioni caricate`;
    } catch (error) {
        console.error('Errore caricamento elenco manutenzioni:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error?.message || error}`;
        }
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            await getCurrent().close();
            return;
        } catch (err) {
            console.warn('Chiusura finestra:', err);
        }
    }
    window.close();
}

document.getElementById('btn-chiudi')?.addEventListener('click', () => {
    chiudiFinestra();
});
document.getElementById('btn-stampa')?.addEventListener('click', () => {
    window.print();
});
document.getElementById('filtro-anno')?.addEventListener('change', () => {
    renderElenco();
});

document.addEventListener('DOMContentLoaded', () => {
    caricaElenco();
});
