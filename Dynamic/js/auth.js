const API_BASE = "http://localhost:8001";
const SESSION_KEY = "civics_session_token";

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY);
}

export function saveSessionToken(token) {
  localStorage.setItem(SESSION_KEY, token);
}

export async function sendCode(email) {
  const res = await fetch(`${API_BASE}/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to send code. Try again.");
  }
}

export async function verifyCode(email, code) {
  const res = await fetch(`${API_BASE}/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Verification failed. Try again.");
  }
  const data = await res.json();
  saveSessionToken(data.token);
}
