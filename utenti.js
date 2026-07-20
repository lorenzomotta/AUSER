import { richiediSessione, isAdmin, leggiSessione } from './auth-session.js';

let invoke;
let adminUserId = '';

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

function mostraMsg(tipo, testo) {
    const err = document.getElementById('ut-errore');
    const ok = document.getElementById('ut-ok');
    if (err) {
        err.hidden = tipo !== 'errore';
        if (tipo === 'errore') err.textContent = testo;
    }
    if (ok) {
        ok.hidden = tipo !== 'ok';
        if (tipo === 'ok') ok.textContent = testo;
    }
}

function badge(label, on) {
    return `<span class="ut-badge ${on ? 'ut-badge-on' : 'ut-badge-off'}">${label}</span>`;
}

function renderLista(lista) {
    const container = document.getElementById('ut-lista');
    const vuoto = document.getElementById('ut-vuoto');
    if (!container) return;

    if (!lista.length) {
        container.hidden = true;
        if (vuoto) vuoto.hidden = false;
        return;
    }
    if (vuoto) vuoto.hidden = true;
    container.hidden = false;

    container.innerHTML = lista.map((u) => `
        <div class="ut-riga" data-user-id="${escapeHtml(u.user_id)}">
            <div>
                <div class="ut-riga-nome">${escapeHtml(u.username || '(senza nome)')}</div>
                <div class="ut-riga-id">${escapeHtml(u.user_id)}</div>
            </div>
            ${badge('ADMIN', !!u.is_admin)}
            ${badge('PROGRAMMA', !!u.programma)}
            ${badge('CALENDARIO', !!u.calendario)}
            <button type="button" class="ut-btn ut-btn-modifica" data-edit-id="${escapeHtml(u.user_id)}">MODIFICA</button>
        </div>
    `).join('');

    container.querySelectorAll('[data-edit-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-edit-id');
            const user = lista.find((x) => String(x.user_id) === String(id));
            if (user) apriModifica(user);
        });
    });
}

async function caricaUtenti() {
    const loading = document.getElementById('ut-loading');
    if (loading) loading.hidden = false;
    mostraMsg('', '');

    try {
        if (!invoke) await initTauri();
        if (!invoke) throw new Error('Apri questa pagina dall\'app AUSER');

        await invoke('init_supabase_from_config').catch(() => {});
        const rows = await invoke('get_all_user_permissions', {
            adminUserId,
            admin_user_id: adminUserId
        });
        if (loading) loading.hidden = true;
        renderLista(Array.isArray(rows) ? rows : []);
    } catch (error) {
        console.error(error);
        if (loading) loading.hidden = true;
        mostraMsg('errore', String(error?.message || error));
    }
}

function apriModifica(user) {
    document.getElementById('edit-user-id').value = user.user_id || '';
    document.getElementById('edit-username').value = user.username || '';
    document.getElementById('edit-is-admin').checked = !!user.is_admin;
    document.getElementById('edit-programma').checked = !!user.programma;
    document.getElementById('edit-calendario').checked = !!user.calendario;
    document.getElementById('edit-password').value = '';

    const btnElimina = document.getElementById('btn-elimina-edit');
    if (btnElimina) {
        const isSelf = String(user.user_id || '') === String(adminUserId || '');
        btnElimina.hidden = isSelf;
        btnElimina.disabled = isSelf;
        btnElimina.title = isSelf
            ? 'Non puoi eliminare il tuo stesso account'
            : 'Elimina utente';
    }

    document.getElementById('modal-edit').hidden = false;
}

function chiudiModifica() {
    document.getElementById('modal-edit').hidden = true;
}

function apriConfermaElimina() {
    const userId = document.getElementById('edit-user-id')?.value || '';
    const username = document.getElementById('edit-username')?.value.trim() || '';
    const testo = document.getElementById('modal-conferma-elimina-testo');
    if (testo) {
        const nome = username || userId || 'questo utente';
        testo.textContent =
            `Sei sicuro di voler eliminare l'utente «${nome}»? L'operazione non si può annullare.`;
    }
    document.getElementById('modal-conferma-elimina').hidden = false;
}

function chiudiConfermaElimina() {
    document.getElementById('modal-conferma-elimina').hidden = true;
}

