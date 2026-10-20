import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/cache', () => ({
  FontCacheManager: {
    instance: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(false)
    }
  }
}))

vi.mock('../../src/font/fontFactory', () => ({
  FontFactory: {
    instance: {
      createFont: vi.fn()
    }
  }
}))

import {
  FONT_NAME_ALIASES,
  resolveFontNameAlias
} from '../../src/font/fontAliases'
import { FontManager } from '../../src/font/fontManager'
import { FontInfo, FontLoader, FontLoadStatus } from '../../src/font/fontLoader'

function createFontLoader(baseUrl: string): FontLoader {
  return {
    load: vi.fn<FontLoader['load']>().mockResolvedValue([] as FontLoadStatus[]),
    getAvailableFonts: vi
      .fn<FontLoader['getAvailableFonts']>()
      .mockResolvedValue([] as FontInfo[]),
    baseUrl
  }
}

function createFakeFont(overrides: Record<string, unknown> = {}) {
  return {
    names: new Set<string>(),
    type: 'mesh',
    unsupportedChars: {},
    hasChar: vi.fn().mockReturnValue(false),
    getCharShape: vi.fn(),
    getCodeShape: vi.fn(),
    getScaleFactor: vi.fn().mockReturnValue(1),
    getNotFoundTextShape: vi.fn(),
    dispose: vi.fn(),
    ...overrides
  }
}

function resetManager(loader: FontLoader) {
  const manager = FontManager.instance as any
  manager.release()
  manager.setFontLoader(loader)
  manager.fontMapping = {}
  manager.missedFonts = {}
  manager.unsupportedChars = {}
  manager.fileNames = []
  manager.enableFontCache = false
  manager.lazyFontLoading = false
  manager.defaultFonts = new Set(['simkai'])
  manager.symbolFonts = new Set(['amgdt'])
  return manager
}

describe('FONT_NAME_ALIASES', () => {
  it('maps normalized family names onto another normalized face name', () => {
    for (const [name, alias] of FONT_NAME_ALIASES) {
      expect(name).toBe(name.toLowerCase())
      expect(alias).toBe(alias.toLowerCase())
      expect(alias).not.toBe(name)
      expect(resolveFontNameAlias(name)).toBe(alias)
    }
  })

  it('aliases the reported MS PGothic spellings onto the MS Gothic collection', () => {
    for (const name of [
      'ms pgothic',
      'ms-pgothic',
      'mspgothic',
      'ｍｓ ｐゴシック',
      'ms uigothic',
      'ｍｓ ｕｉゴシック'
    ]) {
      expect(resolveFontNameAlias(name)).toBe('msgothic')
    }
  })

  it('ignores names without an alias and empty lookups', () => {
    expect(resolveFontNameAlias('simsun')).toBeUndefined()
    expect(resolveFontNameAlias('totally-unknown-font')).toBeUndefined()
    expect(resolveFontNameAlias('')).toBeUndefined()
  })
})

