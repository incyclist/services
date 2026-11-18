import { IncyclistService } from "../service";
import { Observer } from "../types";
import type { IObserver } from "../typedefs";
import type { IDialogService } from "./types";

/**
 * Base class for services that drive a dialog shown over a page (settings tabs, prompts, pickers).
 *
 * Unlike IncyclistPageService it never touches the page bookkeeping (current page, app state),
 * so the page underneath keeps receiving pause/resume. It also never navigates.
 */
export abstract class IncyclistDialogService<P = unknown> extends IncyclistService implements IDialogService {

    protected dialogObserver: Observer | undefined

    constructor(protected name: string) {
        super(name)
    }

    /** Stops a previous observer, creates a new one and returns it */
    openDialog(..._args: unknown[]): IObserver {
        this.stopDialogObserver()
        this.dialogObserver = new Observer()
        return this.dialogObserver
    }

    /** Stops and drops the observer. Safe to call without a preceding openDialog() */
    closeDialog(): void {
        this.stopDialogObserver()
    }

    getDialogObserver(): IObserver | undefined {
        return this.dialogObserver
    }

    abstract getDialogDisplayProps(): P

    protected emitDialogUpdate(): void {
        this.dialogObserver?.emit('dialog-update', this.getDialogDisplayProps())
    }

    protected stopDialogObserver(): void {
        if (this.dialogObserver) {
            this.dialogObserver.stop()
            delete this.dialogObserver
        }
    }
}
