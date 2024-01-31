import { FileInfo } from "../../../api";
import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { AppStatus } from "../../../routes/base/types";
import { useWorkoutList } from "../service";
import { WP } from "../types";
import { BaseCard } from "./base";
import { DEFAULT_FILTERS, DEFAULT_TITLE, ActiveImportProps, WorkoutCardType } from "./types";


export class ActiveImportCard extends BaseCard implements Card<WP> {

    protected file:FileInfo
    protected error:Error
    protected cardObserver 
    protected deleteObserver: PromiseObserver<void>

    constructor( file:FileInfo) {
        super()
        this.file = file;
        this.error = null
        this.cardObserver = new Observer()
    }

    setVisible(): void {
        this.visible = true; // always visible
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canStart(status: AppStatus) {
        return false;
    }
    delete():PromiseObserver<boolean> {
        const list = useWorkoutList().getLists().find( l=>l.getId()==='myRoutes')
        if (list) {
            list.remove(this)
            useWorkoutList().emitLists('updated');
        }
        return PromiseObserver.alwaysReturning(true)
        
    }


    setError(error:Error) {
        this.error = error
        this.emitUpdate()
    }

    setData() {
        //ignore
    }

    emitUpdate() {
        this.cardObserver.emit('update',this.getDisplayProperties())
    }


    getData() {
        return undefined;
    }
    getCardType(): WorkoutCardType {
        return 'ActiveWorkoutImport';
    }
    getId(): string {
        const {type,url,filename,name} = this.file||{}

        return type==='file' ? filename||name : url
    }

    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS;
    }

    getTitle(): string {
        return DEFAULT_TITLE;
    }

    getDisplayProperties(): ActiveImportProps {
        const name = this.file.name
        const error = this.error
        const observer = this.cardObserver

        return { name,error, observer,visible: true };
    }

    retry() {
        this.error = null;
        this.emitUpdate()
        
        useWorkoutList().import( this.file, this)
    }

}