describe('FontManager built-in font name aliases', () => {
  let manager: any
  let loader: FontLoader

  beforeEach(() => {
    loader = createFontLoader('https://cdn.example.com/fonts/')
    manager = resetManager(loader)
  })

  afterEach(() => {
    FontManager.instance.release()
    vi.clearAllMocks()
  })

  it('treats the alias face as loaded for the aliased family name', () => {
    const font = createFakeFont()
    manager.loadedFontMap.set('msgothic', font)

    expect(FontManager.instance.isFontLoaded('MS PGothic')).toBe(true)
    expect(FontManager.instance.isFontLoaded('MS PGothic.woff')).toBe(true)
    expect(FontManager.instance.isFontLoaded('ms pgothic')).toBe(true)
    expect(FontManager.instance.getFontByName('MS PGothic')).toBe(font)
    expect(FontManager.instance.getFontByName('MS PGothic', false)).toBe(font)
    expect(manager.missedFonts).toEqual({})
  })

  it('returns the alias face from findAndReplaceFont without a missing-font report', () => {
    const font = createFakeFont()
    manager.loadedFontMap.set('msgothic', font)
    const listener = vi.fn()
    FontManager.instance.events.fontNotFound.addEventListener(listener)

    expect(FontManager.instance.findAndReplaceFont('MS PGothic')).toBe(
      'msgothic'
    )
    expect(manager.missedFonts).toEqual({})
    expect(listener).not.toHaveBeenCalled()

    FontManager.instance.events.fontNotFound.removeEventListener(listener)
  })

  it('prefers the requested face when the repository publishes it', () => {
    const exact = createFakeFont()
    const standIn = createFakeFont()
    manager.loadedFontMap.set('ms pgothic', exact)
    manager.loadedFontMap.set('msgothic', standIn)

    expect(FontManager.instance.getFontByName('MS PGothic')).toBe(exact)
    // A face published under the requested spelling keeps that spelling, which
    // is what hosts report.
    expect(FontManager.instance.findAndReplaceFont('MS PGothic')).toBe(
      'MS PGothic'
    )
  })

  it('requests the alias face when the aliased family is scheduled for load', async () => {
    await FontManager.instance.requestFont('MS PGothic')

    expect(loader.load).toHaveBeenCalledWith(['msgothic'])
  })

  it('reports the requested name while neither it nor its alias is loaded', () => {
    expect(FontManager.instance.findAndReplaceFont('MS PGothic')).toBe('simkai')
    expect(manager.missedFonts).toEqual({ 'MS PGothic': 1 })
    expect(FontManager.instance.getFontByName('MS PGothic')).toBeUndefined()
    expect(manager.missedFonts).toEqual({ 'MS PGothic': 2 })
  })

  it('keeps user font mappings working for names without a built-in alias', () => {
    manager.loadedFontMap.set('replacement', createFakeFont())
    FontManager.instance.setFontMapping({ Missing: 'replacement' })

    expect(FontManager.instance.findAndReplaceFont('Missing')).toBe(
      'replacement'
    )
    expect(manager.missedFonts).toEqual({ Missing: 1 })
  })
})

describe('FontManager.getCharShapeFromLoadedFonts', () => {
  let manager: any

  beforeEach(() => {
    manager = resetManager(createFontLoader('https://cdn.example.com/fonts/'))
  })

  afterEach(() => {
    FontManager.instance.release()
    vi.clearAllMocks()
  })

  it('draws the glyph from any loaded face and probes each face once', () => {
    const shape = { width: 7 }
    const gothic = createFakeFont({
      hasChar: vi.fn((char: string) => char === '✚'),
      getCharShape: vi.fn().mockReturnValue(shape)
    })
    const simsun = createFakeFont()
    // Alias keys share one instance: the scan must not ask it twice.
    manager.loadedFontMap.set('msgothic', gothic)
    manager.loadedFontMap.set('ms gothic', gothic)
    manager.loadedFontMap.set('simsun', simsun)

    expect(FontManager.instance.getCharShapeFromLoadedFonts('✚', 12)).toBe(
      shape
    )
    expect(gothic.getCharShape).toHaveBeenCalledTimes(1)
    expect(gothic.getCharShape).toHaveBeenCalledWith('✚', 12)
    expect(simsun.getCharShape).not.toHaveBeenCalled()
  })

  it('skips faces reporting the glyph but building no shape', () => {
    const shape = { width: 5 }
    const falsePositive = createFakeFont({
      hasChar: vi.fn().mockReturnValue(true),
      getCharShape: vi.fn().mockReturnValue(undefined)
    })
    const fallback = createFakeFont({
      hasChar: vi.fn().mockReturnValue(true),
      getCharShape: vi.fn().mockReturnValue(shape)
    })
    manager.loadedFontMap.set('falsepositive', falsePositive)
    manager.loadedFontMap.set('fallback', fallback)

    expect(
      FontManager.instance.getCharShapeFromLoadedFonts('✚', 12)
    ).toBe(shape)
  })

  it('returns undefined when no loaded face provides the glyph', () => {
    manager.loadedFontMap.set('simsun', createFakeFont())

    expect(
      FontManager.instance.getCharShapeFromLoadedFonts('✚', 12)
    ).toBeUndefined()
  })
})
