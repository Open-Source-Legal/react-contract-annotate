import { configurePdfWorker } from "@os-legal/react-contract-annotate/pdf";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./demo.css";

// pdf.js needs its worker script's URL before the first PDF is shown.
configurePdfWorker(workerSrc);

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
