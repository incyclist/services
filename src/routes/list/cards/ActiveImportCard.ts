import { FileInfo } from "../../../api";
import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { Route } from "../../base/model/route";
import { useRouteList } from "../service";
import { BaseCard } from "./base";
import { RouteCardType, DEFAULT_FILTERS, DEFAULT_TITLE, ActiveImportProps } from "./types";
import { AppStatus } from "../../base/types";


export class ActiveImportCard extends BaseCard implements Card<Route> {

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
        const list = useRouteList().getLists().find( l=>l.getId()==='myRoutes')
        if (list) {
            list.remove(this)
            useRouteList().emitLists('updated',{log:true});
        }
        return PromiseObserver.alwaysReturning(true)
        
    }


    setError(error:Error) {
        this.error = error
        process.nextTick( ()=>{
            this.emitUpdate()
        })
        
    }

    setData() {
        //ignore
    }

    emitUpdate() {
        const props = this.getDisplayProperties()
        this.cardObserver.emit('update',props)
    }


    getData() {
        return undefined;
    }
    getCardType(): RouteCardType {
        return 'ActiveImport';
    }
    getId(): string {
        const {type,url,filename,name} = this.file||{}

        return type==='file' ? filename||name : url
    }

    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS;
    }

    getTitle(): string {
        return this.error ? `${DEFAULT_TITLE}:${this.getId()}:${this.error.message}` : `${DEFAULT_TITLE}:${this.getId()}`;
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
        
        useRouteList().import( this.file, this)
    }

}
