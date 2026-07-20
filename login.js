import {
    loginConEmailPassword,
    vaiAllaHome
} from './auth-session.js';
import { controllaAggiornamenti } from './app-updater.js';

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

function mostraErrore(msg) {
    const el = document.getElementById('login-errore');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

async function gestisciLogin(event) {
    event.preventDefault();
    mostraErrore('');

    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    const btn = document.getElementById('login-submit');

    if (!email || !password) {
        mostraErrore('Inserisci email e password.');
        return;
    }

    if (!isTauri() || !invoke) {
        mostraErrore('Apri questa pagina dall\'app AUSER.');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'ACCESSO...';
    }

    try {
        await loginConEmailPassword(invoke, email, password);
        vaiAllaHome();
    } catch (error) {
        console.error('Login:', error);
        mostraErrore(String(error?.message || error || 'Accesso non riuscito'));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'ACCEDI';
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await initTauri();

    // Sempre mostra il form di accesso: niente salto automatico alla home
    // (evita sessioni vecchie/invalide che aprono la home senza dati).
    cancellaSessioneSilenziosa();

    document.getElementById('login-form')?.addEventListener('submit', gestisciLogin);

    // Controllo aggiornamenti in italiano (non blocca il login se fallisce)
    if (isTauri()) {
        controllaAggiornamenti().catch((err) => {
            console.warn('Updater all\'avvio:', err);
        });
    }
});

function cancellaSessioneSilenziosa() {
    try {
        localStorage.removeItem('auser_auth_session');
    } catch (_) { /* ignore */ }
}
