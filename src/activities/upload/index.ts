import { ActivityUploadFactory } from './factory'
import { StravaUpload } from './strava'
import { VeloHeroUpload } from './velohero'

export * from './velohero'
export * from './strava'
export * from './types'
export * from './factory'


const factory = new ActivityUploadFactory()
factory.add('strava',new StravaUpload())
factory.add('velohero',new VeloHeroUpload())



