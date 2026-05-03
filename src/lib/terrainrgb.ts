import { BaseTile, type BaseTileOptions } from "./base";

/**
 * Terrain RGB class implementation
 */
export class TerrainRGB extends BaseTile {
  /**
   * Constructor
   * @param url URL for terrain RGB raster tilesets
   * @param tileSize size of tile. 256 or 512
   * @param tms whether it is Tile Map Service
   * @param minzoom minzoom for terrain RGB raster tilesets. default is 5
   * @param maxzoom maxzoom for terrain RGB raster tilesets. default is 15
   */
  constructor(
    url: string,
    tileSize: number,
    minzoom = 5,
    maxzoom = 15,
    tms = false,
    options?: BaseTileOptions,
  ) {
    super(url, tileSize, minzoom, maxzoom, tms, options);
  }

  /**
   * Get an altitude calculated from terrain RGB information
   * @param lnglat coordinates
   * @param z zoom level
   * @returns an altitude calculated from terrain RGB information
   */
  public async getElevation(lnglat: number[], z: number): Promise<number | undefined> {
    const height = await this.getValue(lnglat, z);
    return height;
  }

  /**
   * Get altitudes for multiple coordinates at one zoom level.
   * Coordinates belonging to the same tile share fetch, decode, and cache work.
   * @param lnglats coordinates
   * @param z zoom level
   * @returns altitudes calculated from terrain RGB information
   */
  public async getElevations(
    lnglats: number[][],
    z: number,
  ): Promise<Array<number | undefined>> {
    return this.getValues(lnglats, z);
  }

  /**
   * Formula for calculating an elevation from RGB
   * @param r red
   * @param g green
   * @param b blue
   * @param a alpha
   * @returns an elevation calculated
   */
  protected calc(r: number, g: number, b: number, _a: number): number {
    const elev = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
    return elev;
  }
}
