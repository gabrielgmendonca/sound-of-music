# Do-Re-Mi Meadow

A private birthday gift: a one-tap 3D rhythm game inspired by *The Sound of
Music* (1965). Personal use only — not for publication or distribution.

## Play

```sh
npm install        # local to this folder; nothing global
npm run dev        # prints a Local and a Network URL
```

- Computer: open the Local URL. Click or press Space in time with the bubbles.
- Phone (same Wi-Fi): open the Network URL. Tap anywhere. Works in portrait
  and landscape; turn the ringer switch on and the volume up on iPhone.

`npm run build` writes a self-contained static site to `dist/`.

## Personalise

Edit `src/config.js`:

- `GIFT` — title, salutation, birthday message, signature.
- `GAME` — tempo, how forgiving the timing is, `inputOffset` if taps feel
  early/late on a particular device (e.g. Bluetooth speakers).

The interface is in Portuguese (Brazil) by default; add `?lang=en` to the URL
for English.

## How it is built

See [docs/PLAN.md](docs/PLAN.md).
