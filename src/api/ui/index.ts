
export type SelectDirectoryResult = {   
    selected: string
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
    selectDirectory(): SelectDirectoryResult
    showItemInFolder(fileName:string): void
    getPathForFile(file:string): string
    
}