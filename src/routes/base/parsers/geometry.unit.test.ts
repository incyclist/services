import { FileInfo } from "../../../api"
import { GeometryParser, Geometry, GeometryPoint, VideoPoint, GeoParserData } from "./geometry"
import type { ParseResult } from "./types"
import * as utilsModule from "../../../utils"

jest.mock("../../../api")
jest.mock("../../../utils")
jest.mock("./utils")

describe("GeometryParser", () => {
    let parser: GeometryParser
    let mockFile: FileInfo
    let mockLoader: any

    beforeEach(() => {
        parser = new GeometryParser()
        mockFile = {
            name: "test-route.json",
            path: "/test/path",
        } as Partial<FileInfo> as FileInfo

        mockLoader = {
            open: jest.fn(),
        }

        jest.spyOn(parser as any, "getLoader").mockReturnValue(mockLoader)
        jest.spyOn(utilsModule, "getFileName").mockReturnValue("test-route")
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe("import", () => {
        test("loads data from file when data parameter is not provided", async () => {
            const testGeometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 100, longitude: 11, latitude: 21, altitude: 110 },
                ],
                video_points: [],
            }

            mockLoader.open.mockResolvedValue({ error: null, data: JSON.stringify(testGeometry) })
            jest.spyOn(parser, "getData").mockResolvedValue(testGeometry)
            jest.spyOn(parser, "parse").mockResolvedValue({
                data: { distance: 100, points: [], requiresDownload: false, hasGpx: true },
                details: { id: "geo", title: "test-route", points: [], mapping: undefined },
            })

            const result = await parser.import(mockFile)

            expect(parser.getData).toHaveBeenCalledWith(mockFile, undefined)
            expect(parser.parse).toHaveBeenCalledWith(mockFile, testGeometry)
            expect(result).toHaveProperty("data")
            expect(result).toHaveProperty("details")
        })

        test("uses provided data when data parameter is supplied", async () => {
            const testGeometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }

            jest.spyOn(parser, "getData").mockResolvedValue(testGeometry)
            jest.spyOn(parser, "parse").mockResolvedValue({
                data: { distance: 0, points: [], requiresDownload: false, hasGpx: true },
                details: { id: "geo", title: "test-route", points: [], mapping: undefined },
            })

            await parser.import(mockFile, testGeometry)

            expect(parser.getData).toHaveBeenCalledWith(mockFile, testGeometry)
        })
    })

    describe("getPrimaryExtension", () => {
        test("returns json extension", () => {
            const extension = parser.getPrimaryExtension()
            expect(extension).toBe("json")
        })
    })

    describe("getCompanionExtensions", () => {
        test("returns empty array", () => {
            const extensions = parser.getCompanionExtensions()
            expect(extensions).toEqual([])
            expect(Array.isArray(extensions)).toBe(true)
        })
    })

    describe("supportsExtension", () => {
        test("returns true for json extension", () => {
            expect(parser.supportsExtension("json")).toBe(true)
        })

        test("returns true for JSON extension in uppercase", () => {
            expect(parser.supportsExtension("JSON")).toBe(true)
        })

        test("returns true for Json extension in mixed case", () => {
            expect(parser.supportsExtension("Json")).toBe(true)
        })

        test("returns false for other extensions", () => {
            expect(parser.supportsExtension("xml")).toBe(false)
            expect(parser.supportsExtension("gpx")).toBe(false)
            expect(parser.supportsExtension("txt")).toBe(false)
        })

        test("returns false for empty string", () => {
            expect(parser.supportsExtension("")).toBe(false)
        })
    })

    describe("supportsContent", () => {
        test("returns true when geometry property exists", () => {
            const data: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }
            expect(parser.supportsContent(data)).toBe(true)
        })

        test("returns true when geometry is empty array", () => {
            const data: Geometry = {
                geometry: [],
                video_points: [],
            }
            expect(parser.supportsContent(data)).toBe(true)
        })

        test("returns false when geometry is undefined", () => {
            const data = { video_points: [] } as Geometry
            expect(parser.supportsContent(data)).toBe(false)
        })

        test("returns false when data is undefined", () => {
            expect(parser.supportsContent(undefined as any)).toBe(false)
        })

        test("returns false when data is null", () => {
            expect(parser.supportsContent(null as any)).toBe(false)
        })
    })

    describe("getData", () => {
        test("returns provided data when data parameter is supplied", async () => {
            const testGeometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }

            const result = await parser.getData(mockFile, testGeometry)

            expect(result).toBe(testGeometry)
            expect(mockLoader.open).not.toHaveBeenCalled()
        })

        test("loads from file when data parameter is not provided", async () => {
            const testGeometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }

            mockLoader.open.mockResolvedValue({
                error: null,
                data: JSON.stringify(testGeometry),
            })

            jest.mocked(require("./utils").getUtf8Data).mockReturnValue(JSON.stringify(testGeometry))

            const result = await parser.getData(mockFile)

            expect(mockLoader.open).toHaveBeenCalledWith(mockFile)
            expect(result).toEqual(testGeometry)
        })

        test("throws error when file cannot be opened", async () => {
            mockLoader.open.mockResolvedValue({
                error: true,
                data: null,
            })

            await expect(parser.getData(mockFile)).rejects.toThrow(
                "Could not open file: test-route"
            )
        })

        test("throws error when JSON parsing fails", async () => {
            mockLoader.open.mockResolvedValue({
                error: null,
                data: "invalid json",
            })

            jest.mocked(require("./utils").getUtf8Data).mockReturnValue("invalid json")

            await expect(parser.getData(mockFile)).rejects.toThrow(
                "Could not open file: test-route"
            )
        })

        test("throws error when file loader throws exception", async () => {
            mockLoader.open.mockRejectedValue(new Error("File system error"))

            await expect(parser.getData(mockFile)).rejects.toThrow(
                "Could not open file: test-route"
            )
        })
    })

    describe("parse", () => {
        test("parses geometry points with correct mapping", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 100, longitude: 11, latitude: 21, altitude: 110 },
                    { distance: 200, longitude: 12, latitude: 22, altitude: 120 },
                ],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.points).toHaveLength(3)
            expect(result.details.points[0]).toEqual({
                cnt: 0,
                lat: 20,
                lng: 10,
                elevation: 100,
                routeDistance: 0,
                distance: 0,
            })
            expect(result.details.points[1]).toEqual({
                cnt: 1,
                lat: 21,
                lng: 11,
                elevation: 110,
                routeDistance: 100,
                distance: 100,
            })
            expect(result.details.points[2]).toEqual({
                cnt: 2,
                lat: 22,
                lng: 12,
                elevation: 120,
                routeDistance: 200,
                distance: 100,
            })
        })

        test("sorts geometry points by distance", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 200, longitude: 12, latitude: 22, altitude: 120 },
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 100, longitude: 11, latitude: 21, altitude: 110 },
                ],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.points[0].routeDistance).toBe(0)
            expect(result.details.points[1].routeDistance).toBe(100)
            expect(result.details.points[2].routeDistance).toBe(200)
        })

        test("removes duplicate geometry points with same distance", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 100, longitude: 11, latitude: 21, altitude: 110 },
                    { distance: 100, longitude: 11.5, latitude: 21.5, altitude: 115 },
                    { distance: 200, longitude: 12, latitude: 22, altitude: 120 },
                ],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.points).toHaveLength(3)
            expect(result.details.points[1].lng).toBe(11)
        })

        test("calculates video speed correctly", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 500, longitude: 11, latitude: 21, altitude: 110 },
                    { distance: 1000, longitude: 12, latitude: 22, altitude: 120 },
                ],
                video_points: [
                    { distance: 0, time: 0 },
                    { distance: 500, time: 50 },
                    { distance: 1000, time: 100 },
                ],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.mapping).toHaveLength(3)
            expect(result.details.mapping![0].videoSpeed).toBe(36)
            expect(result.details.mapping![1].videoSpeed).toBe(36)
            expect(result.details.mapping![2].videoSpeed).toBe(36)
        })

        test("sorts video points by time", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                ],
                video_points: [
                    { distance: 1000, time: 100 },
                    { distance: 0, time: 0 },
                    { distance: 500, time: 50 },
                ],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.mapping![0].time).toBe(0)
            expect(result.details.mapping![1].time).toBe(50)
            expect(result.details.mapping![2].time).toBe(100)
        })

        test("removes duplicate video points with same time", async () => {
            const geometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [
                    { distance: 0, time: 0 },
                    { distance: 100, time: 10 },
                    { distance: 150, time: 10 },
                    { distance: 200, time: 20 },
                ],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.mapping).toHaveLength(3)
            expect(result.details.mapping![1].distance).toBe(100)
        })

        test("returns undefined mapping when no video points", async () => {
            const geometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.mapping).toBeUndefined()
        })

        test("sets correct data properties", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 0, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 1000, longitude: 12, latitude: 22, altitude: 120 },
                ],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.data.distance).toBe(1000)
            expect(result.data.requiresDownload).toBe(false)
            expect(result.data.hasGpx).toBe(true)
            expect(result.data.points).toHaveLength(2)
        })

        test("sets correct details properties", async () => {
            const geometry: Geometry = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.id).toBe("geo")
            expect(result.details.title).toBe("test-route")
        })

        test("handles empty geometry array", async () => {
            const geometry: Geometry = {
                geometry: [],
                video_points: [],
            }

            await expect(parser.parse(mockFile, geometry)).rejects.toThrow()
        })

        test("handles undefined geometry array", async () => {
            const geometry: any = {
                video_points: [],
            }

            await expect(parser.parse(mockFile, geometry)).rejects.toThrow()
        })

        test("handles missing video_points property", async () => {
            const geometry: any = {
                geometry: [{ distance: 0, longitude: 10, latitude: 20, altitude: 100 }],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.mapping).toBeUndefined()
            expect(result.details.points).toHaveLength(1)
        })

        test("calculates distance correctly for first point", async () => {
            const geometry: Geometry = {
                geometry: [
                    { distance: 100, longitude: 10, latitude: 20, altitude: 100 },
                    { distance: 200, longitude: 11, latitude: 21, altitude: 110 },
                ],
                video_points: [],
            }

            const result = await parser.parse(mockFile, geometry)

            expect(result.details.points[0].distance).toBe(0)
            expect(result.details.points[1].distance).toBe(100)
        })
    })
})
