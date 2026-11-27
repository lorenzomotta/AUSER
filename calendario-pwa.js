/* Registra l'app sul telefono e nasconde il suggerimento se è già aperta dall'icona. */
(function () {
    const giaInstallata = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;

    if (giaInstallata) {
        const hint = document.getElementById('web-login-installa');
        if (hint) hint.hidden = true;
    }

    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./calendario-sw.js').catch(() => {
            /* Senza https (file aperto dal disco) la registrazione non parte: è normale. */
        });
    });
})();
