import { CyclingMode } from "incyclist-devices";
import { getBindings } from "../../api";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer } from "../../base/types/observer";
import { DeviceRideService, getLoadButtonMode, useDeviceRide } from "../../devices";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { valid } from "../../utils/valid";
import { Workout } from "../base/model";
import { CurrentStep, PowerLimit, StepDefinition } from "../base/model/types";
import { getStepDuration, getStepTargetText } from "../base/graph";
import { WorkoutListService, useWorkoutList } from "../list";
import { WorkoutSettings } from "../list/cards/types";
import { ActiveWorkoutLimit, LoadButtonMode, PowerAdjustmentResult, WorkoutDisplayProperties } from "./types";
import { Injectable } from "../../base/decorators";

const DEFAULT_FTP = 200;
const WORKOUT_ZOOM = 1200;

/** Countdown thresholds (seconds before a leaf-step with a known duration ends) at which
 *  'step-countdown' fires - descending, so a multi-threshold skip in one update() call (e.g.
 *  forward()/backward()) resolves to the threshold closest to zero via Math.min(). */
const STEP_COUNTDOWN_THRESHOLDS = [4, 3, 2, 1] as const

const hasValidDuration = (duration: number | undefined): boolean => {
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
}

/**
 * This service is used by the Front-End to manage the state of the previously selected workout
 * and to implement the business logic to display the content for a workout dashboard
 * 
 * The workout first needs to be initialized - which will reset the internal state (incl. counters and timers)
 * Once the workout has been initialized, it can be started/paused/resumed or stopped
 * 
 * The WorkoutRide Service implements an Observer pattern, were the Observer is created during initialization
 * It will then notify potantial consumers about relevant events:
 * 
 * - 'initialized' - The workout has been initialized and is ready to be used in a ride
 * - 'update' - There was an update, which requires the dashboard to be updated
 * - 'step-changed' - There was a new step selected, which requires the dashboard to be updated
 * - 'step-countdown' - Fired once per second in the last 4s before a leaf-step with a known duration
 *   ends (payload: StepCountdownTick). Not fired across group/repeat-block boundaries or step
 *   changes without a known duration.
 * - 'request-update' - There was an update, which requires to send updated requests to the SmartTrainer
 *  
 * - 'started' - The workout has been started
 * - 'paused' - The workout has been paused
 * - 'resumed' - The workout has been resumed
 * - 'completed' - The workout has been completed or was stopped by the user
 * 
 * 
 * __Dashboard__
 * 
 * The dasboard component will typically only register for the updates and completed events to udpate its internal state
 * 
 * @example
 * ```
 * const {useWorkoutRide} = require('incyclist-services');
 * 
 * const service = useWorkoutRide()
 * 
 * const observer = service.getObserver()
 * if (observer) {
 *    observer
 *      .on('update',(displayProps)=> {console.log(displayProps)})
 *      .on('completed',()=> {console.log('Workout completed')})
 * }
 * ```
 * 
 * __Ride Workkflow__
 * 
 * The business logic of the actual ride, will typically initialize this service and then monitor for request updates 
 * 
 * @example
 * ```
 * const {useWorkoutRide} = require('incyclist-services');
 * 
 * const service = useWorkoutRide()
 * 
 * const observer = service.init()
 * if (observer) {
 *    observer
 *      .on('request-update',(requestProps)=> {console.log(requestProps)})
 *      .on('started',()=> {console.log('Workout started')})
 *      .on('completed',()=> {console.log('Workout completed')})
 * }
 * ```
 * 
 * @public
 * @noInheritDoc
 */

@Singleton
export class WorkoutRide extends IncyclistService{

    protected manualTimeOffset:number
    protected manualPowerOffset:number
    protected workout:Workout
    protected settings:WorkoutSettings
    protected workoutList: WorkoutListService
    protected observer:Observer
    protected state: 'idle'|'initialized'|'active'|'paused'|'completed'
    protected tsStart:number
    protected offset:number
    protected tsPauseStart:number
    protected tsCurrent:number
    protected trainingTime:number
    protected currentLimits:ActiveWorkoutLimit
    protected updateInterval:NodeJS.Timeout
    protected currentStep: StepDefinition
    protected isFreeRide: boolean

    constructor () {
        super('WorkoutRide')   
        this.state='idle'
        this.isFreeRide = true        
    }

    /**
     * Prepares the workout for the upcoming ride
     * 
     * It will make use of the [[WorkoutList]] to get workout that was selected by the user and Start Settings ( ERGMode on/off and selected FTP)
     * If no workout was selected, the method will return without response
     * 
     * Once workout and settings were determined, it will reset the timers and manual offsets that the user has created 
     * during a previous ride
     * 
     * Finally, it will set the internal state to "initialized" and return an Observer, which can be used by 
     * the consumer to get notified about updates.
     * 
     * @returns [[Observer]] Observer object which will notify consumers about updates/status changes of the workout during the ongoing ride
     * @emits __initialized__
     * 
     */

    init():Observer {
        try {

            this.workoutList = this.getWorkoutList()
            this.workout = this.workoutList.getSelected()

            if (!this.workout)
                return;

            this.resetTimes()
            this.manualPowerOffset = 0;
    
            this.settings = this.workoutList.getStartSettings()??{}
            if (!valid(this.settings.ftp)) {
                this.settings.ftp = this.getFtpFromUserSettings() ?? 200
                this.workoutList.setStartSettings(this.settings)
            }
            this.setCurrentLimits(0)
            this.observer = new Observer()
            this.state = 'initialized'
            this.logEvent( {message:'workout initialized',workout:this.workout.name,settings:this.settings})
            waitNextTick().then(()=>{
                this.emit('initialized')
            })
            return this.observer
            
        }
        catch(err) {
            this.logError(err,'init',{workout:this.workout, woType: typeof this.workout})
        }
    }

