(function(){
  // Dati demo minimi per sviluppo
  const demoData = {
    servizi: [
      { id: 1, titolo: 'Servizio demo', data: '01/09/2025', note: 'Esempio locale' }
    ],
    operatori: [],
    tesserati: [],
    rinnovoTesseramenti: [],
    automezzi: []
  };

  window.getLocalData = function getLocalData(collectionName){
    if (!collectionName) return null;
    return demoData[collectionName] || [];
  };
})();
