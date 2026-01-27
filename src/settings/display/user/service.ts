import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { UnitType, useUnitConverter } from "../../../i18n";
import { Observer } from "../../../base/types";
import { useAppState } from "../../../appstate";
import { UserSettingsDisplayProps } from "./types";
import { useUserSettings } from "../../service";

@Singleton
export class UserSettingsDisplayService extends IncyclistService {

    protected initialized: false
    protected observer:Observer;
    protected user:UserSettingsDisplayProps

    constructor() {
        super('UserSettings')
    }

    open():Observer {
        if (this.observer)
            this.close()
        
        this.getUserSettings().pauseNotify('preferences.units')
        this.user = this.getDisplayProps()
        this.observer =  new Observer()
        return this.observer



    }

    close() {
        const updated = this.getDisplayProps()
        const changed = updated.units !== this.user.units

        this.getUserSettings().resumeNotify('preferences.units',changed)

        if (!this.observer) 
            return            
        this.observer.stop()
        delete this.observer

    }


    getDisplayProps():UserSettingsDisplayProps {
        const user = this.getUser()
        const {username,ftp,imageUrl } = user
        const c = this.getUnitConverter()

        const weightValue = user?.weight===undefined ? undefined : c.convert( user.weight, 'weight',{digits:1}) 
        const weightUnit = c.getUnit('weight')

        let units, unitsOptions;

        units = c.getUnits()==='metric' ? 'Metric' : 'Imperial'
        unitsOptions = ['Metric', 'Imperial']


        return {
            imageUrl,
            username,
            ftp,
            weight: { value: weightValue, unit: weightUnit},
            units,
            unitsOptions,
            onChangeWeight: this.setWeight.bind(this),
            onChangeFtp: this.setFtp.bind(this),
            onChangeName: this.setName.bind(this),
            onChangeUnits: this.setUnits.bind(this)
        }
        
    }

    getUser() {
        const user = this.getUserSettings().getValue('user',{})
        return user

    }

    setWeight( weight: number) {
        const c = this.getUnitConverter()
        const unit = c.getUnit('weight')

        if (weight===null || weight===undefined) {
            this.getUserSettings().set('user.weight',null)
            
        }
        else {
            const metricValue = c.convert( weight, 'weight', {from:unit, to: 'kg', digits:1})
            this.getUserSettings().set('user.weight',metricValue)

        }

        this.emitChanged()
    }

    setFtp( ftp:number) {
        this.getUserSettings().set('user.ftp',ftp)
        this.emitChanged()
    }

    setName( name:string) {
        this.getUserSettings().set('user.username',name)
        this.emitChanged()

    }

    setUnits( value: string) {
        const unit = value.toLowerCase() as UnitType
        this.getUserSettings().set('preferences.units',unit)
        this.emitUnitsChanged()
    }

    protected emitChanged() {
        if (this.observer)
            this.observer.emit('changed', this.getUser())
    }

    protected emitUnitsChanged() {
        if (this.observer)
            this.observer.emit('units-changed', this.getDisplayProps())
    }

    @Injectable
    protected getUnitConverter() {
        return useUnitConverter()
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    protected getAppState() {
        return useAppState()
    }

    

}

export const useUserSettingsDisplay = ()=> new UserSettingsDisplayService()