    /**
     * Starts a ride with the workout that was previously selected/initialized
     * 
     * This will start an interval which checks every 500ms if the limits or dashboard need to be adjusted
     * If needed, it will trigger notifications to update the dashboard and/or the limits to be sent to the device
     * 
     * If the [[init]] method has not been called before, it will simply return without any response
     * 
     * @param paused    indicates whether the initial state after start should be _paused_. This should be set if the user is not yet cycling
     * @returns [[Workout]] The workout that has been started
     * @emits   __started__
     * @emits __update__      indicates that the dashboard needs to be adjusted
     *      will add a [[WorkoutDisplayProperties]] object as argument which contains the new display properties
     * @emits   __request-update__      indicates that the limits needs to be adjusted
     *      will add an [[ActiveWorkoutLimit]] object, which contains the udpated limits
     */
    start(paused:boolean=false):Workout {
        try {
            if (this.state!=='initialized' || !this.workout) {
                return
            }
            this.state = 'active'

            const ts = Date.now();
            this.tsStart=ts 
            this.tsCurrent=ts
            this.offset = 0
            this.manualTimeOffset = 0;
            this.currentLimits = undefined

            this.emit('started')
            this.logEvent( {message:'workout started',settings:this.settings})

            if (!this.updateInterval)  { 
                this.update()
                this.updateInterval = setInterval( ()=>{ this.update()}, 500)
            }
            
            if (paused)
                this.pause();

            return this.workout
        }
        catch(err) {
            this.logError(err,'start')
        }
    }


    /**
     * Pauses the current workout
     * 
     * This method needs to be called upon pauses, to ensure that the dashboards and limits will not be updated anymore
     * 
     * If the [[init]] method has not been called before or the workout is not in _active_ state, it will simply return without any response
     * 
     * @emits   __paused__
     */
    pause():void {
        try {
            if (this.state!=='initialized' && this.state!=='active') {
                return
            }

            const ts = Date.now();
            this.tsPauseStart=ts 
            this.tsCurrent=ts
            this.state='paused'

            this.emit('paused')
            this.logger.logEvent( {message:'workout paused'})
        }
        catch(err) {
            this.logError(err,'pause')
        }
    }

    /**
     * Resumes the current workout
     * 
     * This method needs to be called to leave the _paused_ state of the workout so that the the dashboards and limits will be updated again
     * 
     * If the workout is not in _completed_ state, it will restart the workout
     * If the [[init]] method has not been called before or the workout is not in _pause_ state, it will simply return without any response
     * 
     * @emits   __resumed__
     */
    resume():void {
        try {
            if (this.state==='initialized' || this.state==='completed') {  
                this.state='initialized'             
                this.start();
                return;
            }
    
            if (this.state!=='paused')
                return;
    
            const ts = Date.now();       
    
            if (valid(this.tsPauseStart)) {
                this.offset += (ts-this.tsPauseStart)
            }
    
            this.tsPauseStart = undefined        
            this.tsCurrent = ts
           
            this.state='active'
            this.logger.logEvent( {message:'workout resumed',offset:this.offset})
            this.emit('resumed')
    
        }
        catch(err) {
            this.logError(err,'resume')
        }

    }


    /**
     * stops the current workout
     * 
     * This method needs to be called whenever a workout is either completed or a user wants to manually stop it.
     * 
     * @param props - optional properties to be passed 
     * @param props.clearFromList - if set to true, the workout will be removed from the list after stopping
     * @param props.completed - if set to true, the workout will be marked as completed
     * @emits   __completed__  or __stopped__     depending on the value of `completed`
     */
    stop( props?:{clearFromList?:boolean, completed?:boolean}):void {
        const {clearFromList,completed} = props??{}

        try {
            if (!this.workout || this.state==='idle' || this.state==='completed') {
                if (clearFromList) {
                    useWorkoutList().unselect()
                }
                return;
            }

            this.state = 'completed'

            const stateEvent = completed ? 'completed':'stopped'
            this.logger.logEvent( {message: `workout ${stateEvent}`})
            this.emit(stateEvent)

            this.stopWorker();
    
            waitNextTick()
                .then( ()=>{this.resetWorkout()})

            if (clearFromList) {
                useWorkoutList().unselect()
            }
    
        }
        catch(err) {
            this.logError(err,'stop')
        }

    }


    /**
     * Move to the next workout step
     * 
     * This method moves the limits to the next workout step. 
     * This allows the user to jump over steps that cannot be maintained
     * 
     */
    forward():void {
        try {
            const ts = this.trainingTime
            const wo = this.workout;
            const limits = wo.getLimits(ts);

            if (!limits) {
                return;
            }

            
            this.manualTimeOffset += limits.remaining   
            this.update()
            this.observer.emit('forward',ts,limits.remaining )
        }
        catch(err) {
            this.logError(err,'forward')
        }

    }

