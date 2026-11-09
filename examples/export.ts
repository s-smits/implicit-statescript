// A repository fact the rules cannot infer. `PdfSettings` holds four required booleans, so
// prefer-state-union reports it at its defaults, yet each flag is a separate choice read once when
// the file is written. `survey` proposes it for `ignore`, since no update writes its flags, and
// `tailored.oxlintrc.json` adopts that proposal, which silences the hit.

export interface PdfSettings {
  embedFonts: boolean;
  compress: boolean;
  metadata: boolean;
  flatten: boolean;
}

export function exportPdf(pages: readonly string[], settings: PdfSettings): string {
  const parts = [settings.embedFonts ? "fonts" : "", settings.compress ? "deflate" : "", settings.metadata ? "xmp" : ""];
  return `${pages.join("\n")}\n${parts.filter((one) => one !== "").join(",")}${settings.flatten ? "\nflat" : ""}`;
}

export const printSettings: PdfSettings = { embedFonts: true, compress: false, metadata: false, flatten: true };
