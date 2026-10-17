# Reference

Details that you need only now and then. To see every option at any time, run `dwio --help`.

## Options

| Option | What it does |
| --- | --- |
| `--no-open` | Does not open a browser. dwio prints the URL only. |
| `--port <n>` | Uses this port. dwio stops with an error if the port is busy. |
| `--check` | With `upgrade`: says if a newer release exists. Changes nothing. |
| `--keep-alive` | Keeps dwio running after you close the browser tab. |
| `--no-create` | Stops with an error if the file does not exist. |
| `--json` | Prints one line of JSON instead of the URL. |
| `--host <address>` | Listens on this address. See [Use dwio from another computer](remote-access.md). |
| `--allow-host <name>` | Accepts this host name. You can use this option more than once. |
| `--public-port <n>` | Tells dwio which port the browser uses. Use it with a tunnel. |
| `--drawio-version <v>` | Uses this version of the draw.io editor. |

The default port is `3946`. This number is "dwio" on a phone keypad. If port 3946 is busy, dwio tries the next ports, up to 3966. To change the default port, set the environment variable `DWIO_PORT`.

## Upgrade dwio

```sh
dwio upgrade            # installs the newest release
dwio upgrade --check    # says if a newer release exists, and changes nothing
dwio upgrade 0.1.0      # installs a specific version
```

`dwio update` does the same as `dwio upgrade`. Use `--json` to get the result as JSON.

The command downloads the program file for your system from the [Releases page](https://github.com/griimick/dwio/releases). It checks the checksum and runs the new file one time. Then it replaces itself. If a step fails, your old program stays in place.

This works for the program that `install.sh` installs. If you use `npx`, you always get the newest version. If you installed with npm, run `npm install -g @griimick/dwio` to upgrade.

dwio uses the network only when you run `dwio upgrade` or `dwio setup`, and the first time that it needs the draw.io editor. To use a mirror of the Releases page, set `DWIO_RELEASES_URL`.

## The draw.io editor and the cache folder

The first time you run dwio, it downloads the draw.io editor (about 50 MB). It saves the editor in your cache folder. On Linux this is `$XDG_CACHE_HOME/dwio`, or `~/.cache/dwio` if that variable is not set. On macOS it is `~/Library/Caches/dwio`. On Windows it is `%LOCALAPPDATA%\dwio\Cache`. To use a different folder, set `DWIO_CACHE_DIR`. After that, dwio does not use the network. To download the editor in advance, run `dwio setup`.
