import { Unit } from "../../../i18n"

export type UserWeight = {
        value: number,
        unit: Unit
    }
export type UserSettingsDisplayProps = {
    username: string,
    ftp: number,
    weight: UserWeight
    units?: string,
    unitsOptions: Array<string>
    imageUrl?: string,
    onChangeWeight: (value:number)=>void
    onChangeName: (value:string)=>void
    onChangeFtp: (value:number)=>void
    onChangeUnits: (value:string)=>void
}

export type TUserSettings = {
    username: string,
    ftp: number,
    weight: number
}