    /**
     * Move back to the beginning of the current step or previous step
     * 
     * This method moves the limits to the beginning of the current step or previous step
     * This allows the user to repeat steps beyond the repetitions configured in the workout
     * 
     * If the user has completed more than 30s or 50% of a step, it will jump back to the beginning of the current step,
     * otherwise it will jump back to the beginning of the previous step
     * 
     */
    backward():void {

        try {
            const ts = this.trainingTime
            const wo = this.workout;
            const limits = wo.getLimits(ts,true);

            if (!limits) {
                return;
            }

            const completed = limits.duration-limits.remaining

            const stepBusyLmit = Math.min( 15, limits.duration/2)
            let diff = completed;
            let jumpType = 'current'
            let target

            
            if (completed>=stepBusyLmit || limits.start===0) {
                // jump to start of current step
                this.manualTimeOffset -= completed;
                target = limits?.step
            }
            else {
                // jump to start of prev step
                jumpType = 'previous'
                const timePrev = ts-completed-0.1;
                if (timePrev<0) {
                    this.manualTimeOffset -= completed
                }
                else {
                    const prevLimits = wo.getLimits(timePrev,true);
        
                    if (prevLimits ) {
                        this.manualTimeOffset -= (completed+prevLimits.duration)      
                        diff = completed+prevLimits.duration
                        target = prevLimits.step
                    }
                }    
            }

            this.update()
            this.observer.emit('backward',ts,diff,jumpType,limits?.step, target )


        }
        catch(err) {
            let limits;
            let ts
            try {
                ts = this.trainingTime
                limits = this.workout?.getLimits(ts,true)
            }
            catch { // ignore
            }
            this.logError(err,'backward',{ts,limits})
        }

    }

    /**
     * Determines whether a power adjustment in the direction of `delta` should nudge `targetPower`
     * within the current step's power range, as opposed to scaling the Workout FTP.
     *
     * This is the single source of truth for the branching used by both `powerUp()`/`powerDown()`
     * (to decide what they actually adjust) and `getDashboardDisplayProperties()` (to decide
     * whether the corresponding load button should be labelled in Watt or in % of FTP) - keeping
     * both in sync, including the boundary check that differs between the top and bottom of a
     * range (and applies identically whether the range comes from an explicit Watt step or a
     * percent-of-FTP zone, since both resolve into `minPower`/`maxPower` before this point).
     *
     * @param delta positive to check headroom towards `maxPower` (as used by `powerUp`), negative
     *              to check headroom towards `minPower` (as used by `powerDown`); only the sign is
     *              used, the magnitude does not affect the outcome
     */
    private isPowerRangeAdjustable(delta:number):boolean {
        if (this.currentLimits?.minPower===this.currentLimits?.maxPower)
            return false

        return delta>=0
            ? this.currentLimits?.targetPower<this.currentLimits?.maxPower
            : this.currentLimits?.targetPower>this.currentLimits?.minPower
    }

    /**
     * Resolves whether `power` (an absolute-Watt, i.e. `type:'watt'`, limit) is protected from
     * swipe-based adjustment: the step's own `power.locked` wins when set, otherwise falls back to
     * the Workout's `lockedPowerTargets` default (`false`/adjustable when neither is set). Has no
     * bearing on `'pct of FTP'` limits - those always track FTP regardless of this flag, so callers
     * only need to consult it for `type:'watt'` limits.
     */
    private isPowerLocked(power?:PowerLimit):boolean {
        return power?.locked ?? this.workout?.lockedPowerTargets ?? false
    }

    /**
     * True when `powerUp()`/`powerDown()`'s FTP-scaling fallback (no headroom left to nudge
     * `targetPower` within the current step's range, or a fixed target with no range at all) should
     * instead move the current step's own Watt value directly and leave FTP untouched - i.e. the
     * current step's limits are absolute Watts (`type:'watt'`) and not `isPowerLocked()`. Shared by
     * `powerUp()`/`powerDown()` (to decide what they adjust) and `getLoadButtonLabels()` (to decide
     * whether the fallback button label should read in Watt or in % of FTP).
     */
    private isWattFallbackAdjustment():boolean {
        const power = this.currentStep?.power
        return power?.type==='watt' && !this.isPowerLocked(power)
    }

    /**
     * Called after `setCurrentLimits()` has just re-resolved `currentLimits` inside
     * `powerUp()`/`powerDown()`'s fallback branch (no headroom to nudge `targetPower` within the
     * current step's range, or a fixed target with no range at all). `createLimitRequest()` only
     * recomputes `targetPower` from scratch when the step is a genuinely fixed target
     * (`minPower===maxPower`); for a range step it otherwise just carries the pre-swipe `targetPower`
     * forward unchanged (`refresh` path) - which is correct for a locked/unaffected step (min/max
     * didn't move either, so the old target is still exactly where it should be), but leaves the
     * target stranded away from the boundary once min/max *did* move: an unlocked absolute-Watt
     * step's window shifting, or a 'pct of FTP' step's window rescaling with the new FTP.
     *
     * Re-pinning the target to the boundary it was sitting at before the swipe unifies all four
     * fallback cases correctly in one place: a no-op for a fixed target or an unaffected (locked)
     * step (new boundary === old boundary === old target already), and the fix for a 'pct of FTP' or
     * unlocked absolute-Watt range step (new boundary !== old boundary, target now correctly follows
     * it).
     *
     * @param increase true for `powerUp()` (track `maxPower`), false for `powerDown()` (track `minPower`)
     */
    private trackTargetToBoundary(increase:boolean):void {
        if (this.currentLimits?.maxPower===undefined)
            return
        this.currentLimits.targetPower = increase ? this.currentLimits.maxPower : this.currentLimits.minPower
    }

