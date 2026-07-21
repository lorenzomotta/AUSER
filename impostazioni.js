// Popup Impostazioni — lettura/modifica Impostazioni_supa (solo admin)
import { richiediSessione, isAdmin } from './auth-session.js';

let invoke;
/** @type {Array<{id: string, impostazione: string, valore: string}>} */
let impostazioniCaricate = [];

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

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isPasswordField(nome) {
    return String(nome || '').toUpperCase().includes('PASSWORD');
}

function setStatus(message, isError = false) {
    const el = document.getElementById('imp-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
    el.hidden = !message;
}

function renderCampi(lista) {
    const container = document.getElementById('imp-lista');
    const vuoto = document.getElementById('imp-vuoto');
    if (!container) return;

    if (!lista.length) {
        container.hidden = true;
        if (vuoto) vuoto.hidden = false;
        return;
    }

    if (vuoto) vuoto.hidden = true;
    container.hidden = false;

    container.innerHTML = lista.map((item, index) => {
        const nome = item.impostazione || `Impostazione ${item.id || index + 1}`;
        const valore = item.valore || '';
        const isPwd = isPasswordField(nome);
        const id = `imp-val-${index}`;

        if (isPwd) {
            return `
                <div class="imp-campo" data-id="${escapeHtml(item.id)}" data-index="${index}">
                    <label class="imp-campo-label" for="${id}">${escapeHtml(nome)}</label>
                    <div class="imp-campo-password-wrap">
                        <input type="password" class="imp-campo-valore" id="${id}" value="${escapeHtml(valore)}">
                        <button type="button" class="imp-btn-mostra" data-target="${id}">MOSTRA</button>
                    </div>
                </div>`;
        }

        return `
            <div class="imp-campo" data-id="${escapeHtml(item.id)}" data-index="${index}">
                <label class="imp-campo-label" for="${id}">${escapeHtml(nome)}</label>
                <input type="text" class="imp-campo-valore" id="${id}" value="${escapeHtml(valore)}">
            </div>`;
    }).join('');
}

async function caricaImpostazioni() {
    const loading = document.getElementById('imp-loading');
    const errore = document.getElementById('imp-errore');
    const lista = document.getElementById('imp-lista');

    if (loading) loading.hidden = false;
    if (errore) errore.hidden = true;
    if (lista) lista.hidden = true;
    setStatus('');

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');

        await invoke('init_supabase_from_config').catch(() => {});
        const rows = await invoke('get_all_impostazioni');
        impostazioniCaricate = Array.isArray(rows) ? rows : [];
        if (loading) loading.hidden = true;
        renderCampi(impostazioniCaricate);
    } catch (error) {
        console.error('Errore caricamento impostazioni:', error);
        if (loading) loading.hidden = true;
        if (errore) {
            errore.hidden = false;
            errore.textContent = `Errore: ${error}`;
        }
    }
}

function raccogliModifiche() {
    const container = document.getElementById('imp-lista');
    if (!container) return [];

    const modifiche = [];
    container.querySelectorAll('.imp-campo').forEach((campo) => {
        const id = campo.getAttribute('data-id') || '';
        const index = parseInt(campo.getAttribute('data-index') || '-1', 10);
        const input = campo.querySelector('.imp-campo-valore');
        if (!id || !input) return;

        const nuovoValore = input.value;
        const originale = impostazioniCaricate[index]?.valore ?? '';
        if (String(nuovoValore) !== String(originale)) {
            modifiche.push({ id, valore: nuovoValore, index });
        }
    });
    return modifiche;
}

async function salvaImpostazioni() {
    if (!isAdmin()) {
        setStatus('Solo gli amministratori possono modificare le impostazioni.', true);
        return;
    }

    const modifiche = raccogliModifiche();
    if (!modifiche.length) {
        setStatus('Nessuna modifica da salvare.');
        return;
    }

    const btn = document.getElementById('btn-salva');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'SALVATAGGIO...';
    }
    setStatus('');

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');

        await invoke('init_supabase_from_config').catch(() => {});

        for (const m of modifiche) {
            await invoke('update_impostazione', { id: m.id, valore: m.valore });
            if (impostazioniCaricate[m.index]) {
                impostazioniCaricate[m.index].valore = m.valore;
            }
        }

        setStatus(`Salvate ${modifiche.length} impostazione/i.`);
    } catch (error) {
        console.error('Errore salvataggio impostazioni:', error);
        setStatus(`Errore salvataggio: ${error}`, true);
        await caricaImpostazioni();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'SALVA';
        }
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = currentWindow?.label || '';

            if (label === 'impostazioni') {
                try {
                    const mainWin = WebviewWindow.getByLabel('main');
                    if (mainWin) {
                        await mainWin.show();
                        await mainWin.setFocus();
                    }
                } catch (_) { /* ignore */ }
                await currentWindow.close();
                return;
            }

            window.location.href = 'index.html';
            return;
        } catch (err) {
            console.warn('Chiusura:', err);
            window.location.href = 'index.html';
            return;
        }
    }
    if (window.opener) window.close();
    else window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    const sessione = richiediSessione();
    if (!sessione) return;
    if (!isAdmin(sessione)) {
        alert('Accesso riservato agli amministratori.');
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-salva')?.addEventListener('click', salvaImpostazioni);

    document.getElementById('imp-lista')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.imp-btn-mostra');
        if (!btn) return;
        const input = document.getElementById(btn.getAttribute('data-target'));
        if (!input) return;
        const mostra = input.type === 'password';
        input.type = mostra ? 'text' : 'password';
        btn.textContent = mostra ? 'NASCONDI' : 'MOSTRA';
    });

    await caricaImpostazioni();
});
