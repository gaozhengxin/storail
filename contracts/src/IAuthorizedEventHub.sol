pragma solidity ^0.8.24;

interface IAuthorizedEventHub {
    function publish(
        string calldata path,
        string calldata providerId,
        string calldata pointer,
        bytes32 contentHash,
        string calldata metadata
    ) external;

    function update(
        string calldata path,
        string calldata providerId,
        string calldata pointer,
        bytes32 contentHash,
        string calldata metadata
    ) external;
}