    /**
     * The nominal Watt step `powerUp()`/`powerDown()` nudge `targetPower` by once
     * `isPowerRangeAdjustable()` is true: a fixed 5W/50W (matching mobile's swipe-gesture step
     * size, see `useWorkoutRideGestures.ts`) when the workout has an FTP configured, or the
     * literal `magnitude` itself for a purely Watt-based workout with no FTP.
     *
     * @param magnitude the button's nominal magnitude - `1` (inc1/dec1) or `5` (inc5/dec5)
     */
    private getPowerRangeDeltaVal(magnitude:number):number {
        if (!this.settings?.ftp)
            return magnitude
        return magnitude===1 ? 5 : 50
    }

    /**
     * The Watt amount a range-adjustable click will actually apply right now, i.e. the nominal
     * step from `getPowerRangeDeltaVal()` clamped to whatever headroom remains towards
     * `maxPower`/`minPower` - e.g. with only 1W of headroom left, a nominally-5W button only
     * moves `targetPower` by 1W (`powerUp()`/`powerDown()` clamp the same way), so the label must
     * say "+1W", not "+5W".
     */
    private getPowerRangeAdjustmentWatts(magnitude:number, increase:boolean):number {
        const nominal = this.getPowerRangeDeltaVal(magnitude)
        const headroom = increase
            ? this.currentLimits.maxPower-this.currentLimits.targetPower
            : this.currentLimits.targetPower-this.currentLimits.minPower
        return Math.min(nominal, headroom)
    }

    /**
     * Determines what the dashboard's load-adjustment buttons currently mean, based on the
     * rider's current cycling mode (FIXES_BACKLOG #37): `'power'` in ERG mode (the pre-existing,
     * unaffected behaviour - see `getLoadButtonLabels()`), `'gear'` in SIM/Resistance mode with
     * virtual shifting enabled (buttons perform a gear shift instead - see `getGearButtonLabels()`
     * and `powerUp()`/`powerDown()`), `'hidden'` in SIM/Resistance mode with virtual shifting
     * disabled (the buttons are meaningless and `web-ui`/`mobile` must not show them).
     *
     * Reuses `RideDisplayService.isVirtualShiftingEnabled()`'s exact SIM+virtshift-setting check
     * (via the shared `getLoadButtonMode()` helper in `incyclist-devices`' ride module) rather than
     * re-deriving it.
     */
    getLoadButtonMode():LoadButtonMode {
        try {
            const mode = this.getDeviceRide().getCyclingMode() as CyclingMode
            return getLoadButtonMode(mode)
        }
        catch(err) {
            this.logError(err,'getLoadButtonMode')
            return 'power'
        }
    }

    /**
     * Builds the labels for the dashboard's load ("+5"/"+1"/"-1"/"-5", no unit) buttons when
     * `getLoadButtonMode()==='gear'` - matching `ShiftingControl`'s existing button-text convention
     * for a non-workout ride's gear-shift buttons exactly (see `web-ui/.../shifting/control/component.jsx`).
     */
    private getGearButtonLabels():WorkoutDisplayProperties['loadButtons'] {
        return { inc5: '+5', inc1: '+1', dec1: '-1', dec5: '-5' }
    }

    /**
     * Builds the labels for the dashboard's load ("+5%"/"+1%"/"-1%"/"-5%"/"+5W"/...) buttons,
     * reflecting what a click on each of them will actually do right now:
     * - `isPowerRangeAdjustable()` true: nudges `targetPower` within the current step's authored
     *   range (Watt-labelled, with the real, headroom-clamped amount via `getPowerRangeAdjustmentWatts()`)
     * - `isPowerRangeAdjustable()` false and `isWattFallbackAdjustment()` true (an unlocked, absolute-Watt
     *   step with no headroom left, or no range at all): moves the step's own Watt value directly by
     *   the button's raw magnitude (Watt-labelled) - deliberately *not* `getPowerRangeDeltaVal()`'s
     *   5W/50W nominal step, which only ever applied to the range-nudge case above; this fallback's
     *   `powerUp()`/`powerDown()` implementation adds the raw magnitude to `manualPowerOffset`
     *   directly (a founding behaviour of this method, predating the 5W/50W mechanism), so the label
     *   must match that, not the unrelated range-nudge convention
     * - otherwise (a `'pct of FTP'` step, or a locked absolute-Watt step): scales the Workout FTP (%-labelled)
     *
     * Mirrors the exact branching `powerUp()`/`powerDown()` use to act, keeping label and effect in sync.
     */
    private getLoadButtonLabels():WorkoutDisplayProperties['loadButtons'] {
        const label = (magnitude:number, increase:boolean):string => {
            const sign = increase ? '+' : '-'
            const delta = increase ? magnitude : -magnitude
            if (this.isPowerRangeAdjustable(delta))
                return `${sign}${this.getPowerRangeAdjustmentWatts(magnitude, increase)}W`
            if (this.isWattFallbackAdjustment())
                return `${sign}${magnitude}W`
            return `${sign}${magnitude}%`
        }
        return {
            inc5: label(5, true),
            inc1: label(1, true),
            dec1: label(1, false),
            dec5: label(5, false),
        }
    }

