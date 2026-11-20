// Maschera di inserimento rifornimento, usata dal calendario web sul telefono.

let getClient = null;
let nomeTabella = 'Rifornimenti';
let getMezzi = () => [];
let getOperatori = () => [];
let salvataggioInCorso = false;
let messaggioOkTimer = 0;

function $(id) {
    return document.getElementById(id);
}

function mostraErrore(testo) {
    const el = $('rif-errore');
    if (!el) return;
    el.textContent = testo || '';
    el.hidden = !testo;
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
    (opzioni || []).forEach((op) => {
        const value = String(op?.value ?? '').trim();
        const label = String(op?.label ?? value).trim();
        if (!value || !label) return;
        pezzi.push(`<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`);
    });
    select.innerHTML = pezzi.join('');
}

function escapeHtml(testo) {
    return String(testo)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttr(testo) {
    return escapeHtml(testo).replace(/"/g, '&quot;');
}

function numeroOppureVuoto(raw) {
    const testo = String(raw ?? '').trim().replace(',', '.');
    if (!testo) return { ok: true, valore: null };
    const n = Number(testo);
    if (!Number.isFinite(n) || n < 0) return { ok: false, valore: null };
    return { ok: true, valore: n };
}

function aggiornaCampoNuovoDistributore() {
    const scelta = $('rif-distributore-scelta');
    const wrap = $('rif-nuovo-wrap');
    const input = $('rif-distributore-nuovo');
    if (!scelta || !wrap) return;
    const nuovo = scelta.value === '__nuovo__';
    wrap.hidden = !nuovo;
    if (nuovo) input?.focus();
}

async function caricaDistributori() {
    const select = $('rif-distributore-scelta');
    if (!select) return;
    const nomi = [];
    const client = typeof getClient === 'function' ? getClient() : null;
    if (client) {
        const { data, error } = await client
            .from(nomeTabella)
            .select('Distributore')
            .limit(1000);
        if (!error && Array.isArray(data)) {
            const visti = new Set();
            data.forEach((row) => {
                const nome = String(row?.Distributore ?? row?.distributore ?? '').trim();
                const chiave = nome.toLocaleLowerCase('it');
                if (!nome || visti.has(chiave)) return;
                visti.add(chiave);
                nomi.push(nome);
            });
            nomi.sort((a, b) => a.localeCompare(b, 'it'));
        }
    }
    const opzioni = nomi.map((nome) => ({ value: nome, label: nome }));
    opzioni.push({ value: '__nuovo__', label: 'Aggiungi nuovo…' });
    riempiSelect(select, opzioni, 'Scegli…');
    if (!nomi.length) select.value = '__nuovo__';
    aggiornaCampoNuovoDistributore();
}

function preparaMaschera() {
    mostraErrore('');
    const data = $('rif-data');
    if (data) data.value = oggiIso();
    riempiSelect($('rif-mezzo'), getMezzi(), 'Scegli il mezzo…');
    riempiSelect($('rif-operatore'), getOperatori(), 'Scegli l’operatore…');
    const km = $('rif-km');
    const litri = $('rif-litri');
    const costo = $('rif-costo');
    const note = $('rif-note');
    const nuovo = $('rif-distributore-nuovo');
    if (km) km.value = '';
    if (litri) litri.value = '';
    if (costo) costo.value = '';
    if (note) note.value = '';
    if (nuovo) nuovo.value = '';
    caricaDistributori();
}

function apriMaschera() {
    const overlay = $('rif-mobile-overlay');
    if (!overlay) return;
    preparaMaschera();
    overlay.hidden = false;
}

function chiudiMaschera() {
    const overlay = $('rif-mobile-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    mostraErrore('');
}

function distributoreScelto() {
    const scelta = String($('rif-distributore-scelta')?.value || '').trim();
    if (scelta === '__nuovo__') {
        return String($('rif-distributore-nuovo')?.value || '').trim();
    }
    return scelta;
}

function messaggioPermesso(err) {
    const testo = String(err?.message || err || '');
    if (/anteprima/i.test(testo)) return testo;
    if (/42501|row-level|permission|policy|42501/i.test(testo)) {
        return 'Salvataggio non consentito. In Supabase va eseguito una volta il file supabase-rifornimenti-permesso.sql.';
    }
    if (/rifornimenti|schema cache|PGRST205|42P01/i.test(testo)) {
        return 'La tabella Rifornimenti non è raggiungibile dal calendario. Controlla il nome in config.public.json.';
    }
    return testo ? `Non riesco a salvare. ${testo}` : 'Non riesco a salvare il rifornimento.';
}

function mostraSalvato() {
    const el = $('rif-mobile-ok');
    if (!el) return;
    el.hidden = false;
    window.clearTimeout(messaggioOkTimer);
    messaggioOkTimer = window.setTimeout(() => {
        el.hidden = true;
    }, 2500);
}

async function salvaRifornimento() {
    if (salvataggioInCorso) return;
    mostraErrore('');

    const data = String($('rif-data')?.value || '').trim();
    const mezzo = String($('rif-mezzo')?.value || '').trim();
    const operatore = String($('rif-operatore')?.value || '').trim();
    const distributore = distributoreScelto();
    const km = numeroOppureVuoto($('rif-km')?.value);
    const litri = numeroOppureVuoto($('rif-litri')?.value);
    const costo = numeroOppureVuoto($('rif-costo')?.value);
    const note = String($('rif-note')?.value || '').trim();

    if (!data) {
        mostraErrore('Indica la data del rifornimento.');
        return;
    }
    if (!mezzo) {
        mostraErrore('Scegli il mezzo.');
        return;
    }
    if (!operatore) {
        mostraErrore('Scegli l’operatore.');
        return;
    }
    if (!distributore) {
        mostraErrore('Scegli un distributore, oppure scrivine uno nuovo.');
        return;
    }
    if (!km.ok || !litri.ok || !costo.ok) {
        mostraErrore('Km, litri e costo devono essere numeri, oppure lascia la casella vuota.');
        return;
    }

    const client = typeof getClient === 'function' ? getClient() : null;
    if (!client) {
        mostraErrore('Apri la maschera dopo aver fatto l’accesso al calendario.');
        return;
    }

    const body = {
        Data_Rifornimento: data,
        Mezzo: mezzo,
        Operatore: operatore,
        Distributore: distributore
    };
    if (km.valore != null) body.KM_Rifornimento = km.valore;
    if (litri.valore != null) body.Litri = litri.valore;
    if (costo.valore != null) body.Costo_Rifornimento = costo.valore;
    if (note) body.Note_Rifornimento = note;

    const btn = $('rif-btn-salva');
    salvataggioInCorso = true;
    if (btn) btn.disabled = true;
    try {
        const { error } = await client.from(nomeTabella).insert(body);
        if (error) throw error;
        chiudiMaschera();
        mostraSalvato();
    } catch (err) {
        console.error(err);
        mostraErrore(messaggioPermesso(err));
    } finally {
        salvataggioInCorso = false;
        if (btn) btn.disabled = false;
    }
}

function collegaPulsanti() {
    if (document.body.dataset.rifMobileBound === '1') return;
    document.body.dataset.rifMobileBound = '1';

    $('btn-apri-rifornimento')?.addEventListener('click', apriMaschera);
    $('rif-btn-annulla')?.addEventListener('click', chiudiMaschera);
    $('rif-mobile-chiudi')?.addEventListener('click', chiudiMaschera);
    $('rif-btn-salva')?.addEventListener('click', salvaRifornimento);
    $('rif-distributore-scelta')?.addEventListener('change', aggiornaCampoNuovoDistributore);
    $('rif-mobile-overlay')?.addEventListener('click', (event) => {
        if (event.target?.id === 'rif-mobile-overlay') chiudiMaschera();
    });
}

export function avviaMascheraRifornimento(opzioni) {
    getClient = opzioni?.getClient || null;
    nomeTabella = String(opzioni?.nomeTabella || 'Rifornimenti').trim() || 'Rifornimenti';
    getMezzi = typeof opzioni?.getMezzi === 'function' ? opzioni.getMezzi : () => [];
    getOperatori = typeof opzioni?.getOperatori === 'function' ? opzioni.getOperatori : () => [];
    collegaPulsanti();
}

collegaPulsanti();
