import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import App from "@/App.tsx";
import { loadSettings } from "@/utils/config";
import { setTheme } from "@/utils/theme";

// 描画の前にテーマを当てる（違う色で一瞬描かない）
loadSettings()
  .then((s) => setTheme(s.theme), () => setTheme("system"))
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  );
