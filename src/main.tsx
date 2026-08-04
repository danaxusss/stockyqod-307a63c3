import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource-variable/inter";
import "./index.css";
import { hardReloadApp } from "./utils/appReload";

// Every route here is code-split, so a tab left open across a deploy still
// asks for chunk filenames that no longer exist. The failure only appears when
// the user navigates or opens a lazy feature — as "Failed to fetch dynamically
// imported module". Vite reports it through this event; recover by fetching
// the new build once. The time guard stops a genuinely missing chunk (or an
// offline device) from causing a reload loop.
const RELOAD_GUARD = "stocky_chunk_reload_at";

window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
  if (Date.now() - last < 60_000) {
    console.error("[app] chunk load failed again after reloading; letting the error surface", event);
    return;
  }
  event.preventDefault();
  sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
  console.warn("[app] stale build detected — reloading to fetch the current version");
  hardReloadApp();
});

createRoot(document.getElementById("root")!).render(<App />);
