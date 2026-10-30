
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

// Optional build-time theme: set VITE_THEME (for example "afterdark") to apply a [data-theme] block.
const theme = import.meta.env.VITE_THEME;
if (theme) document.documentElement.dataset.theme = theme;

  createRoot(document.getElementById("root")!).render(<App />);
  