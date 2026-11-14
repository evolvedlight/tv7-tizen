# Init7 TV for Samsung Tizen (QN90AA)

Native Samsung Tizen Smart TV application for **Init7 TV7**, built for **Samsung Tizen Smart TVs (Tizen 6.0+ / QN90AA)**.

## Easiest Way to Sideload onto Your Samsung TV

No Tizen Studio GUI required — you just need **Node.js** on a PC/Mac on the same network as your TV:

1. **Enable Developer Mode on your TV** (one-time setup):
   - Open **Apps** on your Samsung TV's Smart Hub.
   - Press **`12345`** on your remote control (use the on-screen number pad if your remote has no number keys).
   - Turn **Developer Mode** **ON** and enter your PC's local IP address (e.g. `192.168.1.x`).
   - Hold the TV power button for ~5 seconds to reboot the TV.

2. **Build & install in one command**:
   ```bash
   git clone <this-repo-url>
   cd samsung-init7
   npm install
   npm run deploy
   ```
   This automatically generates a local Tizen signing certificate, builds `dist/Init7TV.wgt`, discovers your TV on the LAN, installs the app, and launches it.
   *(If auto-discovery doesn't find your TV, pass its IP explicitly: `npm run deploy -- <YOUR_TV_IP>`.)*

> **Alternative (Pre-built `.wgt` from GitHub Releases):** Download `Init7TV.wgt` from the latest Release (or GitHub Actions artifact) and install it with Tizen `sdb`:
> ```bash
> sdb connect <YOUR_TV_IP>:26101
> sdb install Init7TV.wgt
> ```

## Features
- **Built-in On-TV Multicast Receiver (`Init7TVApp.UdpxyService` on `127.0.0.1:40223`)**:
  - Runs a lightweight local UDP-multicast-to-HTTP proxy directly inside the TV's Tizen Node.js background service runtime (`tizen/service/udpxy-service.js`).
  - Streams all **242 Init7 multicast channels** (including **CBBC**, **BBC One HD**, **BBC Two**, **Cbeebies**, **Channel 5**, **ITV 3**, **ITV 4**, **Film 4**, etc.) in Samsung's `AVPlay` hardware MPEG-TS decoder with **zero external `udpxy` server required**.
  - Also supports optional external `udpxy` (e.g. `udpxy.local:40222` / `192.168.1.10:40222`) and Direct Init7 HLS Mode (`102 Channels`).
- **Full Multi-Channel EPG TV Guide (`📅 TV Guide`)**:
  - Interactive 2.5-hour multi-channel timeline grid with live current-time marker, instant program synopses, and 60fps virtualized scrolling across all 242 channels.
- **Quick Favorites on Main Menu & SolarCell Remote Support**:
  - **`★ Quick Favs` Strip** on the main OSD menu (`▲` from OSD action bar) for instant 1-click channel switching.
  - Toggle Favorites from the Channel List, TV Guide, or Live TV using **`⏯ Play/Pause`**, **Hold `OK`**, or the **`Yellow`** button.
- **60fps Zero-Reflow Channel Drawer**: $O(1)$ focus updates, pure-math scroll calculation, and debounced sequential EPG prefetching for instant scrolling on Tizen 6.0.
- **Full Samsung Remote Integration**:
  - `▲ / ▼`: Navigate channels in drawer, or zap channels in full-screen
  - `◀ / ▶`: Switch language/favorite groups in drawer, or navigate OSD controls
  - `OK / Enter`: Tune channel / toggle OSD controls
  - `CH ∧ / CH ∨`: Instant channel zapping anytime
  - `0 – 9`: Direct numeric channel entry
  - `Yellow Button` (or `F`): Toggle ★ Favorite
  - `Info` (or `I`): Show Now/Next OSD & full program details
  - `Guide / Channel List` (or `C`): Toggle Channel Drawer
  - `Back / Return`: Close overlays, or double-press in full-screen to exit app

## Quick Install on Samsung QN90AA

1. **Enable Developer Mode on your TV**:
   - Turn on your Samsung QN90AA TV and open the **Apps** screen from the Smart Hub.
   - Press **`12345`** on your remote control (or using the on-screen number pad).
   - Toggle **Developer Mode** to **ON**.
   - Enter your PC's local LAN IP address (e.g. `192.168.1.x`).
   - Hold the TV power button for ~5 seconds until the TV reboots (or unplug for 10s and power back on).

2. **Deploy over the network from this repo**:
   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   npm run deploy -- <YOUR_TV_IP>
   ```
   *(Or run `npm run deploy` without arguments to auto-scan `192.168.1.1-254` for your TV).*

3. **Preview in a desktop browser**:
   ```bash
   npm run serve
   ```
   Then open `http://localhost:8080`.
