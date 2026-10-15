import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { MText } from '../../src/renderer/mtext'
import {
  createDefaultColorSettings,
  MTextAttachmentPoint,
  MTextFlowDirection,
  TextStyle
} from '../../src/renderer/types'

/** Fake glyphs are always 10 units wide so visual-line widths are easy to reason about. */
function createShapeGeometry(width: number, height: number) {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, 0)
  shape.lineTo(width, height)
  shape.lineTo(0, height)
  shape.lineTo(0, 0)
  return new THREE.ShapeGeometry(shape)
}

function createTextFixture(
  overrides: Partial<{
    text: string
    height: number
    width: number
    widthFactor: number
    position: { x: number; y: number; z: number }
    rotation: number
    drawingDirection: MTextFlowDirection
    attachmentPoint: MTextAttachmentPoint
  }> = {}
) {
  const textHeight = overrides.height ?? 24
  const style: TextStyle = {
    name: 'default',
    standardFlag: 0,
    fixedTextHeight: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    textGenerationFlag: 0,
    lastHeight: textHeight,
    font: 'fake',
    bigFont: ''
  }
  const styleManager = {
    unsupportedTextStyles: {},
    getMeshBasicMaterial: vi
      .fn()
      .mockReturnValue(new THREE.MeshBasicMaterial()),
    getLineBasicMaterial: vi.fn().mockReturnValue(new THREE.LineBasicMaterial())
  }
  const fontManager = {
    getFontScaleFactor: () => 1,
    getFontType: () => 'mesh',
    findAndReplaceFont: (name: string) => name,
    getCharShape: (_char: string, _fontName: string, size: number) => ({
      width: 10,
      toGeometry: () => createShapeGeometry(10, size)
    }),
    getNotFoundTextShape: () => undefined
  }

  return new MText(
    {
      text: overrides.text ?? 'A',
      height: textHeight,
      width: overrides.width ?? 100,
      widthFactor: overrides.widthFactor,
      position: overrides.position ?? { x: 0, y: 0, z: 0 },
      rotation: overrides.rotation,
      drawingDirection: overrides.drawingDirection,
      attachmentPoint: overrides.attachmentPoint
    },
    style,
    styleManager as any,
    fontManager as any,
    createDefaultColorSettings()
  )
}

/** World-space x-extent of every rendered leaf mesh, one entry per visual line. */
function getChildBoxes(object: THREE.Object3D) {
  const boxes: Array<{ minX: number; maxX: number }> = []
  object.traverse(child => {
    if (!('geometry' in child)) return
    const geometry = child.geometry as THREE.BufferGeometry
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox) return
    child.updateWorldMatrix(true, false)
    const world = geometry.boundingBox.clone().applyMatrix4(child.matrixWorld)
    boxes.push({ minX: world.min.x, maxX: world.max.x })
  })
  return boxes
}

function hasBox(boxes: Array<{ minX: number; maxX: number }>, minX: number, maxX: number) {
  return boxes.some(
    box => Math.abs(box.minX - minX) < 1e-3 && Math.abs(box.maxX - maxX) < 1e-3
  )
}

describe('MText paragraph alignment and word wrapping', () => {
  it('keeps a trailing digit run together when it crosses the wrap boundary', () => {
    // Width 60 = 6 fake glyphs. '一二三四五15': CJK may break between any two
    // characters, but the digit run '15' is one Latin word token — once it does
    // not fit as a whole it must move to the next line, never split 1|5.
    const mtext = createTextFixture({
      text: '一二三四五15',
      height: 24,
      width: 60,
      attachmentPoint: MTextAttachmentPoint.TopLeft
    })

    mtext.syncDraw()
    const boxes = getChildBoxes(mtext)

    expect(hasBox(boxes, 0, 50)).toBe(true)
    expect(hasBox(boxes, 0, 20)).toBe(true)
  })

  it('reproduces the mining label case: digits stay with their unit on line 2', () => {
    // Width 120 = 12 glyphs. '2号回风立井总回风巷450米' (14 glyphs) wraps once;
    // expected: line 1 '2号回风立井总回风巷' (100 wide), line 2 '450米' (40 wide).
    const mtext = createTextFixture({
      text: '2号回风立井总回风巷450米',
      height: 24,
      width: 120,
      attachmentPoint: MTextAttachmentPoint.TopLeft
    })

    mtext.syncDraw()
    const boxes = getChildBoxes(mtext)

    expect(hasBox(boxes, 0, 100)).toBe(true)
    expect(hasBox(boxes, 0, 40)).toBe(true)
  })

  it('centers each line inside a defined-width column under MiddleCenter', () => {
    // Longest line 'AAAA' (40) pins the 100-wide frame at [-50, 50]; 'AA' (20)
    // must render centered → [40, 60] in column space → [-10, 10] in world.
    const mtext = createTextFixture({
      text: 'AA\\PAAAA',
      height: 24,
      width: 100,
      attachmentPoint: MTextAttachmentPoint.MiddleCenter
    })

    mtext.syncDraw()
    const boxes = getChildBoxes(mtext)

    expect(hasBox(boxes, -10, 10)).toBe(true)
    expect(hasBox(boxes, -20, 20)).toBe(true)
  })

  it('centers soft-wrapped lines inside the column under MiddleCenter', () => {
    // '一二三四五六' at width 40 (4 fake glyphs per line) soft-wraps into
    // '一二三四' and '五六' (20 wide). The short second line must be centered
    // → [10, 30] in column space → [-10, 10] after MiddleCenter anchoring.
    const mtext = createTextFixture({
      text: '一二三四五六',
      height: 24,
      width: 40,
      attachmentPoint: MTextAttachmentPoint.MiddleCenter
    })

    mtext.syncDraw()
    const boxes = getChildBoxes(mtext)

    expect(hasBox(boxes, -20, 20)).toBe(true)
    expect(hasBox(boxes, -10, 10)).toBe(true)
  })

  it('overflows an atomic ASCII run that is wider than the whole column', () => {
    // Run '1234567' (70) can never fit the 60-wide column; it moves to a fresh
    // line as a whole and overflows there — like a pure-Latin part number.
    const mtext = createTextFixture({
      text: '一二三1234567',
      height: 24,
      width: 60,
      attachmentPoint: MTextAttachmentPoint.TopLeft
    })

    mtext.syncDraw()
    const boxes = getChildBoxes(mtext)

    expect(hasBox(boxes, 0, 30)).toBe(true)
    expect(hasBox(boxes, 0, 70)).toBe(true)
  })
})
