import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const pdfParse = require("pdf-parse");
console.log("pdfParse type:", typeof pdfParse);
console.log("Is function?", typeof pdfParse === "function");
