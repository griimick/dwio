# Troubleshooting

**"has no embedded draw.io data".** The SVG file does not come from draw.io. Open a `.drawio.svg` file that draw.io made, or make a new file.

**"port … is in use".** Another program uses the port. Use a different port with `--port`.

**A message says "Merged changes from disk".** The file changed while you had unsaved edits. dwio combined both. If you and the outside change edited the same shape, the version from the disk wins for that shape. Use Undo (`Ctrl+Z`) in the editor to go back.

**A message says "Lost connection to dwio".** dwio is not running, or the computer went to sleep. The editor keeps your diagram, but it cannot save. Use **File**, **Export as** to keep your work. Then start dwio again.

**"No Chrome, Chromium or Edge browser found".** `dwio export` needs a browser to draw the diagram. Install one, or set `DWIO_BROWSER` to its full path.

**"cannot write to ..." when you upgrade.** dwio has no permission to change its own folder. Install again with `install.sh` and set `DWIO_INSTALL_DIR` to a folder that you own, or run `dwio upgrade` with the right permission.

**The colors are wrong or you do not want colors.** dwio uses colors only when the output goes to a terminal. Output that you pipe or redirect has no colors. To turn colors off, set `NO_COLOR=1`. To force colors on, set `FORCE_COLOR=1`. The URL or JSON that dwio writes to standard output never has colors.

**The browser does not open.** Use `--no-open`, and open the printed URL yourself. On Linux, dwio uses `xdg-open`. To use a different browser, set the `BROWSER` environment variable.
