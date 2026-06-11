import { selectQuestions, TEST_SIZE, shuffle } from "./selector.js";
import {
  buildOptionsForInstance,
  renderQuestion,
  lockForm,
} from "./renderers.js";
import { score, correctIndexesFor } from "./scorer.js";
import { getSessionToken, sendCode, verifyCode, saveSessionEmail, getSessionEmail, clearSession, getUserName, saveUserName, fetchProfile, saveName } from "./auth.js";

const PASS_THRESHOLD = 12;
const STORAGE_KEY = "civics_quiz_progress";

const views = {
  authEmail: document.getElementById("view-auth-email"),
  authCode: document.getElementById("view-auth-code"),
  nameEntry: document.getElementById("view-name-entry"),
  home: document.getElementById("view-home"),
  welcome: document.getElementById("view-welcome"),
  quiz: document.getElementById("view-quiz"),
  results: document.getElementById("view-results"),
  review: document.getElementById("view-review"),
  report: document.getElementById("view-report"),
};

function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    el.hidden = k !== name;
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

let allQuestions = [];
let state = null; // { questions, answers, currentIndex }
let pendingEmail = null;
let _prevReportView = "home";
let _questionsPromise = null;
let masteredIds = new Set();

function saveProgress(viewName) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view: viewName, state }));
  } catch (_) {}
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const { view, state: s } = saved;
    if (!["quiz", "results", "review"].includes(view)) return null;
    if (!Array.isArray(s?.questions) || s.questions.length === 0) return null;
    if (!Array.isArray(s?.answers) || s.answers.length !== s.questions.length) return null;
    if (typeof s.currentIndex !== "number" || s.currentIndex < 0 || s.currentIndex >= s.questions.length) return null;
    return saved;
  } catch (_) {
    return null;
  }
}

async function fetchMastery() {
  const token = getSessionToken();
  if (!token) return;
  try {
    const res = await fetch("/mastery", { headers: { "Authorization": `Bearer ${token}` } });
    if (!res.ok) return;
    masteredIds = new Set((await res.json()).mastered);
  } catch (_) {}
}

function showMasteryOpt() {
  const cb = document.getElementById("exclude-mastered-cb");
  const msgEl = document.getElementById("mastery-count-msg");
  cb.checked = false;
  if (masteredIds.size === 0) {
    msgEl.textContent = "You haven't mastered any questions yet.";
    cb.disabled = true;
  } else {
    msgEl.textContent = `You've mastered ${masteredIds.size} of 128 questions.`;
    cb.disabled = false;
  }
}

async function goToWelcome() {
  await fetchMastery();
  showMasteryOpt();
  showView("welcome");
}

