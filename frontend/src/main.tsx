import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { ToastProvider } from "./ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