    /**
     * Adjusts the base level of th workout
     *
     * This allows the user to increase the instensity of a workout.
     *
     * Depending on how the the step limits are defined, this will have different impact
     * - Step defined in "percentage of FTP": The FTP will be increased by _delta_ %, defaulting the
     *   starting point to `DEFAULT_FTP` (200) if the Workout has no FTP configured yet - `init()`
     *   already guarantees one is set before a ride can reach this method, so this only matters for
     *   direct/test-only invocations.
     * - Step defined in "Watts", unlocked (`!isPowerLocked()`, the default): the power limit itself
     *   will be increased by _delta_ Watts - within the authored range while there is headroom
     *   (`isPowerRangeAdjustable()`), or by extending past the authored boundary once there isn't
     *   (including a fixed target, which has no headroom by definition). FTP is left untouched, since
     *   an absolute-Watt value is independent of FTP.
     * - Step defined in "Watts", locked (`isPowerLocked()`, e.g. a structured test interval that must
     *   hold an exact wattage): the power limit is left untouched; FTP is scaled instead, exactly like
     *   a "percentage of FTP" step - useful so a locked step's swipe can still raise FTP for the
     *   benefit of later, unlocked/percentage-based steps in the same workout.
     *
     * `manualPowerOffset` (the accumulator behind the Watt case above) only ever accumulates from a
     * swipe that actually took the unlocked-Watt branch - never from a swipe that scaled FTP (whether
     * because the step was 'pct of FTP' or a locked Watt step). This keeps the two dials fully
     * separate: an FTP-only swipe during e.g. a warmup must never silently shift the start of a later,
     * unrelated, unlocked-Watt step (such as a ramp test) that the rider never touched.
     *
     * @param delta adjustment of the FTP(in%) or current Power (in Watt)
     * @returns which quantity was adjusted and its resulting value (in Watt): `{type:'targetPower'}`
     *          when the current step allows a power range (`minPower!==maxPower`) and the target is
     *          nudged directly within that range, or when an unlocked absolute-Watt step's value is
     *          moved directly (in or out of range); `{type:'ftp'}` when the Workout FTP itself was
     *          scaled; `undefined` only when the load buttons are hidden for the current cycling mode
     *          or an error occurred
     *
     */
    powerUp(delta:number):PowerAdjustmentResult|undefined {


        if (delta<0)
            return this.powerDown(-delta)

        this.logEvent({message: 'workout power up', delta})

        try {
            const loadButtonMode = this.getLoadButtonMode()
            if (loadButtonMode==='hidden')
                return undefined

            if (loadButtonMode==='gear') {
                this.gearChange(delta)
                this.logEvent({message: 'workout gear shift', gearDelta: delta})
                return { type: 'gear', value: delta }
            }

            if ( this.isPowerRangeAdjustable(delta)) {
                const deltaVal = this.getPowerRangeDeltaVal(delta)
                this.currentLimits.targetPower = Math.min(this.currentLimits.targetPower+deltaVal, this.currentLimits.maxPower)
                this.logEvent({message: 'workout target power adjusted', targetPower:this.currentLimits.targetPower})
                this.emit('update', this.getDashboardDisplayProperties())
                return { type: 'targetPower', value: this.currentLimits.targetPower };
            }

            const wattFallback = this.isWattFallbackAdjustment()

            if (wattFallback)
                this.manualPowerOffset += delta
            else {
                this.settings.ftp = (this.settings.ftp??DEFAULT_FTP) * (1+delta/100)
                this.workoutList.setStartSettings(this.settings)
                this.logEvent({message: 'workout FTP adjusted', ftp:this.settings.ftp})
            }

            this.setCurrentLimits()
            this.trackTargetToBoundary(true)
            this.emit('update', this.getDashboardDisplayProperties())

            if (wattFallback) {
                this.logEvent({message: 'workout target power adjusted', targetPower:this.currentLimits.targetPower})
                return { type: 'targetPower', value: this.currentLimits.targetPower }
            }

            return { type: 'ftp', value: Math.round(this.settings.ftp) }
        }
        catch(err) {
            this.logError(err,'powerUp')
            return undefined
        }
    }

    /**
     * Adjusts the base level of th workout
     * 
     * This allows the user to decrease the instensity of a workout.
     *
     * Depending on how the the step limits are defined, this will have different impact
     * - Step defined in "percentage of FTP": The FTP will be decreased by _delta_ %, defaulting the
     *   starting point to `DEFAULT_FTP` (200) if the Workout has no FTP configured yet - `init()`
     *   already guarantees one is set before a ride can reach this method, so this only matters for
     *   direct/test-only invocations.
     * - Step defined in "Watts", unlocked (`!isPowerLocked()`, the default): the power limit itself
     *   will be decreased by _delta_ Watts - within the authored range while there is headroom
     *   (`isPowerRangeAdjustable()`), or by extending past the authored boundary once there isn't
     *   (including a fixed target, which has no headroom by definition). FTP is left untouched, since
     *   an absolute-Watt value is independent of FTP.
     * - Step defined in "Watts", locked (`isPowerLocked()`, e.g. a structured test interval that must
     *   hold an exact wattage): the power limit is left untouched; FTP is scaled instead, exactly like
     *   a "percentage of FTP" step - useful so a locked step's swipe can still lower FTP for the
     *   benefit of later, unlocked/percentage-based steps in the same workout.
     *
     * `manualPowerOffset` (the accumulator behind the Watt case above) only ever accumulates from a
     * swipe that actually took the unlocked-Watt branch - never from a swipe that scaled FTP (whether
     * because the step was 'pct of FTP' or a locked Watt step). This keeps the two dials fully
     * separate: an FTP-only swipe during e.g. a warmup must never silently shift the start of a later,
     * unrelated, unlocked-Watt step (such as a ramp test) that the rider never touched.
     *
     * @param delta adjustment of the FTP(in%) or current Power (in Watt)
     * @returns which quantity was adjusted and its resulting value (in Watt): `{type:'targetPower'}`
     *          when the current step allows a power range (`minPower!==maxPower`) and the target is
     *          nudged directly within that range, or when an unlocked absolute-Watt step's value is
     *          moved directly (in or out of range); `{type:'ftp'}` when the Workout FTP itself was
     *          scaled; `undefined` only when the load buttons are hidden for the current cycling mode
     *          or an error occurred
     *
     */
    powerDown(delta:number):PowerAdjustmentResult|undefined {
        this.logEvent({message: 'workout power down', delta})

        try {
            const loadButtonMode = this.getLoadButtonMode()
            if (loadButtonMode==='hidden')
                return undefined

            if (loadButtonMode==='gear') {
                this.gearChange(-delta)
                this.logEvent({message: 'workout gear shift', gearDelta: -delta})
                return { type: 'gear', value: -delta }
            }

            if ( this.isPowerRangeAdjustable(-delta)) {
                const deltaVal = this.getPowerRangeDeltaVal(delta)
                this.currentLimits.targetPower = Math.max(this.currentLimits.targetPower-deltaVal, this.currentLimits.minPower)
                this.logEvent({message: 'workout target power adjusted', targetPower:this.currentLimits.targetPower})
                this.emit('update', this.getDashboardDisplayProperties())
                return { type: 'targetPower', value: this.currentLimits.targetPower };
            }

            const wattFallback = this.isWattFallbackAdjustment()

            if (wattFallback)
                this.manualPowerOffset -= delta
            else {
                this.settings.ftp = (this.settings.ftp??DEFAULT_FTP) / (1+delta/100)
                this.workoutList.setStartSettings(this.settings)
                this.logEvent({message: 'workout FTP adjusted', ftp:this.settings.ftp})
            }

            this.setCurrentLimits()
            this.trackTargetToBoundary(false)
            this.emit('update', this.getDashboardDisplayProperties())

            if (wattFallback) {
                this.logEvent({message: 'workout target power adjusted', targetPower:this.currentLimits.targetPower})
                return { type: 'targetPower', value: this.currentLimits.targetPower }
            }

            return { type: 'ftp', value: Math.round(this.settings.ftp) }
        }
        catch(err) {
            this.logError(err,'powerDown')
            return undefined
        }
    }

