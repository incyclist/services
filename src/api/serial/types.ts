import type {BindingPortInterface} from '@serialport/bindings-interface'

export type ISerialBinding = {

    getSerialBinding: (ifName:string)=>any
}