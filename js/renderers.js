import { shuffle } from "./selector.js";

/** Build the options array shown to the user for a given question instance.
 * Stored on the answer record so review screen can reuse the same option set. */
export function buildOptionsForInstance(question) {
  if (question.type === "single" || question.type === "multi-exact") {
    return shuffle(question.options);
  }
  return null;
}

function makeChoiceOption(name, value, label, type) {
  const wrap = document.createElement("label");
  wrap.className = "option";
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  const span = document.createElement("span");
  span.className = "label";
  span.textContent = label;
  wrap.appendChild(input);
  wrap.appendChild(span);
  return wrap;
}

/** Render the form for a question. Returns helpers the controller uses. */
export function renderQuestion(question, displayOptions, formEl, hintEl) {
  formEl.innerHTML = "";
  hintEl.hidden = true;
  hintEl.textContent = "";

  if (question.type === "single") {
    for (let i = 0; i < displayOptions.length; i++) {
      formEl.appendChild(
        makeChoiceOption("answer", String(i), displayOptions[i], "radio"),
      );
    }
    return {
      readAnswer: () => {
        const checked = formEl.querySelector('input[name="answer"]:checked');
        return checked ? [parseInt(checked.value, 10)] : null;
      },
      isReady: () => !!formEl.querySelector('input[name="answer"]:checked'),
    };
  }

  if (question.type === "multi-exact") {
    const need = question.requiredCount;
    hintEl.hidden = false;
    hintEl.textContent = `Select exactly ${need}.`;
    for (let i = 0; i < displayOptions.length; i++) {
      formEl.appendChild(
        makeChoiceOption("answer", String(i), displayOptions[i], "checkbox"),
      );
    }
    return {
      readAnswer: () => {
        const checked = Array.from(
          formEl.querySelectorAll('input[name="answer"]:checked'),
        ).map((el) => parseInt(el.value, 10));
        return checked.length ? checked : null;
      },
      isReady: () => {
        const n = formEl.querySelectorAll('input[name="answer"]:checked').length;
        return n === need;
      },
    };
  }

  if (question.type === "open") {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-input";
    input.name = "answer";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Type your answer";
    formEl.appendChild(input);
    if (question.userSpecific) {
      hintEl.hidden = false;
      hintEl.textContent =
        "This depends on your state or current officials. Type your answer, then self-assess after submitting.";
    }
    return {
      readAnswer: () => {
        const v = input.value.trim();
        return v ? v : null;
      },
      isReady: () => input.value.trim().length > 0,
      focus: () => input.focus(),
    };
  }

  throw new Error(`Unknown question type: ${question.type}`);
}

/** Lock the form and visually mark correct/wrong options. */
export function lockForm(question, displayOptions, formEl, userIndexes, correctIndexes) {
  if (question.type === "single" || question.type === "multi-exact") {
    const labels = formEl.querySelectorAll("label.option");
    labels.forEach((label, idx) => {
      label.classList.add("locked");
      const input = label.querySelector("input");
      input.disabled = true;
      const isCorrect = correctIndexes.includes(idx);
      const wasPicked = userIndexes && userIndexes.includes(idx);
      if (isCorrect) label.classList.add("correct");
      if (wasPicked && !isCorrect) label.classList.add("wrong");
    });
    return;
  }
  if (question.type === "open") {
    const input = formEl.querySelector("input.text-input");
    if (input) input.disabled = true;
  }
}
