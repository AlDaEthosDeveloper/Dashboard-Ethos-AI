export function getAIContext() {
  return {
    url: window.location.href,
    title: document.title,
    domText: document.body.innerText.slice(0, 12000),
    timestamp: new Date().toISOString(),
  };
}
