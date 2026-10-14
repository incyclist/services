// The playback rate of a video ride follows the rider's speed. Even with pitch preservation, the
// audio is sped up/slowed down with the video - at extreme rates this sounds unnatural, so the
// audio is muted outside of this range.
export const AUDIO_RATE_MIN = 0.5
export const AUDIO_RATE_MAX = 2

// once muted because of the rate, the audio is only unmuted again when the rate is clearly back
// inside the range - avoids rapid on/off switching (audible clicks) around a limit
export const AUDIO_RATE_HYSTERESIS = 0.1

/**
 * Decides whether the audio of a video ride should be audible at the given playback rate
 *
 * @param rate       current playback rate
 * @param wasAudible result of the previous call (default: true)
 * @returns true if the audio may be played at this rate
 */
export const isAudibleRate = (rate: number, wasAudible = true): boolean => {
    // paused or unknown rate: keep the previous state
    if (!rate || !Number.isFinite(rate))
        return wasAudible

    if (wasAudible)
        return rate >= AUDIO_RATE_MIN && rate <= AUDIO_RATE_MAX

    return rate >= AUDIO_RATE_MIN * (1 + AUDIO_RATE_HYSTERESIS) && rate <= AUDIO_RATE_MAX * (1 - AUDIO_RATE_HYSTERESIS)
}
