import { PromiseObserver } from "../types/observer"


export interface Card<T>{
    getId():string
    getData():T
    setData(data:T)
    getCardType()
    getDisplayProperties()
    setInitialized(val:boolean):void
    reset():void
    delete():PromiseObserver<boolean>

    isVisible():boolean
    setVisible(visible:boolean)
    equals( card:Card<T>):boolean 
}


export class CardList<T>  {
    
    protected selected: Card<T>
    protected hovered: Card<T>
    protected cards: Array<Card<T>>


    constructor( protected id:string, protected title:string) {
        this.cards = []        
    }

    get length():number {
        return this.cards.length
    }

    getId():string {
        return this.id;
    }
    getTitle():string {
        return this.title
    }

    getCards(): Array<Card<T>> {
        return this.cards
    }

    getSelected():T {
        return this.selected.getData()
    }
    select(card:Card<T>):void {
        this.selected = card
    }

    getHovered():Card<T> {
        return this.hovered
    }
    hover(card:Card<T>):void {
        this.hovered = card
    }

    add(card: Card<T>) {
        this.cards.push(card)
    }

    remove(card: Card<T>) {
        const idx = this.cards.findIndex( c=> c.equals(card) )
        if (idx!==-1) {
                if ( this.selected && card.equals(this.selected)) {
                    this.selected = undefined
                }
            this.cards.splice(idx,1)
        }
    }

}


