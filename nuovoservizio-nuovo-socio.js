/**
 * Modale "Nuovo socio" da Nuovo Servizio (pulsante accanto a TRASPORTATO).
 * Non-admin: solo nominativo, tipologia fissa NUOVO.
 * Admin: può scegliere la tipologia; opzione aggiuntiva per anagrafica + tesseramento.
 */
import { isAdmin, leggiSessione } from './auth-session.js';

const TIPOLOGIA_NUOVO = 'NUOVO';

function isoToItalian(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const parts = iso.trim().split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

function scadenzaFromAnno(anno) {
    const a = String(anno || '').trim();
    if (!a) return '';
    return `31/12/${a}`;
}

function val(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return String(el.value || '').trim();
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mostraErrore(msg) {
    const el = document.getElementById('ns-modal-nuovo-socio-errore');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

function anagraficaToTesserato(anagrafica, tesseramento) {
    const a = anagrafica || {};
    const t = tesseramento || null;
    return {
        id: a.id || 0,
        idsocio: String(a.idsocio || ''),
        nominativo: a.nominativo || '',
        codicefiscale: a.codicefiscale || '',
        numerotessera: t?.numero || '',
        scadenzatessera: t?.scadenza || (t?.anno ? scadenzaFromAnno(t.anno) : ''),
        telefono: a.telefono || '',
        tipologiasocio: a.tipologiasocio || TIPOLOGIA_NUOVO,
        operatore: a.operatore ? 'SI' : 'NO',
        attivo: a.attivo === false ? 'NO' : 'SI',
        archivia: a.archivia ? 'true' : 'false',
        disponibilita: a.disponibilita || '',
        notaaggiuntiva: a.notaaggiuntiva || '',
        sesso: a.sesso || '',
        nascita_comune: a.nascita_comune || '',
        nascita_data: a.nascita_data || '',
        residenza_indirizzo: a.residenza_indirizzo || '',
        residenza_civico: a.residenza_civico || '',
        residenza_cap: a.residenza_cap || '',
        residenza_comune: a.residenza_comune || '',
        residenza_provincia: a.residenza_provincia || ''
    };
}

function tipologiasocioSelezionata() {
    const admin = isAdmin(leggiSessione());
    if (!admin) return TIPOLOGIA_NUOVO;
    return val('ns-ns-tipologia') || TIPOLOGIA_NUOVO;
}

function popolaSelectTipologia(lista, selected = TIPOLOGIA_NUOVO) {
    const select = document.getElementById('ns-ns-tipologia');
    if (!select) return;

    const set = new Set(
        (Array.isArray(lista) ? lista : [])
            .map((v) => String(v || '').trim())
            .filter(Boolean)
    );
    set.add(TIPOLOGIA_NUOVO);
    if (selected) set.add(selected);

    const options = [...set].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
    select.innerHTML = options
        .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
        .join('');

    select.value = set.has(selected) ? selected : TIPOLOGIA_NUOVO;
}

function resetForm() {
    setVal('ns-ns-idsocio', '');
    setVal('ns-ns-nominativo', '');
    popolaSelectTipologia([TIPOLOGIA_NUOVO], TIPOLOGIA_NUOVO);
    setVal('ns-ns-cf', '');
    setVal('ns-ns-sesso', '');
    setVal('ns-ns-nasc-comune', '');
    setVal('ns-ns-nasc-data', '');
    setVal('ns-ns-indirizzo', '');
    setVal('ns-ns-civico', '');
    setVal('ns-ns-cap', '');
    setVal('ns-ns-comune', '');
    setVal('ns-ns-prov', '');
    setVal('ns-ns-telefono', '');
    setVal('ns-ns-tess-anno', '');
    setVal('ns-ns-tess-numero', '');
    setVal('ns-ns-tess-data', '');
    setVal('ns-ns-tess-quota', '');

    const extraCheck = document.getElementById('ns-ns-extra-dati');
    if (extraCheck) extraCheck.checked = false;
    aggiornaVisibilitaExtra(false);
    mostraErrore('');
}

function aggiornaVisibilitaExtra(mostra) {
    const box = document.getElementById('ns-modal-extra-dati');
    if (box) box.hidden = !mostra;
}

function aggiornaUiRuolo() {
    const admin = isAdmin(leggiSessione());
    const opzione = document.getElementById('ns-modal-admin-opzione');
    const hint = document.getElementById('ns-modal-nuovo-socio-hint');
    const selectTipologia = document.getElementById('ns-ns-tipologia');

    if (opzione) opzione.hidden = !admin;
    if (selectTipologia) {
        selectTipologia.disabled = !admin;
        selectTipologia.title = admin
            ? 'Seleziona la tipologia socio'
            : 'Per gli utenti non admin la tipologia è sempre NUOVO';
    }

    if (hint) {
        hint.textContent = admin
            ? 'Inserisci almeno il nominativo e scegli la tipologia. Puoi anche aggiungere anagrafica e tesseramento.'
            : 'Inserisci il nominativo. La tipologia sarà impostata automaticamente su NUOVO.';
    }

    if (!admin) {
        const extraCheck = document.getElementById('ns-ns-extra-dati');
        if (extraCheck) extraCheck.checked = false;
        aggiornaVisibilitaExtra(false);
        popolaSelectTipologia([TIPOLOGIA_NUOVO], TIPOLOGIA_NUOVO);
    }
}

/**
 * @param {object} deps
 * @param {() => any} deps.getInvoke
 * @param {() => boolean} deps.isTauri
 * @param {(tesserato: object) => Promise<void>|void} deps.onSocioCreato
 */
export function setupNuovoSocioTrasportato(deps) {
    const { getInvoke, isTauri, onSocioCreato } = deps;

    const modal = document.getElementById('ns-modal-nuovo-socio');
    const btnApri = document.getElementById('btn-nuovo-socio-trasportato');
    const btnChiudi = document.getElementById('ns-modal-nuovo-socio-chiudi');
    const btnAnnulla = document.getElementById('ns-modal-nuovo-socio-annulla');
    const btnSalva = document.getElementById('ns-modal-nuovo-socio-salva');
    const form = document.getElementById('ns-form-nuovo-socio');
    const extraCheck = document.getElementById('ns-ns-extra-dati');

    if (!modal || !btnApri) return;

    async function caricaTipologiePerAdmin(invoke) {
        if (!isAdmin(leggiSessione()) || !invoke) {
            popolaSelectTipologia([TIPOLOGIA_NUOVO], TIPOLOGIA_NUOVO);
            return;
        }
        try {
            const list = await invoke('get_all_tipologie_socio');
            popolaSelectTipologia(list, TIPOLOGIA_NUOVO);
        } catch (err) {
            console.warn('Caricamento tipologie socio:', err);
            popolaSelectTipologia([TIPOLOGIA_NUOVO], TIPOLOGIA_NUOVO);
        }
    }

    async function apriModale() {
        resetForm();
        aggiornaUiRuolo();

        const invoke = getInvoke?.();
        if (isTauri?.() && invoke) {
            try {
                await invoke('init_supabase_from_config').catch(() => {});
                const [nextId] = await Promise.all([
                    invoke('get_next_idsocio'),
                    caricaTipologiePerAdmin(invoke)
                ]);
                setVal('ns-ns-idsocio', String(nextId || ''));
            } catch (err) {
                console.warn('Apertura modale nuovo socio:', err);
                setVal('ns-ns-idsocio', '');
                await caricaTipologiePerAdmin(invoke);
            }
        }

        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.getElementById('ns-ns-nominativo')?.focus();
    }

    function chiudiModale() {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        resetForm();
    }

    function collectAnagraficaPayload() {
        const adminExtra = isAdmin(leggiSessione()) && Boolean(extraCheck?.checked);
        const tipologia = tipologiasocioSelezionata();
        const base = {
            id: 0,
            idsocio: val('ns-ns-idsocio'),
            nominativo: val('ns-ns-nominativo'),
            tipologiasocio: tipologia,
            codicefiscale: '',
            sesso: '',
            nascita_comune: '',
            nascita_data: '',
            residenza_indirizzo: '',
            residenza_civico: '',
            residenza_cap: '',
            residenza_comune: '',
            residenza_provincia: '',
            telefono: '',
            operatore: false,
            attivo: true,
            archivia: false,
            disponibilita: '',
            notaaggiuntiva: ''
        };

        if (!adminExtra) return base;

        return {
            ...base,
            codicefiscale: val('ns-ns-cf').toUpperCase(),
            sesso: val('ns-ns-sesso'),
            nascita_comune: val('ns-ns-nasc-comune'),
            nascita_data: isoToItalian(val('ns-ns-nasc-data')),
            residenza_indirizzo: val('ns-ns-indirizzo'),
            residenza_civico: val('ns-ns-civico'),
            residenza_cap: val('ns-ns-cap'),
            residenza_comune: val('ns-ns-comune'),
            residenza_provincia: val('ns-ns-prov').toUpperCase(),
            telefono: val('ns-ns-telefono')
        };
    }

    function collectTesseramentoOpzionale(idsocio) {
        const adminExtra = isAdmin(leggiSessione()) && Boolean(extraCheck?.checked);
        if (!adminExtra) return null;

        const anno = val('ns-ns-tess-anno');
        const numero = val('ns-ns-tess-numero');
        const dataIso = val('ns-ns-tess-data');
        const quota = val('ns-ns-tess-quota');

        if (!anno && !numero && !dataIso && !quota) return null;
        if (!anno) {
            throw new Error('Per il tesseramento indica almeno l\'anno.');
        }

        return {
            id: null,
            idsocio: String(idsocio),
            anno,
            numero,
            data: isoToItalian(dataIso),
            scadenza: scadenzaFromAnno(anno),
            tipologia: tipologiasocioSelezionata(),
            quota,
            note: ''
        };
    }

    async function salvaNuovoSocio() {
        mostraErrore('');
        const nominativo = val('ns-ns-nominativo');
        if (!nominativo) {
            mostraErrore('Il nominativo è obbligatorio.');
            document.getElementById('ns-ns-nominativo')?.focus();
            return;
        }

        const invoke = getInvoke?.();
        if (!isTauri?.() || !invoke) {
            mostraErrore('Apri questa pagina dall\'app AUSER.');
            return;
        }

        let tessPayload = null;
        try {
            tessPayload = collectTesseramentoOpzionale(val('ns-ns-idsocio'));
        } catch (err) {
            mostraErrore(String(err?.message || err));
            return;
        }

        if (btnSalva) {
            btnSalva.disabled = true;
            btnSalva.textContent = 'SALVATAGGIO...';
        }

        try {
            await invoke('init_supabase_from_config').catch(() => {});

            let idsocio = val('ns-ns-idsocio');
            if (!idsocio) {
                idsocio = String(await invoke('get_next_idsocio'));
                setVal('ns-ns-idsocio', idsocio);
            }

            const tipologia = tipologiasocioSelezionata();
            try {
                await invoke('add_tipologia_socio', { tipologia });
            } catch (_) {
                /* già presente: ok */
            }

            const anagrafica = {
                ...collectAnagraficaPayload(),
                idsocio,
                nominativo,
                tipologiasocio: tipologia
            };

            const saved = await invoke('create_socio_anagrafica', { anagrafica });
            const idsocioFinale = saved?.idsocio || idsocio;

            let savedTess = null;
            if (tessPayload) {
                savedTess = await invoke('save_tesseramento', {
                    tesseramento: {
                        ...tessPayload,
                        idsocio: idsocioFinale,
                        tipologia
                    }
                });
            }

            const tesserato = anagraficaToTesserato(
                { ...anagrafica, ...(saved || {}), idsocio: idsocioFinale, tipologiasocio: tipologia },
                savedTess
            );

            chiudiModale();
            await onSocioCreato?.(tesserato);
        } catch (error) {
            console.error('Nuovo socio da servizio:', error);
            mostraErrore(String(error?.message || error || 'Salvataggio non riuscito'));
        } finally {
            if (btnSalva) {
                btnSalva.disabled = false;
                btnSalva.textContent = 'SALVA';
            }
        }
    }

    btnApri.addEventListener('click', (e) => {
        e.preventDefault();
        apriModale();
    });
    btnChiudi?.addEventListener('click', chiudiModale);
    btnAnnulla?.addEventListener('click', chiudiModale);
    btnSalva?.addEventListener('click', salvaNuovoSocio);

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        salvaNuovoSocio();
    });

    extraCheck?.addEventListener('change', () => {
        aggiornaVisibilitaExtra(Boolean(extraCheck.checked));
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) chiudiModale();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) {
            e.preventDefault();
            chiudiModale();
        }
    });
}
