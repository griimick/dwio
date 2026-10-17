# Export a picture

Use `dwio export` to see how a diagram looks. It does not open the editor. It draws the diagram and writes an image file.

```sh
dwio export diagram.drawio.svg                 # writes diagram.png next to the file
dwio export diagram.drawio -o /tmp/look.png    # choose the output file
dwio export diagram.drawio -o diagram.pdf      # the extension sets the format
dwio export diagram.drawio -o -  > out.png     # write to standard output
dwio export diagram.drawio -o copy.drawio.svg  # make a .drawio.svg from a .drawio file
```

dwio needs a Chrome, Chromium, or Edge browser on your computer to draw the diagram. dwio looks for one in `PATH`, in the usual install folders, and in the Playwright cache. To use a specific browser, set `DWIO_BROWSER` or use `--browser <path>`. dwio does not open a window. The browser runs without a screen.

| Option | What it does |
| --- | --- |
| `-o`, `--output <path>` | Output file. The extension sets the format. Use `-` for standard output. |
| `--format <f>` | `png`, `svg`, `pdf`, or `drawio.svg`. This overrides the extension. |
| `--page <n or name>` | Exports one page. Use the page number (from 1) or the exact page name. The default is page 1. |
| `--all-pages` | Exports each page to its own file: `name-1.png`, `name-2.png`, and so on. |
| `--scale <x>` | Zoom factor. The default is 2 for PNG and 1 for the other formats. |
| `--border <px>` | Space around the drawing. The default is 10. |
| `--background <color>` | Background color, for example `"#ffffff"`. PNG and PDF are white by default. |
| `--transparent` | Makes the PNG background transparent. |
| `--timeout <seconds>` | Stops after this time. The default is 60. |
| `--json` | Prints the result as JSON: file path, format, page, size in bytes, and image size in pixels. |

A `.drawio.svg` export keeps all pages of the file unless you set `--page` or `--all-pages`. Other formats export page 1 unless you choose a page. If the file has more pages, dwio prints a note on standard error.
