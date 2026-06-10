import { describe, expect, test } from 'bun:test'
import { buildClaudeCliArgs, resolveClaudeCliLauncher } from './desktopBundledCli.js'

describe('desktop bundled CLI launcher', () => {
  test('runs script launchers through the current Bun executable on Windows', () => {
    const launcher = resolveClaudeCliLauncher({
      cliPath: 'C:\\tmp\\mock-sdk-cli.ts',
      execPath: process.execPath,
    })

    expect(launcher).toEqual({
      command: 'C:\\tmp\\mock-sdk-cli.ts',
      kind: 'script',
      requiresAppRoot: false,
    })

    const args = buildClaudeCliArgs(launcher!, ['--print'])

    if (process.platform === 'win32') {
      expect(args).toEqual([process.execPath, 'C:\\tmp\\mock-sdk-cli.ts', '--print'])
    } else {
      expect(args).toEqual(['bun', 'C:\\tmp\\mock-sdk-cli.ts', '--print'])
    }
  })
})
