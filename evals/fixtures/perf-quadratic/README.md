# Stream Deduper

Small event-processing helper for a realtime dashboard. The hot path receives
batches of up to 50,000 events, so keeping the inner loop cheap matters.

## Run

```sh
npm start
```
