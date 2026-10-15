import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { MText } from '../../src/renderer/mtext'
import {
  createDefaultColorSettings,
  MTextAttachmentPoint,
  TextStyle
} from '../../src/renderer/types'

function createShapeGeometry(width: number, height: number) {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(width, 0)
  shape.lineTo(width, height)
  shape.lineTo(0, height)
  shape.lineTo(0, 0)
  return new THREE.ShapeGeometry(shape)
}

function createGeometryBox(object: THREE.Object3D) {
  const box = new THREE.Box3()
  const childBox = new THREE.Box3()

  object.updateWorldMatrix(true, true)
  object.traverse(child => {
    if (!('geometry' in child)) return

    const geometry = child.geometry as THREE.BufferGeometry
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox) return

    child.updateWorldMatrix(true, false)
    childBox.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld)
    box.union(childBox)
  })

  return box
}

/** Fake font: every glyph advances 10 units and draws a 10 x size box at its pen. */
function createTextFixture(
  overrides: Partial<{
    text: string
    height: number
    width: number
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
      position: { x: 0, y: 0, z: 0 },
      attachmentPoint: overrides.attachmentPoint ?? MTextAttachmentPoint.TopLeft
    },
    style,
    styleManager as any,
    fontManager as any,
    createDefaultColorSettings()
  )
}

describe('MText paragraph indent layout', () => {
  it('treats \\pi value as drawing units when the height multiple cannot fit', () => {
    // height=24: `\pi5` read as a height multiple means 5 x 24 = 120, wider
    // than the 100 frame. The raw 5 fits, so the value must be drawing units:
    // the first glyph starts at x=5 and "AA" spans [5, 25] on one line.
    const mtext = createTextFixture({
      text: '\\pi5;AA',
      height: 24,
      width: 100
    })

    mtext.syncDraw()
    const box = createGeometryBox(mtext)

    expect(box.min.x).toBeCloseTo(5, 4)
    expect(box.max.x).toBeCloseTo(25, 4)
  })

  it('keeps a height-multiple indent after left alignment', () => {
    // height=24: `\pi2` means 2 x 24 = 48, inside the 100 frame. Left
    // alignment must not snap the indented first glyph back to the margin.
    const mtext = createTextFixture({
      text: '\\pi2;AA',
      height: 24,
      width: 100
    })

    mtext.syncDraw()
    const box = createGeometryBox(mtext)

    expect(box.min.x).toBeCloseTo(48, 4)
    expect(box.max.x).toBeCloseTo(68, 4)
  })

  it('starts an unindented paragraph at the frame edge', () => {
    const mtext = createTextFixture({
      text: 'AAA',
      height: 24,
      width: 100
    })

    mtext.syncDraw()
    const box = createGeometryBox(mtext)

    expect(box.min.x).toBeCloseTo(0, 4)
    expect(box.max.x).toBeCloseTo(30, 4)
  })

  it('keeps the persisted indent for a paragraph after \\P', () => {
    // `\p` properties persist across `\P`, so both lines keep the 48-unit
    // indent and left alignment preserves it on each line.
    const mtext = createTextFixture({
      text: '\\pi2;AA\\PBB',
      height: 24,
      width: 100
    })

    mtext.syncDraw()
    const box = createGeometryBox(mtext)

    expect(box.min.x).toBeCloseTo(48, 4)
    expect(box.max.x).toBeCloseTo(68, 4)
  })
})