    /**
     * Performs a gear shift, using the exact same device-level mechanism a non-workout ride's
     * gear shift uses (`RideDisplayService.gearChange()` -> `RideModeService.sendUpdate({gearDelta})`,
     * which itself just forwards to `DeviceRideService.sendUpdate()`) - see FIXES_BACKLOG #37. No
     * workout-specific gear semantics are introduced by this: the current step's own
     * target/duration/completion tracking is left untouched, exactly as it is already untouched by
     * the rider's real-world cadence choice.
     *
     * Only called by `powerUp()`/`powerDown()` once `getLoadButtonMode()==='gear'`.
     *
     * @param gearDelta positive to shift up, negative to shift down
     */
    private gearChange(gearDelta:number):void {
        this.getDeviceRide().sendUpdate({gearDelta})
    }

    /**
     * Toggles between the originally selected mode and ERG mode
     *
     * This allows to temporarily swith to SmartTrainer (SIM) mode,
     * e.g. if there is a Sprint(max effort) segment upcoming and switch back to ERG after that segment
     *
     */
    toggleCyclingMode():void {
        const  deviceRide = useDeviceRide()
        deviceRide.toggleCyclingMode()

        this.emit('update', this.getDashboardDisplayProperties())    }


    /**
     * Provides the information that should be displayed in the dashboard
     * 
     * This contains:
     * - The complete workout ( to be shown in the graph)
     * - The workout title (to be shown in the info bar)
     * - The current FTP setting
     * - The current limits ( to be shown as values in the dashboard) incl. step time and remaining step time
     * - Optionally: start and stop for the workout graph
     * 
     * This method also implements the logic to automatically adjust the zoom factor for the workout graph
     * every 30s. If the total remaining workout time is less than 20min, the zoom will contain the last 20mins
     * 
     * @returns [[WorkoutDisplayProperties]] Information to be shown in the dashboard
     * 
     */
    getDashboardDisplayProperties():WorkoutDisplayProperties {
        try {
            if (this.state==='idle' || this.state==='completed') {
                return {};
            }

            const {start,stop} = this.getZoomParameters(this.trainingTime);
            const title = this.getStepTitle(this.trainingTime)
            const canShowBackward = Math.round((this.trainingTime??0))>0
            const loadButtonMode = this.getLoadButtonMode()

            const props = {
                workout:this.workout, title,
                ftp:this.settings.ftp,
                current:this.currentLimits,
                start,stop,
                mode: this.getCyclingModeText(),
                canShowBackward,
                canShowForward:true,
                loadButtonMode,
                loadButtons: loadButtonMode==='power' ? this.getLoadButtonLabels() : this.getGearButtonLabels()
            }

            return props

        }        
        catch(err)  { 
            this.logError(err,'getDashboardDisplayProperties')
            return{}
        }

    }

    /**
     * Provides the limits that are used in the current workout step
     * 
     * @returns [[ActiveWorkoutLimit]] the current limit or _undefined_ if the workout hasn't bee initialized or already was completed
     * 
     */
    getCurrentLimits():ActiveWorkoutLimit {
        if (this.state==='idle' || this.state==='completed') {
            return undefined;
        }

        return this.currentLimits
    }

    /**
     * Provides information if the dashboard should be shown
     * 
     * The dashboard should be shown as soon as a workout has been initialized until it has been completed
     * 
     * @return boolean true: dashboard should be shown, false: dashboard does not need to be shown
     */
    inUse(): boolean {
        return this.state!=='idle' && this.state!=='completed'
    }

