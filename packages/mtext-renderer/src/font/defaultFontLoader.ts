import { getFileNameWithoutExtension } from '../common'
import { resolveFontNameAlias } from './fontAliases'
import { FontInfo, FontLoader, FontLoadStatus } from './fontLoader'
import { FontManager } from './fontManager'

/**
 * Default implementation of the FontLoader interface.
 * This class provides font loading functionality using [this font repository](https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/).
 * It loads font metadata from a JSON file and provides access to available fonts.
 */
export class DefaultFontLoader implements FontLoader {
  /** List of available fonts in the system */
  private _avaiableFonts: FontInfo[]
  private _baseUrl: string
  private _avaiableFontMap: Map<string, FontInfo>
  /**
   * Shared in-flight metadata fetch. Concurrent {@link getAvailableFonts} /
   * {@link load} callers (common with lazy per-entity font requests) must not
   * each hit `fonts.json` independently.
   */
  private _availableFontsPromise: Promise<FontInfo[]> | null = null
  /**
   * At most one forced `fonts.json` revalidation per baseUrl. Used when a
   * requested face is missing from a possibly stale HTTP-cached catalog
   * (e.g. jsDelivr `@main` with a long max-age).
   */
  private _catalogRefreshAttempted = false
  /**
   * In-flight catalog revalidation. Concurrent {@link load} callers (common
   * when style primary + bigfont are requested via `requestFonts`) must all
   * await the same refresh; otherwise a sibling can read the stale map, mark
   * the new face `NotFound`, and sticky-skip it for the rest of the session.
   */
  private _catalogRefreshPromise: Promise<FontInfo[]> | null = null

  /**
   * Creates a new instance of DefaultFontLoader
   */
  constructor() {
    this._avaiableFonts = []
    this._avaiableFontMap = new Map()
    this._baseUrl = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data/fonts/'
  }

  /**
   * Base URL to load fonts
   */
  get baseUrl() {
    return this._baseUrl
  }
  set baseUrl(value: string) {
    if (this._baseUrl === value) {
      return
    }
    this._baseUrl = value
    this.clearAvailableFontsCache()
    this._catalogRefreshAttempted = false
    this._catalogRefreshPromise = null
    this.onFontUrlChanged(value)
  }

  /**
   * Gets the list of available fonts
   * @returns Array of FontInfo objects describing available fonts
   */
  get avaiableFonts() {
    return this._avaiableFonts
  }

  /**
   * Triggered when font url changed
   * @param url - New font url value
   */
  onFontUrlChanged(url: string) {
    // Do nothing for now
  }

  /**
   * Retrieves information about all available fonts in the system.
   * Loads font metadata from a CDN if not already loaded.
   * Concurrent callers share one in-flight fetch so `fonts.json` is requested
   * at most once per loader instance / baseUrl.
   * @returns Promise that resolves to an array of FontInfo objects
   * @throws {Error} If font metadata cannot be loaded from the CDN
   */
  async getAvailableFonts() {
    if (this._avaiableFonts.length > 0) {
      this.buildFontMap()
      return this._avaiableFonts
    }
    if (this._availableFontsPromise) {
      return this._availableFontsPromise
    }

    const baseUrl = this._baseUrl
    const promise = this.fetchAvailableFonts(baseUrl).finally(() => {
      // Only clear if this promise is still the active one (a newer fetch may
      // have started after baseUrl changed, including A→B→A cycles).
      if (this._availableFontsPromise === promise) {
        this._availableFontsPromise = null
      }
    })
    this._availableFontsPromise = promise
    return promise
  }

