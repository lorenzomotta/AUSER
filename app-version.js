/**
 * Versione app (da tauri.conf.json / Cargo.toml) — titolo finestra e UI.
 */

const FALLBACK_VERSION = '1.0.8';

export async function getAppVersion() {
    try {
        if (typeof window !== 'undefined' &&
            (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI_IPC__ !== undefined)) {
            const { getVersion } = await import('@tauri-apps/api/app');
            const v = await getVersion();
            if (v) return String(v).trim();
        }
    } catch (err) {
        console.warn('getVersion non disponibile:', err);
    }
    return FALLBACK_VERSION;
}

/** Imposta il titolo della finestra Tauri, es. "AUSER Asti - Accesso v1.0.5" */
export async function applicaTitoloFinestra(prefisso) {
    const version = await getAppVersion();
    const titolo = `${prefisso} v${version}`;
    document.title = titolo;
    try {
        const { appWindow } = await import('@tauri-apps/api/window');
        await appWindow.setTitle(titolo);
    } catch (err) {
        console.warn('setTitle non disponibile:', err);
    }
    return version;
}

/** Scrive "v1.0.5" in un elemento (se presente) */
export async function mostraVersioneInElemento(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return '';
    const version = await getAppVersion();
    el.textContent = `v${version}`;
    return version;
}
