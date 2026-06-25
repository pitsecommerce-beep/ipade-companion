// Extracción de texto de PDFs en el navegador con pdfjs-dist.
// El texto extraído se guarda en documents.content_text para que el agente
// pueda consultarlo sin necesidad de re-procesar el archivo.
import * as pdfjsLib from "pdfjs-dist";
// Vite empaqueta el worker como una URL al hacer build.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_CHARS = 200_000; // límite defensivo para no guardar textos gigantes

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let out = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    out += `\n\n[Página ${pageNum}]\n${pageText}`;
    if (out.length > MAX_CHARS) {
      out = out.slice(0, MAX_CHARS) + "\n\n[…texto truncado…]";
      break;
    }
  }
  return out.trim();
}
