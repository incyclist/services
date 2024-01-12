import { CoachSettings } from "./types";

export class Coach {
    protected settings: CoachSettings

    constructor(settings:CoachSettings) {
        this.settings = settings
    }
}