/**
 * Tiny pub-sub für Match-State-Updates im Client.
 *
 * Use-Case: Wenn ein Inquire-Button irgendwo eine Anfrage abschickt, soll
 * die "Meine Anfragen"-Liste sofort reloaden — ohne SWR/React-Query-Setup.
 *
 * Pattern: Window-Custom-Event. Subscribe in der Liste, dispatch im Trigger.
 */

const EVENT_NAME = "home4u:matches-updated";

export function emitMatchesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function onMatchesUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => handler();
  window.addEventListener(EVENT_NAME, wrapped);
  return () => window.removeEventListener(EVENT_NAME, wrapped);
}
