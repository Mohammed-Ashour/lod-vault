const LOD_URL_PATTERNS = ["https://lod.lu/artikel/*", "https://www.lod.lu/artikel/*"];

async function reloadLodTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: LOD_URL_PATTERNS });
    await Promise.all(
      tabs
        .filter((tab) => typeof tab.id === "number")
        .map((tab) => chrome.tabs.reload(tab.id))
    );
  } catch (_error) {
    // Ignore tab reload failures.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" || details.reason === "install") {
    reloadLodTabs();
  }
});
