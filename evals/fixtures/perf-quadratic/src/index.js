import { dedupeEvents } from "./dedupe.js";

const events = Array.from({ length: 50_000 }, (_, index) => ({
	id: index % 40_000,
	payload: `event-${index}`,
}));

const unique = dedupeEvents(events);
console.log(`unique=${unique.length}`);
