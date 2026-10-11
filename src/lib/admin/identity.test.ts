import { describe, expect, it } from 'vitest';
import type { Client, Place } from './data';
import { clientKey, placeKey } from './identity';

describe('dashboard row identity', () => {
	it('retains equal client display names on distinct networks, origins and UA versions', () => {
		const base: Client = { name: 'curl', agent: 'curl/8', origin: 'programmatic', network: 'AS42', requests: 2, errors: 0, topEndpoint: '/api/matrix', lastSeen: 0, spark: [2] };
		const clients: Client[] = [base, { ...base, network: 'AS43' }, { ...base, origin: 'bots' }, { ...base, agent: 'curl/9' }];
		expect(new Set(clients.map((client) => client.name)).size).toBe(1);
		expect(new Set(clients.map(clientKey)).size).toBe(clients.length);
		expect(clients.reduce((n, client) => n + client.requests, 0)).toBe(8);
		const updatedClient: Client = { ...base, requests: 100, lastSeen: 1 };
		expect(clientKey(updatedClient)).toBe(clientKey(base));
	});

	it('retains repeated city names across countries and coordinates', () => {
		const base: Place = { city: 'Springfield', country: 'United States', lat: 42.1, lon: -72.6, visitors: 2, api: 3 };
		const places = [base, { ...base, lat: 39.8, lon: -89.6 }, { ...base, country: 'Canada' }];
		expect(new Set(places.map((place) => place.city)).size).toBe(1);
		expect(new Set(places.map(placeKey)).size).toBe(places.length);
		const updatedPlace: Place = { ...base, visitors: 200, api: 300 };
		expect(placeKey(updatedPlace)).toBe(placeKey(base));
	});
});
