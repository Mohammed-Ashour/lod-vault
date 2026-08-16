# Chrome Web Store graphics

The generated upload set lives in `upload-v2.1.0/`. It contains exactly the assets accepted by the Chrome Web Store listing form:

| Asset | File | Dimensions |
|---|---|---:|
| Screenshot 1 | `01-popup-1280x800.png` | 1280×800 |
| Screenshot 2 | `02-lod-banner-1280x800.png` | 1280×800 |
| Screenshot 3 | `03-vault-1280x800.png` | 1280×800 |
| Screenshot 4 | `04-flashcards-1280x800.png` | 1280×800 |
| Screenshot 5 | `05-lod-lens-1280x800.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo | `promo-marquee-1400x560.png` | 1400×560 |
| Store icon | `icon-128x128.png` | 128×128 |

Upload the screenshots in numbered order. The same files are bundled in `chrome-web-store-assets-v2.1.0.zip` for handoff; upload the individual PNG files in the Developer Dashboard.

## Rebuild

```bash
node media/webstore/render-webstore-images.mjs
```

The renderer clears the versioned upload folder, captures the source HTML with Playwright, validates every PNG's dimensions, copies the store icon, writes the upload order, and creates the handoff ZIP.

## Chrome requirements

Chrome currently requires a 128×128 store icon, one to five 1280×800 screenshots, and a 440×280 small promo tile. The 1400×560 marquee is optional. See:

- [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing)
