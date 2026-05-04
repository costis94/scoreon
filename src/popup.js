document.getElementById("openScanner").addEventListener("click", async () => {
  const scannerUrl = new URL(chrome.runtime.getURL("src/scanner.html"));

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.title) scannerUrl.searchParams.set("sourceTitle", activeTab.title);
    if (activeTab?.url) scannerUrl.searchParams.set("sourceUrl", activeTab.url);
  } catch (error) {
    console.warn("Could not read active tab title. Scanner will use a manual/default title.", error);
  }

  await chrome.tabs.create({ url: scannerUrl.toString() });
  window.close();
});
