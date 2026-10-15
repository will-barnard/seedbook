// Thin fetch wrapper. Cookies ride along automatically (same origin).
async function req(method, path, body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  authStatus: () => req("GET", "/auth/status"),
  setup: (email, password) => req("POST", "/auth/setup", { email, password }),
  login: (email, password) => req("POST", "/auth/login", { email, password }),
  logout: () => req("POST", "/auth/logout"),
  config: () => req("GET", "/config"),

  // leads
  listLeads: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v)
    ).toString();
    return req("GET", `/leads${qs ? "?" + qs : ""}`);
  },
  getLead: (id) => req("GET", `/leads/${id}`),
  createLead: (data) => req("POST", "/leads", data),
  updateLead: (id, data) => req("PUT", `/leads/${id}`, data),
  deleteLead: (id) => req("DELETE", `/leads/${id}`),
  generateFollowup: (id, instructions) =>
    req("POST", `/leads/${id}/generate-followup`, { instructions }),
  remindLead: (id) => req("POST", `/leads/${id}/remind`),
  runDigest: () => req("POST", "/reminders/run"),

  // rate card
  listOfferings: (activeOnly = false) => req("GET", `/offerings${activeOnly ? "?active=1" : ""}`),
  createOffering: (data) => req("POST", "/offerings", data),
  updateOffering: (id, data) => req("PUT", `/offerings/${id}`, data),
  deleteOffering: (id) => req("DELETE", `/offerings/${id}`),

  // proposal settings
  getSettings: () => req("GET", "/settings"),
  updateSettings: (data) => req("PUT", "/settings", data),

  // proposals
  listProposals: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return req("GET", `/proposals${qs ? "?" + qs : ""}`);
  },
  createProposal: (leadId) => req("POST", "/proposals", { lead_id: leadId }),
  getProposal: (id) => req("GET", `/proposals/${id}`),
  updateProposal: (id, data) => req("PUT", `/proposals/${id}`, data),
  deleteProposal: (id) => req("DELETE", `/proposals/${id}`),
  generateProposal: (id) => req("POST", `/proposals/${id}/generate`),
  reviseProposal: (id, body) => req("POST", `/proposals/${id}/revise`, body),
  saveProposalVersion: (id, sections) => req("POST", `/proposals/${id}/versions`, sections),
  sendProposal: (id, versionId) => req("POST", `/proposals/${id}/send`, { version_id: versionId }),
  proposalOutcome: (id, status, note) => req("POST", `/proposals/${id}/outcome`, { status, note }),
};
