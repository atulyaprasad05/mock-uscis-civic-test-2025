import { selectQuestions, TEST_SIZE } from "./selector.js";
import {
  buildOptionsForInstance,
  renderQuestion,
  lockForm,
} from "./renderers.js";
import { score, correctIndexesFor } from "./scorer.js";

const PASS_THRESHOLD = 12;
const STORAGE_KEY = "civics_quiz_progress";

const views = {
  welcome: document.getElementById("view-welcome"),
  quiz: document.getElementById("view-quiz"),
  results: document.getElementById("view-results"),
  review: document.getElementById("view-review"),
};

function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    el.hidden = k !== name;
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

let allQuestions = [];
let state = null; // { questions, answers, currentIndex }

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

async function loadQuestionBank() {
  const res = await fetch("data/questions.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load questions.json: ${res.status}`);
  const data = await res.json();
  return data.questions;
}

function startNewTest() {
  localStorage.removeItem(STORAGE_KEY);
  const picked = selectQuestions(allQuestions);
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
  document.getElementById("btn-start").addEventListener("click", startNewTest);
  els.submit.addEventListener("click", submitAnswer);
  els.next.addEventListener("click", gotoNext);
  document.getElementById("btn-review").addEventListener("click", showReview);
  document.getElementById("btn-retake").addEventListener("click", startNewTest);
  document.getElementById("btn-retake-2").addEventListener("click", startNewTest);
  document
    .getElementById("btn-back-results")
    .addEventListener("click", () => showView("results"));
}

async function init() {
  wire();
  try {
    allQuestions = await loadQuestionBank();
  } catch (err) {
    const card = document.querySelector("#view-welcome .card");
    card.innerHTML =
      '<h2 style="color:var(--accent)">Failed to load question bank</h2>' +
      `<p>${escapeHTML(err.message)}</p>` +
      '<p>If you opened <code>index.html</code> directly, modules/fetch won\'t work over <code>file://</code>. ' +
      'Run a local server, e.g. <code>python -m http.server 8000</code> and visit ' +
      '<code>http://localhost:8000/</code>.</p>';
    return;
  }

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
    }
  }
}

init();
