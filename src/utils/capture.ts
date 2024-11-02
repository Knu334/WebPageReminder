export const captureVisibleTab = async (): Promise<string> => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab.id) return "";

    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: "jpeg",
      quality: 50,
    });
    return dataUrl;
  } catch (error) {
    console.error("Failed to capture tab:", error);
    return "";
  }
};
