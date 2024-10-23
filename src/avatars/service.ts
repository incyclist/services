import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { Avatar, AvatarOption, Color } from "./types";

@Singleton
export class AvatarService extends IncyclistService {

    protected options: Array<AvatarOption>  =[]
    protected registered: Record<string,Avatar> = {}
    protected currentBucket:number = 0

    constructor() {
        super('Avatars')
        this.buildOptions()
    }

    setCurrentRiderAvatar(avatar: Avatar):void {
        this.cleanup('current',true)

        let currentOption = this.find(avatar) 
        if (!currentOption) {
            currentOption = {avatar,usageCnt:0}
            this.options.push(currentOption)
        }
        currentOption.usageCnt++   
    }

    get( id:string):Avatar {
        if (!this.registered[id])
            this.registered[id] = this.getNextAvailable()
        return this.registered[id]
    }

    delete(id:string):void {
        this.cleanup(id)
    }

    deleteAll() {
        const currentAvatar = this.registered.current

        this.options.forEach( o=> {o.usageCnt=0}) 
        this.currentBucket = 0
        const currentOption = this.find(currentAvatar)
        currentOption.usageCnt=1

        this.registered= {current:currentAvatar}
    }


    protected buildOptions() {
        if (this.options?.length>0)
            return;

        this.options = []
        const colors:Array<Color> = [ 'yellow' ,'red' ,'blue' , 'green' , 'purple', 'orange', 'hotpink', 'brown', 'grey','black', 'white' , 'violet' , 'lime' , 'olive' , 'cyan' , 'skyblue']

        
        colors.forEach( helmet => { 
            colors.forEach( shirt => {             
                this.options.push({ avatar:{helmet,shirt},usageCnt:0})
            })   
        })
        
    }

    protected getNextAvailable():Avatar {

        let available = this.options.find( a=>a.usageCnt===this.currentBucket)
        if (!available) {
            this.currentBucket++

            // block current rider avatar
            const currentOption = this.find('current')
            currentOption.usageCnt++
    
            available = this.options.find( a=>a.usageCnt===this.currentBucket)
        }

        available.usageCnt++;

        return available?.avatar;
    }

    protected cleanup(id:string, isCurrent:boolean=false):void {
        if (this.registered[id]) {
            
            const prev = this.find(this.registered[id])
            if (prev) {
                if (isCurrent)
                    prev.usageCnt = 0
                else 
                    prev.usageCnt--
            }
            delete this.registered[id]
        }

        const currentAvatar = this.registered.current
        const inUse = this.options.filter(a=>!currentAvatar || (a.avatar.helmet!==currentAvatar.helmet && a.avatar.shirt!==currentAvatar.shirt )).sort( (a,b)=>b.usageCnt-a.usageCnt)
        this.currentBucket = inUse[0].usageCnt
    }

    protected find(avatar):AvatarOption {
        return this.options.find( a=>a.avatar.helmet === avatar.helmet && a.avatar.shirt===avatar.shirt)
    }


}


export const useAvatars = ()=>new AvatarService()
