export type WeightedLocation = {lat: number; lon: number; value: number};

/** Connected proximity groups, including singletons. Counts weight spherical centers. */
export function clusterLocations(points: readonly WeightedLocation[], radiusKm = 180): WeightedLocation[] {
	const radians = Math.PI / 180;
	const vectors = points.map(p => {
		const lat = p.lat * radians, lon = p.lon * radians;
		return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
	});
	const parents = points.map((_, i) => i);
	const root = (i: number): number => {
		while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
		return i;
	};
	// Chord distance avoids expensive great-circle trig in the bounded pair loop.
	const threshold = (2 * Math.sin(radiusKm / (2 * 6371))) ** 2;
	for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) {
		const a = vectors[i], b = vectors[j];
		if ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2 <= threshold) parents[root(i)] = root(j);
	}
	const groups = new Map<number, {x:number; y:number; z:number; value:number; weight:number; first:number}>();
	points.forEach((p, i) => {
		const key = root(i), weight = Math.max(0, p.value);
		const g = groups.get(key) ?? {x:0,y:0,z:0,value:0,weight:0,first:i};
		g.x += vectors[i][0] * weight; g.y += vectors[i][1] * weight; g.z += vectors[i][2] * weight;
		g.value += p.value; g.weight += weight; groups.set(key, g);
	});
	return [...groups.values()].map(g => g.weight ? {
		lat: Math.atan2(g.z, Math.hypot(g.x, g.y)) / radians,
		lon: Math.atan2(g.y, g.x) / radians,
		value: g.value
	} : {...points[g.first], value:g.value});
}
