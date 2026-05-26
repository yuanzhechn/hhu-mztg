const rawData = window.MAOGAI_QUESTION_DATA;
const chapters = rawData.chapters.map((chapter) => ({
  ...chapter,
  points: Array.isArray(chapter.points) ? chapter.points : [],
  questions: Array.isArray(chapter.questions) ? chapter.questions : [],
}));
const allQuestions = chapters.flatMap((chapter) =>
  chapter.questions.map((question) => ({
    ...question,
    chapterTitle: chapter.title,
    chapterNumber: chapter.chapter,
  })),
);
const questionMap = new Map(allQuestions.map((question) => [question.id, question]));

const STORAGE_KEY = "maogai-review-local-v2";
const GUIDE_KEY = "maogai-guide-local-v1";
const modes = [
  { key: "points", label: "考点速览" },
  { key: "practice", label: "章节刷题" },
  { key: "wrong", label: "错题本" },
  { key: "rush", label: "考前速刷" },
];
const guideSteps = [
  {
    title: "章节刷题",
    text: "按 8 章节顺序练习，答错的题自动收进错题本，不用手动标记。",
  },
  {
    title: "错题本",
    text: "回头集中复习刷错的题；记住的随手移出，剩下的都是真没掌握。",
  },
  {
    title: "考前速刷",
    text: "临考前快速过一遍易错点，错题快过 / 全章快过两种节奏。",
  },
];

const els = {
  heroCount: document.querySelector("#heroCount"),
  heroCta: document.querySelector("#heroCta"),
  modeNav: document.querySelector(".mode-nav"),
  modeContent: document.querySelector("#modeContent"),
  guideBtn: document.querySelector("#guideBtn"),
  guideModal: document.querySelector("#guideModal"),
  guideClose: document.querySelector("#guideClose"),
  guideSkip: document.querySelector("#guideSkip"),
  guideNext: document.querySelector("#guideNext"),
  guideStep: document.querySelector("#guideStep"),
  guideTitle: document.querySelector("#guideTitle"),
  guideText: document.querySelector("#guideText"),
};

const defaultState = {
  rememberedPoints: [],
  wrongQuestionIds: [],
  practiceIndex: {},
  practiceStats: {},
  practiceResults: {},
  mode: "practice",
  selectedChapter: 1,
  wrongIndex: 0,
  rushMode: "wrong",
  rushIndex: 0,
};

let state = loadState();
let activeQuestionId = null;
let activeSelected = [];
let activeSubmitted = false;
let activeCorrect = false;
let guideIndex = 0;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      ...defaultState,
      ...saved,
      rememberedPoints: Array.isArray(saved.rememberedPoints) ? saved.rememberedPoints : [],
      wrongQuestionIds: Array.isArray(saved.wrongQuestionIds) ? saved.wrongQuestionIds : [],
      practiceIndex: saved.practiceIndex && typeof saved.practiceIndex === "object" ? saved.practiceIndex : {},
      practiceStats: saved.practiceStats && typeof saved.practiceStats === "object" ? saved.practiceStats : {},
      practiceResults: saved.practiceResults && typeof saved.practiceResults === "object" ? saved.practiceResults : {},
      selectedChapter: Number.isInteger(saved.selectedChapter) ? saved.selectedChapter : 1,
      mode: modes.some((mode) => mode.key === saved.mode) ? saved.mode : "practice",
      wrongIndex: Number.isInteger(saved.wrongIndex) ? saved.wrongIndex : 0,
      rushMode: ["wrong", "all"].includes(saved.rushMode) ? saved.rushMode : "wrong",
      rushIndex: Number.isInteger(saved.rushIndex) ? saved.rushIndex : 0,
    };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function answerLetter(option, index) {
  const match = String(option).match(/^([A-Z])\s*[.．、]/);
  return match ? match[1] : String.fromCharCode(65 + index);
}

function sortedLetters(letters) {
  return [...(letters || [])].map(String).sort();
}

function isCorrectAnswer(question, selected) {
  const answer = sortedLetters(question.answer);
  const picked = sortedLetters(selected);
  return answer.length === picked.length && answer.every((letter, index) => letter === picked[index]);
}

function resetActive() {
  activeQuestionId = null;
  activeSelected = [];
  activeSubmitted = false;
  activeCorrect = false;
}

