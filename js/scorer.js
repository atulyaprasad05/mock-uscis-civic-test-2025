import { isFuzzyMatch } from "./fuzzy.js";

/** correctIndexes: indexes into displayOptions that are correct answers. */
export function correctIndexesFor(question, displayOptions) {
  if (question.type !== "single" && question.type !== "multi-exact") return [];
  const correctSet = new Set(question.optionCorrect || question.correct);
  const result = [];
  displayOptions.forEach((opt, i) => {
    if (correctSet.has(opt)) result.push(i);
  });
  return result;
}

/** Returns { correct: bool, requiresSelfAssess: bool, fuzzyScore?: number } */
export function score(question, userAnswer, displayOptions) {
  if (question.type === "single") {
    if (!userAnswer || userAnswer.length !== 1) {
      return { correct: false, requiresSelfAssess: false };
    }
    const picked = displayOptions[userAnswer[0]];
    const correctSet = new Set(question.optionCorrect || question.correct);
    return { correct: correctSet.has(picked), requiresSelfAssess: false };
  }

  if (question.type === "multi-exact") {
    const need = question.requiredCount;
    if (!userAnswer || userAnswer.length !== need) {
      return { correct: false, requiresSelfAssess: false };
    }
    const correctSet = new Set(question.optionCorrect || question.correct);
    for (const idx of userAnswer) {
      const opt = displayOptions[idx];
      if (!correctSet.has(opt)) {
        return { correct: false, requiresSelfAssess: false };
      }
    }
    return { correct: true, requiresSelfAssess: false };
  }

  if (question.type === "open") {
    if (question.userSpecific) {
      return { correct: false, requiresSelfAssess: true };
    }
    const candidates = question.acceptableAnswers || question.correct;
    const matched = isFuzzyMatch(userAnswer, candidates);
    if (matched) return { correct: true, requiresSelfAssess: false };
    return { correct: false, requiresSelfAssess: true };
  }

  throw new Error(`Unknown question type: ${question.type}`);
}
