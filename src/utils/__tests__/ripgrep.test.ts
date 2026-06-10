import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  isUsableBuiltinRipgrepPath,
  resetRipgrepConfigCacheForTests,
  ripgrepCommand,
} from '../ripgrep.js'

const tempFiles: string[] = []
const tempDirs: string[] = []
const originalPath = process.env.PATH
const originalPathLower = process.env.Path
const originalPathext = process.env.PATHEXT
const originalUseBuiltinRipgrep = process.env.USE_BUILTIN_RIPGREP

function setPathForCurrentProcess(value: string): void {
  if (process.platform === 'win32') {
    process.env.PATH = value
    process.env.Path = value
  } else {
    process.env.PATH = value
  }
}

async function createRipgrepShim(dir: string): Promise<string> {
  const fileName = process.platform === 'win32' ? 'rg.cmd' : 'rg'
  const shimPath = join(dir, fileName)
  const content =
    process.platform === 'win32'
      ? '@echo ripgrep 13.0.0\r\n'
      : '#!/bin/sh\nprintf "ripgrep 13.0.0\\n"\n'
  await writeFile(shimPath, content, { mode: 0o755 })
  return shimPath
}

afterEach(async () => {
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalPathLower === undefined) delete process.env.Path
  else process.env.Path = originalPathLower
  if (originalPathext === undefined) delete process.env.PATHEXT
  else process.env.PATHEXT = originalPathext
  if (originalUseBuiltinRipgrep === undefined) delete process.env.USE_BUILTIN_RIPGREP
  else process.env.USE_BUILTIN_RIPGREP = originalUseBuiltinRipgrep
  resetRipgrepConfigCacheForTests()
  await Promise.all(tempFiles.splice(0).map(path => rm(path, { force: true })))
  await Promise.all(
    tempDirs.splice(0).map(path => rm(path, { force: true, recursive: true })),
  )
})

describe('isUsableBuiltinRipgrepPath', () => {
  test('rejects Bun virtual filesystem paths', () => {
    expect(
      isUsableBuiltinRipgrepPath('B:\\~BUN\\root\\vendor\\ripgrep\\x64-win32\\rg.exe'),
    ).toBe(false)
    expect(
      isUsableBuiltinRipgrepPath('/$bunfs/root/vendor/ripgrep/arm64-darwin/rg'),
    ).toBe(false)
  })

  test('rejects missing paths', () => {
    expect(
      isUsableBuiltinRipgrepPath(join(tmpdir(), 'missing-cc-haha-rg')),
    ).toBe(false)
  })

  test('accepts real filesystem paths', async () => {
    const filePath = join(tmpdir(), `cc-haha-rg-${Date.now()}`)
    await writeFile(filePath, '')
    tempFiles.push(filePath)

    expect(isUsableBuiltinRipgrepPath(filePath)).toBe(true)
  })
})

describe('ripgrepCommand', () => {
  test('recomputes system ripgrep availability when PATH changes', async () => {
    const firstDir = join(tmpdir(), `cc-haha-rg-path-a-${Date.now()}`)
    const secondDir = join(tmpdir(), `cc-haha-rg-path-b-${Date.now()}`)
    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })
    tempDirs.push(firstDir, secondDir)

    await createRipgrepShim(firstDir)
    const secondRgPath = await createRipgrepShim(secondDir)

    process.env.USE_BUILTIN_RIPGREP = '0'
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    setPathForCurrentProcess(firstDir)
    resetRipgrepConfigCacheForTests()

    const originalCommand = ripgrepCommand()
    expect(originalCommand.rgPath).not.toBe('')

    setPathForCurrentProcess(secondDir)

    expect(ripgrepCommand().rgPath).toBe(secondRgPath)
  })

  test('prefers the Windows Path env key when PATH is stale', async () => {
    if (process.platform !== 'win32') {
      return
    }

    const firstDir = join(tmpdir(), `cc-haha-rg-path-stale-${Date.now()}`)
    const secondDir = join(tmpdir(), `cc-haha-rg-path-current-${Date.now()}`)
    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })
    tempDirs.push(firstDir, secondDir)

    await createRipgrepShim(firstDir)
    const currentRgPath = await createRipgrepShim(secondDir)

    process.env.USE_BUILTIN_RIPGREP = '0'
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    process.env.PATH = firstDir
    process.env.Path = secondDir
    resetRipgrepConfigCacheForTests()

    expect(ripgrepCommand().rgPath).toBe(currentRgPath)
  })
})
