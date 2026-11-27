/* Service worker minimo: serve solo perché il telefono riconosca la pagina come app.
   Non salva copie delle pagine e non tocca login né dati Supabase. */
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
    /* Lascia passare la rete così com'è. */
});
