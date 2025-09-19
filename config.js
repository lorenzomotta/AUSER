(function(){
  // Modalità sviluppo sempre attiva per ora
  window.isDevelopmentMode = function isDevelopmentMode(){ return true; };

  // Logger semplice
  window.log = function log(message, level){
    const ts = new Date().toISOString();
    const lvl = (level || 'info').toUpperCase();
    console.log(`[${ts}] [${lvl}] ${message}`);
  };

  // Messaggi di stato (no-op in questa versione)
  window.showStatusMessage = function showStatusMessage(){ /* noop */ };

  // Simula ritardo di rete in dev
  window.simulateNetworkDelay = function simulateNetworkDelay(ms){
    const delay = typeof ms === 'number' ? ms : 250;
    return new Promise(resolve => setTimeout(resolve, delay));
  };
})();
