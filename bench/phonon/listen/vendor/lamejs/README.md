# lamejs 1.2.1 (LGPL-3.0)

The MP3 encoder behind the listening page's Save button (LT-219), loaded by
`../../mp3.worker.js` with `importScripts`. It is a separate program under its
own licence, not part of this repo's MIT code: it is served as its own file and
never bundled into anything else.

| File | What it is |
| --- | --- |
| `lame.min.js` | `package/lame.min.js` from the npm tarball, byte for byte unmodified |
| `LICENSE` | `package/LICENSE` from the same tarball (LAME's notes on the LGPL) |
| `COPYING.LESSER` | GNU Lesser General Public License v3, from https://www.gnu.org/licenses/lgpl-3.0.txt |
| `COPYING` | GNU General Public License v3, which the LGPL builds on, from https://www.gnu.org/licenses/gpl-3.0.txt |
| `SHA256SUMS` | sha256 of the four files above; `stage.sh` checks it before staging |

- Package: lamejs 1.2.1, https://registry.npmjs.org/lamejs/-/lamejs-1.2.1.tgz
  (npm integrity `sha512-s7bxvjvYthw6oPLCm5pFxvA84wUROODB8jEO2+CE1adhKgrIvVOlmMgY8zyugxGrvRaDHNJanOiS21/emty6dQ==`)
- Source: https://github.com/zhuker/lamejs, a JavaScript port of LAME
  (https://lame.sourceforge.io).
- `lame.min.js`: 156,043 bytes (55 KB gzipped), sha256
  `15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4`.

To replace it, put a new unmodified `lame.min.js` here, update `SHA256SUMS`, this
file and the pin in `tests/listen-mp3.test.js`, and keep the licence texts beside it.