    /**
     * Provides information if the workout is currently applying limits
     * 
     * A segment of the workout could represent a "free ride" (no limits)
     * In these cases, 
     *  - the app should behave as a ride without workout
     *  - but workout should still be shown in dashboard
     * 
     * @return boolean true: workout is applying limits, false: workout
     */
    appliesLimits(): boolean {
        return this.inUse() && !this.isFreeRide
    }
    
    /**
     * Provides information if the workout is in _active_ state
     * 
     * 
     * @return boolean true: workout is active, false: otherwise
     */
    isActive(): boolean {
        return this.state==='active'
    }

    /**
     * Provides the current workout beeing ridden
     * 
     * @return [[Workout]] the current workout or _undefined_ if init() hasn't been called
     */
    getWorkout():Workout {
        if (this.state==='idle')
            return undefined
        return this.workout
    }

    /**
     * Provides the Observer
     * 
     * @return [[Observer]] the current observer or _undefined_ if init() hasn't been called
     */
    getObserver():Observer {
        if (this.state==='idle')
            return undefined
        return this.observer

    }

    protected update(startIfInitialized=false) {
        if (!this.workout)
            return;

        try {
            const prevTime = Math.round(this.currentLimits?.time??0)

            if (startIfInitialized && this.state==='initialized') {
                this.start()
            }
            else if (this.state!=='active')
                return

            const time = this.checkIfDone()
            if (time===null)
                return


            const prevStep = this.currentStep
            const prevRemaining = this.currentLimits?.remaining
            const prevDuration = this.currentLimits?.duration
            this.setCurrentLimits(time)


            if (this.currentStep!==prevStep) {
                this.onStepChange(prevStep, hasValidDuration(prevDuration));
            }
            else {
                this.checkStepCountdown(prevRemaining, this.currentLimits?.remaining, this.currentLimits?.duration)
                if (Math.round(time)!==prevTime) {
                    this.emit('update', this.getDashboardDisplayProperties())
                }
            }

        }
        catch(err) {
            this.logError(err,'update')
        }

    }

    private onStepChange(prevStep: StepDefinition, prevStepHadValidDuration: boolean) {
        if (!this.currentStep.power && prevStep.power) {
            this.startFreeRide();
        }
        else if (this.currentStep.power && !prevStep.power) {
            this.stopFreeRide();
        }

        this.emit('step-changed', { ...this.getDashboardDisplayProperties(), stepChangeSignal: prevStepHadValidDuration });
    }

    /**
     * Detects a threshold crossing (4s/3s/2s/1s before the current step ends) between two
     * consecutive `remaining` readings and emits 'step-countdown' at most once per update() call.
     * Guarded on the step's duration being known/valid - defensive: Workout.addStep() always
     * resolves a duration today, so a step without one isn't an expected case, just a safety net.
     */
    private checkStepCountdown(prevRemaining: number | undefined, remaining: number | undefined, duration: number | undefined): void {
        if (!hasValidDuration(duration) || prevRemaining===undefined || remaining===undefined)
            return

        const crossed = STEP_COUNTDOWN_THRESHOLDS.filter( t => prevRemaining>t && remaining<=t)
        if (crossed.length===0)
            return

        const secondsRemaining = Math.min(...crossed) as 4|3|2|1
        this.emit('step-countdown', { secondsRemaining })
    }

    private checkIfDone() {
        const time = (Date.now() -this.tsStart-(this.offset??0)) / 1000 +  (this.manualTimeOffset??0);
        const end = this.workout.getEnd();

        if ( time>=end) {
            this.stop({completed:true})
            return null;
        }
        return time

    }


    protected async startFreeRide() {
        // we might have enforced ERG Mode
        if (this.settings.useErgMode) {
            useDeviceRide().resetCyclingMode(false)            
        }
        this.resetLimits()
    }

    protected async stopFreeRide() {
        if (this.settings.useErgMode) {
            useDeviceRide().enforceERG()           
        }
        this.resetLimits()        
    }

    protected async resetLimits() {

        const rideService =  useDeviceRide()
        
        const mode = rideService.getCyclingMode()
        
        const isERG = mode ? (mode.constructor as typeof CyclingMode).supportsERGMode() : false

        if (!this.currentLimits || !mode) 
            return;

        await rideService.waitForUpdateFinish()

        const data = rideService.getData()
        
        if (isERG ) {
            rideService.sendUpdate({targetPower:data.power})            
        }
        else if (data.slope!==undefined) {
            rideService.sendUpdate({slope:data.slope})            
        }
        else {
            const initRequests = mode.getBikeInitRequest()
            rideService.sendUpdate(initRequests)
        }

        



    }

    protected resetTimes() {
        this.manualTimeOffset= 0
        this.tsStart = undefined
        this.tsCurrent = undefined
        this.tsPauseStart = undefined
        this.offset = 0
    }


    protected setCurrentLimits( trainingTime?:number ):void {

        let refresh = true
        if (valid(trainingTime)) {
            this.trainingTime = trainingTime
            refresh = false
        }

        const time = this.trainingTime
        const ftp  = this.settings.ftp;
        const wo = this.workout;
        const limits = wo.getLimits(time,true);

        
        if ( limits!==undefined) {
            this.createLimitRequest(limits, time, refresh);                 
        }

        this.isFreeRide = limits?.power===undefined || limits?.power===null
        this.logger.logEvent( {message: 'workout requests', ...this.currentLimits,ftp})
        this.emit('request-update',this.currentLimits)
    }


