# dem-tiles

> Fork of [@watergis/terrain-rgb](https://github.com/watergis/terrain-rgb) by Jin IGARASHI, with performance improvements and additional sampling modes.

Decode elevation from Terrain RGB and Terrarium raster tile sets by longitude and latitude.

## What's different from upstream

- **Median filter sampling** — median elevation from a configurable pixel window, reducing noise from resampled/gdal2tiles tilesets.
- **`createImageBitmap` decoding** — uses the browser-native [`createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap) API instead of `HTMLImageElement` + Object URLs. Faster decoding, no dangling object URLs.
- **OffscreenCanvas support** — uses `OffscreenCanvas` when available, otherwise falls back to `<canvas>`.
- **O(1) pixel lookup** — computes RGBA byte offset directly, no intermediate `Array<[r,g,b,a]>` allocation.
- **In-flight request deduplication** — multiple lookups on the same tile share one fetch + decode promise.
- **Batch `getElevations`** — group coordinates by tile to minimize fetch/decode work.

## Install

```
npm i dem-tiles
```

## Usage

```ts
import { TerrainRGB, Terrarium } from "dem-tiles";
import { LRUCache } from "lru-cache";

const url = "https://wasac.github.io/rw-terrain/tiles/{z}/{x}/{y}.png";
const tileCache = new LRUCache<string, Uint8Array | undefined>({ max: 500 });

// Default: nearest-neighbor sampling
const trgb = new TerrainRGB(url, 512, 5, 15, false, { tileCache });
const elevation = await trgb.getElevation([30.0529622, -1.9575129], 15);

// Median filter sampling (3x3 window)
const trgbMedian = new TerrainRGB(url, 512, 5, 15, false, {
  tileCache,
  sampling: "median",
  sampleRadius: 1,
});

// Terrarium tileset
const terrarium = new Terrarium(url, 512, 5, 15, false, { tileCache });

// Batch lookup — coordinates sharing the same tile reuse one decoded buffer
const elevations = await trgb.getElevations(
  [
    [30.0529622, -1.9575129],
    [30.05297, -1.9576],
  ],
  15,
);
```

TMS tiles are supported by passing `true` as the 5th argument:

```ts
const trgb = new TerrainRGB(url, 512, 5, 15, true);
```

If a tile cannot be found, the method returns `undefined` (404s are handled gracefully). Both PNG and WebP formats are supported.

## API

### `TerrainRGB` / `Terrarium`

```
new TerrainRGB(url, tileSize, minzoom, maxzoom, tms, options?)
new Terrarium(url, tileSize, minzoom, maxzoom, tms, options?)
```

### `BaseTileOptions`

| Option         | Type                                        | Default     | Description                              |
| -------------- | ------------------------------------------- | ----------- | ---------------------------------------- |
| `tileCache`    | `LRUCache<string, Uint8Array \| undefined>` | —           | External LRU for decoded tile data       |
| `sampling`     | `"nearest" \| "median"`                     | `"nearest"` | Pixel sampling strategy                  |
| `sampleRadius` | `number`                                    | `1`         | Pixel radius for median window (1 = 3x3) |

### Methods

- `getElevation([lng, lat], zoom)` → `Promise<number | undefined>`
- `getElevations([[lng,lat], ...], zoom)` → `Promise<Array<number | undefined>>`

## Performance

- Reuse a `tileCache` across calls when possible.
- Prefer `getElevations(coords, zoom)` over many independent `getElevation()` calls when many coordinates share tiles.
- Grouping happens by resolved tile URL, so repeated coordinates in the same tile share fetch, decode, cache, and in-flight request work.

## Credits

This project is a fork of [watergis/terrain-rgb](https://github.com/watergis/terrain-rgb). Original work by [Jin IGARASHI](https://github.com/watergis). Licensed under MIT.
