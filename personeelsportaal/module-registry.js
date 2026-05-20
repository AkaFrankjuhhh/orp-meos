(function () {
  const features = new Map();

  // Defensie Personeelsportaal feature registry: elke pagina/functie kan zichzelf hier aanmelden.
  function registerFeature(name, api = {}) {
    features.set(name, api);
    return api;
  }

  function getFeature(name) {
    return features.get(name) || null;
  }

  function listFeatures() {
    return [...features.keys()];
  }

  window.DefensiePortalModules = { registerFeature, getFeature, listFeatures };
}());