function ensureActive(question) {
  if (!question || activeQuestionId === question.id) return;
  activeQuestionId = question.id;
  activeSelected = [];
  activeSubmitted = false;
  activeCorrect = false;
}

function selectedChapter() {
  return chapters.find((chapter) => chapter.chapter === state.selectedChapter) || chapters[0];
}

function selectedChapterQuestions() {
  return selectedChapter().questions.map((question) => questionMap.get(question.id)).filter(Boolean);
}

function currentPracticeIndex(questions) {
  const chapter = selectedChapter();
  const max = Math.max(questions.length - 1, 0);
  const index = Math.min(state.practiceIndex[chapter.chapter] || 0, max);
  state.practiceIndex[chapter.chapter] = index;
  return index;
}

function currentQuestion() {
  if (state.mode === "practice") {
    const questions = selectedChapterQuestions();
    return questions[currentPracticeIndex(questions)];
  }
  if (state.mode === "wrong") {
    const questions = wrongQuestions();
    state.wrongIndex = Math.min(state.wrongIndex, Math.max(questions.length - 1, 0));
    return questions[state.wrongIndex];
  }
  if (state.mode === "rush") {
    const questions = rushQuestions();
    state.rushIndex = Math.min(state.rushIndex, Math.max(questions.length - 1, 0));
    return questions[state.rushIndex];
  }
  return null;
}

function wrongQuestions() {
  return state.wrongQuestionIds.map((id) => questionMap.get(id)).filter(Boolean);
}

function rushQuestions() {
  return state.rushMode === "wrong" ? wrongQuestions() : allQuestions;
}

function addWrong(id) {
  if (!state.wrongQuestionIds.includes(id)) {
    state.wrongQuestionIds = [...state.wrongQuestionIds, id];
  }
}

function removeWrong(id) {
  state.wrongQuestionIds = state.wrongQuestionIds.filter((wrongId) => wrongId !== id);
  state.wrongIndex = Math.min(state.wrongIndex, Math.max(state.wrongQuestionIds.length - 1, 0));
  resetActive();
  saveState();
  render();
}

function recordPracticeResult(question, correct) {
  const chapter = question.chapterNumber || question.chapter;
  const stats = state.practiceStats[chapter] || { right: 0, total: 0 };
  state.practiceStats = {
    ...state.practiceStats,
    [chapter]: {
      right: stats.right + (correct ? 1 : 0),
      total: stats.total + 1,
    },
  };
  state.practiceResults = {
    ...state.practiceResults,
    [chapter]: {
      ...(state.practiceResults[chapter] || {}),
      [question.id]: correct ? "correct" : "wrong",
    },
  };
  if (!correct) addWrong(question.id);
}

function finishAnswer(question, selected) {
  activeSelected = sortedLetters(selected);
  activeSubmitted = true;
  activeCorrect = isCorrectAnswer(question, activeSelected);

  if (state.mode === "practice") {
    recordPracticeResult(question, activeCorrect);
  } else if (state.mode === "rush" && !activeCorrect) {
    addWrong(question.id);
  }

  saveState();
  render();
}

function render() {
  renderHero();
  renderModeNav();
  renderMode();
}

function renderHero() {
  const chapter = selectedChapter();
  const questions = selectedChapterQuestions();
  const index = currentPracticeIndex(questions);
  const stats = state.practiceStats[chapter.chapter];
  const label = stats && stats.total > 0
    ? `继续:第${chapter.chapter}章 · ${index + 1}/${questions.length}`
    : `开始刷题 · 第${chapter.chapter}章`;
  els.heroCount.textContent = `${allQuestions.length} 题刷完。`;
  els.heroCta.textContent = label;
}

function renderModeNav() {
  for (const button of els.modeNav.querySelectorAll(".mode-button")) {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  }
}

function renderMode() {
  if (state.mode === "points") renderPointsMode();
  if (state.mode === "practice") renderPracticeMode();
  if (state.mode === "wrong") renderWrongMode();
  if (state.mode === "rush") renderRushMode();
}

