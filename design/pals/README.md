# Pals sticker pack

Twelve animated stickers of the Pals characters (the Pals style's cast: Hoa, Mặt trời, Cỏ, Giọt, Bông, Ma nhỏ, Mây, Trứng, Flan), each a pal with one of the twelve expressions.

- The characters are drawn in code: `src/shared/pals-art.ts` (bodies, faces, colours), the same drawings the app uses for avatars and the empty screens.
- `motion.mjs` poses each sticker at any point of its loop: squash and stretch on the pal's foot, anticipation and settle, and the little things around it (hearts, z's, tears, sparkles). Every movement is periodic or comes to rest at both ends, so the loop has no seam; the first frame is the rest pose and doubles as the still.
- `build-pack.mjs` draws every frame straight from SVG at twice the final size, frames them the same way, adds the Moshi sticker edge (`design/lib/sticker-edge.mjs`, shared with Mito) and writes `resources/stickers/pals/`: `<id>.png`, `<id>-white.png` and `<id>.webp` (60 fps, so a 60 Hz screen shows a new frame on every refresh).
- `preview.html` (written by the build) shows them all moving; open it in a browser.

To rebuild: `node design/pals/build-pack.mjs [ids…]` (all twelve when none are named; a few minutes each).

The list (ids, which pal and expression, names, loop lengths) is `src/shared/pals-stickers.ts`; the app serves the files through `src/shared/picture-packs.ts`.
