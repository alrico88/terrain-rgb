import { lngLatToGoogle, lngLatToTile } from "global-mercator";
import type { LRUCache } from "lru-cache";

type TileCacheValue = Uint8Array | undefined;
type TileIndex = [number, number, number];
type Rgba = [number, number, number, number];
type SamplingMode = "nearest" | "median";

interface RasterRequest {
  url: string;
  tile: TileIndex;
  lng: number;
  lat: number;
}

export interface BaseTileOptions {
  tileCache?: LRUCache<string, TileCacheValue>;
  /**
   * Pixel sampling strategy. "nearest" reads one pixel. "median" returns the
   * median elevation from a square window around the target pixel.
   */
  sampling?: SamplingMode;
  /**
   * Pixel radius for median sampling. 1 means a 3x3 window.
   */
  sampleRadius?: number;
}

/**
 * Abstract class for terrain RGB tiles
 */
export abstract class BaseTile {
  protected url: string;

  protected tileSize: number;

  protected tms: boolean;

  protected minzoom: number;

  protected maxzoom: number;

  private tileCache?: LRUCache<string, TileCacheValue>;

  private sampling: SamplingMode;

  private sampleRadius: number;

  private readonly inFlightRequests = new Map<
    string,
    Promise<TileCacheValue>
  >();

  private decodeCanvas?: HTMLCanvasElement | OffscreenCanvas;

  private decodeContext?:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

  private extension: string;

  /**
   * Constructor
   * @param url URL for terrain RGB raster tilesets
   * @param tileSize size of tile. 256 or 512
   * @param tms whether it is Tile Map Service
   * @param minzoom minzoom for terrain RGB raster tilesets
   * @param maxzoom maxzoom for terrain RGB raster tilesets
   * @param tms whether it is Tile Map Service
   */
  constructor(
    url: string,
    tileSize: number,
    minzoom: number,
    maxzoom: number,
    tms: boolean,
    options?: BaseTileOptions,
  ) {
    this.url = url;
    this.tileSize = tileSize;
    this.tms = tms;
    this.minzoom = minzoom;
    this.maxzoom = maxzoom;
    this.tileCache = options?.tileCache;
    const ext = this.getUrlExtension(this.url) ?? "png";
    if (ext !== "png" && ext !== "webp") {
      throw new Error(`Invalid file extension: ${ext}`);
    }
    this.extension = ext;
    this.sampling = options?.sampling ?? "nearest";
    this.sampleRadius = Math.max(0, Math.floor(options?.sampleRadius ?? 1));
  }

  /**
   * Get the value from target coordinates and zoom level by using certain formula.
   * @param lnglat coordinates
   * @param z  zoom level
   * @returns the value calculated by certain formula
   */
  protected getValue(lnglat: number[], z: number): Promise<number | undefined> {
    return this.getValues([lnglat], z).then((values) => values[0]);
  }

  /**
   * Get values for multiple coordinates at one zoom level.
   * Coordinates sharing a tile reuse one decoded tile and each pixel lookup is O(1).
   * @param lnglats coordinates
   * @param z zoom level
   * @returns values calculated by the subclass formula
   */
  protected async getValues(
    lnglats: number[][],
    z: number,
  ): Promise<Array<number | undefined>> {
    const values = new Array<number | undefined>(lnglats.length);
    const groups = new Map<string, Array<RasterRequest & { index: number }>>();

    for (let index = 0; index < lnglats.length; index += 1) {
      const request = this.createRasterRequest(lnglats[index], z);
      const group = groups.get(request.url);
      if (group) {
        group.push({ ...request, index });
      } else {
        groups.set(request.url, [{ ...request, index }]);
      }
    }

    await Promise.all(
      Array.from(groups.values(), async (group) => {
        const pixels = await this.getTilePixels(group[0].url);
        for (const request of group) {
          values[request.index] = pixels
            ? this.getValueFromPixels(
                pixels,
                request.tile,
                request.lng,
                request.lat,
              )
            : undefined;
        }
      }),
    );

    return values;
  }

  /**
   * Get the value calculated from coordinates on WEBP raster tileset
   * @param url tile URL
   * @param tile tile index info
   * @param lng longitude
   * @param lat latitude
   * @returns the value calculated from coordinates. If tile does not exist returns undefined
   */
  private getValueFromPixels(
    pixels: Uint8Array,
    tile: TileIndex,
    lng: number,
    lat: number,
  ): number | undefined {
    const pixPos = this.lngLatToPixelPosition(tile, lng, lat);
    if (pixPos === undefined) return undefined;

    if (this.sampling === "median" && this.sampleRadius > 0) {
      return this.getMedianValueFromPixels(pixels, pixPos);
    }

    return this.getValueFromPixel(pixels, pixPos[0], pixPos[1]);
  }

  private async getTilePixels(url: string): Promise<TileCacheValue> {
    if (this.tileCache?.has(url)) {
      return this.tileCache.get(url);
    }

    const inFlight = this.inFlightRequests.get(url);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchAndDecodeTile(url).then((pixels) => {
      this.tileCache?.set(url, pixels);
      return pixels;
    });

    this.inFlightRequests.set(url, request);
    try {
      return await request;
    } finally {
      this.inFlightRequests.delete(url);
    }
  }

