import { EventEmitter } from "events";
import { RouteCard } from "./RouteCard";
import { getBindings } from "../../../api";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { parseMp4Boxes } from "../../../video";

jest.mock("../../../video", () => ({
    parseMp4Boxes: jest.fn(),
}));

describe('RouteCard.videoExists', () => {

    const existsFile = jest.fn();

    beforeEach(() => {
        existsFile.mockReset();
        getBindings().fs = { existsFile } as any;
    });

    const createCard = (info: RouteInfo) => new RouteCard(new Route(info));

    test('returns false when the route has no video', async () => {
        const card = createCard({ hasVideo: false });
        expect(await card.videoExists()).toBe(false);
        expect(existsFile).not.toHaveBeenCalled();
    });

    test('a well-formed video:/// URL resolves to the correct absolute path', async () => {
        existsFile.mockResolvedValue(true);
        const card = createCard({ hasVideo: true, videoUrl: 'video:///mnt/nas/data/videos/route.mp4' });

        const exists = await card.videoExists();

        expect(existsFile).toHaveBeenCalledWith('/mnt/nas/data/videos/route.mp4');
        expect(exists).toBe(true);
    });

    test('a malformed video://// URL (extra leading slash) still resolves to the correct absolute path', async () => {
        existsFile.mockResolvedValue(true);
        const card = createCard({ hasVideo: true, videoUrl: 'video:////mnt/nas/data/videos/route.mp4' });

        const exists = await card.videoExists();

        expect(existsFile).toHaveBeenCalledWith('/mnt/nas/data/videos/route.mp4');
        expect(exists).toBe(true);
    });

    test('a well-formed video:/// URL with a Windows drive-letter path resolves without a stray leading slash', async () => {
        existsFile.mockResolvedValue(true);
        const card = createCard({ hasVideo: true, videoUrl: 'video:///C:\\Users\\klaus\\Videos\\Neuer Ordner\\ValGardena.mp4' });

        const exists = await card.videoExists();

        expect(existsFile).toHaveBeenCalledWith('C:\\Users\\klaus\\Videos\\Neuer Ordner\\ValGardena.mp4');
        expect(exists).toBe(true);
    });

    test('a well-formed file:/// URL resolves to the correct absolute path', async () => {
        existsFile.mockResolvedValue(true);
        const card = createCard({ hasVideo: true, videoUrl: 'file:///mnt/nas/data/videos/route.mp4' });

        const exists = await card.videoExists();

        expect(existsFile).toHaveBeenCalledWith('/mnt/nas/data/videos/route.mp4');
        expect(exists).toBe(true);
    });

    test('a malformed file://// URL (extra leading slash) still resolves to the correct absolute path', async () => {
        existsFile.mockResolvedValue(true);
        const card = createCard({ hasVideo: true, videoUrl: 'file:////mnt/nas/data/videos/route.mp4' });

        const exists = await card.videoExists();

        expect(existsFile).toHaveBeenCalledWith('/mnt/nas/data/videos/route.mp4');
        expect(exists).toBe(true);
    });

    test('returns false when the resolved local file does not exist', async () => {
        existsFile.mockResolvedValue(false);
        const card = createCard({ hasVideo: true, videoUrl: 'video:///mnt/nas/data/videos/missing.mp4' });

        expect(await card.videoExists()).toBe(false);
    });

    test('remote video URLs are treated as existing without a file check', async () => {
        const card = createCard({ hasVideo: true, videoUrl: 'https://example.com/video.mp4' });

        expect(await card.videoExists()).toBe(true);
        expect(existsFile).not.toHaveBeenCalled();
    });
});

describe('RouteCard.updateStartPos', () => {

    const createCard = (info: RouteInfo = {}) => new RouteCard(new Route(info));

    const data = { startPos: { value: 0, unit: 'km' }, realityFactor: 1 } as any;

    test('does not throw and returns null when called with undefined (malformed UI input)', () => {
        const card = createCard();
        expect(() => card.updateStartPos(undefined as any, data)).not.toThrow();
        expect(card.updateStartPos(undefined as any, data)).toBeNull();
    });

    test('does not throw and returns null when called with null', () => {
        const card = createCard();
        expect(() => card.updateStartPos(null as any, data)).not.toThrow();
        expect(card.updateStartPos(null as any, data)).toBeNull();
    });

    test('still updates the start position when called with a plain number', () => {
        const card = createCard();
        const updated = card.updateStartPos(5, data);
        expect(updated?.startPos.value).toBe(5);
    });
});