  /**
   * Loads the specified fonts into the system. If one font is already loaded,
   * the font will not be loaded again. If no font names are provided, just loads
   * all available fonts information (not fonts).
   * @param fontNames - Array of font names to load
   * @returns Promise that resolves to an array of FontLoadStatus objects
   */
  async load(fontNames: readonly string[]): Promise<FontLoadStatus[]> {
    if (fontNames == null || fontNames.length === 0) {
      return []
    }

    // Fast path: every requested face is already in memory — skip catalog /
    // IndexedDB entirely. Open-drawing awaits this per TEXT/MTEXT entity.
    const alreadyLoadedFast: FontLoadStatus[] = []
    let allLoaded = true
    for (const font of fontNames) {
      if (FontManager.instance.isFontLoaded(this.catalogLookupKey(font))) {
        alreadyLoadedFast.push({
          fontName: this.bareFontKey(font),
          url: '',
          status: 'Success'
        })
      } else {
        allLoaded = false
        break
      }
    }
    if (allLoaded) {
      return alreadyLoadedFast
    }

    await this.getAvailableFonts()

    // Stale HTTP-cached fonts.json can omit newly published faces (e.g. malgun,
    // hztxt2). Keep normal caching for the common path; revalidate at most once
    // per baseUrl when a requested name is absent from the in-memory catalog.
    // Concurrent loads must share that refresh (see _catalogRefreshPromise).
    const missingFromCatalog = fontNames.some(
      font => !this._avaiableFontMap.has(this.catalogLookupKey(font))
    )
    if (missingFromCatalog) {
      await this.ensureCatalogRefreshedOnce()
    }

    const alreadyLoadedStatuses: FontLoadStatus[] = []
    const fontsToLoad: FontInfo[] = []
    const requestedFontInfos = new Map<string, FontInfo>()
    const seenFiles = new Set<string>()
    fontNames.forEach(font => {
      // Statuses are reported under the requested (extension-stripped) name;
      // the catalog entry is resolved through the alias-aware key.
      const fontKey = this.bareFontKey(font)
      const fontInfo = this._avaiableFontMap.get(this.catalogLookupKey(font))
      if (fontInfo) {
        requestedFontInfos.set(fontKey, fontInfo)
        if (FontManager.instance.isFontLoaded(fontKey)) {
          alreadyLoadedStatuses.push({
            fontName: fontKey,
            url: fontInfo.url,
            status: 'Success'
          })
          return
        }
        const fileKey = fontInfo.file.toLowerCase()
        if (!seenFiles.has(fileKey)) {
          seenFiles.add(fileKey)
          fontsToLoad.push(fontInfo)
        }
      }
    })
    const newlyLoadedStatuses =
      fontsToLoad.length > 0
        ? await FontManager.instance.loadFonts(fontsToLoad)
        : []

    // Merge and return statuses for all requested fonts, preserving order.
    // FontManager reports status by file name; alias requests need remapping.
    const statusMap: Record<string, FontLoadStatus> = {}
    ;[...alreadyLoadedStatuses, ...newlyLoadedStatuses].forEach(s => {
      statusMap[s.fontName] = s
    })

    const statuses: FontLoadStatus[] = []
    for (const font of fontNames) {
      const fontKey = this.bareFontKey(font)
      const directStatus = statusMap[fontKey]
      if (directStatus) {
        statuses.push(directStatus)
        continue
      }

      const fontInfo = requestedFontInfos.get(fontKey)
      if (fontInfo) {
        if (FontManager.instance.isFontLoaded(fontKey)) {
          statuses.push({
            fontName: fontKey,
            url: fontInfo.url,
            status: 'Success'
          })
          continue
        }

        const fileBaseName = getFileNameWithoutExtension(
          fontInfo.file
        ).toLowerCase()
        const loadedByFile = statusMap[fileBaseName]
        if (loadedByFile) {
          statuses.push({
            fontName: fontKey,
            url: fontInfo.url,
            status: loadedByFile.status
          })
          continue
        }
      }

      if (await FontManager.instance.loadFontFromCache(font)) {
        statuses.push({
          fontName: fontKey,
          url: '',
          status: 'Success'
        })
        continue
      }

      statuses.push({
        fontName: fontKey,
        url: '',
        status: 'NotFound'
      })
    }
    return statuses
  }

  private clearAvailableFontsCache() {
    this._avaiableFonts = []
    this._avaiableFontMap.clear()
    this._availableFontsPromise = null
  }

