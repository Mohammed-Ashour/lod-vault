// Flows for study/p2-exercises: the exercise components in the demo page
// docs/demo/exercises.html, fed by lexicons parsed from the LOD fixtures.
const page = (hash, query = "") => `/docs/demo/exercises.html${query}#${hash}`;
const GIF = { width: 760, height: 560, theme: "dark" };

// Changing only the hash doesn't reload the demo, so reload in that case.
async function open(page, hash, query = "") {
  await page.eval(`(() => {
    const next = new URL(${JSON.stringify(page_url(hash, query))}, location.href);
    if (next.pathname + next.search === location.pathname + location.search) {
      location.hash = next.hash;
      location.reload();
    } else {
      location.href = next.href;
    }
  })()`);
  await page.wait(900);
}
function page_url(hash, query) {
  return page(hash, query);
}

async function typeAnswer(page, selector, text) {
  await page.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await page.type(selector, text);
}

export default [
  {
    name: "gender-gif", url: page("g:HAUS1"), ...GIF,
    async run(p) {
      await p.gif("gender-right-and-wrong.gif", async ({ hold }) => {
        await hold(1200);
        await p.key("l");
        await hold(2200);
        await p.key("Enter");
        await hold(1000);
        await open(p, "g:FRA1");
        await hold(1200);
        await p.click('[data-gender="m"]');
        await hold(2600);
        await p.click(".ex-continue");
        await hold(1000);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  {
    name: "plural-gif", url: page("pl:MANN1"), ...GIF,
    async run(p) {
      await p.gif("plural-accent-slip.gif", async ({ hold }) => {
        await hold(1000);
        await typeAnswer(p, ".ex-input", "Manner");
        await hold(500);
        await p.click(".ex-submit");
        await hold(2800);
        await p.click(".ex-continue");
        await hold(900);
        await open(p, "pl:FRA1");
        await hold(700);
        await typeAnswer(p, ".ex-input", "Frae");
        await p.click(".ex-submit");
        await hold(2600);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  {
    name: "perfect-gif", url: page("pp:GOEN1"), ...GIF,
    async run(p) {
      await p.gif("perfect-aux-and-participle.gif", async ({ hold }) => {
        await hold(1000);
        await p.click('[data-aux="sinn"]');
        await hold(400);
        await typeAnswer(p, ".ex-input", "gaangen");
        await hold(400);
        await p.click(".ex-submit");
        await hold(2400);
        await p.click(".ex-continue");
        await hold(800);
        await open(p, "pp:MAACHEN1");
        await hold(800);
        await p.click('[data-aux="sinn"]');
        await hold(300);
        await typeAnswer(p, ".ex-input", "gemaach");
        await p.click(".ex-submit");
        await hold(2800);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  {
    name: "cloze-gif", url: page("cz:MAACHEN1", "?sense=2&ex=0"), ...GIF,
    async run(p) {
      const answers = await p.eval(`[...document.querySelectorAll(".ex-input")].map((input) => input.dataset.expected)`);
      await p.gif("cloze-with-example-audio.gif", async ({ hold }) => {
        await hold(1400);
        for (const [index, answer] of answers.entries()) {
          await p.eval(`document.querySelectorAll(".ex-input")[${index}].focus()`);
          await p.type(".ex-input:focus", answer);
          await hold(300);
        }
        await hold(400);
        await p.click(".ex-submit");
        await hold(3400);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  {
    name: "sense-gif", url: page("sd:HAUS1", "?seed=3"), ...GIF,
    async run(p) {
      await p.gif("which-meaning.gif", async ({ hold }) => {
        await hold(1800);
        const right = await p.eval(`[...document.querySelectorAll(".ex-option")].findIndex((b) => b.textContent.includes("household"))`);
        await p.key(String(right + 1));
        await hold(2400);
        await p.key("Enter");
        await hold(800);
        await open(p, "sd:GOEN1", "?seed=5");
        await hold(2000);
        await p.key("1");
        await hold(2600);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  {
    name: "leech-gif", url: page("leech:GOEN1"), width: 760, height: 700, theme: "dark",
    async run(p) {
      await p.gif("leech-panel.gif", async ({ hold }) => {
        await hold(1200);
        await p.type(".leech-note", "goen → gaangen: 'I've gone' like 'gone'");
        await hold(500);
        await p.eval(`[...document.querySelectorAll(".leech-sense input")].forEach((box, index) => { if (index > 3) box.checked = false; })`);
        await hold(1200);
        await p.click(".leech-actions .btn-primary");
        await hold(2000);
        await p.click(".leech-suspend");
        await hold(2000);
      }, { selector: ".demo-main", width: 760 });
    }
  },
  ...["dark", "light"].map((theme) => ({
    name: `meaning-${theme}`, url: page("meaning:HAUS1"), width: 760, height: 560, scale: 2, theme,
    async run(p) {
      await p.shot(`meaning-card-${theme}.png`, ".demo-flashcard");
    }
  })),
  ...["dark", "light"].map((theme) => ({
    name: `exercises-${theme}`, url: page("pp:GOEN1"), width: 760, height: 560, scale: 2, theme,
    async run(p) {
      await p.click('[data-aux="sinn"]');
      await typeAnswer(p, ".ex-input", "gaang");
      await p.click(".ex-submit");
      await p.wait(300);
      await p.shot(`perfect-feedback-${theme}.png`, ".demo-flashcard");
    }
  })),
  {
    name: "gender-narrow", url: page("g:HAUS1"), width: 400, height: 640, scale: 2, theme: "light",
    async run(p) {
      await p.key("k");
      await p.wait(300);
      await p.shot("gender-wrong-narrow-light.png", ".demo-flashcard");
    }
  }
];
