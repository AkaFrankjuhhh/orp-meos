(function () {
  const features = new Map();

  // Porto feature registry: houdt OPS, kaart, duty, profiel en audio gescheiden.
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

  window.PortoModules = { registerFeature, getFeature, listFeatures };
}());