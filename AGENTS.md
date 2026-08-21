# Codex Workflow Notes

- Active app path: `/Users/hh/Desktop/dev/unclozet`. The Codex workspace may open elsewhere, so use this path when reading, editing, building, or running the app.
- Keep routine local edits lightweight: implement the requested change, run `npm run build`, and keep `localhost:3001` available for review when useful.
- Only commit, push, or deploy when the user explicitly asks for deployment or saving a version.
- For small UI copy/style changes, avoid browser automation unless the change is visual-risky or the user asks for verification.
- When using Playwright, read only bounded output: prefer snapshots and targeted checks, avoid dumping full console logs, and clean `.playwright-cli` afterward.
- Do not include `.playwright-cli`, `.next`, `out`, or other generated files in commits.
- For new flows, decide the storage model first: whether it needs a list entry, unique URL, reload/back-button behavior, and cross-device persistence.
- External APIs must not block core work. If postcode lookup fails or the API key is invalid, allow order saving with an empty postcode.
- Treat memo sessions and standalone order sessions as different list item types. Keep them visually separated in the saved list.
- Before deployment: run `npm run build`, check `git diff --check`, commit the intended files only, then push `main`.