async function loadQuestionBank() {
  const res = await fetch("data/questions.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load questions.json: ${res.status}`);
  const data = await res.json();
  return data.questions;
}

// ---- Auth handlers ----
async function handleSendCode() {
  const emailInput = document.getElementById("auth-email-input");
  const errorEl = document.getElementById("auth-email-error");
  const btn = document.getElementById("btn-send-code");
  const email = emailInput.value.trim();
  if (!email) return;

  btn.disabled = true;
  btn.textContent = "Sending…";
  errorEl.hidden = true;

  try {
    await sendCode(email);
    pendingEmail = email;
    document.getElementById("auth-code-email-display").textContent = email;
    const codeInput = document.getElementById("auth-code-input");
    const verifyBtn = document.getElementById("btn-verify-code");
    codeInput.value = "";
    document.getElementById("auth-code-message").hidden = true;
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify";
    showView("authCode");
    codeInput.focus();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Send code";
  }
}

async function handleVerifyCode() {
  const codeInput = document.getElementById("auth-code-input");
  const msgEl = document.getElementById("auth-code-message");
  const btn = document.getElementById("btn-verify-code");
  const code = codeInput.value.trim();
  if (!code || !pendingEmail) return;

  btn.disabled = true;
  btn.textContent = "Verifying…";
  msgEl.hidden = true;

  try {
    const { is_new_user } = await verifyCode(pendingEmail, code);
    saveSessionEmail(pendingEmail);
    if (is_new_user) {
      _questionsPromise = loadQuestionBank().then(q => { allQuestions = q; });
      showView("nameEntry");
      document.getElementById("name-input").focus();
    } else {
      await loadAndProceed();
    }
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = "auth-error";
    msgEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Verify";
  }
}

async function handleResendCode() {
  const msgEl = document.getElementById("auth-code-message");
  if (!pendingEmail) { showView("authEmail"); return; }
  try {
    await sendCode(pendingEmail);
    msgEl.textContent = "Code resent!";
    msgEl.className = "auth-error success";
    msgEl.hidden = false;
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = "auth-error";
    msgEl.hidden = false;
  }
}

async function handleNameSubmit() {
  const input = document.getElementById("name-input");
  const name = input.value.trim();
  if (!name) return;

  const btn = document.getElementById("btn-name-submit");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await Promise.all([
      saveName(name, getSessionToken()).catch(() => {}),
      _questionsPromise,
    ]);
    saveUserName(name);
    showToolbar();
    showHome(name, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue";
  }
}

async function getUserDisplayName() {
  const cached = getUserName();
  if (cached) return cached;
  try {
    const { name, email } = await fetchProfile(getSessionToken());
    if (name) saveUserName(name);
    if (email && !getSessionEmail()) saveSessionEmail(email);
    return name || null;
  } catch (_) {
    return null;
  }
}

function showHome(name, isNew) {
  document.getElementById("home-greeting").textContent =
    isNew ? `Welcome, ${name}!` : `Welcome back, ${name}!`;
  showView("home");
}

// ---- Load questions and restore/show correct view ----
async function loadAndProceed() {
  try {
    allQuestions = await loadQuestionBank();
  } catch (err) {
    showView("welcome");
    const card = document.querySelector("#view-welcome .card");
    card.innerHTML =
      '<h2 style="color:var(--accent)">Failed to load question bank</h2>' +
      `<p>${escapeHTML(err.message)}</p>` +
      '<p>If you opened <code>index.html</code> directly, modules/fetch won\'t work over <code>file://</code>. ' +
      'Run a local server, e.g. <code>python -m http.server 8000</code> and visit ' +
      '<code>http://localhost:8000/</code>.</p>';
    return;
  }
  const name = await getUserDisplayName();
  showToolbar();
  const saved = loadProgress();
  if (saved) {
    state = saved.state;
    if (saved.view === "quiz") {
      showView("quiz");
      renderCurrent();
    } else if (saved.view === "results") {
      showResults();
    } else if (saved.view === "review") {
      showResults();
      showReview();
    } else {
      routeToHomeOrName(name);
    }
  } else {
    routeToHomeOrName(name);
  }
}

function routeToHomeOrName(name) {
  if (name) {
    showHome(name, false);
  } else {
    _questionsPromise = Promise.resolve();
    showView("nameEntry");
    document.getElementById("name-input").focus();
  }
}

function startNewTest() {
  localStorage.removeItem(STORAGE_KEY);
  let pool = allQuestions;
  const excludeCb = document.getElementById("exclude-mastered-cb");
  if (excludeCb?.checked && masteredIds.size > 0) {
    const unmastered = allQuestions.filter(q => !masteredIds.has(q.id));
    if (unmastered.length >= TEST_SIZE) {
      pool = unmastered;
    } else {
      const extra = shuffle(allQuestions.filter(q => masteredIds.has(q.id)));
      pool = [...unmastered, ...extra.slice(0, TEST_SIZE - unmastered.length)];
    }
  }
  const picked = selectQuestions(pool);
  state = {
    questions: picked,
    currentIndex: 0,
    answers: picked.map((q) => ({
      questionId: q.id,
      questionNumber: q.questionNumber,
      displayOptions: buildOptionsForInstance(q),
      userAnswer: null,
      isCorrect: false,
      selfAssessed: false,
      submitted: false,
    })),
  };
  showView("quiz");
  renderCurrent();
  saveProgress("quiz");
}

// ---- Quiz rendering ----
const els = {
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  topicChip: document.getElementById("topic-chip"),
  meta: document.getElementById("question-meta"),
  prompt: document.getElementById("question-prompt"),
  hint: document.getElementById("question-hint"),
  form: document.getElementById("answer-form"),
  feedback: document.getElementById("feedback"),
  submit: document.getElementById("btn-submit"),
  next: document.getElementById("btn-next"),
};

let currentHelpers = null;

function renderCurrent() {
  const idx = state.currentIndex;
  const q = state.questions[idx];
  const a = state.answers[idx];

  els.progressFill.style.width = `${((idx) / TEST_SIZE) * 100}%`;
  els.progressLabel.textContent = `Question ${idx + 1} of ${TEST_SIZE}`;
  els.topicChip.textContent = q.topic;
  els.meta.textContent = `Official Q${q.questionNumber} · ${q.subtopic || ""}`;
  els.prompt.textContent = q.prompt;
  els.feedback.hidden = true;
  els.feedback.className = "feedback";
  els.feedback.innerHTML = "";
  els.submit.hidden = false;
  els.submit.disabled = true;
  els.submit.textContent = "Submit answer";
  els.next.hidden = true;

  currentHelpers = renderQuestion(q, a.displayOptions, els.form, els.hint);

  // wire readiness updates
  const updateReady = () => {
    els.submit.disabled = !currentHelpers.isReady();
  };
  els.form.addEventListener("input", updateReady);
  els.form.addEventListener("change", updateReady);
  if (currentHelpers.focus) currentHelpers.focus();
}

function submitAnswer() {
  const idx = state.currentIndex;
  const q = state.questions[idx];
  const a = state.answers[idx];
  const userAnswer = currentHelpers.readAnswer();
  if (userAnswer === null) return;
  a.userAnswer = userAnswer;
  a.submitted = true;

  const result = score(q, userAnswer, a.displayOptions);
  a.isCorrect = result.correct;

  // Lock form and mark options
  if (q.type === "single" || q.type === "multi-exact") {
    const correctIdx = correctIndexesFor(q, a.displayOptions);
    lockForm(q, a.displayOptions, els.form, userAnswer, correctIdx);
  } else {
    lockForm(q, a.displayOptions, els.form, null, []);
  }

  renderFeedback(q, a, result);

  els.submit.hidden = true;
  els.next.hidden = false;
  els.next.textContent =
    idx === TEST_SIZE - 1 ? "See results" : "Next question";
  els.next.focus();
}

function renderFeedback(q, a, result) {
  els.feedback.hidden = false;
  const verdict = document.createElement("div");
  verdict.className = "verdict";

  if (result.requiresSelfAssess) {
    els.feedback.className = "feedback";
    if (q.userSpecific) {
      verdict.textContent =
        "This depends on your state or current officials. Did you answer correctly?";
    } else {
      verdict.textContent =
        "Couldn't auto-match your answer. Did you have it right?";
    }
    els.feedback.appendChild(verdict);

    const corr = document.createElement("div");
    corr.className = "correct-answers";
    if (!q.userSpecific) {
      corr.innerHTML =
        "<strong>Accepted answer(s):</strong>" + renderAcceptedList(q);
    } else {
      corr.innerHTML =
        "<em>Your local senator, representative, governor, or current federal official is the correct answer here.</em>";
    }
    els.feedback.appendChild(corr);

    // self-assess controls
    const assess = document.createElement("div");
    assess.className = "self-assess";
    assess.innerHTML = `
      <label><input type="checkbox" id="self-assess-cb" /> I had this right</label>
    `;
    els.feedback.appendChild(assess);
    const cb = assess.querySelector("#self-assess-cb");
    cb.addEventListener("change", () => {
      a.selfAssessed = cb.checked;
      a.isCorrect = cb.checked;
      els.feedback.className = `feedback ${cb.checked ? "correct" : ""}`;
    });
    return;
  }

  els.feedback.className = `feedback ${result.correct ? "correct" : "wrong"}`;
  verdict.textContent = result.correct ? "Correct!" : "Not quite.";
  els.feedback.appendChild(verdict);

  const corr = document.createElement("div");
  corr.className = "correct-answers";
  if (q.type === "single") {
    corr.innerHTML =
      "<strong>Correct answer:</strong> " +
      escapeHTML(q.optionCorrect ? q.optionCorrect[0] : q.correct[0]);
  } else if (q.type === "multi-exact") {
    const items = (q.optionCorrect || q.correct)
      .map((c) => `<li>${escapeHTML(c)}</li>`)
      .join("");
    corr.innerHTML = `<strong>Correct answers:</strong><ul>${items}</ul>`;
  } else {
    corr.innerHTML =
      "<strong>Accepted answer(s):</strong>" + renderAcceptedList(q);
  }
  els.feedback.appendChild(corr);
}

function renderAcceptedList(q) {
  const items = (q.correct || [])
    .map((c) => `<li>${escapeHTML(c)}</li>`)
    .join("");
  return `<ul>${items}</ul>`;
}

async function submitTestResults() {
  const token = getSessionToken();
  if (!token) return;
  const correctCount = state.answers.filter((a) => a.isCorrect).length;
  const questions = state.questions.map((q, i) => {
    const a = state.answers[i];
    return {
      question_id: q.id,
      topic: q.topic,
      correct: a.isCorrect ? 1 : 0,
      user_answer: formatUserAnswer(q, a),
    };
  });
  try {
    await fetch("/tests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ score: correctCount, questions }),
    });
  } catch (_) {}
}

