// Flow for study/p2-cards: the registry demo page (docs/demo/card-registry.html).
const URL = "/docs/demo/card-registry.html";
export default ["dark", "light"].map((theme) => ({
  name: `registry-${theme}`,
  url: URL, width: 980, height: 760, scale: 2, theme,
  async run(page) {
    await page.wait(400);
    await page.shot(`registry-today-${theme}.png`, ".demo-main");
    if (theme === "dark") await page.gif("registry-walkthrough.gif", async (rec) => {
      await rec.hold(900);
      await page.eval("document.getElementById('queue').scrollIntoView({block:'center'})");
      await rec.hold(1400);
      await page.eval("window.scrollTo(0,0)");
      await rec.hold(900);
    });
  }
}));
