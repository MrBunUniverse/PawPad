# PawPad

**Your PS4 controller, but cute. Live in OBS.**

PawPad shows your PS4 controller inputs on stream as pixel-art buttons: pressed buttons light up (or squish), the sticks move, and L2/R2 show how hard you're pulling them (0–100). It has several looks, including a floppy-eared **Bun** and a cat-eared **Cat**, and a wide layout for games with a cramped HUD.

![The PawPad looks: Classic, Fine, Fine Midnight, Bun, Cat and Bun wide](docs/looks.png)

Most controller overlays read a pad plugged into your PC. PawPad reads it **on the console**: a GoldHEN plugin sends the inputs over your network, so it works when you play on the PS4 and capture with a capture card. (I couldn't find another tool that does this, but I may have missed one.)

```
PS4 (GoldHEN plugin)  --UDP-->  Bridge (this app, on your PC/Mac)  --WebSocket-->  OBS Browser Source
```

## What you need

- A PS4 running **GoldHEN** (2.2 or newer).
- A computer on the **same network** as the PS4 running OBS Studio (macOS, Windows or Linux).
- An FTP client to copy files to the PS4 (GoldHEN's FTP server listens on port **2121**).

## 1. Install the plugin on the PS4

1. Copy `pad_stream.prx` to `/data/GoldHEN/plugins/` on the PS4.
2. Copy `pad_stream.ini` to `/data/GoldHEN/pad_stream.ini` and **set `ip`** to your computer's address (the bridge prints it when it starts, step 2).
3. Add the plugin to `/data/GoldHEN/plugins.ini` (merge with what's already there):

   ```ini
   [default]
   /data/GoldHEN/plugins/pad_stream.prx
   ```

   To load it only for specific games, put the line under that game's title ID instead, for example `[CUSA12085]`.
4. Restart the game (or the console) so GoldHEN loads the plugin.

`pad_stream.ini` options:

| Key | Meaning | Default |
|---|---|---|
| `ip` | Address of the computer running the bridge | none, you must set it |
| `port` | UDP port, must match the bridge | `9999` |
| `poll_rate_ms` | Milliseconds between updates (`16` ≈ 60/s, `8` ≈ 120/s) | `16` |

## 2. Run the bridge

Download the zip for your system from the Releases page, unzip it, and run:

| System | File | Notes |
|---|---|---|
| Windows | `bridge.exe` | Allow it through Windows Firewall on **private** networks when asked |
| macOS | `bridge` | First launch: right-click → Open (it isn't notarised). Allow incoming connections if asked |
| Linux | `bridge` | `chmod +x bridge` if needed |

The window prints the address to put in `pad_stream.ini` and the OBS URL. Keep it open while you stream.

The status line shows `receiving N packets/s` once the PS4 is sending. If it says `waiting for packets...`, see Troubleshooting.

## 3. Add it to OBS

1. In OBS, add a **Browser** source.
2. Set:

   | Setting | Value |
   |---|---|
   | URL | `http://localhost:8080/?hideUI=1` |
   | Width | `488` |
   | Height | `280` |
   | FPS | `60` |

   Leave **Custom CSS** at its default. 488 × 280 keeps the pixels sharp; other sizes work, but the overlay scales to fit and can look uneven.
3. Resize the source on your scene however you like.

If you change anything on the bridge side later, right-click the source → **Refresh cache of current page**.

## 4. Choose a look

Open `http://localhost:8080/` in a normal browser tab and use **Settings**. Whatever you pick is sent to the bridge, so **OBS follows live** with the same URL: no refresh and no new link to paste. The choice is remembered.

| Setting | Options |
|---|---|
| **Style** | **Classic** (chunky pixels, the default), **Fine** (twice as many pixels: rounder corners, thinner outlines, segmented L2/R2 meter), **Bun** (Fine plus a cream bunny: floppy ears on a coral touchpad, pink bunny-paw sticks that squish when pressed, and ears that stay attached to the touchpad and give a tiny pixel "boing" when you push it down and again when you let go), **Cat** (Fine plus cat ears and paw-print sticks that squish when pressed) |
| **Colors** (Fine) | **Default**, or **Midnight**, a dark palette without the animal extras |
| **Which cat** (Cat) | Pumpkin (orange), Shadow (black), Snowball (white), Smokey (gray), Mittens (Siamese) |
| **Layout** | **Normal**, or **Wide**: one short row with L2/L1 at the left end and R2/R1 at the right, for games with a cramped HUD |
| **Touchpad** | Show or hide the touchpad block (the wide row closes the gap) |

The Browser Source stays **488 × 280** in every layout. The wide row is drawn at full width inside the same box and the space above and below it is transparent, so nothing needs resizing when you switch.

### Capture-card delay

If the overlay is ahead of your video, raise **Capture delay** in Settings, or put it in the URL: `?hideUI=1&delay=120` (milliseconds, 0–500).

### URL options

URL options pin that page to a value and ignore the live changes from Settings. Use them only if you want a fixed look.

| Option | Example | Effect |
|---|---|---|
| `hideUI=1` | | Hides the status and settings (use this in OBS) |
| `preset` | `preset=bun` | One-word look: `classic`, `fine`, `fine-midnight`, `bun`, or a cat (`pumpkin`, `shadow`, `snowball`, `smokey`, `mittens`) |
| `style`, `cat`, `tone` | `style=cat&cat=smokey` | The same, spelled out (`style=bun`; `tone=midnight` is Fine's Midnight colors) |
| `layout` | `layout=wide` | `normal` or `wide` |
| `touchpad` | `touchpad=0` | Hide the touchpad |
| `delay` | `delay=120` | Capture-card delay in ms (0–500) |
| `deadzone` | `deadzone=0.08` | Ignore small stick movement (0–0.5) |
| `demo=1` | | Start in test mode |

## Test mode (no PS4 needed)

Open `http://localhost:8080/` in a browser, open **Settings**, and switch on **Test mode**. A fake controller is sent to every connected page, **including OBS**, so you can position and size the overlay without the PS4. It stops when you switch it off or close that page.

## Troubleshooting

The badge in the top-left of the settings page tells you where it's stuck:

| Badge | Meaning | Fix |
|---|---|---|
| **Bridge offline** | The page can't reach the bridge | Start the bridge; check the URL and port |
| **Waiting for PS4** | Bridge is up but no packets arrive | See below |
| **PS4 live** | Everything works | |

**Waiting for PS4:**
- The `ip` in `/data/GoldHEN/pad_stream.ini` must be your computer's *current* address. It changes if your router gives out new addresses; the bridge prints the right one on start.
- PS4 and computer must be on the same network (not a guest Wi-Fi with client isolation).
- Firewall: allow the bridge to receive **UDP port 9999**.
- Restart the game after changing any plugin file.
- Test the rest of the chain with Test mode first. If that works, the bridge and OBS are fine and the problem is on the PS4 side.

**"port already in use":** another copy of the bridge is running. Close it, or start with `--udp-port=<n>` / `--http-port=<n>` (and set the same port in `pad_stream.ini` and the OBS URL).

**OBS shows nothing:** the bridge must be running before the source loads; then Refresh cache of current page.

## Bridge options

```
bridge --http-port=8080 --udp-port=9999 --ps4-ip=192.168.1.50 --host=127.0.0.1
```

| Option | Default | Notes |
|---|---|---|
| `--http-port` | `8080` | Overlay page and WebSocket |
| `--udp-port` | `9999` | Where the PS4 sends |
| `--ps4-ip` | any | Only accept packets from this address |
| `--host` | `127.0.0.1` | Set to `0.0.0.0` only if OBS runs on a *different* computer |

## Security notes

- The overlay is served on `127.0.0.1` only, and only pages served by the bridge itself can connect to its WebSocket.
- UDP has no authentication. The bridge locks onto the first PS4 that sends valid packets and ignores other addresses until it goes quiet for 5 seconds. For a hard guarantee use `--ps4-ip`.
- Don't expose the UDP port to the internet.

## Building from source

```bash
# bridge (Node 22+)
cd mac-receiver && npm install && npm start

# tests
node mac-receiver/test/verify.js        # starts its own bridge: stop any running one first (ports 8080/9999)

# standalone executables + release zips (downloads Node binaries)
bash scripts/build-release.sh           # output in dist/

# PS4 plugin (needs the OpenOrbis toolchain; edit paths at the top of the script)
bash ps4-plugin/build_prx.sh

# optional macOS menu-bar launcher
bash mac-app/build.sh
```

Layout:

```
ps4-plugin/     GoldHEN plugin (C, OpenOrbis)
mac-receiver/   bridge: UDP in, HTTP + WebSocket out
obs-overlay/    the overlay page (index.html + style.css settings UI, app.js client, retro.js canvas drawing)
mac-app/        optional macOS menu-bar launcher
config/         example PS4 config files
scripts/        release build
```

## License

MIT, see [LICENSE](LICENSE).

## Disclaimer

Running homebrew plugins requires a jailbroken console. You do this at your own risk, and online play with a modified console can get you banned. This project is not affiliated with Sony.
