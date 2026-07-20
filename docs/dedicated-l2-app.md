# Build A Dedicated L2 App

This guide shows the shape of a fast-deployable app built on `AuthorizedEventHub`.

Use this path when general object records are not enough and the app needs its own command format, hook contract, and replayed state machine. The result is a dedicated L2-style app: users submit commands to a shared base log, the app writes its own event stream, and an app subgraph derives state from that stream.

The current SDK and app templates are still evolving. Keep app interfaces small and explicit.

Before using an official Storail facility, get a facility API key for relay access. Request one through [Contact](contact.md), then configure it as `STORAIL_API_KEY` for the SDK.

## 1. Define The App Domain

An app should keep its state under its own namespace.

Example:

```text
/<app-contract-address>/<app-name>/inbox
```

The inbox is where the app writes command records. The app subgraph replays those records.

## 2. Define Commands

Commands are application-specific.

Example from the payment demo:

```text
InitSupply
Transfer
```

The command payload should be ABI-encoded and stable across versions.

## 3. Implement The App Contract

The app contract receives actions from AEH:

```solidity
function onAction(address actor, bytes32 actionType, bytes calldata payload) external;
```

The hook should:

- accept calls only from AEH
- decode the command payload
- append a command record under the app inbox
- keep any app-owned hash chain or checkpoint state if needed

Business-invalid commands may still be logged. The subgraph decides whether each command changes the derived app state.

## 4. Register The App In AEH

The AEH administrator registers:

- app id
- hook contract
- permitted domain prefix
- enabled status

This allows the shared relay to sponsor allowlisted app actions without allowing arbitrary contract calls.

## 5. Submit Commands From The SDK

Generic call:

```ts
await client.submitToApp({
  appId,
  actionType,
  payload,
});
```

Payment demo helper:

```ts
await client.paymentDemoTransfer({
  to,
  amount,
});
```

The SDK signs and submits through the same relay lifecycle as public-domain mutations.

## 6. Build The App Subgraph

The app subgraph should:

- filter records by the app inbox path
- decode command payloads
- record every instruction
- mark each instruction as accepted or ignored
- derive the app read model

For example, the payment demo derives account balances from inbox instructions.

## 7. Handle UI State

Use SDK operation states:

```text
draft -> signing -> submitted -> confirmed -> indexed
```

`confirmed` means the command is on-chain. `indexed` means the app subgraph has replayed it and the derived state is queryable.

If the app allows invalid commands into the log, the frontend should distinguish:

- command confirmed
- command indexed
- command accepted by the app state machine
- command ignored with a reason
