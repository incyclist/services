export type UnitType = 'metric' | 'imperial'

export type Dimension = 'distance' | 'elevation' | 'speed' | 'weight'

export type Unit = 'm' | 'km' | 'ft' | 'mi' | 'yd' | 'km/h' | 'mph' | 'm/s' | 'kg' | 'lbs'

export type FormattedNumber = {
    value: number,
    unit: Unit
}

export type ConvertProps = {
    from?: Unit
    to?: Unit
    digits?: number
}

export type FormulaDefinition = {
    unit: Unit
    formulas: Record< string,number>
}

export type UnitConversionRules = Record<Dimension, FormulaDefinition>