async function fetchAndShowReport() {
  document.getElementById("account-dropdown").hidden = true;
  _prevReportView = Object.keys(views).find((k) => !views[k].hidden) || "welcome";
  const token = getSessionToken();
  if (!token) return;
  let data;
  try {
    const res = await fetch("/report", {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch (_) {
    return;
  }
  renderReport(data);
  showView("report");
}

function renderReport(data) {
  const TOTAL_QUESTIONS = 128;

  // Tests
  const testsList = document.getElementById("report-tests-list");
  const noTests = document.getElementById("report-no-tests");
  testsList.innerHTML = "";
  if (data.tests.length === 0) {
    noTests.hidden = false;
  } else {
    noTests.hidden = true;
    data.tests.forEach((t) => {
      const row = document.createElement("div");
      row.className = "test-history-row";
      const date = new Date(t.taken_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      });
      const chips = t.topics
        .map((tp) => `<span class="topic-chip-sm">${escapeHTML(tp)}</span>`)
        .join("");
      row.innerHTML = `
        <span class="test-date">${date}</span>
        <span class="test-score-badge">${t.score}&thinsp;/&thinsp;20</span>
        <span class="test-topic-chips">${chips}</span>
      `;
      testsList.appendChild(row);
    });
  }

  // Summary
  document.getElementById("report-total-tests").textContent = data.summary.total_tests;
  document.getElementById("report-avg-score").textContent = data.summary.total_tests
    ? `${data.summary.avg_score} / 20`
    : "—";
  document.getElementById("report-unique-q").textContent =
    `${data.summary.unique_questions} / ${TOTAL_QUESTIONS}`;

  const byTopic = document.getElementById("report-by-topic");
  byTopic.innerHTML = "";
  for (const [topic, count] of Object.entries(data.summary.unique_by_topic)) {
    const row = document.createElement("div");
    row.className = "report-stat-row";
    row.innerHTML = `<span>${escapeHTML(topic)}</span><span>${count} seen</span>`;
    byTopic.appendChild(row);
  }

  // Mastery
  const masteryContainer = document.getElementById("report-mastery-rows");
  masteryContainer.innerHTML = "";
  const m = data.mastery;
  const threshold = data.mastery_threshold;
  const seenCount = Object.values(m).reduce((s, c) => s + c, 0);
  const levels = [
    { label: "Never seen",                    count: TOTAL_QUESTIONS - seenCount, color: "var(--border)" },
    { label: "Needs work (0)",                count: m["0"] || 0,                 color: "var(--wrong-border)" },
    { label: "Learning (1)",                  count: m["1"] || 0,                 color: "#f59e0b" },
    { label: "Almost there (2)",              count: m["2"] || 0,                 color: "#3b82f6" },
    { label: `Mastered (${threshold})`,       count: m[String(threshold)] || 0,   color: "var(--correct-border)" },
  ];
  levels.forEach(({ label, count, color }) => {
    const pct = Math.round((count / TOTAL_QUESTIONS) * 100);
    const row = document.createElement("div");
    row.className = "mastery-level-row";
    row.innerHTML = `
      <span class="mastery-label">${label}</span>
      <div class="mastery-bar-wrap">
        <div class="mastery-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="mastery-count">${count}</span>
    `;
    masteryContainer.appendChild(row);
  });
}

function showToolbar() {
  document.getElementById("dropdown-name").textContent = getUserName() || "";
  document.getElementById("dropdown-email").textContent = getSessionEmail() || "";
  document.getElementById("user-toolbar").style.display = "flex";
  document.body.classList.add("has-toolbar");
}

function hideToolbar() {
  document.getElementById("user-toolbar").style.display = "none";
  document.getElementById("account-dropdown").hidden = true;
  document.getElementById("dropdown-name").textContent = "";
  document.getElementById("dropdown-email").textContent = "";
  document.body.classList.remove("has-toolbar");
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gotoNext() {
  if (state.currentIndex < TEST_SIZE - 1) {
    state.currentIndex += 1;
    saveProgress("quiz");
    renderCurrent();
  } else {
    submitTestResults();
    showResults();
  }
}

// ---- Results ----
function showResults() {
  const correctCount = state.answers.filter((a) => a.isCorrect).length;
  const passed = correctCount >= PASS_THRESHOLD;

  document.getElementById("result-headline").textContent = passed
    ? "Nice work!"
    : "Keep studying.";
  document.getElementById("result-score").textContent = String(correctCount);
  const banner = document.getElementById("result-banner");
  banner.className = `banner ${passed ? "pass" : "fail"}`;
  banner.textContent = passed ? "PASSED" : "DID NOT PASS";

  // Topic breakdown
  const byTopic = new Map();
  state.questions.forEach((q, i) => {
    const t = q.topic;
    if (!byTopic.has(t)) byTopic.set(t, { correct: 0, total: 0 });
    const row = byTopic.get(t);
    row.total += 1;
    if (state.answers[i].isCorrect) row.correct += 1;
  });
  const container = document.getElementById("topic-breakdown");
  container.innerHTML = "";
  for (const [topic, row] of byTopic.entries()) {
    const div = document.createElement("div");
    div.className = "topic-row";
    div.innerHTML = `<span>${escapeHTML(topic)}</span><span class="score">${row.correct}/${row.total}</span>`;
    container.appendChild(div);
  }
  showView("results");
  saveProgress("results");
}

// ---- Review ----
function showReview() {
  const list = document.getElementById("review-list");
  list.innerHTML = "";
  state.questions.forEach((q, i) => {
    const a = state.answers[i];
    const item = document.createElement("div");
    item.className = `review-item ${a.isCorrect ? "correct" : "wrong"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent =
      `${a.isCorrect ? "Correct" : "Incorrect"} · Official Q${q.questionNumber} ` +
      `· ${q.topic}${q.subtopic ? " > " + q.subtopic : ""} ` +
      `· page ${q.pageNumber}`;
    item.appendChild(meta);

    const prompt = document.createElement("div");
    prompt.className = "prompt";
    prompt.textContent = q.prompt;
    item.appendChild(prompt);

    const your = document.createElement("div");
    your.className = "your-answer";
    your.innerHTML = `<strong>Your answer:</strong> ${escapeHTML(formatUserAnswer(q, a))}`;
    item.appendChild(your);

    const corr = document.createElement("div");
    corr.className = "correct-answer";
    if (q.userSpecific) {
      corr.innerHTML =
        "<strong>Correct answer:</strong> <em>varies by state / current officials</em>";
    } else {
      const list = (q.optionCorrect || q.correct).join("; ");
      corr.innerHTML = `<strong>Correct answer(s):</strong> ${escapeHTML(list)}`;
    }
    item.appendChild(corr);

    list.appendChild(item);
  });
  showView("review");
  saveProgress("review");
}

function formatUserAnswer(q, a) {
  if (!a.submitted || a.userAnswer === null) return "(no answer)";
  if (q.type === "single") {
    return a.displayOptions[a.userAnswer[0]];
  }
  if (q.type === "multi-exact") {
    return a.userAnswer.map((i) => a.displayOptions[i]).join("; ");
  }
  if (q.type === "open") {
    const txt = String(a.userAnswer);
    if (a.selfAssessed) return `${txt}  (self-assessed correct)`;
    return txt;
  }
  return "(unknown)";
}

// ---- Wiring ----
function wire() {
  document.getElementById("btn-send-code").addEventListener("click", handleSendCode);
  document.getElementById("btn-verify-code").addEventListener("click", handleVerifyCode);
  document.getElementById("btn-resend-code").addEventListener("click", handleResendCode);
  document.getElementById("auth-email-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSendCode();
  });
  document.getElementById("auth-code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleVerifyCode();
  });
  document.getElementById("btn-name-submit").addEventListener("click", handleNameSubmit);
  document.getElementById("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleNameSubmit();
  });
  document.getElementById("btn-learn-mode").addEventListener("click", goToWelcome);
  document.getElementById("btn-start").addEventListener("click", startNewTest);
  els.submit.addEventListener("click", submitAnswer);
  els.next.addEventListener("click", gotoNext);
  document.getElementById("btn-review").addEventListener("click", showReview);
  document.getElementById("btn-retake").addEventListener("click", goToWelcome);
  document.getElementById("btn-retake-2").addEventListener("click", goToWelcome);
  document
    .getElementById("btn-back-results")
    .addEventListener("click", () => showView("results"));

  document.getElementById("btn-report").addEventListener("click", fetchAndShowReport);
  document.getElementById("btn-back-report").addEventListener("click", () => showView(_prevReportView));

  document.getElementById("btn-restart").addEventListener("click", () => {
    document.getElementById("account-dropdown").hidden = true;
    goToWelcome();
  });

  document.getElementById("btn-account").addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = document.getElementById("account-dropdown");
    dd.hidden = !dd.hidden;
  });

  document.getElementById("btn-logout").addEventListener("click", () => {
    localStorage.clear();
    state = null;
    allQuestions = [];
    pendingEmail = null;
    hideToolbar();
    document.getElementById("auth-email-input").value = "";
    document.getElementById("auth-email-error").hidden = true;
    showView("authEmail");
  });

  document.addEventListener("click", () => {
    document.getElementById("account-dropdown").hidden = true;
  });
}

async function init() {
  wire();
  if (!getSessionToken()) {
    showView("authEmail");
    return;
  }
  await loadAndProceed();
}

init();