function chapterTabs() {
  return `
    <div class="chapter-tabs" data-action="chapter-tabs">
      ${chapters.map((chapter) => `
        <button class="chapter-tab ${chapter.chapter === state.selectedChapter ? "active" : ""}" type="button" data-chapter="${chapter.chapter}">
          <strong>第${chapter.chapter}章</strong>
          <span>${escapeHtml(chapter.title)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderPointsMode() {
  const chapter = selectedChapter();
  els.modeContent.innerHTML = `
    <div class="mode-stack">
      ${chapterTabs()}
      <section class="shell-card points-card">
        <p class="section-kicker">第${chapter.chapter}章</p>
        <h2>${escapeHtml(chapter.title)}</h2>
        <div class="point-list">
          ${chapter.points.map((point, index) => {
            const id = `ch${chapter.chapter}-point-${index}`;
            const remembered = state.rememberedPoints.includes(id);
            return `
              <button class="point-button ${remembered ? "remembered" : ""}" type="button" data-point="${id}">
                <span class="point-badge">${remembered ? "✓" : index + 1}</span>
                <span class="point-text">${escapeHtml(point)}</span>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderPracticeMode() {
  const chapter = selectedChapter();
  const questions = selectedChapterQuestions();
  const index = currentPracticeIndex(questions);
  const question = questions[index];
  const stats = state.practiceStats[chapter.chapter] || { right: 0, total: 0 };
  const results = state.practiceResults[chapter.chapter] || {};
  ensureActive(question);

  els.modeContent.innerHTML = `
    <div class="mode-stack">
      ${chapterTabs()}
      ${stats.total > 0 ? `
        <div class="stat-grid">
          <div class="stat-card"><strong>${questions.length}</strong><span>本章题量</span></div>
          <div class="stat-card"><strong>${stats.right}</strong><span>累计正确</span></div>
          <div class="stat-card"><strong>${stats.total}</strong><span>累计已答</span></div>
        </div>
      ` : ""}
      ${renderNavigator(questions, index, results)}
      ${renderQuestionCard(question, `第${chapter.chapter}章 · ${index + 1}/${questions.length}`, "下一题")}
    </div>
  `;
}

function renderWrongMode() {
  const questions = wrongQuestions();
  state.wrongIndex = Math.min(state.wrongIndex, Math.max(questions.length - 1, 0));
  const question = questions[state.wrongIndex];

  if (!questions.length) {
    resetActive();
    els.modeContent.innerHTML = `
      <section class="shell-card empty-card">
        <h2>错题本是空的</h2>
        <p>去章节刷题里答几道题，答错会自动收进这里。</p>
      </section>
    `;
    return;
  }

  ensureActive(question);
  els.modeContent.innerHTML = `
    <div class="mode-stack">
      <section class="shell-card wrong-head">
        <div>
          <p class="section-kicker">错题本</p>
          <h2>当前 ${questions.length} 题</h2>
        </div>
        <button class="danger-outline" type="button" data-action="clear-wrong">清空错题</button>
      </section>
      ${renderQuestionCard(question, `错题复习 · ${state.wrongIndex + 1}/${questions.length} · 第${question.chapterNumber}章`, "下一题", true)}
    </div>
  `;
}

function renderRushMode() {
  const questions = rushQuestions();
  state.rushIndex = Math.min(state.rushIndex, Math.max(questions.length - 1, 0));
  const question = questions[state.rushIndex];

  if (!questions.length) {
    resetActive();
  } else {
    ensureActive(question);
  }

  els.modeContent.innerHTML = `
    <div class="mode-stack">
      <div class="rush-grid">
        <button class="rush-card ${state.rushMode === "wrong" ? "active" : ""}" type="button" data-rush="wrong">
          <h2>错题快过</h2>
          <p>只跑错题本里的题，适合考前补漏洞。</p>
        </button>
        <button class="rush-card ${state.rushMode === "all" ? "active" : ""}" type="button" data-rush="all">
          <h2>全章快过</h2>
          <p>8 章题库快速轮转，适合考前扫一遍。</p>
        </button>
      </div>
      ${questions.length
        ? renderQuestionCard(question, state.rushMode === "wrong" ? `错题快过 · ${state.rushIndex + 1}/${questions.length}` : `全章快过 · ${state.rushIndex + 1}/${questions.length}`, "继续速刷")
        : `<section class="shell-card empty-card"><h2>暂无可速刷题目</h2><p>错题快过需要先在刷题中产生错题。</p></section>`}
    </div>
  `;
}

function renderNavigator(questions, currentIndex, results) {
  if (questions.length <= 1) return "";
  const summary = questions.reduce((acc, question) => {
    const result = results[question.id];
    if (!result) return acc;
    acc.answered += 1;
    acc.correct += result === "correct" ? 1 : 0;
    acc.wrong += result === "wrong" ? 1 : 0;
    return acc;
  }, { answered: 0, correct: 0, wrong: 0 });

  return `
    <section class="shell-card question-navigator">
      <div class="navigator-head">
        <div>
          <p class="navigator-kicker">答题卡</p>
          <h2>可直接跳到任意题</h2>
        </div>
        <p class="navigator-status">当前第 ${currentIndex + 1} / ${questions.length} 题 · 已做 ${summary.answered} · 对 ${summary.correct} · 错 ${summary.wrong}</p>
      </div>
      <div class="legend-row" aria-label="答题卡状态说明">
        <span><i class="dot"></i>未做</span>
        <span><i class="dot correct"></i>正确</span>
        <span><i class="dot wrong"></i>错误</span>
      </div>
      <div class="jump-grid">
        ${questions.map((question, index) => {
          const result = results[question.id] || "pending";
          const label = result === "correct" ? "正确" : result === "wrong" ? "错误" : "未做";
          return `
            <button class="jump-button ${index === currentIndex ? "active" : ""} ${result !== "pending" ? result : ""}" type="button" data-jump="${index}" aria-label="第 ${index + 1} 题, ${label}">
              ${index + 1}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderQuestionCard(question, eyebrow, nextLabel, removable = false) {
  if (!question) {
    return `
      <section class="shell-card empty-card">
        <h2>暂无题目</h2>
        <p>当前范围还没有可刷题目。</p>
      </section>
    `;
  }

  const answerSet = new Set(sortedLetters(question.answer));
  const options = question.options.map((option, index) => {
    const letter = answerLetter(option, index);
    const selected = activeSelected.includes(letter);
    const isAnswer = answerSet.has(letter);
    const classNames = ["answer-button"];
    if (!activeSubmitted && selected) classNames.push("selected");
    if (activeSubmitted && isAnswer) classNames.push("correct");
    if (activeSubmitted && selected && !isAnswer) classNames.push("wrong");
    return `
      <button class="${classNames.join(" ")}" type="button" data-answer="${letter}">
        ${escapeHtml(option)}
      </button>
    `;
  }).join("");

  return `
    <article class="shell-card question-card" data-question="${question.id}">
      <header class="question-card-head">
        <span class="question-eyebrow">${escapeHtml(eyebrow)}</span>
        <span class="question-type">${question.type === "multi" ? "多选" : "单选"}</span>
      </header>
      <div class="question-card-body">
        <h2 class="question-title">${escapeHtml(question.stem)}</h2>
        <div class="option-list">${options}</div>
        ${question.type === "multi" && !activeSubmitted ? `
          <div class="multi-submit-row">
            <p>已选 ${activeSelected.length} 个 · 选好后点提交，可反复修改</p>
            <button class="small-primary" type="button" data-action="submit-answer" ${activeSelected.length ? "" : "disabled"}>提交答案</button>
          </div>
        ` : ""}
        ${activeSubmitted ? `
          <div class="next-row">
            <button class="small-primary" type="button" data-action="next-question">${escapeHtml(nextLabel)}</button>
          </div>
          ${renderReview(question)}
          ${removable ? `<div class="next-row"><button class="small-ghost" type="button" data-action="remove-wrong">从错题本移除</button></div>` : ""}
        ` : ""}
      </div>
    </article>
  `;
}

function renderReview(question) {
  const answer = sortedLetters(question.answer);
  const correctOptions = question.options.filter((option, index) => answer.includes(answerLetter(option, index)));
  const explanation = String(question.explanation || "").trim();
  return `
    <div class="review-box">
      <p class="review-result ${activeCorrect ? "correct" : "wrong"}">${activeCorrect ? "答对了" : "这题没答对"}</p>
      <div class="review-detail">
        <p><span class="muted-label">正确答案:</span>${answer.join("、")}</p>
        <div class="review-options">
          <p>正确选项</p>
          ${correctOptions.map((option) => `<p>${escapeHtml(option)}</p>`).join("")}
        </div>
        <p><span class="muted-label">你选的:</span>${activeSelected.length ? activeSelected.join("、") : "未选择"}</p>
        <p><span class="muted-label">解析:</span>${explanation ? escapeHtml(explanation) : "本题暂无解析"}</p>
        <p><span class="muted-label">来源:</span>${escapeHtml(question.source || "一手公开资料")}</p>
      </div>
    </div>
  `;
}

function goNext() {
  if (state.mode === "practice") {
    const chapter = selectedChapter();
    const questions = selectedChapterQuestions();
    const index = currentPracticeIndex(questions);
    state.practiceIndex[chapter.chapter] = (index + 1) % Math.max(questions.length, 1);
  } else if (state.mode === "wrong") {
    const questions = wrongQuestions();
    state.wrongIndex = (state.wrongIndex + 1) % Math.max(questions.length, 1);
  } else if (state.mode === "rush") {
    const questions = rushQuestions();
    state.rushIndex = (state.rushIndex + 1) % Math.max(questions.length, 1);
  }
  resetActive();
  saveState();
  render();
}

function showGuide(startIndex = 0) {
  guideIndex = startIndex;
  renderGuide();
  els.guideModal.classList.remove("hidden");
}

function hideGuide() {
  localStorage.setItem(GUIDE_KEY, "1");
  els.guideModal.classList.add("hidden");
}

function renderGuide() {
  const step = guideSteps[guideIndex];
  els.guideStep.textContent = `第 ${guideIndex + 1} 步 / 共 ${guideSteps.length} 步`;
  els.guideTitle.textContent = step.title;
  els.guideText.textContent = step.text;
  els.guideNext.textContent = guideIndex === guideSteps.length - 1 ? "开始使用" : "下一步";
}

els.modeNav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  state.mode = button.dataset.mode;
  resetActive();
  saveState();
  render();
});

els.heroCta.addEventListener("click", () => {
  state.mode = "practice";
  resetActive();
  saveState();
  render();
  window.scrollTo({ top: 180, behavior: "smooth" });
});

els.modeContent.addEventListener("click", (event) => {
  const chapterButton = event.target.closest("button[data-chapter]");
  if (chapterButton) {
    state.selectedChapter = Number(chapterButton.dataset.chapter);
    resetActive();
    saveState();
    render();
    return;
  }

  const pointButton = event.target.closest("button[data-point]");
  if (pointButton) {
    const pointId = pointButton.dataset.point;
    state.rememberedPoints = state.rememberedPoints.includes(pointId)
      ? state.rememberedPoints.filter((id) => id !== pointId)
      : [...state.rememberedPoints, pointId];
    saveState();
    render();
    return;
  }

  const jumpButton = event.target.closest("button[data-jump]");
  if (jumpButton) {
    const chapter = selectedChapter();
    state.practiceIndex[chapter.chapter] = Number(jumpButton.dataset.jump);
    resetActive();
    saveState();
    render();
    return;
  }

  const rushButton = event.target.closest("button[data-rush]");
  if (rushButton) {
    state.rushMode = rushButton.dataset.rush;
    state.rushIndex = 0;
    resetActive();
    saveState();
    render();
    return;
  }

  const actionButton = event.target.closest("button[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === "submit-answer") {
      const question = currentQuestion();
      if (question && activeSelected.length) finishAnswer(question, activeSelected);
    }
    if (action === "next-question") goNext();
    if (action === "remove-wrong") {
      const question = currentQuestion();
      if (question) removeWrong(question.id);
    }
    if (action === "clear-wrong" && window.confirm(`确定清空全部 ${state.wrongQuestionIds.length} 道错题？此操作无法撤销。`)) {
      state.wrongQuestionIds = [];
      state.wrongIndex = 0;
      resetActive();
      saveState();
      render();
    }
    return;
  }

  const answerButton = event.target.closest("button[data-answer]");
  if (!answerButton || activeSubmitted) return;
  const question = currentQuestion();
  if (!question) return;
  const letter = answerButton.dataset.answer;
  if (question.type === "single") {
    finishAnswer(question, [letter]);
    return;
  }
  activeSelected = activeSelected.includes(letter)
    ? activeSelected.filter((selected) => selected !== letter)
    : sortedLetters([...activeSelected, letter]);
  render();
});

els.guideBtn.addEventListener("click", () => showGuide(0));
els.guideClose.addEventListener("click", hideGuide);
els.guideSkip.addEventListener("click", hideGuide);
els.guideNext.addEventListener("click", () => {
  if (guideIndex >= guideSteps.length - 1) {
    hideGuide();
    return;
  }
  guideIndex += 1;
  renderGuide();
});
els.guideModal.addEventListener("click", (event) => {
  if (event.target === els.guideModal) hideGuide();
});

render();
if (!localStorage.getItem(GUIDE_KEY)) showGuide(0);