  /**
   * Request key used for status reporting: file name without extension,
   * lowercased. Catalog faces are stored without `.shx` / `.ttf` extensions,
   * so style file names still hit the map.
   */
  private bareFontKey(fontName: string): string {
    return getFileNameWithoutExtension(fontName).toLowerCase()
  }

  /**
   * Catalog key of a requested font name: the bare key when the repository
   * publishes it, otherwise its built-in alias face (`MS PGothic` is served by
   * the `msgothic` collection). Statuses stay reported under the requested
   * name, the file-derived status merge in {@link load} maps the alias result
   * back.
   */
  private catalogLookupKey(fontName: string): string {
    const lowerCaseFontName = this.bareFontKey(fontName)
    if (this._avaiableFontMap.has(lowerCaseFontName)) {
      return lowerCaseFontName
    }
    const alias = resolveFontNameAlias(lowerCaseFontName)
    return alias && this._avaiableFontMap.has(alias)
      ? alias
      : lowerCaseFontName
  }

  /**
   * Starts or joins the single per-baseUrl catalog revalidation so concurrent
   * {@link load} callers all see the refreshed map before resolving misses.
   */
  private async ensureCatalogRefreshedOnce(): Promise<void> {
    if (this._catalogRefreshPromise) {
      await this._catalogRefreshPromise
      return
    }
    if (this._catalogRefreshAttempted) {
      return
    }
    this._catalogRefreshAttempted = true
    const promise = this.refreshAvailableFontsFromNetwork().finally(() => {
      if (this._catalogRefreshPromise === promise) {
        this._catalogRefreshPromise = null
      }
    })
    this._catalogRefreshPromise = promise
    await promise
  }

  /**
   * Refetches `fonts.json`, bypassing the HTTP cache so CDN updates are
   * visible after a miss. Keeps the current in-memory catalog until the new
   * payload replaces it — clearing first races concurrent {@link load} calls
   * into an empty map (they report catalog faces as `NotFound` and sticky-miss
   * them for the session).
   */
  private async refreshAvailableFontsFromNetwork(): Promise<FontInfo[]> {
    const baseUrl = this._baseUrl
    const promise = this.fetchAvailableFonts(baseUrl, {
      bypassHttpCache: true
    }).finally(() => {
      if (this._availableFontsPromise === promise) {
        this._availableFontsPromise = null
      }
    })
    this._availableFontsPromise = promise
    return promise
  }

  /**
   * Fetches and caches remote font metadata for the given base URL.
   */
  private async fetchAvailableFonts(
    baseUrl: string,
    options?: { bypassHttpCache?: boolean }
  ): Promise<FontInfo[]> {
    const fontMetaDataUrl = baseUrl + 'fonts.json'
    let fonts: FontInfo[]
    try {
      // Default: allow HTTP cache (jsDelivr max-age is long). Callers that need
      // a fresh catalog after a miss pass bypassHttpCache.
      const response = options?.bypassHttpCache
        ? await fetch(fontMetaDataUrl, { cache: 'no-cache' })
        : await fetch(fontMetaDataUrl)
      fonts = (await response.json()) as FontInfo[]
    } catch (error) {
      throw new Error(
        `Filed to get avaiable font from '${fontMetaDataUrl}' due to ${error}!`
      )
    }

    // Stale response after baseUrl changed — discard and load for the new URL.
    if (this._baseUrl !== baseUrl) {
      return this.getAvailableFonts()
    }

    fonts.forEach(font => {
      font.url = baseUrl + font.file
    })
    this._avaiableFonts = fonts
    this.buildFontMap()
    return this._avaiableFonts
  }

  /**
   * Rebuild the name → FontInfo map from {@link _avaiableFonts}. Clears first
   * so a refreshed catalog cannot leave stale keys behind.
   */
  private buildFontMap() {
    const fontMap = this._avaiableFontMap
    fontMap.clear()
    this._avaiableFonts.forEach(font => {
      font.name.forEach(name => {
        fontMap.set(name.toLowerCase(), font)
      })
    })
  }
}
