(function () {
  const features = new Map();

  // pManager feature registry: elke pagina/functie kan zichzelf hier aanmelden.
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

  window.PManagerModules = { registerFeature, getFeature, listFeatures };
}());