describe('RouteCard.canStart', () => {

    const createCard = (info: RouteInfo) => new RouteCard(new Route(info));

    const downloadedVideo: RouteInfo = {
        hasVideo: true,
        isDownloaded: true,
        requiresDownload: true,
        videoUrl: 'video:///home/user/Videos/route.mp4'
    } as RouteInfo;

    describe('video already available on this device', () => {

        test('a downloaded video can be started while offline', () => {
            const card = createCard(downloadedVideo);
            expect(card.canStart({ isOnline: false } as any)).toBe(true);
        });

        test('a downloaded video can be started while online', () => {
            const card = createCard(downloadedVideo);
            expect(card.canStart({ isOnline: true } as any)).toBe(true);
        });

        test('a local (imported) video can be started while offline', () => {
            const card = createCard({
                hasVideo: true, isLocal: true, requiresDownload: false,
                videoUrl: 'video:///home/user/Videos/route.mp4'
            } as RouteInfo);
            expect(card.canStart({ isOnline: false } as any)).toBe(true);
        });
    });

    describe('video not (yet) available on this device', () => {

        test('a route still awaiting its download stays gated on connectivity', () => {
            const card = createCard({
                hasVideo: true, isDownloaded: false, requiresDownload: true,
                downloadUrl: 'https://example.com/route.mp4'
            } as RouteInfo);
            expect(card.canStart({ isOnline: false } as any)).toBe(false);
            expect(card.canStart({ isOnline: true } as any)).toBe(true);
        });

        test('a video still streamed over http stays gated on connectivity', () => {
            const card = createCard({
                hasVideo: true, isDownloaded: true, requiresDownload: false,
                videoUrl: 'https://example.com/route.mp4'
            } as RouteInfo);
            expect(card.canStart({ isOnline: false } as any)).toBe(false);
        });
    });

    describe('GPX routes', () => {

        test('are blocked while offline, as no map can be rendered', () => {
            const card = createCard({ hasVideo: false } as RouteInfo);
            expect(card.canStart({ isOnline: false } as any)).toBe(false);
        });

        test('can be started while online', () => {
            const card = createCard({ hasVideo: false } as RouteInfo);
            expect(card.canStart({ isOnline: true } as any)).toBe(true);
        });
    });

    test('returns false when the card carries no route', () => {
        const card = new RouteCard(undefined as any);
        expect(card.canStart({ isOnline: true } as any)).toBe(false);
    });
});

describe('RouteCard.openSettings', () => {

    const createCard = (info: RouteInfo, details?: any) => {
        const card = new RouteCard(new Route(info));
        if (details)
            card.getData().details = details;
        return card;
    };

    const videoRouteAwaitingDetails: RouteInfo = { hasVideo: true } as RouteInfo;

    test('does not throw for a video route whose details have not been loaded yet', () => {
        const card = createCard(videoRouteAwaitingDetails);

        expect(card.getRouteData()).toBeUndefined();
        expect(() => card.openSettings()).not.toThrow();
    });

    test('reports that the details are not available yet', () => {
        const card = createCard(videoRouteAwaitingDetails);

        expect(card.openSettings().detailsAvailable).toBe(false);
    });

    test('does not claim the video is missing while the details are still unknown', () => {
        const card = createCard(videoRouteAwaitingDetails);

        const props = card.openSettings();

        expect(props.videoMissing).toBeFalsy();
        expect(props.canStart).toBe(false);
    });

    test('claims the video is missing once loaded details turn out to carry no video', () => {
        const card = createCard(videoRouteAwaitingDetails, { video: {} });

        const props = card.openSettings();

        expect(props.detailsAvailable).toBe(true);
        expect(props.videoMissing).toBe(true);
        expect(props.canStart).toBe(false);
    });

    test('reports the details as available for a GPX route once they are loaded', () => {
        const card = createCard({ hasVideo: false } as RouteInfo, { points: [] });

        expect(card.openSettings().detailsAvailable).toBe(true);
    });

});

