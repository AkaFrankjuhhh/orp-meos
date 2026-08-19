let meosCsrfToken = "";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function setMeosCsrfToken(token) {
  meosCsrfToken = String(token || "").trim();
}

function rememberCsrfToken(payload) {
  if (payload?.csrfToken) setMeosCsrfToken(payload.csrfToken);
}

export async function apiJson(path, options = {}) {
  let headers = { Accept: "application/json", ...(options.headers || {}) };
  const method = String(options.method || "GET").toUpperCase();
  const fetchOptions = {
    ...options,
    headers,
    credentials: "same-origin"
  };
  if (Object.prototype.hasOwnProperty.call(options, "body") && typeof options.body !== "string") {
    fetchOptions.body = JSON.stringify(options.body || {});
    headers = { ...headers, "Content-Type": "application/json" };
  }
  if (mutationMethods.has(method) && meosCsrfToken) {
    headers = { ...headers, "X-MEOS-CSRF": meosCsrfToken };
  }
  fetchOptions.headers = headers;
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
    setMeosCsrfToken("");
    const returnTo = encodeURIComponent(window.location.pathname || "/dashboard");
    window.location.href = payload?.loginUrl || `/api/meos/login?returnTo=${returnTo}`;
    throw new Error("MEOS login vereist.");
  }
  rememberCsrfToken(payload);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `MEOS API fout ${response.status}`);
  }
  return payload || {};
}
