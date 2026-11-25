import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

import { configurePdfWorker } from "../src/pdf/index";

configurePdfWorker(workerSrc);