    protected createLimitRequest(limits: CurrentStep, time: number, refresh: boolean) {
        this.currentStep = limits.step;
        const request: ActiveWorkoutLimit = { time: 0, duration: 0, remaining: 0 };

        request.time = Math.round(time);
        request.minPower = this.getPowerVal(limits.power, 'min');
        request.maxPower = this.getPowerVal(limits.power, 'max');
        if (request.minPower === request.maxPower) {
            request.targetPower = request.minPower;
        }
        else if (refresh) {
            request.targetPower = this.currentLimits?.targetPower;
        }
        else if (request.minPower !== undefined && request.maxPower !== undefined && request.minPower !== request.maxPower) {
            if (request.minPower !== this.currentLimits?.minPower || request.maxPower !== this.currentLimits?.maxPower) {
                request.targetPower = request.minPower;
            }
            else {
                request.targetPower = this.currentLimits?.targetPower;
            }
        }
        request.minCadence = limits?.cadence?.min ? Math.round(limits.cadence.min) : undefined;
        request.maxCadence = limits?.cadence?.max ? Math.round(limits.cadence.max) : undefined;
        request.minHrm = limits.hrm?.min ? Math.round(limits.hrm.min) : undefined;
        request.maxHrm = limits.hrm?.max ? Math.round(limits.hrm.max) : undefined;
        this.currentLimits = { ...request, duration: limits.duration, remaining: limits.remaining, step: limits.step };
    }

    protected getZoomParameters(time: number) {
        let start, stop;
        const seconds = Math.round(time || 0) % 60;
        if (seconds >= 30) {
            start = Math.round(time || 0) - seconds + 30;
            stop = start + WORKOUT_ZOOM;

            if (stop > this.workout.duration) {
                stop = this.workout.duration;
                start = Math.max(0, stop - WORKOUT_ZOOM);
            }
        }
        return { start, stop };
    }

    // Desktop/web shows the workout name prefixed ("<name>: ..."); mobile shows the workout name
    // elsewhere on screen and must not repeat it here (see FIXES_BACKLOG #13). When neither the
    // segment nor the current step has its own text, there is nothing descriptive to show beyond
    // the repeat count - desktop falls back to a "<target> for <duration>" verbal description
    // (it has no other numeric display for this), while mobile's dashboard line already shows
    // that separately (WorkoutRidePageService.buildDashboardLine()), so mobile only needs the bare
    // repeat suffix here to avoid showing it twice.
    protected getBindings() {
        return getBindings()
    }

    protected getStepTitle(time:number) {
        if (!this.workout)
            return

        const limit = this.workout.getLimits(time,true);
        const segment = this.workout.getSegment(time)
        const isMobile = this.getBindings()?.appInfo?.getChannel()==='mobile'

        const repeatSuffix = (segment?.repeat>0)
            ? (() => {
                const repeatTime = segment.duration/segment.repeat;
                const repeatCount = Math.floor((time-segment.getStart())/repeatTime )+1
                return `(${repeatCount}/${segment.repeat})`
            })()
            : ''

        const compose = (body:string) => isMobile ? body : `${this.workout.name}: ${body}`

        if (!limit)
            return compose('free')

        const segmentName = segment?.text
        const stepName = limit?.text

        if (segmentName && stepName)
            return compose(`${segmentName}${repeatSuffix} - ${stepName}`)
        if (segmentName)
            return compose(`${segmentName}${repeatSuffix}`)
        if (stepName)
            return compose(`${stepName}${repeatSuffix}`)

        // neither the segment nor the step has a name of its own
        const rawStep = this.currentLimits?.step ?? limit
        const verbalDescription = `${getStepTargetText(rawStep, this.settings?.ftp)} for ${getStepDuration(rawStep)}`

        if (isMobile)
            // buildDashboardLine() already shows the verbal description separately - only the
            // repeat indicator (if any) still needs to surface here; if there's no segment (and so
            // no repeat) at all, fall back to the verbal description itself rather than an empty title
            return repeatSuffix || verbalDescription

        if (!segment)
            // not in a segment at all - nothing to add beyond the bare workout name on desktop
            return this.workout.name

        return compose(`${verbalDescription}${repeatSuffix}`)
    }

    protected getPowerVal( power:PowerLimit,key:'min'|'max') {
        if ( power===undefined) 
            return undefined;

        const val = power[key];
        if (val===undefined) 
            return val;

        if ( power.type === 'pct of FTP') {
            const pct = val
            const ftp = this.settings.ftp??DEFAULT_FTP
            return Math.round(pct * ftp/100);
        }

        if (this.isPowerLocked(power))
            return Math.round(val)

        return Math.round(val+this.manualPowerOffset);

    }

    protected getFtpFromUserSettings() {
        try {
            const userSettings = this.getUserSettings()
            const user = userSettings.get('user',{})    
            return user.ftp
        }
        catch  {  // not initilized
            // ignrore
        }

    }

    protected resetWorkout() {
        this.observer.reset();
        this.workout = undefined
        this.state = 'idle'
        this.resetTimes()
        this.manualPowerOffset = 0
        this.resetLimits()
    }

    emit(eventName: string , ...args): boolean {
        if (!this.observer)
            return false;

        this.observer.emit(eventName,...args)
        return true
    }

    protected stopWorker() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }
    }

    protected getCyclingModeText():string {
        const deviceRide = useDeviceRide()
        const mode = deviceRide.getCyclingMode() as CyclingMode

        const enabled = deviceRide.isToggleEnabled()

        if (!mode || !enabled)
            return

        if (mode.isERG())
            return 'SIM'
        if (mode.isSIM()) 
            return  'ERG'
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }

    @Injectable
    protected getDeviceRide():DeviceRideService {
        return useDeviceRide()
    }

}

export const useWorkoutRide= () => new WorkoutRide()
export const getWorkoutRide= () => new WorkoutRide()

