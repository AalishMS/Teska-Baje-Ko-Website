import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/oswald/latin-700.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource/kalam/devanagari-700.css";
import "@fontsource/noto-sans-devanagari/devanagari-700.css";
import "@fontsource/arimo/latin-400.css";
import "@fontsource/arimo/latin-500.css";
import "@fontsource/arimo/latin-600.css";
import "@fontsource/arimo/latin-700.css";
import "@fontsource/libre-baskerville/latin-700.css";
import "@fontsource/noto-emoji/400.css";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
