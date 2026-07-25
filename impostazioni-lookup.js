// Gestione schede lookup: Richiedenti, TipoSocio, Motivazioni, Tipi pagamento

const LOOKUP_META = {
    richiedenti: {
        titolo: 'Richiedenti',
        label: 'Richiedente',
        intro: 'Aggiungi, modifica o elimina i richiedenti (tabella Richiedenti_supa).'
    },
    tipo_socio: {
        titolo: 'Tipologie socio',
        label: 'Tipologia socio',
        intro: 'Aggiungi, modifica o elimina le tipologie socio (tabella TipoSocio_supa).'
    },
    motivazioni_trasporto: {
        titolo: 'Motivazioni',
        label: 'Motivazione',
        intro: 'Aggiungi, modifica o elimina le motivazioni trasporto (tabella Motivazioni_trasporto_supa).'
    },
    tipo_pagamenti: {
        titolo: 'Tipi pagamento',
        label: 'Tipo di pagamento',
        intro: 'Aggiungi, modifica o elimina i tipi di pagamento (tabella TipoPagamenti_supa).'
    }
};

/** @type {string|null} */
let kindAttivo = null;
/** @type {Array<{id: string, valore: string}>} */
let itemsCaricati = [];
/** @type {{ id: string, valore: string }|null} */
let pendingDelete = null;

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {object} deps
 * @param {() => any} deps.getInvoke
 * @param {(msg: string, isError?: boolean) => void} deps.setStatus
 * @param {(el: HTMLElement|null, show: boolean) => void} [deps.setHidden]
 */
