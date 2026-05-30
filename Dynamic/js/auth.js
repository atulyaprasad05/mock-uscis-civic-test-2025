const API_BASE = "";
const SESSION_KEY = "civics_session_token";
const SESSION_EMAIL_KEY = "civics_session_email";
const SESSION_NAME_KEY = "civics_session_name";

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

export function getUserName() {
  return localStorage.getItem(SESSION_NAME_KEY);
}

export function saveUserName(name) {
  if (name) localStorage.setItem(SESSION_NAME_KEY, name);
  else localStorage.removeItem(SESSION_NAME_KEY);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_EMAIL_KEY);
  localStorage.removeItem(SESSION_NAME_KEY);
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
  return { is_new_user: data.is_new_user };
}

export async function fetchProfile(token) {
  const res = await fetch(`${API_BASE}/profile`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) return { name: null };
  return res.json();
}

export async function saveName(name, token) {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Failed to save name.");
  }
}
