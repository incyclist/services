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