describe('RouteCard.onVideoSelected', () => {

    const MP4_PROBE_CHUNK_SIZE = 16 * 1024 * 1024;

    const existsFile = jest.fn();
    const readHeadTail = jest.fn();
    const convert = jest.fn();
    const mockParseMp4Boxes = parseMp4Boxes as jest.Mock;

    const createCard = () => new RouteCard(new Route({} as RouteInfo, { video: {} } as any));

    const dropped = (name: string, ext: string) => ({
        type: 'file', url: `file:///videos/${name}.${ext}`, name, ext, dir: '/videos', delimiter: '/'
    });

    // flush pending microtask chains (the awaited binding calls inside remuxIfNotFaststart)
    // before emitting the conversion event a test is waiting on
    const emitOnNextTick = (emitter: EventEmitter, event: string, ...args) => {
        setImmediate(() => emitter.emit(event, ...args));
    };

    beforeEach(() => {
        existsFile.mockReset().mockResolvedValue(true);
        readHeadTail.mockReset().mockResolvedValue({ head: Buffer.from('head'), tail: Buffer.from('tail') });
        convert.mockReset();
        mockParseMp4Boxes.mockReset();

        getBindings().fs = { existsFile } as any;
        getBindings().video = { readHeadTail, convert } as any;
    });

    test('rejects unsupported formats without touching the binding', async () => {
        const card = createCard();
        const result = await card.onVideoSelected(dropped('route', 'mkv') as any);

        expect(result).toBe('Unsupported video format - Please select MP4 or AVI');
        expect(readHeadTail).not.toHaveBeenCalled();
        expect(convert).not.toHaveBeenCalled();
    });

    test('reports missing files without touching the binding', async () => {
        existsFile.mockResolvedValue(false);
        const card = createCard();
        const result = await card.onVideoSelected(dropped('route', 'mp4') as any);

        expect(result).toBe('Could not open file');
        expect(readHeadTail).not.toHaveBeenCalled();
    });

    test('an already-faststart MP4 is probed but not remuxed', async () => {
        mockParseMp4Boxes.mockReturnValue({ moovLocation: 'head' });

        const card = createCard();
        const result = await card.onVideoSelected(dropped('route', 'mp4') as any);

        expect(result).toBeNull();
        expect(readHeadTail).toHaveBeenCalledWith('file:///videos/route.mp4', MP4_PROBE_CHUNK_SIZE);
        expect(parseMp4Boxes).toHaveBeenCalledWith(Buffer.from('head'), Buffer.from('tail'));
        expect(convert).not.toHaveBeenCalled();
        expect(card.getRouteDescription().videoUrl).toBe('file:///videos/route.mp4');
        expect(card.getRouteData().video.url).toBe('file:///videos/route.mp4');
    });

    test('a non-faststart MP4 with moovLocation "tail" is remuxed, and the remuxed URL is stored', async () => {
        mockParseMp4Boxes.mockReturnValue({ moovLocation: 'tail' });
        const observer = new EventEmitter();
        convert.mockResolvedValue(observer);

        const card = createCard();
        const promise = card.onVideoSelected(dropped('route', 'mp4') as any);
        emitOnNextTick(observer, 'conversion.done', 'file:///videos/route.mp4');
        const result = await promise;

        expect(result).toBeNull();
        expect(convert).toHaveBeenCalledWith('file:///videos/route.mp4', { enforceFast: true });
        // the resulting file: URL is stored using the desktop video:// playback scheme,
        // same convention as the existing (AVI) convert()/finishConversion() path
        expect(card.getRouteDescription().videoUrl).toBe('video:///videos/route.mp4');
        expect(card.getRouteData().video.url).toBe('video:///videos/route.mp4');
    });

    test('a non-faststart MP4 with moovLocation "not-found" is treated the same as "tail" and is remuxed', async () => {
        mockParseMp4Boxes.mockReturnValue({ moovLocation: 'not-found' });
        const observer = new EventEmitter();
        convert.mockResolvedValue(observer);

        const card = createCard();
        const promise = card.onVideoSelected(dropped('route', 'mp4') as any);
        emitOnNextTick(observer, 'conversion.done', 'file:///videos/route.mp4');
        const result = await promise;

        expect(result).toBeNull();
        expect(convert).toHaveBeenCalledWith('file:///videos/route.mp4', { enforceFast: true });
        expect(card.getRouteDescription().videoUrl).toBe('video:///videos/route.mp4');
    });

    test('AVI import is unaffected: the probe/remux path is never entered', async () => {
        const card = createCard();
        const result = await card.onVideoSelected(dropped('route', 'avi') as any);

        expect(result).toBeNull();
        expect(readHeadTail).not.toHaveBeenCalled();
        expect(convert).not.toHaveBeenCalled();
        expect(parseMp4Boxes).not.toHaveBeenCalled();
        expect(card.getRouteDescription().videoUrl).toBe('file:///videos/route.avi');
    });

    test('a remux failure falls back to the original URL rather than blocking the import', async () => {
        mockParseMp4Boxes.mockReturnValue({ moovLocation: 'tail' });
        const observer = new EventEmitter();
        convert.mockResolvedValue(observer);

        const card = createCard();
        const promise = card.onVideoSelected(dropped('route', 'mp4') as any);
        emitOnNextTick(observer, 'conversion.error', new Error('ffmpeg failed'));
        const result = await promise;

        expect(result).toBeNull();
        expect(card.getRouteDescription().videoUrl).toBe('file:///videos/route.mp4');
    });

    test('skips the check entirely when the platform binding does not support it (e.g. mobile)', async () => {
        getBindings().video = {} as any;

        const card = createCard();
        const result = await card.onVideoSelected(dropped('route', 'mp4') as any);

        expect(result).toBeNull();
        expect(parseMp4Boxes).not.toHaveBeenCalled();
        expect(card.getRouteDescription().videoUrl).toBe('file:///videos/route.mp4');
    });

});
