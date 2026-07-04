function isTauri() {
    return typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ !== undefined ||
            window.__TAURI_IPC__ !== undefined);
}

function oggiIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function impostaDataPredefinita() {
    const input = document.getElementById('input-data');
    if (input) {
        input.value = oggiIso();
    }
}

async function chiudiFinestra() {
    if (isTauri()) {
        try {
            const { getCurrent } = await import('@tauri-apps/api/window');
            await getCurrent().close();
            return;
        } catch (e) {
            console.warn(e);
        }
    }
    if (window.opener) {
        window.close();
    } else {
        window.location.href = 'index.html';
    }
}

async function apriReport() {
    const input = document.getElementById('input-data');
    const dataIso = input?.value?.trim();

    if (!dataIso) {
        alert('Seleziona una data prima di continuare.');
        input?.focus();
        return;
    }

    const url = `RIEPILOGOINCASSI.html?data=${encodeURIComponent(dataIso)}`;

    if (isTauri()) {
        try {
            const { Window, getCurrent } = await import('@tauri-apps/api/window');
            const webview = await Window.create('riepilogo-incassi', {
                url,
                title: 'INCASSI GIORNALIERI',
                width: 1400,
                height: 900,
                resizable: true,
                maximized: true,
                decorations: true,
                alwaysOnTop: false,
                center: true
            });
            await webview.setFocus();
            await getCurrent().close();
            return;
        } catch (error) {
            console.error('Errore apertura report incassi:', error);
        }
    }

    window.location.href = url;
}

function setupEventListeners() {
    document.getElementById('btn-chiudi')?.addEventListener('click', chiudiFinestra);
    document.getElementById('btn-visualizza')?.addEventListener('click', apriReport);

    document.getElementById('input-data')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            apriReport();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    impostaDataPredefinita();
    setupEventListeners();
});
