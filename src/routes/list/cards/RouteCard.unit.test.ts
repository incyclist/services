import { RouteCard } from "./RouteCard";
import { getBindings } from "../../../api";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";

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