async function eliminaUtenteConfermato() {
    const userId = document.getElementById('edit-user-id')?.value || '';
    const username = document.getElementById('edit-username')?.value.trim() || '';
    if (!userId) {
        mostraMsg('errore', 'Utente non selezionato.');
        return;
    }

    if (userId === adminUserId) {
        chiudiConfermaElimina();
        mostraMsg('errore', 'Non puoi eliminare il tuo stesso account mentre sei collegato.');
        return;
    }

    const btnSi = document.getElementById('btn-conferma-elimina-si');
    if (btnSi) btnSi.disabled = true;

    try {
        await invoke('delete_app_user', {
            payload: {
                admin_user_id: adminUserId,
                user_id: userId
            }
        });
        chiudiConfermaElimina();
        chiudiModifica();
        mostraMsg('ok', `Utente ${username || userId} eliminato.`);
        await caricaUtenti();
    } catch (error) {
        console.error(error);
        chiudiConfermaElimina();
        mostraMsg('errore', String(error?.message || error));
    } finally {
        if (btnSi) btnSi.disabled = false;
    }
}

function apriNuovo() {
    document.getElementById('nuovo-email').value = '';
    document.getElementById('nuovo-password').value = '';
    document.getElementById('nuovo-username').value = '';
    document.getElementById('nuovo-is-admin').checked = false;
    document.getElementById('nuovo-programma').checked = true;
    document.getElementById('nuovo-calendario').checked = false;
    document.getElementById('modal-nuovo').hidden = false;
}

function chiudiNuovo() {
    document.getElementById('modal-nuovo').hidden = true;
}

async function salvaModifica() {
    const userId = document.getElementById('edit-user-id')?.value;
    const username = document.getElementById('edit-username')?.value.trim() || '';
    const isAdminFlag = !!document.getElementById('edit-is-admin')?.checked;
    const programma = !!document.getElementById('edit-programma')?.checked;
    const calendario = !!document.getElementById('edit-calendario')?.checked;
    const nuovaPassword = document.getElementById('edit-password')?.value || '';

    if (!username) {
        mostraMsg('errore', 'Inserisci uno username.');
        return;
    }

    try {
        await invoke('update_user_permissions', {
            payload: {
                admin_user_id: adminUserId,
                user_id: userId,
                username,
                is_admin: isAdminFlag,
                programma,
                calendario,
                nuova_password: nuovaPassword.trim() ? nuovaPassword.trim() : null
            }
        });
        chiudiModifica();
        mostraMsg('ok', `Username aggiornato: ${username}`);
        await caricaUtenti();
    } catch (error) {
        console.error(error);
        mostraMsg('errore', String(error?.message || error));
    }
}

async function salvaNuovo() {
    const email = document.getElementById('nuovo-email')?.value.trim() || '';
    const password = document.getElementById('nuovo-password')?.value || '';
    const username = document.getElementById('nuovo-username')?.value.trim() || '';
    const isAdminFlag = !!document.getElementById('nuovo-is-admin')?.checked;
    const programma = !!document.getElementById('nuovo-programma')?.checked;
    const calendario = !!document.getElementById('nuovo-calendario')?.checked;

    if (!email || !password) {
        mostraMsg('errore', 'Email e password obbligatorie.');
        return;
    }

    try {
        await invoke('create_app_user', {
            payload: {
                admin_user_id: adminUserId,
                email,
                password,
                username,
                is_admin: isAdminFlag,
                programma,
                calendario
            }
        });
        chiudiNuovo();
        mostraMsg('ok', `Utente ${email} creato.`);
        await caricaUtenti();
    } catch (error) {
        console.error(error);
        mostraMsg('errore', String(error?.message || error));
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent, WebviewWindow } = await import('@tauri-apps/api/window');
            const currentWindow = getCurrent();
            const label = currentWindow?.label || '';
            if (label === 'gestione-utenti') {
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
            console.warn(err);
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

    adminUserId = sessione.user_id || leggiSessione()?.user_id || '';
    if (!adminUserId) {
        alert('Sessione non valida.');
        window.location.href = 'LOGIN.html';
        return;
    }

    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-nuovo')?.addEventListener('click', apriNuovo);
    document.getElementById('btn-annulla-edit')?.addEventListener('click', chiudiModifica);
    document.getElementById('btn-annulla-nuovo')?.addEventListener('click', chiudiNuovo);
    document.getElementById('btn-salva-edit')?.addEventListener('click', salvaModifica);
    document.getElementById('btn-salva-nuovo')?.addEventListener('click', salvaNuovo);
    document.getElementById('btn-elimina-edit')?.addEventListener('click', apriConfermaElimina);
    document.getElementById('btn-conferma-elimina-si')?.addEventListener('click', eliminaUtenteConfermato);
    document.getElementById('btn-conferma-elimina-no')?.addEventListener('click', chiudiConfermaElimina);

    await caricaUtenti();
});
