const DEFAULT_ROUTE_API_PROD = 'https://dlws.incyclist.com/api/v1/routes';

export const ROUTE_API = 'ROUTE_API'
export const DEFAULT_ROUTE_API = DEFAULT_ROUTE_API_PROD;

export const NO_CACHE = {
    headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Expires': '0',
    },
};
