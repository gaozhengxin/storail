# Storail

Storail is a consensus-backed event log for low-frequency application state that needs public auditability without forcing users to manage gas.

It does not store bulk user content. It stores signed, append-only application events and content references, so developers can anchor important state transitions on-chain while keeping large payloads in external decentralized storage.

In practice, Storail is a low-cost stack for developers who want:

- a public event log on an EVM chain
- permissioned namespaces with explicit write authority
- gasless user transactions through an ERC-2771 relay
- uncompromising on decentralization
- a full application path that stays serverless end to end

The core model is simple:

- `AuthorizedEventHub` is the on-chain consensus event hub
- external storage networks hold the actual content
- the subgraph provides an indexed read model
- the relay worker removes end-user gas friction

This makes Storail a good fit for applications that are:

- low frequency rather than high-throughput
- extremely sensitive to user friction
- required to preserve a clear on-chain audit trail

Storail is designed to stay cheap to use and simple to deploy as a fully serverless application stack: contracts, subgraph, relay, and frontend. Compared with broader decentralized app data stacks such as ComposeDB, Tableland, or more typical IPFS-first backends, Storail is narrower and more opinionated by design, with a tighter focus on permissioned namespaces, gasless writes, off-chain content references, and a public consensus event log.

Storail adds convenience, not trust burden. It does not dilute decentralization with extra trusted layers, privileged operators, or soft-consensus substitutes; correctness, verifiability, and censorship resistance still come from public consensus.

## Development Principles For Codex And Agents

- Documentation first.
- Small, independently testable iterations.
- The SDK is the primary product.
- The on-chain event log is the source of truth.

This section is repository guidance for Codex and other development agents working in this codebase.

## CI

Run local CI before committing:

```sh
pnpm ci:local
```

This does not send chain transactions. Testnet e2e is available separately and should be run on demand:

```sh
pnpm e2e:arbitrum-sepolia
```

## Key Features

- Permissioned event logging:
  namespace owners can grant and revoke writers while preserving a public mutation history.
- Gasless writes:
  users sign typed data, and a serverless ERC-2771 relay submits the transaction on their behalf.
- Decentralized content addressing:
  content stays off-chain, while references and critical state transitions remain publicly verifiable.
- Serverless application path:
  contracts, subgraph, relay, and frontend can be composed without running a traditional application server.

See [codex/overview.md](codex/overview.md) and [codex/charter.md](codex/charter.md).

## License

Storail is released under the GNU General Public License v3.0 only. See [LICENSE](LICENSE).

Copyright (C) 2026 Defa Wang. Defa Wang is the author's pseudonym.

## Workspace

- `contracts/`: Foundry Solidity contracts and tests.
- `packages/operator/`: packages for operating a Storail facility.
- `packages/operator/public-domain-subgraph/`: The Graph subgraph for public-domain event indexing.
- `packages/operator/relay-worker/`: serverless ERC-2771 relay and storage proxy worker.
- `packages/developer/`: packages for application developers using a facility.
- `packages/developer/sdk/`: TypeScript SDK package.
- `packages/developer/payment-demo-subgraph/`: payment demo application subgraph.
- `packages/official/website/`: official singleton website and documentation deployment.
- `scripts/operator/`: facility deployment and verification scripts.
- `scripts/developer/`: developer demo deployment scripts.
- `scripts/e2e/`: project-level e2e scripts.
- `docs/`: user-facing documentation.
- `codex/`: project notes, architecture records, task history, and deployment records for Codex and other development agents.

Local `.env` files live next to the package or script that uses them. Use the adjacent `.env.example` files as templates.
