// Flow for study/p2-grader: the grader demo page (docs/demo/answer-grader.html).
const URL = "/docs/demo/answer-grader.html";

async function answer(page, text) {
  await page.eval(`(() => { const input = document.getElementById("answer"); input.value = ""; input.focus(); })()`);
  await page.type("#answer", text);
}

export default [
  {
    name: "grader-table-dark",
    url: URL, width: 900, height: 820, scale: 2, theme: "dark",
    async run(page) {
      await page.shot("grader-cases-dark.png", "#table");
    }
  },
  {
    name: "grader-table-light",
    url: URL, width: 900, height: 820, scale: 2, theme: "light",
    async run(page) {
      await page.shot("grader-cases-light.png", "#table");
    }
  },
  {
    name: "grader-gif",
    url: URL, width: 900, height: 420, theme: "dark",
    async run(page) {
      await page.gif("grader-accent-slip.gif", async ({ hold }) => {
        await hold(500);
        await answer(page, "schwesteren");
        await hold(300);
        await page.click("#check");
        await hold(2200);
        await answer(page, "Schw");
        await page.click(".accent-key");
        await page.type("#answer", "steren");
        await hold(300);
        await page.click("#check");
        await hold(2000);
        await answer(page, "Schwëtseren");
        await page.click("#check");
        await hold(2200);
      }, { selector: "#live", width: 800 });
    }
  }
];
