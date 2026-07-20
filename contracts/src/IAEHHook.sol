pragma solidity ^0.8.24;

interface IAEHHook {
    function onAction(
        address actor,
        bytes32 actionType,
        bytes calldata payload
    ) external;
}
