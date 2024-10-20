const DEFAULT_WORKOUT_API_PROD = 'https://dlws.incyclist.com/api/v1/routes';

export const WORKOUT_API = 'WORKOUT_API'
export const DEFAULT_WORKOUT_API = DEFAULT_WORKOUT_API_PROD;

export const NO_CACHE = {
    headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Expires': '0',
    },
};
