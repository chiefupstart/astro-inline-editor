/** Dev inline editor: tag an element with its JSON source path. */
export function contentEdit(file, path, html = false) {
  return {
    "data-edit-file": file,
    "data-edit-path": path,
    ...(html ? { "data-edit-html": "true" } : {}),
  };
}
