import { JsonRepository } from '../../api/repository/json'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import type { JSONObject } from '../../utils/xml'
import type { Route } from '../base/model/route'
import type { RouteShape, RouteShapeRecord } from './types'
import { buildRouteShape } from './utils'

/** Repository the shape records live in - one record per route id. */
const REPO_NAME = 'routeShapes'

/** Bump whenever the decimation changes: records of an older version are recomputed lazily. */
export const ROUTE_SHAPE_VERSION = 1

/**
 * Keeps a small, decimated preview shape (~100 points) per route, so a route list row can draw
 * its map and elevation strip without loading the route's details.
 *
 * The shapes are deliberately **not** part of the route description: all descriptions share one
 * record that is read at startup and rewritten on every save, so per-route point arrays there
 * would grow the hottest read/write path in the app. Instead every shape is its own small record
 * in the `routeShapes` repository.
 *
 * Population:
 * - new imports: {@link saveOnImport} - computed from the points already in hand at parse time
 * - existing routes: {@link backfill} - lazily, the first time the route's details are loaded.
 *   There is no migration; a missing record simply means "imported before shapes existed".
 *
 * Shapes that were computed or read in this session are resident in memory, so {@link get} is a
 * synchronous lookup - this is what feeds the summary display props of a route card.
 *
 * @noInheritDoc
 * @extends IncyclistService
 */
@Singleton
export class RouteShapeStore extends IncyclistService {

    protected shapes: Map<string,RouteShape> = new Map()
    protected loads: Map<string,Promise<RouteShape|undefined>> = new Map()
    protected repo?: JsonRepository

    constructor() {
        super('RouteShapeStore')
    }

    /**
     * Returns the shape of a route if it is resident in memory. Never touches the repository.
     *
     * @param id route id
     */
    get(id:string):RouteShape|undefined {
        if (!id)
            return undefined
        return this.shapes.get(id)
    }

    /**
     * Returns the shape of a route, reading its one record from the repository if it is not yet
     * resident. Concurrent calls for the same route share one read.
     *
     * @param id route id
     * @returns the shape, or `undefined` if none has been stored for this route (yet)
     */
    async load(id:string):Promise<RouteShape|undefined> {
        if (!id)
            return undefined

        const resident = this.shapes.get(id)
        if (resident)
            return resident

        let pending = this.loads.get(id)
        if (!pending) {
            pending = this.read(id).finally( ()=> { this.loads.delete(id) })
            this.loads.set(id, pending)
        }
        return pending
    }

    /**
     * Computes the shape of a freshly parsed route and stores it.
     *
     * The shape is resident as soon as this method is called (before the first `await`), so a
     * card built right after it has the shape without any further async step. Overwrites an
     * existing record - a re-import may have changed the geometry.
     *
     * Never throws and never rejects: a shape is optional, an import must not fail over it.
     *
     * @param route the parsed route, with its points
     */
    async saveOnImport(route:Route):Promise<void> {
        const id = route?.description?.id
        try {
            const shape = this.compute(route)
            if (!id || !shape)
                return

            this.shapes.set(id, shape)
            await this.write(id, shape)
        }
        catch(err) {
            this.logError(err as Error, 'saveOnImport', {id})
        }
    }

    /**
     * Makes sure a route whose details have just been loaded has a stored shape: reads the
     * existing record if there is one, otherwise computes the shape from the route's points and
     * writes it.
     *
     * Never throws and never rejects.
     *
     * @param route route with its details (points) loaded
     * @returns true if a shape became resident through this call, false if it already was or
     *          none could be produced
     */
    async backfill(route:Route):Promise<boolean> {
        const id = route?.description?.id
        if (!id || this.shapes.has(id))
            return false

        try {
            if (await this.load(id))
                return true

            const shape = this.compute(route)
            if (!shape)
                return false

            this.shapes.set(id, shape)
            await this.write(id, shape)
            return true
        }
        catch(err) {
            this.logError(err as Error, 'backfill', {id})
            return false
        }
    }

    /**
     * Removes a route's shape, both from memory and from the repository.
     *
     * @param id route id
     */
    async delete(id:string):Promise<void> {
        if (!id)
            return

        this.shapes.delete(id)
        try {
            await this.getRepo().delete(id)
        }
        catch(err) {
            this.logError(err as Error, 'delete', {id})
        }
    }

    protected compute(route:Route):RouteShape|undefined {
        return buildRouteShape(route?.points)
    }

    protected async read(id:string):Promise<RouteShape|undefined> {
        try {
            const record = await this.getRepo().read(id) as unknown as RouteShapeRecord
            if (!this.isValidRecord(record))
                return undefined

            // a shape computed while this read was in flight is newer - keep it
            if (!this.shapes.has(id))
                this.shapes.set(id, record.points)
            return this.shapes.get(id)
        }
        catch(err) {
            this.logError(err as Error, 'read', {id})
            return undefined
        }
    }

    protected async write(id:string, shape:RouteShape):Promise<void> {
        const record:RouteShapeRecord = { id, version:ROUTE_SHAPE_VERSION, points:shape }
        await this.getRepo().write(id, record as unknown as JSONObject)
    }

    protected isValidRecord(record:RouteShapeRecord|undefined):boolean {
        return record?.version===ROUTE_SHAPE_VERSION && Array.isArray(record.points) && record.points.length>0
    }

    @Injectable
    protected getRepo():JsonRepository {
        this.repo = this.repo ?? JsonRepository.create(REPO_NAME)
        return this.repo
    }
}

/** Returns the singleton RouteShapeStore instance. */
export const useRouteShapeStore = (): RouteShapeStore => new RouteShapeStore()
