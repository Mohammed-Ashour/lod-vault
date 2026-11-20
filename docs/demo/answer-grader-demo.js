// Demo of LodVaultAnswerGrader: a live answer box and a table of cases.
(() => {
  const grader = globalThis.LodVaultAnswerGrader;
  const LABELS = {
    exact: ["Correct", "is-correct"],
    case: ["Correct · capital", "is-correct"],
    nrule: ["Correct · n-rule", "is-correct"],
    accent: ["Correct · accent slip", "is-close"],
    typo: ["Typo?", "is-close"],
    wrong: ["Wrong", "is-wrong"],
    empty: ["No answer", "is-wrong"]
  };
  const GRADE_NAMES = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

  function verdictChip(result) {
    const [label, className] = LABELS[result.verdict];
    const chip = document.createElement("span");
    chip.className = `answer-verdict ${className}`;
    chip.textContent = label;
    return chip;
  }

  const input = document.getElementById("answer");
  document.getElementById("keys").append(grader.createAccentButtons(document, input));
  const resultBox = document.getElementById("result");

  function check() {
    const result = grader.grade(input.value, "Schwësteren", { noun: true });
    resultBox.replaceChildren(verdictChip(result), grader.renderDiff(document, result.diff));
    const notes = grader.describeNotes(result.notes);
    if (result.verdict === "typo") notes.push("Count it (Hard) or mark it wrong (Again)?");
    notes.push(`Grade: ${GRADE_NAMES[result.verdict === "typo" ? result.typoGrade : result.grade]}${result.verdict === "typo" ? " if counted" : ""}`);
    const list = document.createElement("ul");
    list.className = "answer-notes";
    for (const note of notes) {
      const item = document.createElement("li");
      item.textContent = note;
      list.append(item);
    }
    resultBox.append(list);
  }
  document.getElementById("check").addEventListener("click", check);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") check(); });

  const CASES = [
    ["Haiser", "Haiser", {}],
    ["Haiser.", "Haiser", {}],
    ["haiser", "Haiser", { noun: true }],
    ["mechs", "méchs", {}],
    ["schwester", "Schwëster", { noun: true }],
    ["gaang", "gaangen / gaang", {}],
    ["gemaacht", "gemaach · gemaacht", {}],
    ["Frae", "Fraen", { nRule: { Fraen: "Frae" } }],
    ["gaangn", "gaangen", {}],
    ["Schwëtser", "Schwëster", {}],
    ["geet", "gees", {}],
    ["Schwe:ster", "Schwëster", { aliases: true }],
    ["", "Haus", {}]
  ];
  const body = document.querySelector("#table tbody");
  for (const [typed, expected, options] of CASES) {
    const result = grader.grade(typed, expected, options);
    const row = document.createElement("tr");
    const cells = [typed || "∅", expected, Object.keys(options).map((key) => key === "nRule" ? "nRule" : key).join(", ") || "–"];
    for (const text of cells) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    const verdict = document.createElement("td");
    verdict.append(verdictChip(result));
    const gradeCell = document.createElement("td");
    gradeCell.textContent = result.verdict === "typo" ? `Again / ${GRADE_NAMES[result.typoGrade]}` : GRADE_NAMES[result.grade];
    const diff = document.createElement("td");
    diff.append(grader.renderDiff(document, result.diff));
    row.append(verdict, gradeCell, diff);
    body.append(row);
  }
})();
