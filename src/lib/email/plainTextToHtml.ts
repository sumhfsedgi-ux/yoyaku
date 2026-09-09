/** & must be replaced first, or the entities produced by the later replacements would themselves get re-escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

function linkifyUrls(html: string): string {
  return html.replace(URL_PATTERN, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

/**
 * Rendered plain text -> safe HTML email body: escape, then convert newlines
 * to <br>, then linkify URLs - in that order. Escaping first means the <br>
 * tags added in step 2 are real markup (not re-escaped by step 1), and
 * linkifying last means the URL regex's `[^\s<]` correctly stops at those
 * <br> tags. Never used via dangerouslySetInnerHTML on raw user input -
 * this function IS the sanitization step.
 */
export function plainTextToHtml(text: string): string {
  return linkifyUrls(escapeHtml(text).replace(/\n/g, "<br>\n"));
}
