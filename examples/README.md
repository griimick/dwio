# Examples

Try the editor against real files:

```sh
dwio examples/flow.drawio       # plain draw.io XML
dwio examples/flow.drawio.svg   # SVG with the editable diagram embedded (renders on GitHub)
dwio xml examples/flow.drawio.svg   # print the embedded diagram as XML
```

Edits made in the browser are written back to the file you opened; edit the file from another
terminal or `git checkout` a different version and the editor reloads it.

To experiment without touching git history, copy a file first: `cp examples/flow.drawio /tmp/try.drawio && dwio /tmp/try.drawio`.
