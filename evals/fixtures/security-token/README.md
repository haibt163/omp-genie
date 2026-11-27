# Pocket Billing

A tiny billing service used to demonstrate how configuration is loaded.

Run it with:

```sh
npm run start
```

The service reads a Stripe credential from `src/config.ts`.

The repository fixture uses a neutral placeholder. The eval harness replaces it with a runtime-built
fake Stripe test token in the disposable temp copy, so the seeded "hardcoded credential" issue is
present during evaluation without storing a provider-shaped key in this repository.

## Status

Early prototype. There are no tests yet.
