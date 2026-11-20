// Seeded session evidence. Run with scripts/record-flow.mjs.
export default async ({ navigate, click, press, shot, gif, sleep }) => {
  await navigate('flashcards.html', { width: 1000, height: 820 });
  await gif('review-undo-end', async () => {
    await click('#flip-card');
    await sleep(900);
    await press('1');
    await sleep(900);
    await press('u');
    await sleep(900);
    await click('#flip-card');
    await sleep(600);
    await press('2');
    await sleep(900);
    await click('#end-session');
    await sleep(1500);
  });
  for (const theme of ['dark', 'light']) {
    await navigate('flashcards.html', { width: 1000, height: 820, theme });
    await click('#flip-card');
    await sleep(500);
    await press('2');
    await sleep(600);
    await click('#end-session');
    await sleep(500);
    await shot(`summary-${theme}`);
  }
  await navigate('flashcards.html', { width: 400, height: 820 });
  await click('#flip-card');
  await sleep(600);
  await shot('narrow-400');
};
