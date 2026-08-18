export async function apiJson(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const fetchOptions = {
    ...options,
    headers,
    credentials: "same-origin"
  };
  if (Object.prototype.hasOwnProperty.call(options, "body") && typeof options.body !== "string") {
    fetchOptions.body = JSON.stringify(options.body || {});
    fetchOptions.headers = { ...headers, "Content-Type": "application/json" };
  }
  const response = await fetch(path, {
    ...fetchOptions
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 401) {
    const returnTo = encodeURIComponent(window.location.pathname || "/dashboard");
    window.location.href = payload?.loginUrl || `/api/meos/login?returnTo=${returnTo}`;
    throw new Error("MEOS login vereist.");
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `MEOS API fout ${response.status}`);
  }
  return payload || {};
}