export function createLookupManager(deps) {
    const { getInvoke, setStatus } = deps;

    function meta() {
        return LOOKUP_META[kindAttivo] || {
            titolo: 'Elenco',
            label: 'Valore',
            intro: ''
        };
    }

    function renderLista(lista) {
        const container = document.getElementById('lk-lista');
        const vuoto = document.getElementById('lk-vuoto');
        if (!container) return;

        if (!lista.length) {
            container.hidden = true;
            container.innerHTML = '';
            if (vuoto) vuoto.hidden = false;
            return;
        }

        if (vuoto) vuoto.hidden = true;
        container.hidden = false;
        container.innerHTML = lista.map((item) => `
            <div class="imp-lookup-riga" data-id="${escapeHtml(item.id)}">
                <span class="imp-lookup-valore">${escapeHtml(item.valore || '(vuoto)')}</span>
                <button type="button" class="imp-btn imp-btn-modifica" data-action="modifica">MODIFICA</button>
                <button type="button" class="imp-btn imp-btn-elimina" data-action="elimina">ELIMINA</button>
            </div>
        `).join('');
    }

    async function carica(kind) {
        kindAttivo = kind;
        const loading = document.getElementById('lk-loading');
        const errore = document.getElementById('lk-errore');
        const lista = document.getElementById('lk-lista');
        const vuoto = document.getElementById('lk-vuoto');

        if (loading) loading.hidden = false;
        if (errore) {
            errore.hidden = true;
            errore.textContent = '';
        }
        if (lista) lista.hidden = true;
        if (vuoto) vuoto.hidden = true;
        setStatus('');

        try {
            const invoke = await getInvoke();
            if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');

            await invoke('init_supabase_from_config').catch(() => {});
            const rows = await invoke('get_lookup_items', { kind });
            itemsCaricati = Array.isArray(rows) ? rows : [];
            if (loading) loading.hidden = true;
            renderLista(itemsCaricati);
        } catch (error) {
            console.error('Errore caricamento lookup:', error);
            if (loading) loading.hidden = true;
            if (errore) {
                errore.hidden = false;
                errore.textContent = `Errore: ${error}`;
            }
        }
    }

    function apriModale({ id = '', valore = '', isNew = true } = {}) {
        const modal = document.getElementById('modal-lookup');
        const title = document.getElementById('modal-lookup-title');
        const label = document.getElementById('lk-edit-label');
        const idInput = document.getElementById('lk-edit-id');
        const valInput = document.getElementById('lk-edit-valore');
        const m = meta();

        if (title) title.textContent = isNew ? `Nuovo: ${m.titolo}` : `Modifica: ${m.titolo}`;
        if (label) label.textContent = m.label;
        if (idInput) idInput.value = id;
        if (valInput) {
            valInput.value = valore;
            setTimeout(() => valInput.focus(), 30);
        }
        if (modal) modal.hidden = false;
    }

    function chiudiModale() {
        const modal = document.getElementById('modal-lookup');
        if (modal) modal.hidden = true;
    }

    function apriConfermaElimina(item) {
        pendingDelete = item;
        const modal = document.getElementById('modal-conferma-elimina');
        const testo = document.getElementById('modal-conferma-testo');
        const m = meta();
        if (testo) {
            testo.textContent =
                `Sei sicuro di voler eliminare «${item.valore || ''}» da ${m.titolo}? ` +
                'L\'operazione non si può annullare.';
        }
        if (modal) modal.hidden = false;
    }

    function chiudiConferma() {
        pendingDelete = null;
        const modal = document.getElementById('modal-conferma-elimina');
        if (modal) modal.hidden = true;
    }

    async function salvaDaModale() {
        if (!kindAttivo) return;

        const id = (document.getElementById('lk-edit-id')?.value || '').trim();
        const valore = (document.getElementById('lk-edit-valore')?.value || '').trim();
        if (!valore) {
            setStatus('Inserisci un valore.', true);
            return;
        }

        const btn = document.getElementById('btn-lk-salva');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'SALVATAGGIO...';
        }

        try {
            const invoke = await getInvoke();
            if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');
            await invoke('init_supabase_from_config').catch(() => {});

            if (id) {
                await invoke('update_lookup_item', { kind: kindAttivo, id, valore });
                setStatus('Valore aggiornato.');
            } else {
                await invoke('add_lookup_item', { kind: kindAttivo, valore });
                setStatus('Valore aggiunto.');
            }

            chiudiModale();
            await carica(kindAttivo);
        } catch (error) {
            console.error('Errore salvataggio lookup:', error);
            setStatus(`Errore: ${error}`, true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'SALVA';
            }
        }
    }

    async function confermaElimina() {
        if (!kindAttivo || !pendingDelete?.id) {
            chiudiConferma();
            return;
        }

        const btn = document.getElementById('btn-conferma-si');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'ELIMINAZIONE...';
        }

        try {
            const invoke = await getInvoke();
            if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');
            await invoke('init_supabase_from_config').catch(() => {});
            await invoke('delete_lookup_item', {
                kind: kindAttivo,
                id: pendingDelete.id
            });
            setStatus('Valore eliminato.');
            chiudiConferma();
            await carica(kindAttivo);
        } catch (error) {
            console.error('Errore eliminazione lookup:', error);
            setStatus(`Errore eliminazione: ${error}`, true);
            chiudiConferma();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'SÌ, ELIMINA';
            }
        }
    }

    function bindEvents() {
        document.getElementById('btn-aggiungi')?.addEventListener('click', () => {
            if (!kindAttivo) return;
            apriModale({ isNew: true, valore: '' });
        });

        document.getElementById('btn-lk-annulla')?.addEventListener('click', chiudiModale);
        document.getElementById('btn-lk-salva')?.addEventListener('click', salvaDaModale);

        document.getElementById('lk-edit-valore')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                salvaDaModale();
            }
        });

        document.getElementById('btn-conferma-no')?.addEventListener('click', chiudiConferma);
        document.getElementById('btn-conferma-si')?.addEventListener('click', confermaElimina);

        document.getElementById('lk-lista')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const riga = btn.closest('.imp-lookup-riga');
            if (!riga) return;
            const id = riga.getAttribute('data-id') || '';
            const item = itemsCaricati.find((x) => String(x.id) === String(id));
            if (!item) return;

            if (btn.getAttribute('data-action') === 'modifica') {
                apriModale({ id: item.id, valore: item.valore || '', isNew: false });
            } else if (btn.getAttribute('data-action') === 'elimina') {
                apriConfermaElimina(item);
            }
        });

        document.getElementById('modal-lookup')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-lookup') chiudiModale();
        });
        document.getElementById('modal-conferma-elimina')?.addEventListener('click', (e) => {
            if (e.target.id === 'modal-conferma-elimina') chiudiConferma();
        });
    }

    return {
        LOOKUP_META,
        carica,
        bindEvents,
        getKind: () => kindAttivo
    };
}
