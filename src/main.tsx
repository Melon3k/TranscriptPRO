import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Font CSS must load before globals.css so @font-face is defined before use.
// Static Fontsource packages (not -variable) so family names stay "Outfit"/
// "Inter"/"JetBrains Mono" as referenced by FONTS in src/lib/ui.ts; latin-ext
// subsets included for Polish diacritics.
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/outfit/800.css";
import "@fontsource/outfit/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
// Real italic faces for the caption italic toggle (weights the captions use:
// 400/700), so the preview matches the ASS render instead of a synthesized
// oblique. Outfit ships no italic — WebKit still synthesizes for that family.
import "@fontsource/inter/400-italic.css";
import "@fontsource/inter/700-italic.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "@fontsource/jetbrains-mono/700-italic.css";
import "./styles/globals.css";
import "./i18n"; // side-effect: initializes i18next singleton before any t() call

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </React.StrictMode>
);
