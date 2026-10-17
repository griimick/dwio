# Use dwio from another computer

By default, dwio accepts connections from your own computer only. To use it from another computer, for example over Tailscale, do this:

```sh
dwio diagram.drawio.svg --host 0.0.0.0
```

dwio prints one URL for each network address. Each URL has a secret token. Anyone who has the URL can read and change the file. The connection is plain HTTP, so use this option only on a network that you trust.

## Error: "bad host"

dwio refuses a request if the address in the browser is not an IP address, `localhost`, or the name of your computer. This rule protects you from attacks on local servers. The error message tells you what to do.

To open dwio with a different name, allow the name:

```sh
dwio diagram.drawio.svg --host 0.0.0.0 --allow-host mybox.example.ts.net
```

To use an SSH tunnel with a different port, set both ports:

```sh
ssh -L 8080:127.0.0.1:3946 server
dwio diagram.drawio.svg --public-port 8080
```
