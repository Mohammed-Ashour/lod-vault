# LODVault study update media

The MP4 is a silent 1080 × 1350 video at 30 fps for social feeds. Captions are part of the video. The GIF is a smaller looping version.

Recorded from the real extension pages on the PR #86 branch for version 2.5.0 with a sample vault and simulated browser storage. The wrapper adds captions, click markers and an illustrated browser opening. The popup and extension pages are real. Each new panel and its caption appear together after the panel is ready. No personal data appears. The video is labeled "Next update" because these changes are merged but have not been published to the store.

The clip starts at a browser toolbar, opens the LODVault popup, then moves into Flashcards. It shows review interval previews, undo, real gap-fill input and feedback, Progress, tags and saved decks. The gap-fill answers and example spans come from the committed LOD response fixtures, parsed by the real lexicon parser. Selectable question modes share each word's core schedule; this clip does not claim separate skill schedules.

Suggested post:

The next LODVault update adds review interval previews, undo, a Progress page, and tags and decks for your saved words. Here is a look at the new study flow.

To record again, run this command from the repository root:

```sh
node media/social-2026-11-20/capture.mjs
```

Chromium and ffmpeg are required. The capture script starts and stops its local recording server automatically.
