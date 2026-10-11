import type { Client, Place } from './data';

/** Display names repeat across networks; identity follows the server's grouping. */
export const clientKey = (client: Pick<Client, 'origin' | 'agent' | 'network'>) =>
	JSON.stringify([client.origin, client.agent, client.network]);

/** City names repeat across countries and rounded geolocation coordinates. */
export const placeKey = (place: Pick<Place, 'city' | 'country' | 'lat' | 'lon'>) =>
	JSON.stringify([place.city, place.country, place.lat, place.lon]);
