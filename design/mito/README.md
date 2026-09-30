# Mito sticker pack

Mèo Bơ, the black cat with amber eyes and white paws: 12 stickers, all animated.

- `stills/` still stickers cut from the drawn sheets (transparent PNG), for any that are not animated (none now).
- `animation.html` the animated stickers (all twelve). Open it in a browser to watch them. Each one bends the original drawing on a WebGL mesh (one shared context for the whole page), so the art stays exactly as drawn.
- `export-frames.mjs` renders the animated ones into `frames/<id>/` (25 fps, not kept in git).
- `build-pack.mjs` adds the Moshi sticker edge and writes the app's files to `resources/stickers/mito/`: `<id>.png`, `<id>-white.png` and, for animated ones, `<id>.webp`.

To rebuild the pack, run `node design/mito/export-frames.mjs`, then `node design/mito/build-pack.mjs`.

The app side lives in `src/shared/mito.ts`, which holds the list, the names and the id whitelist.