  private async fetchAndDecodeTile(url: string): Promise<TileCacheValue> {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        return undefined;
      }
      throw new Error(`Failed to fetch tile: ${res.statusText}`);
    }
    const blob = await res.blob();
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return this.decodeImage(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      return undefined;
    }
  }

  private decodeImage(
    image: CanvasImageSource,
    width: number,
    height: number,
  ): Uint8Array {
    const ctx = this.getDecodeContext(width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height).data;
    return new Uint8Array(imageData);
  }

  private getDecodeContext(
    width: number,
    height: number,
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    if (!this.decodeCanvas) {
      this.decodeCanvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");
    }

    if (this.decodeCanvas.width !== width) this.decodeCanvas.width = width;
    if (this.decodeCanvas.height !== height) this.decodeCanvas.height = height;

    if (!this.decodeContext) {
      this.decodeContext = this.decodeCanvas.getContext("2d") ?? undefined;
    }
    if (!this.decodeContext) {
      throw new Error("Failed to create canvas context");
    }
    return this.decodeContext;
  }

  /**
   * Calculate the value from RGBA.
   * You must impletement this method in your sub class.
   * @param r red
   * @param g green
   * @param b blue
   * @param a alpha
   */
  protected abstract calc(r: number, g: number, b: number, a: number): number;

  private lngLatToPixelPosition(
    tile: TileIndex,
    lng: number,
    lat: number,
  ): number[] | undefined {
    const bbox = this.tileToBBOX(tile);
    return this.getPixelPosition(lng, lat, bbox);
  }

  private getValueFromPixel(
    pixels: Uint8Array,
    x: number,
    y: number,
  ): number | undefined {
    const rgba = this.getRgbaFromPixel(pixels, x, y);
    if (rgba === undefined) return undefined;

    const [r, g, b, a] = rgba;
    if (a === 0) return undefined;
    return this.calc(r, g, b, a);
  }

  private getRgbaFromPixel(
    pixels: Uint8Array,
    x: number,
    y: number,
  ): Rgba | undefined {
    if (x < 0 || x >= this.tileSize || y < 0 || y >= this.tileSize) {
      return undefined;
    }
    const offset = (x + y * this.tileSize) * 4;
    return [
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      pixels[offset + 3],
    ];
  }

  private getMedianValueFromPixels(
    pixels: Uint8Array,
    pixPos: number[],
  ): number | undefined {
    const [centerX, centerY] = pixPos;
    const values: number[] = [];
    const minX = Math.max(0, centerX - this.sampleRadius);
    const maxX = Math.min(this.tileSize - 1, centerX + this.sampleRadius);
    const minY = Math.max(0, centerY - this.sampleRadius);
    const maxY = Math.min(this.tileSize - 1, centerY + this.sampleRadius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const value = this.getValueFromPixel(pixels, x, y);
        if (value !== undefined) values.push(value);
      }
    }

    if (values.length === 0) return undefined;
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    if (values.length % 2 === 1) return values[mid];
    return (values[mid - 1] + values[mid]) / 2;
  }

  /**
   * Get the position in pixel from the coordinates
   * @param lng longitude
   * @param lat latitude
   * @param bbox bbox (minx, miny, maxx, maxy)
   * @returns The position in pixel
   */
  private getPixelPosition(lng: number, lat: number, bbox: number[]): number[] {
    const pixelWidth = this.tileSize;
    const pixelHeight = this.tileSize;
    const bboxWidth = bbox[2] - bbox[0];
    const bboxHeight = bbox[3] - bbox[1];

    const widthPct = (lng - bbox[0]) / bboxWidth;
    const heightPct = (lat - bbox[1]) / bboxHeight;
    const xPx = Math.floor(pixelWidth * widthPct);
    const yPx = Math.floor(pixelHeight * (1 - heightPct));
    return [xPx, yPx];
  }

  private createRasterRequest(lnglat: number[], z: number): RasterRequest {
    const lng = lnglat[0];
    const lat = lnglat[1];
    let zoom = z;
    if (z > this.maxzoom) {
      zoom = this.maxzoom;
    } else if (z < this.minzoom) {
      zoom = this.minzoom;
    }
    const tile = (
      this.tms
        ? lngLatToTile([lng, lat], zoom)
        : lngLatToGoogle([lng, lat], zoom)
    ) as TileIndex;
    const url: string = this.url
      .replace(/{x}/g, tile[0].toString())
      .replace(/{y}/g, tile[1].toString())
      .replace(/{z}/g, tile[2].toString());
    return { url, tile, lng, lat };
  }

  /**
   * Get file extenstion name from the URL
   * @param url URL for tilesets
   * @returns file extenstion either png or webp
   */
  private getUrlExtension(url: string): string | undefined {
    let extension = url.split(/[#?]/)[0].split(".").pop();
    if (extension) {
      extension = extension.trim();
    }
    return extension;
  }

  /**
   * Get the bbox of a tile
   * @param {Array<number>} tile
   * @returns {Array<number>} bbox
   * @example
   * var bbox = tileToBBOX([5, 10, 10])
   * //=bbox
   */
  private tileToBBOX(tile: TileIndex): number[] {
    const e = this.tile2lon(tile[0] + 1, tile[2]);
    const w = this.tile2lon(tile[0], tile[2]);
    const s = this.tile2lat(tile[1] + 1, tile[2]);
    const n = this.tile2lat(tile[1], tile[2]);
    return [w, s, e, n];
  }

  private tile2lon(x: number, z: number): number {
    return (x / Math.pow(2, z)) * 360 - 180;
  }

  private tile2lat(y: number, z: number): number {
    const r2d = 180 / Math.PI;
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return r2d * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
}
