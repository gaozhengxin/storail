# Current Deployments

This page records the public test deployments used by the current development branch.

These deployments are for development and integration testing. Do not treat them as production infrastructure.

## Arbitrum Sepolia

Network:

- chain id: `421614`
- deployment record: `codex/deployments/arbitrum-sepolia.json`
- start block: `273317938`
- deployment transaction: `0x30997724e55ac298497011bef7ebc14a1a4aa7b3ddeee602ddf9a9330d8ed181`

Contracts:

- `ERC2771Forwarder`: `0xB6152130C2F1aED0C59c6E2348592B931edf9A1d`
- `AuthorizedEventHub`: `0x50639896E45165B9D8c420AAC0090F5D6782dA8D`
- `PaymentDemoApp`: `0xd4A2945c47BD0438a180113A73206b247d0E9A1E`

## Subgraphs

Public-domain subgraph:

- Studio slug: `storail-arbitrum-sepolia`
- query URL: `https://api.studio.thegraph.com/query/1754335/storail-arbitrum-sepolia/version/latest`

Payment demo subgraph:

- Studio slug: `demo-app-payment`
- query URL: `https://api.studio.thegraph.com/query/1754335/demo-app-payment/version/latest`

## Relay Worker

Cloudflare Worker:

- URL: `https://storail-relay-worker.zhengxingao.workers.dev`
- health check: `https://storail-relay-worker.zhengxingao.workers.dev/health`
- public relayer status page: `https://storail-relay-worker.zhengxingao.workers.dev/status`

The status page intentionally hides relayer addresses and exact balances.

## Official Website

Cloudflare Worker:

- website: `https://storail.pages.dev/`
- docs: `https://storail.pages.dev/docs/`

This worker is the official project singleton. It is separate from the operator relay worker.

## Latest Recorded E2E

Direct chain E2E:

- record: `codex/deployments/arbitrum-sepolia-e2e-latest.json`
- status: `chain_passed`
- run id: `20260603032500`

SDK live E2E:

- request id: `0xb19d815bf3cb04407054cc1b7fb19db8762ee59cc3ad7c003841e0c1bed2f6e5`
- transaction: `0x00036e3b406b4170d41248b5419a6b9780885e1999ce542f5406fde5a4f52b14`
- final SDK status: `indexed`

## Local Environment

The repository does not use a root `.env` for local development. Put local configuration next to the package or script that uses it.

Useful local examples:

```text
scripts/operator/.env.example
scripts/e2e/.env.example
packages/operator/public-domain-subgraph/.env.example
packages/operator/relay-worker/.env.example
packages/developer/sdk/.env.example
packages/developer/payment-demo-subgraph/.env.example
packages/official/website/.env.example
```
