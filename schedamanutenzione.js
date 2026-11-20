// Scheda Manutenzione — popup report A4 stampabile

let invoke;

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

function getIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('id') || '').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function getMezzoFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return String(params.get('mezzo') || '').trim();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const s = value == null ? '' : String(value).trim();
    el.textContent = s || '—';
}

function statoLabel(stato) {
    const s = String(stato || '').trim().toLowerCase();
    if (s === 'eseguita') return 'Eseguita';
    if (s === 'annullata') return 'Annullata';
    if (s === 'aperta') return 'Aperta';
    return s ? s : '—';
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

async function caricaScheda() {
    const loading = document.getElementById('sm-loading');
    const errore = document.getElementById('sm-errore');
    const page = document.getElementById('sm-page');
    const status = document.getElementById('sm-status');

    const id = getIdFromUrl();
    if (!id) {
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = 'ID manutenzione mancante o non valido.';
        }
        return;
    }

    try {
        if (!invoke) await initTauri();
        if (!invoke || !isTauri()) {
            throw new Error('Apri questa scheda dall\'app AUSER');
        }

        await invoke('init_supabase_from_config').catch(() => {});
        const m = await invoke('get_manutenzione', { id });
        if (!m || !m.id) throw new Error('Manutenzione non trovata');

        const mezzoLabel = await risolviEtichettaMezzo(m.id_mezzo, getMezzoFromUrl());
        const tip = String(m.tipologia || '').trim();
        const isKm = tip.toLowerCase() === 'km';

        setText('sm-mezzo', mezzoLabel);
        setText('sm-id', m.id);
        setText('sm-stato', statoLabel(m.stato));
        setText('sm-data', m.data);
        setText('sm-tipologia', tip || '—');
        setText('sm-motivazione', m.motivazione);
        setText('sm-km-rif', m.km_riferimento);
        setText('sm-delta-km', m.delta_chilometri);
        setText('sm-km-prev', m.km_previsto);
        setText('sm-preavviso-km', m.preavviso);
        setText('sm-delta-giorni', m.delta_giorni);
        setText('sm-data-prev', m.data_prevista);
        setText('sm-preavviso-gg', m.preavviso);
        setText('sm-presso', m.eseguita_presso);
        setText('sm-operatore', m.operatore);
        setText('sm-pagato', m.pagato);
        setText('sm-note', m.note_manutenzione);

        const sezKm = document.getElementById('sm-sezione-km');
        const sezGg = document.getElementById('sm-sezione-giorni');
        if (sezKm) sezKm.hidden = !isKm;
        if (sezGg) sezGg.hidden = isKm;

        const badge = document.getElementById('sm-stato-badge');
        if (badge) badge.textContent = statoLabel(m.stato);

        if (loading) loading.hidden = true;
        if (errore) errore.hidden = true;
        if (page) page.hidden = false;
        if (status) status.textContent = `Manutenzione n. ${m.id}`;
        document.title = `Scheda manutenzione ${m.id} - AUSER Asti`;
    } catch (error) {
        console.error('Errore caricamento scheda manutenzione:', error);
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
    if (window.opener) window.close();
    else window.history.back();
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('btn-stampa')?.addEventListener('click', () => window.print());
    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    await caricaScheda();
});
