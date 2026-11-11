/**
 * Saves a file to the user's Downloads folder (or wherever Chrome asks, if
 * "Ask where to save each file" is on) by clicking a download link from the
 * content script. Unlike `chrome.downloads`, this needs no extra permission.
 * The file only ever exists in memory until Chrome writes it.
 */
export function downloadFile(doc: Document, file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Chrome has read the blob once the download has started; free it after a while.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
