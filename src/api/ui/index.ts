
export type SelectDirectoryOptions = {
    /** Folder the picker should open at, when the platform supports preselecting one. */
    initialDirectory?: string
}

export type SelectDirectoryResult = {
    selected?: string
    canceled?: boolean
    displayName?: string
    /**
     * Opaque platform token granting continued access to the selected folder across app
     * restarts. Only set on platforms where the pick alone does not persist access.
     */
    grant?: string
    /** Set instead of `grant` when the platform could not produce one. */
    grantError?: string
}

export type TakeScreenshotProps = {
    fileName?: string
}

export interface INativeUI  {
    quit(): void,
    toggleFullscreen(): void    
    disableScreensaver(): void
    enableScreensaver(): void
    takeScreenshot(props:TakeScreenshotProps): Promise<string>
    openBrowserWindow(url:string): void
    openAppWindow(url:string): void
    // `options` is additive - implementations that ignore it (web-ui, desktop) stay valid.
    selectDirectory(options?: SelectDirectoryOptions): Promise<SelectDirectoryResult>
    showItemInFolder(fileName:string): void
    getPathForFile(file:string): string
    detectLanguage():Array<string>|string
    openPage(route:string)
    
}