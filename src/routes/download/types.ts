import { IDownloadSession } from "../../api/download";
import {  PromiseObserver } from "../../base/types/observer";

export class DownloadObserver extends PromiseObserver<void> {
    protected session:IDownloadSession
    emit(event,...args) {
        super.emit(event,...args)
    }
    setSession(session:IDownloadSession) {
        this.session = session
    }

    stop() {
        super.stop()
        if (this.session)
            this.session.stop()
        
    }

}