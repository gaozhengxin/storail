# Contact

Use this page for Storail official provider requests and project contact.

## Official Provider API Keys

The official Storail provider can issue facility API keys for relay and storage-proxy access.

Email:

```text
defa.crypto@proton.me
```

Include:

- project name
- expected usage
- whether you need relay, storage proxy, or both
- contact address for follow-up

API keys are not public self-service credentials. They are issued out of band so usage limits and operator cost can be managed per project.

## Self-Hosted Operators

If you operate your own Storail facility, generate API keys from your own relay worker seed:

```sh
cd packages/operator/relay-worker
API_KEY_SEED=... pnpm generate:api-key -- --key-id developer-demo
```

Do not share relayer private keys or storage-provider credentials with application developers.
