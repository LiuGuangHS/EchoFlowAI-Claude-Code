import { existsSync } from 'node:fs'
import path from 'node:path'
import type { App, Tray } from 'electron'

type ElectronTrayApi = {
  Menu: typeof import('electron').Menu
  Tray: typeof import('electron').Tray
  nativeImage: typeof import('electron').nativeImage
}

export type TrayController = {
  tray: Tray
  dispose(): void
}

export function resolveTrayIconPath(desktopRoot: string): string {
  const candidates = [
    path.join(desktopRoot, 'src-tauri', 'icons', 'icon.png'),
    path.join(desktopRoot, 'public', 'app-icon.png'),
    path.join(desktopRoot, 'dist', 'app-icon.png'),
  ]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`Electron tray icon not found under ${desktopRoot}`)
  }
  return resolved
}

export function shouldInstallTray(platform = process.platform): boolean {
  return platform !== 'darwin'
}

export async function installTray({
  app,
  desktopRoot,
  show,
  quit,
  electronApi,
}: {
  app: App
  desktopRoot: string
  show: () => void
  quit: () => void
  electronApi?: ElectronTrayApi
}): Promise<TrayController> {
  const { Menu, Tray, nativeImage } = electronApi ?? await import('electron')
  const icon = nativeImage.createFromPath(resolveTrayIconPath(desktopRoot))
  const tray = new Tray(icon)
  tray.setToolTip(app.name || 'EchoFlow-ClaudeCode')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show EchoFlow-ClaudeCode', click: show },
    { type: 'separator' },
    { label: 'Quit EchoFlow-ClaudeCode', click: quit },
  ]))
  tray.on('click', show)

  return {
    tray,
    dispose() {
      tray.destroy()
    },
  }
}
