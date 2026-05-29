const API_BASE = "";
const SESSION_KEY = "civics_session_token";
const SESSION_EMAIL_KEY = "civics_session_email";

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY);
}

export function saveSessionToken(token) {
  localStorage.setItem(SESSION_KEY, token);
}

export function saveSessionEmail(email) {
  localStorage.setItem(SESSION_EMAIL_KEY, email);
}

export function getSessionEmail() {
  return localStorage.getItem(SESSION_EMAIL_KEY);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_EMAIL_KEY);
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
