(() => {
  const base = window.PROOFLY_API_URL || "http://127.0.0.1:8787";
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `API request failed (${response.status})`);
    return payload;
  }
  window.ProoflyAPI = {
    health: () => request("/api/health"),
    getQuestions: () => request("/api/questions"),
    saveQuestions: questions => request("/api/questions", { method: "PUT", body: JSON.stringify({ questions }) }),
    getAddresses: () => request("/api/wallet/addresses"),
    createWalletNonce: address => request("/api/wallet/nonce", { method: "POST", body: JSON.stringify({ address }) }),
    verifyWallet: payload => request("/api/wallet/verify", { method: "POST", body: JSON.stringify(payload) }),
    getBadgeEligibility: () => request("/api/badges/eligibility"),
    createBadgeClaim: payload => request("/api/badges/claim", { method: "POST", body: JSON.stringify(payload) }),
    createForumClaim: payload => request("/api/forum/claim", { method: "POST", body: JSON.stringify(payload) }),
    selectDemoBestAnswer: payload => request("/api/demo/select-best", { method: "POST", body: JSON.stringify(payload) })
  };
})();
